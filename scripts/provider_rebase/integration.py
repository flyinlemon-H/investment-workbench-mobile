"""Full-window gate shared by Worker and manual/batch. Never auto applies."""
import copy
from datetime import date, datetime, timezone
import hashlib
import os
from pathlib import Path
from . import core as C
from . import revision as R
from . import evidence as E
from .store import Store

def runtime_version(module):
    path=getattr(module,'__file__',None)
    return 'provider-source-sha256:'+C.digest(dict(provider=hashlib.sha256(Path(path).read_text(encoding='utf-8-sig').encode()).hexdigest(),
        strictParser=hashlib.sha256(Path(__file__).with_name('fetch.py').read_text(encoding='utf-8-sig').encode()).hexdigest())) if path else 'fixture-provider-v1'

def provider_classes(module):
    class StrictYahooDailyProvider:
        name='yahoo'
        def fetch_daily(self,symbol,start,end):
            from .fetch import fetch
            rows,evidence,_=fetch('yahoo',symbol.canonical,start.isoformat(),end.isoformat())
            if not evidence.get('adjustmentConfirmed'):raise ValueError('SOURCE_CONTRACT_MISMATCH')
            return [module.DailyBar(**r) for r in rows]
    # Minimal fixture modules can supply their own adapter. Real production
    # modules always expose DailyBar and use the strict parser above.
    yahoo=StrictYahooDailyProvider if hasattr(module,'DailyBar') else module.YahooDailyProvider
    return {'eastmoney':module.EastMoneyDailyProvider,'yahoo':yahoo}

class ContinuityChain:
    def __init__(self,chain,history,contract=None,*,stock=None,store=None,provider_version=None,complete_check=None):
        self.chain,self.history,self.contract=chain,history,contract
        self.stock=stock or dict(priceHistory=history,marketDataFreshness={'sourceContract':contract} if contract else {})
        self.store,self.complete_check=store,complete_check
        self.provider_version=provider_version or (contract or {}).get('providerVersion','legacy-observed-v1')
        self.report=self.current_contract=self.candidate=None

    def fetch_daily(self,symbol,start,end):
        ticker=getattr(symbol,'canonical',None) or self.stock.get('code') or getattr(symbol,'code',None) or getattr(symbol,'symbol',None)
        if self.history:start=date.fromisoformat(min(r['date'] for r in self.history))
        try:bars,provider,errors=self.chain.fetch_daily(symbol,start,end)
        except Exception:
            self.report=dict(classification='REVISION_PROBE_FAILED',allowed=False)
            if self.store and ticker:self.store.record_probe(ticker,self.report)
            raise ValueError('REVISION_PROBE_FAILED') from None
        for bar in bars:
            if self.complete_check:
                bar.is_complete_bar=bool(bar.is_complete_bar and self.complete_check(date.fromisoformat(bar.date),symbol.market))
        rows=[b.to_dict() for b in bars if b.is_complete_bar]
        self.probed_rows=copy.deepcopy(rows)
        if not rows:raise ValueError('REVISION_PROBE_FAILED')
        if any(r['date']<start.isoformat() or r['date']>end.isoformat() for r in rows):raise ValueError('SOURCE_CONTRACT_MISMATCH')
        units=(self.contract or {}).get('units',{})
        self.current_contract=R.source_contract(ticker,provider,rows,self.provider_version,units)
        self.report=R.inspect(self.history,rows,self.current_contract,self.contract)
        if not self.report['allowed']:
            reason=self.report['classification']
            if reason in {'PROVIDER_REBASE_REQUIRED','PROVIDER_SWITCH','SAME_PROVIDER_REVISION','REVISION_SUSPECTED'}:
                moment=datetime.now(timezone.utc).isoformat()
                req=C.request(self.stock,ticker,end.isoformat(),moment)
                evidence=dict(units=units,adjustmentConfirmed=True,adjustmentAlgorithmVersion=self.provider_version,
                    writerGuardsConfirmed=False,calendarConfirmed=False,
                    probe=dict(start=start.isoformat(),end=end.isoformat(),mode='entire_retained_window'))
                self.candidate=R.candidate(req,provider,rows,self.provider_version,moment,evidence)
                if self.store:self.candidate_object,self.request_object=self.store.save(req,self.candidate)
                if 'UNIT_CONTRACT_INCOMPLETE' in self.candidate['blockers'] and reason=='SAME_PROVIDER_REVISION':reason='UNIT_CONTRACT_INCOMPLETE'
            elif self.store:self.store.record_probe(ticker,self.report)
            raise ValueError(reason)
        if self.store:self.store.record_probe(ticker,self.report)
        return [b for b in bars if b.is_complete_bar],provider,errors

def guarded_updater(updater,provider_module):
    """Publish the entire facts bundle only after a successful per-symbol probe."""
    installed = getattr(updater, '__market_revision_guard__', None)
    if installed:
        if installed != E.implementation_hash():raise ValueError('guard_implementation_changed')
        return updater
    def update(state,**kwargs):
        results=[];store=kwargs.pop('revision_store',None)
        if store is None:
            directory=Path(os.environ.get('LOCALAPPDATA',Path.home()))/'InvestmentWorkbench'/'market-revisions'
            store=Store(directory/'candidates.sqlite')
        for stock in state.get('stocks',[]):
            clone=copy.deepcopy(stock);history=clone.get('priceHistory') or []
            expected_base=C.digest(C.facts(stock))
            contract=(clone.get('marketDataFreshness') or {}).get('sourceContract')
            chain=kwargs.get('provider_chain')
            if chain is None:
                classes=provider_classes(provider_module)
                if contract:
                    if contract.get('canonicalProvider') not in classes:
                        results.append(dict(symbol=stock.get('code'),success=False,error='SOURCE_CONTRACT_MISMATCH'));continue
                    chain=provider_module.ProviderChain([classes[contract['canonicalProvider']]()])
                else:chain=provider_module.ProviderChain([classes['eastmoney'](),classes['yahoo']()])
            guard=ContinuityChain(chain,history,contract,stock=clone,store=store,provider_version=runtime_version(provider_module),
                complete_check=getattr(provider_module,'is_complete_trade_date',None))
            outcome=updater({'stocks':[clone]},**{**kwargs,'provider_chain':guard})
            results.extend(outcome)
            if not outcome:continue
            result=outcome[0]
            if guard.report:result.update(revisionClassification=guard.report['classification'],revisionState='revision_stable' if guard.report['allowed'] else ('revision_review_required' if guard.candidate else 'revision_failed'))
            if guard.candidate:
                result.update(candidateId=guard.candidate['candidateId'],candidateObject=getattr(guard,'candidate_object',None),
                    approvalPackageHash=guard.candidate['approvalPackageHash'],blockers=guard.candidate['blockers'])
            if not result['success']:continue
            try:
                rows=clone.get('priceHistory',[])
                if not guard.report or not guard.report['allowed']:raise ValueError('UNSAFE_WRITE_PATH_BLOCKED')
                if C.digest(C.facts(stock))!=expected_base:raise ValueError('VERSION_CONFLICT')
                R.require_stable(history,rows,result['provider'],contract)
                current=guard.current_contract
                if R.semantic_rows(rows)!=R.semantic_rows(guard.probed_rows):raise ValueError('VERSION_CONFLICT')
                if current['historyWindow']!=dict(start=rows[0]['date'],end=rows[-1]['date']):raise ValueError('VERSION_CONFLICT')
                version=R.content_hash(rows,current);preview=R.technical_preview(rows,current)
                technical_version=C.digest(dict(contentHash=version,technical=preview))
                clone['technicalIndicators']=preview['indicators']
                clone['technicalData']={**copy.deepcopy(stock.get('technicalData',{})),**preview['technicalData']}
                clone['technicalData'].update(technicalDataStatus='fresh',dataQuality='validated')
                clone['marketDataFreshness'].update(sourceContract=current,revisionStatus='revision_stable',technical_analysis_stale=False,
                    historyWriteGuard=dict(version=R.VERSION,classification='STABLE',contentHash=version))
                if (stock.get('marketDataFreshness') or {}).get('sourceMigration'):
                    clone['marketDataFreshness']['sourceMigration']=copy.deepcopy(stock['marketDataFreshness']['sourceMigration'])
                for key in ('technicalIndicators','technicalData','marketDataFreshness'):
                    clone[key].update(dataVersion=version,dataContentVersion=version,technicalVersion=technical_version,latestCompleteBar=rows[-1]['date'])
                clone['technicalIndicators']['updated_at']=clone['marketDataFreshness']['fetched_at']
                for key in C.FIELDS:stock[key]=copy.deepcopy(clone[key])
            except (ValueError,KeyError,TypeError) as error:
                result.update(success=False,error=str(error) if str(error) in R.SAFE_ERRORS else 'UNSAFE_WRITE_PATH_BLOCKED')
        return results
    update.__market_revision_guard__ = E.implementation_hash()
    return update

def resolve_baseline(store,ticker,previous):
    active=store.active(ticker)
    if not active:return previous
    bundle=active['bundle']
    if bundle['quality']!='certified_single_source':raise ValueError('provider_mismatch')
    current=bundle['stock'];old_meta=(previous or {}).get('marketDataFreshness') or {}
    migration=old_meta.get('sourceMigration') or {}
    if migration.get('generation')==active['generation'] and (old_meta.get('dataVersion')==current['marketDataFreshness']['dataVersion'] or
        (migration.get('currentVersion')==current['marketDataFreshness'].get('sourceMigration',{}).get('currentVersion') and
         old_meta.get('revisionStatus')=='revision_stable' and old_meta.get('last_trade_date','')>=current['marketDataFreshness']['last_trade_date'])):
        return previous
    resolved=copy.deepcopy(current)
    resolved['marketDataFreshness']['sourceMigration']['generation']=active['generation']
    return resolved
