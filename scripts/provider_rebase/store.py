"""Local immutable candidates and transactional active bundles. No remote RPCs.

The SQLite active pointer is authoritative for opted-in readers, not a promise
that legacy JSON/Pages consumers have received a migration. Those require a
separate reviewed deployment. Generation never goes backwards, even on rollback.
"""
from __future__ import annotations
from contextlib import contextmanager
import copy
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sqlite3
from .core import candidate, digest, encoded, facts, verify

def now():return datetime.now(timezone.utc).isoformat()

class Store:
    def __init__(self,path):
        self.path=Path(path)

    @contextmanager
    def tx(self):
        self.path.parent.mkdir(parents=True,exist_ok=True)
        db=sqlite3.connect(self.path,timeout=10,isolation_level=None)
        db.execute('PRAGMA synchronous=FULL')
        db.executescript('''
        CREATE TABLE IF NOT EXISTS objects (id TEXT PRIMARY KEY, kind TEXT NOT NULL, body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY, symbol TEXT NOT NULL, body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS active (symbol TEXT PRIMARY KEY, version TEXT NOT NULL, previous TEXT, generation INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS approvals (hash TEXT PRIMARY KEY, body TEXT NOT NULL);
        CREATE TRIGGER IF NOT EXISTS immutable_objects_update BEFORE UPDATE ON objects BEGIN SELECT RAISE(ABORT,'immutable'); END;
        CREATE TRIGGER IF NOT EXISTS immutable_objects_delete BEFORE DELETE ON objects BEGIN SELECT RAISE(ABORT,'immutable'); END;
        CREATE TRIGGER IF NOT EXISTS immutable_events_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'immutable'); END;
        CREATE TRIGGER IF NOT EXISTS immutable_events_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'immutable'); END;
        ''')
        db.execute('BEGIN IMMEDIATE')
        try:yield db;db.execute('COMMIT')
        except BaseException:db.execute('ROLLBACK');raise
        finally:db.close()

    def _put(self,db,value,kind):
        key=digest(value);data=encoded(value).decode()
        prior=db.execute('SELECT body FROM objects WHERE id=?',(key,)).fetchone()
        if prior and prior[0]!=data:raise ValueError('object_collision')
        db.execute('INSERT OR IGNORE INTO objects VALUES (?,?,?)',(key,kind,data))
        return key

    def _get(self,db,key,kind=None):
        row=db.execute('SELECT body,kind FROM objects WHERE id=?',(key,)).fetchone()
        if not row or (kind and row[1]!=kind):raise ValueError('object_not_found')
        value=json.loads(row[0])
        if digest(value)!=key:raise ValueError('stored_object_hash_mismatch')
        return value

    def _event(self,db,ticker,action,**fields):
        db.execute('INSERT INTO events(symbol,body) VALUES (?,?)',(ticker,encoded(dict(symbol=ticker,action=action,at=now(),**fields)).decode()))

    def save(self,req,value):
        verify(value)
        if req['requestId']!=value['requestId'] or digest(req['base'])!=value['baseHash']:raise ValueError('request_binding_mismatch')
        with self.tx() as db:
            rid=self._put(db,req,'request');cid=self._put(db,value,'candidate')
            self._event(db,value['symbol'],'candidate_generated',candidateId=value['candidateId'],candidateHash=value['candidateHash'],objectId=cid,requestObject=rid)
            if value.get('schemaVersion') == 2:
                for state in value['states']:
                    self._event(db,value['symbol'],state,objectId=cid,contentHash=value['contentHash'],approvalPackageHash=value['approvalPackageHash'])
        return cid,rid

    def record_probe(self,ticker,report):
        with self.tx() as db:
            self._event(db,ticker,'revision_stable' if report.get('allowed') else 'revision_failed',
                classification=report['classification'])

    def read(self,key):
        if not self.path.exists():raise ValueError('object_not_found')
        db=sqlite3.connect(self.path.resolve().as_uri()+'?mode=ro',uri=True)
        try:return self._get(db,key)
        finally:db.close()

    def pending(self,ticker=None):
        if not self.path.exists():return []
        db=sqlite3.connect(self.path.resolve().as_uri()+'?mode=ro',uri=True)
        try:
            results=[]
            requests={json.loads(body)['requestId']:oid for oid,body in db.execute("SELECT id,body FROM objects WHERE kind='request'")}
            for oid,body in db.execute("SELECT id,body FROM objects WHERE kind='candidate' ORDER BY rowid DESC"):
                c=json.loads(body)
                if ticker and c['symbol']!=ticker:continue
                if db.execute('SELECT 1 FROM approvals WHERE hash=?',(c['candidateHash'],)).fetchone():continue
                results.append(dict(objectId=oid,requestObject=requests.get(c['requestId']),symbol=c['symbol'],candidateId=c['candidateId'],
                    candidateHash=c['candidateHash'],approvalPackageHash=c.get('approvalPackageHash'),
                    classification=c.get('classification'),validationStatus=c['validationStatus'],blockers=c['blockers']))
                if len(results)>=100:break
            return results
        finally:db.close()

    def approve(self,cid,rid,phrase,provider,resolutions,actor):
        with self.tx() as db:
            c=verify(self._get(db,cid,'candidate'));req=self._get(db,rid,'request')
            if c['requestId']!=req['requestId']:raise ValueError('request_binding_mismatch')
            self._revalidate(c,req)
            if phrase!='Approve candidate '+c['candidateHash']:raise ValueError('explicit_approval_required')
            if c['blockers']:raise ValueError('candidate_invalid')
            if provider!=c['sourceContract']['canonicalProvider']:raise ValueError('provider_confirmation_required')
            if not actor or any(not str(resolutions.get(k,'')).strip() for k in c['reviewItems']):raise ValueError('unresolved_review_items')
            approval=dict(candidateId=c['candidateId'],candidateHash=c['candidateHash'],objectId=cid,requestObject=rid,
                provider=provider,resolutions=resolutions,actor=actor,approvedAt=now(),baseHash=c['baseHash'])
            if c.get('schemaVersion') == 2:
                approval.update(contentHash=c['contentHash'],approvalPackageHash=c['approvalPackageHash'])
            existing=db.execute('SELECT body FROM approvals WHERE hash=?',(c['candidateHash'],)).fetchone()
            if existing:return json.loads(existing[0])
            db.execute('INSERT INTO approvals VALUES (?,?)',(c['candidateHash'],encoded(approval).decode()))
            self._event(db,c['symbol'],'approved',**approval)
            return approval

    def _revalidate(self,c,req):
        constructor=candidate
        if c.get('schemaVersion') == 2:
            from .revision import candidate as constructor
        rebuilt=constructor(req,c['sourceContract']['rawProviderId'] if c.get('schemaVersion')==2 else c['sourceContract']['canonicalProvider'],c['stock']['priceHistory'],
            c['sourceContract']['providerVersion'],c['generatedAt'],c['evidence'])
        if rebuilt['candidateHash']!=c['candidateHash']:raise ValueError('candidate_validation_outdated')
        if c.get('schemaVersion') == 1:
            # Read old immutable objects, but do not let the legacy approval
            # route bypass newly required unit and changed-volume gates.
            from .revision import source_contract, unit_gate, compare
            contract=source_contract(c['symbol'],c['sourceContract']['canonicalProvider'],c['stock']['priceHistory'],
                c['sourceContract']['providerVersion'],c['evidence'].get('units'))
            _,blockers=unit_gate(contract,req['base']['priceHistory'],c['evidence'],
                compare(req['base']['priceHistory'],c['stock']['priceHistory']))
            if blockers:raise ValueError('candidate_invalid')

    def active(self,ticker):
        # A normal reader must not initialize/create a database.
        if not self.path.exists():return None
        db=sqlite3.connect(self.path.resolve().as_uri()+'?mode=ro',uri=True)
        try:
            row=db.execute('SELECT version,previous,generation FROM active WHERE symbol=?',(ticker,)).fetchone()
            if not row:return None
            return dict(version=row[0],previousVersion=row[1],generation=row[2],bundle=self._get(db,row[0],'version'))
        finally:db.close()

    def apply(self,cid,rid,base,expected_generation=0,failpoint=None):
        with self.tx() as db:
            c=verify(self._get(db,cid,'candidate'));req=self._get(db,rid,'request')
            self._revalidate(c,req)
            row=db.execute('SELECT version,previous,generation FROM active WHERE symbol=?',(c['symbol'],)).fetchone()
            if row:
                current=self._get(db,row[0],'version')
                if current.get('candidateHash')==c['candidateHash']:return dict(version=row[0],generation=row[2],idempotent=True)
            approved=db.execute('SELECT body FROM approvals WHERE hash=?',(c['candidateHash'],)).fetchone()
            if not approved:raise ValueError('explicit_approval_required')
            approval=json.loads(approved[0])
            if approval['objectId']!=cid or approval['requestObject']!=rid or c['blockers']:raise ValueError('approval_binding_mismatch')
            if c.get('schemaVersion') == 2 and (approval.get('contentHash')!=c['contentHash'] or approval.get('approvalPackageHash')!=c['approvalPackageHash']):raise ValueError('approval_binding_mismatch')
            if (row[2] if row else 0)!=expected_generation:raise ValueError('generation_conflict')
            current_facts=facts(current['stock']) if row else facts(base)
            if digest(current_facts)!=c['baseHash'] or req['baseHash']!=c['baseHash']:raise ValueError('base_version_changed')
            if row:previous=row[0]
            else:previous=self._put(db,dict(symbol=c['symbol'],stock=req['base'],sourceContract=req['base']['marketDataFreshness'].get('sourceContract'),quality='legacy_archived',reason='pre_rebase_snapshot'),'version')
            stock=copy.deepcopy(c['stock']);mf=stock['marketDataFreshness']
            mf.update(kline_status='current',dataVersion=c['candidateHash'],resultVersion=c['candidateHash'],
                sourceMigration=dict(previousVersion=previous,currentVersion=c['candidateHash'],generation=expected_generation+1,
                    aiJudgmentStatus='needs_review',reason='history_source_changed'))
            stock['technicalData'].update(technicalDataStatus='fresh',dataQuality='validated',dataVersion=c['candidateHash'])
            stock['technicalIndicators']['dataVersion']=c['candidateHash']
            if c.get('schemaVersion') == 2:
                mf['sourceMigration'].update(reason='same_source_history_revision' if c['type']=='same_provider_revision' else 'history_source_changed',
                    approvalPackageHash=c['approvalPackageHash'])
                mf.update(revisionStatus='applied',technical_analysis_stale=False)
            bundle=dict(symbol=c['symbol'],candidateHash=c['candidateHash'],sourceContract=c['sourceContract'],stock=stock,quality='certified_single_source')
            version=self._put(db,bundle,'version')
            if failpoint:failpoint('before_pointer')
            db.execute('INSERT INTO active VALUES (?,?,?,?) ON CONFLICT(symbol) DO UPDATE SET version=excluded.version,previous=excluded.previous,generation=excluded.generation',
                (c['symbol'],version,previous,expected_generation+1))
            self._event(db,c['symbol'],'applied',candidateId=c['candidateId'],candidateHash=c['candidateHash'],fromVersion=previous,toVersion=version,generation=expected_generation+1,approvalHash=digest(approval))
            if failpoint:failpoint('after_pointer')
            return dict(version=version,previousVersion=previous,generation=expected_generation+1)

    def rollback(self,ticker,expected_generation,phrase,reason):
        with self.tx() as db:
            row=db.execute('SELECT version,previous,generation FROM active WHERE symbol=?',(ticker,)).fetchone()
            if not row or not row[1]:raise ValueError('no_previous_version')
            if row[2]!=expected_generation:raise ValueError('generation_conflict')
            if phrase!='Rollback '+row[0]+' to '+row[1] or not reason.strip():raise ValueError('explicit_rollback_required')
            self._get(db,row[1],'version')
            db.execute('UPDATE active SET version=?,previous=?,generation=? WHERE symbol=?',(row[1],row[0],row[2]+1,ticker))
            self._event(db,ticker,'rolled_back',fromVersion=row[0],toVersion=row[1],generation=row[2]+1,reason=reason)
            return dict(version=row[1],generation=row[2]+1)
