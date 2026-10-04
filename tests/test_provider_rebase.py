import copy
from datetime import date,timedelta
import json
from pathlib import Path
import sqlite3
import tempfile
import os
import sys
import types
from unittest.mock import patch
import unittest
from scripts.provider_rebase import core as C
from scripts.provider_rebase.store import Store
from scripts.provider_rebase.integration import ContinuityChain,resolve_baseline,guarded_updater

NOW='2026-10-04T01:00:00+00:00'
def bars(n=140,provider='yahoo'):
    return [dict(date=(date(2026,1,1)+timedelta(days=i)).isoformat(),open=10+i/100,high=12+i/100,low=9+i/100,
        close=11+i/100,volume=1000+i,amount=None,provider=provider,adjustment='qfq',price_basis='adjusted',is_complete_bar=True,fetched_at=NOW) for i in range(n)]
def evidence():
    return dict(adjustmentConfirmed=True,calendarConfirmed=True,writerGuardsConfirmed=True,adjustmentAlgorithmVersion='fixture-v1',
        units={p:{'price':dict(confirmed=True,unit='quote_currency',currency='HKD',scale=1,evidence='fixture'),
            'volume':dict(confirmed=True,unit='shares',currency=None,scale=1,evidence='fixture')} for p in C.REGISTRY})
def setup_candidate(n=140):
    old=bars(n);old[n//2]['provider']='eastmoney'
    stock={'code':'2899.HK','priceHistory':old,'technicalIndicators':{'old':'preserved'},'plans':[{'untouched':True}],'shares':777}
    req=C.request(stock,'2899.HK',old[-1]['date'],NOW)
    c=C.candidate(req,'yahoo',bars(n),'fixture-v1',NOW,evidence())
    return stock,req,c

class PureTests(unittest.TestCase):
    def test_classification_segments(self):
        stock,_,_=setup_candidate();a=C.analyze(stock['priceHistory'])
        self.assertEqual(a['switchCount'],2);self.assertEqual(a['classification'],'MULTIPLE_PROVIDER_SWITCHES')
    def test_full_window_not_550_day_guess(self):
        s,r,c=setup_candidate();self.assertEqual(r['requestedHistoryStart'],s['priceHistory'][0]['date'])
        self.assertEqual(c['coverage']['oldOnlyDates'],[])
    def test_no_mutation_no_alias_no_auto_approval(self):
        s,r,c=setup_candidate();frozen=copy.deepcopy(s)
        C.candidate(r,'yahoo',bars(),'fixture-v1',NOW,evidence())
        self.assertEqual(s,frozen);self.assertEqual(c['validationStatus'],'review_required');self.assertEqual(c['aiJudgmentStatus'],'needs_review')
        self.assertTrue(all(x['rawProviderId']=='yahoo' for x in c['stock']['priceHistory']))
    def test_hash_binds_bars_contract_evidence_technical(self):
        _,_,c=setup_candidate();self.assertEqual(C.verify(c),c)
        for mutate in [lambda x:x['stock']['priceHistory'][0].update(close=10),lambda x:x['sourceContract'].update(priceBasis='raw'),lambda x:x['evidence'].update(calendarConfirmed=False),lambda x:x['stock']['technicalIndicators'].update(ma5=999)]:
            d=copy.deepcopy(c);mutate(d)
            with self.assertRaisesRegex(ValueError,'hash'):C.verify(d)
    def test_deterministic_hash(self):
        _,r,c=setup_candidate();self.assertEqual(c,C.candidate(r,'yahoo',bars(),'fixture-v1',NOW,evidence()))
    def test_invalid_metadata(self):
        _,r,_=setup_candidate()
        for patch in [{'provider':'eastmoney'},{'canonicalProviderId':'eastmoney'},{'rawProviderId':'other'},{'adjustment':'raw'},{'price_basis':'unknown'},{'is_complete_bar':False},{'close':float('nan')},{'volume':-1}]:
            rows=bars();rows[0].update(patch)
            with self.subTest(patch=patch),self.assertRaises(ValueError):C.candidate(r,'yahoo',rows,'v',NOW,evidence())
    def test_truncation_blocked_and_dates_reported(self):
        _,r,_=setup_candidate();c=C.candidate(r,'yahoo',bars()[10:],'v',NOW,evidence())
        self.assertIn('truncated_history',c['blockers']);self.assertEqual(len(c['coverage']['oldOnlyDates']),10)
    def test_different_price_no_invented_acceptance(self):
        _,r,_=setup_candidate();rows=bars();rows[0]['close']+=.2
        c=C.candidate(r,'yahoo',rows,'v',NOW,evidence());report=c['overlap']['fields']['close']
        self.assertEqual(report['differenceCount'],1);self.assertAlmostEqual(report['maxDifference'],.2)
        self.assertIn('close_differences_unassessed',c['reviewItems'])
    def test_volume_separate_from_price(self):
        _,r,_=setup_candidate();rows=bars();rows[0]['volume']*=100
        c=C.candidate(r,'yahoo',rows,'v',NOW,evidence())
        self.assertEqual(c['overlap']['fields']['close']['differenceCount'],0)
        self.assertEqual(c['overlap']['fields']['volume']['differenceCount'],1)
    def test_unknown_units_not_compared_or_approved(self):
        _,r,_=setup_candidate();ev=evidence();ev['units']={}
        c=C.candidate(r,'yahoo',bars(),'v',NOW,ev)
        self.assertIn('volume_units_unconfirmed',c['blockers']);self.assertEqual(c['overlap']['fields']['volume']['differenceCount'],0)
        self.assertIsNone(c['stock']['technicalIndicators']['volume_change']['change_pct'])
    def test_missing_amount_not_entire_candidate_failure(self):
        _,_,c=setup_candidate();self.assertEqual(c['overlap']['fields']['amount']['status'],'NOT_COMPARABLE');self.assertFalse(c['blockers'])
    def test_technical_recomputed_short_samples_nullable(self):
        _,_,c=setup_candidate(20);ind=c['stock']['technicalIndicators'];td=c['stock']['technicalData']
        self.assertIsNone(ind['ma60']);self.assertIsNone(ind['macd']['dif']);self.assertEqual(td['supportPrice'],11)
        self.assertEqual(td['technicalAsOf'],c['stock']['priceHistory'][-1]['date'])
    def test_illegal_symbols_and_no_fake_alias(self):
        for s in ['../2899','https://example.org','2899.HK; DROP TABLE','$(calc)','YAHOO']:
            with self.assertRaises(ValueError):C.symbol(s)
        _,r,_=setup_candidate()
        with self.assertRaises(ValueError):C.candidate(r,'eastmoney_direct',bars(),'v',NOW,evidence())
    def test_incremental_continuity(self):
        C.incremental_guard(bars(),bars(),'yahoo')
        for patch in [{'provider':'eastmoney'},{'price_basis':'raw'},{'adjustment':'raw'}]:
            old=bars();old[0].update(patch)
            with self.assertRaises(ValueError):C.incremental_guard(old,bars(),'yahoo')
        new=bars();new[0]['close']+=.2
        with self.assertRaisesRegex(ValueError,'SAME_PROVIDER_REVISION'):C.incremental_guard(bars(),new,'yahoo')
    def test_recommendation_not_old_count(self):
        x=C.recommend([dict(provider='eastmoney',candidateHash='x',blockers=[],reviewItems=[]),dict(provider='yahoo',candidateHash='y',blockers=['truncated_history'])])
        self.assertEqual(x['recommendedProvider'],'eastmoney');self.assertEqual(x['selectionStatus'],'USER_CONFIRMATION_REQUIRED')

class StoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.store=Store(Path(self.tmp.name)/'isolated.sqlite');self.stock,self.req,self.c=setup_candidate()
        self.cid,self.rid=self.store.save(self.req,self.c)
    def approve(self):
        return self.store.approve(self.cid,self.rid,'Approve candidate '+self.c['candidateHash'],'yahoo',
            {k:'explicit fixture evidence' for k in self.c['reviewItems']},'fixture reviewer')
    def test_generate_has_no_active(self):self.assertIsNone(self.store.active('2899.HK'))
    def test_apply_without_approval_rejected(self):
        with self.assertRaisesRegex(ValueError,'explicit_approval'):self.store.apply(self.cid,self.rid,self.stock)
    def test_wrong_phrase_provider_and_unresolved(self):
        for phrase,provider in [('yes','yahoo'),('Approve candidate '+self.c['candidateHash'],'eastmoney')]:
            with self.assertRaises(ValueError):self.store.approve(self.cid,self.rid,phrase,provider,{},'reviewer')
    def test_blocked_candidate_cannot_approve(self):
        ev=evidence();ev['units']={};c=C.candidate(self.req,'yahoo',bars(),'v',NOW,ev);cid,rid=self.store.save(self.req,c)
        with self.assertRaisesRegex(ValueError,'invalid'):self.store.approve(cid,rid,'Approve candidate '+c['candidateHash'],'yahoo',{},'reviewer')
    def test_changed_base_rejected(self):
        self.approve();other=copy.deepcopy(self.stock);other['priceHistory'][0]['close']+=.01
        with self.assertRaisesRegex(ValueError,'base_version'):self.store.apply(self.cid,self.rid,other)
        self.assertIsNone(self.store.active('2899.HK'))
    def test_apply_atomic_and_idempotent(self):
        self.approve();before=copy.deepcopy(self.stock);a=self.store.apply(self.cid,self.rid,self.stock)
        current=self.store.active('2899.HK');self.assertEqual(current['generation'],1)
        self.assertEqual(current['bundle']['stock']['technicalData']['technicalAsOf'],self.c['newSummary']['lastDate'])
        self.assertEqual(self.stock,before)
        self.assertTrue(self.store.apply(self.cid,self.rid,self.stock)['idempotent'])
        db=sqlite3.connect(self.store.path)
        self.assertEqual(db.execute("SELECT count(*) FROM events WHERE body LIKE '%\"action\":\"applied\"%'").fetchone()[0],1);db.close()
    def test_injected_failure_rolls_back_pointer_and_audit(self):
        self.approve()
        for stage in ['before_pointer','after_pointer']:
            def fail(s):
                if s==stage:raise OSError('simulated disk failure')
            with self.assertRaises(OSError):self.store.apply(self.cid,self.rid,self.stock,failpoint=fail)
            self.assertIsNone(self.store.active('2899.HK'))
    def test_rollback_restores_entire_previous_and_keeps_new(self):
        self.approve();a=self.store.apply(self.cid,self.rid,self.stock)
        self.store.rollback('2899.HK',1,'Rollback '+a['version']+' to '+a['previousVersion'],'fixture review')
        cur=self.store.active('2899.HK');self.assertEqual(cur['generation'],2);self.assertEqual(cur['bundle']['stock'],C.facts(self.stock))
        self.assertEqual(self.store.read(a['version'])['candidateHash'],self.c['candidateHash'])
        with self.assertRaisesRegex(ValueError,'provider_mismatch'):resolve_baseline(self.store,'2899.HK',self.stock)
    def test_conflicting_generation(self):
        self.approve()
        with self.assertRaisesRegex(ValueError,'generation_conflict'):self.store.apply(self.cid,self.rid,self.stock,2)
    def test_objects_immutable(self):
        db=sqlite3.connect(self.store.path)
        with self.assertRaises(sqlite3.IntegrityError):db.execute('UPDATE objects SET body=?',('{}',))
        db.close()
    def test_active_reader_no_creation(self):
        p=Path(self.tmp.name)/'missing.sqlite';self.assertIsNone(Store(p).active('2899.HK'));self.assertFalse(p.exists())
    def test_stale_remote_baseline_replaced_only_after_apply(self):
        self.assertEqual(resolve_baseline(self.store,'2899.HK',self.stock),self.stock)
        self.approve();self.store.apply(self.cid,self.rid,self.stock)
        chosen=resolve_baseline(self.store,'2899.HK',self.stock)
        self.assertEqual(set(x['provider'] for x in chosen['priceHistory']),{'yahoo'})

    def test_projection_preserves_business_and_requires_current_hash(self):
        from scripts.provider_rebase.projection import project
        import hashlib
        self.approve();self.store.apply(self.cid,self.rid,self.stock)
        target=Path(self.tmp.name)/'formal.json';target.write_text(json.dumps({'stocks':[self.stock],'orders':[{'unchanged':1}]}),encoding='utf-8')
        before=hashlib.sha256(target.read_bytes()).hexdigest()
        with self.assertRaisesRegex(ValueError,'target_changed'):project(self.store,'2899.HK',target,'bad',1)
        project(self.store,'2899.HK',target,before,1)
        doc=json.loads(target.read_text());self.assertEqual(doc['stocks'][0]['plans'],self.stock['plans']);self.assertEqual(doc['stocks'][0]['shares'],777)
        self.assertEqual(doc['orders'],[{'unchanged':1}]);self.assertEqual(set(x['provider'] for x in doc['stocks'][0]['priceHistory']),{'yahoo'})

class CompanionTests(unittest.TestCase):
    def test_pc_direct_merge_and_manual_failed_state_guard(self):
        from scripts.provider_rebase.pc_patch import build
        from scripts.provider_rebase import pc_guard
        from scripts.market_data_worker import load_source_updater
        source=Path(os.environ.get('MARKET_SOURCE_ROOT',''))
        if not (source/'src/market_data/updater.py').is_file():self.skipTest('PC source not configured')
        load_source_updater(source)
        plan=build(source);module=types.ModuleType('src.market_data.rebase_test');module.__package__='src.market_data'
        from scripts import provider_rebase
        from scripts.provider_rebase import integration
        with patch.dict(sys.modules,{'src.market_data.continuity_guard':pc_guard,'src.market_data.provider_rebase':provider_rebase,'src.market_data.provider_rebase.integration':integration}):exec(compile(plan['updatedSource'],'<isolated_pc_guard>','exec'),module.__dict__)
        from src.market_data.provider import DailyBar
        incoming=[DailyBar(**x) for x in bars(20)]
        merged,n=module.merge_price_history(bars(20),incoming);self.assertEqual(n,0)
        old=bars(20);old[0]['provider']='eastmoney'
        with self.assertRaisesRegex(ValueError,'PROVIDER_REBASE_REQUIRED'):module.merge_price_history(old,incoming)
        class Chain:
            def fetch_daily(self,*args):return incoming,'yahoo',[]
        stock={'code':'2899.HK','priceHistory':old,'marketDataFreshness':{'kline_status':'current'},'plans':['preserved']};before=copy.deepcopy(stock)
        result=module.update_market_data({'stocks':[stock]},provider_chain=Chain())
        self.assertFalse(result[0]['success']);self.assertEqual(stock,before)

if __name__=='__main__':unittest.main()
