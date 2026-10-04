import copy
from datetime import date
from pathlib import Path
import sqlite3
import subprocess
import sys
import os
import json
import tempfile
import types
import unittest
from scripts.provider_rebase import core as C, revision as R
from scripts.provider_rebase.store import Store
from scripts.provider_rebase.integration import ContinuityChain, guarded_updater
from tests.test_provider_rebase import bars, evidence, NOW


def contract(rows):
    return R.source_contract('2899.HK', 'yahoo', rows, 'fixture-provider-v1', evidence()['units'])


def make_candidate(mixed=False, volume=False):
    old = bars()
    if mixed:
        old[0]['provider'] = 'eastmoney'
    stock = dict(code='2899.HK', priceHistory=old, technicalData={'oldJudgment': 'untouched'})
    req = C.request(stock, '2899.HK', old[-1]['date'], NOW)
    new = bars()
    new[20]['close'] += .000004
    if volume:
        new[21]['volume'] += 1
    return stock, req, R.candidate(req, 'yahoo', new, 'fixture-provider-v1', NOW, evidence())


class RevisionTests(unittest.TestCase):
    def test_stable_entire_window_and_append(self):
        new = bars(141)
        self.assertTrue(R.inspect(bars(), new, contract(new))['allowed'])

    def test_sub_percent_micro_drift_not_ignored(self):
        old, req, c = make_candidate()
        self.assertEqual(c['classification'], 'SAME_PROVIDER_REVISION')
        self.assertEqual(c['revisionReport']['comparison']['fields']['close']['differenceCount'], 1)
        self.assertEqual(c['type'], 'same_provider_revision')
        self.assertFalse(c['applyAllowed'])
        C.verify(c)

    def test_mixed_priority_with_same_provider_evidence(self):
        _, _, c = make_candidate(mixed=True)
        self.assertEqual(c['classification'], 'PROVIDER_REBASE_REQUIRED')
        self.assertEqual(c['type'], 'provider_rebase')
        self.assertTrue(c['revisionReport']['sameProviderRevisionDetected'])

    def test_switch_distinct_from_revision_and_contract_error(self):
        new = bars(provider='eastmoney')
        source = R.source_contract('2899.HK', 'eastmoney', new, 'fixture-provider-v1')
        self.assertEqual(R.inspect(bars(), new, source)['classification'], 'PROVIDER_SWITCH')
        self.assertEqual(R.inspect(bars(), new, source, contract(bars()))['classification'], 'PROVIDER_SWITCH')
        source['adjustment'] = 'raw'
        self.assertEqual(R.inspect(bars(), new, source)['classification'], 'SOURCE_CONTRACT_MISMATCH')

    def test_missing_coverage_is_not_stable(self):
        new = bars()[1:]
        self.assertEqual(R.inspect(bars(), new, contract(new))['classification'], 'REVISION_SUSPECTED')

    def test_volume_revision_separate_and_blocks_apply(self):
        _, _, c = make_candidate(volume=True)
        self.assertIn('VOLUME_DIFFERENCE_UNEXPLAINED', c['blockers'])
        self.assertEqual(c['revisionReport']['comparison']['fields']['volume']['differenceCount'], 1)
        self.assertEqual(c['revisionReport']['comparison']['fields']['amount']['status'], 'NOT_COMPARABLE')

    def test_unit_status_strong_is_not_confirmed(self):
        _, req, c = make_candidate()
        ev = evidence(); ev['units']['yahoo']['volume'].update(status='strong_evidence', confirmed=False)
        candidate = R.candidate(req, 'yahoo', c['stock']['priceHistory'], 'fixture-provider-v1', NOW, ev)
        self.assertIn('UNIT_CONTRACT_INCOMPLETE', candidate['blockers'])
        self.assertEqual(candidate['unitStatuses']['yahoo']['volume'], 'strong_evidence')

    def test_hash_split_time_raw_semantics_and_evidence(self):
        _, req, c = make_candidate()
        rows = copy.deepcopy(c['stock']['priceHistory'])
        for row in rows:
            row['fetched_at'] = '2026-10-05T01:00:00Z'
        changed = R.candidate(req, 'yahoo', rows, 'fixture-provider-v1', '2026-10-05T01:00:00Z', evidence())
        self.assertEqual(c['contentHash'], changed['contentHash'])
        self.assertNotEqual(c['approvalPackageHash'], changed['approvalPackageHash'])
        ev = evidence(); ev['reviewEvidence'] = 'new independent evidence'
        changed = R.candidate(req, 'yahoo', rows, 'fixture-provider-v1', NOW, ev)
        self.assertEqual(c['contentHash'], changed['contentHash'])
        self.assertNotEqual(c['approvalPackageHash'], changed['approvalPackageHash'])

    def test_integer_float_semantics_equal(self):
        a = bars(); b = copy.deepcopy(a); b[0]['volume'] = float(b[0]['volume'])
        self.assertEqual(R.content_hash(a, contract(a)), R.content_hash(b, contract(b)))

    def test_provider_version_drift_blocks(self):
        previous = contract(bars()); source = copy.deepcopy(previous); source['providerVersion'] = 'changed'
        self.assertEqual(R.inspect(bars(), bars(), source, previous)['classification'], 'SOURCE_CONTRACT_MISMATCH')

    def test_alias_registry_never_collapses_sources(self):
        self.assertNotEqual(R.canonical('eastmoney'), R.canonical('yahoo'))
        with self.assertRaises(ValueError): R.canonical('unregistered_alias')
        with unittest.mock.patch.dict(R.REGISTRY['yahoo'], aliases=['yahoo_legacy_test']):
            self.assertEqual(R.canonical('yahoo_legacy_test'), 'yahoo')

    def test_known_alias_retained_separately_and_candidate_revalidates(self):
        stock,req,c=make_candidate()
        rows=copy.deepcopy(c['stock']['priceHistory'])
        with unittest.mock.patch.dict(R.REGISTRY['yahoo'],aliases=['yahoo_legacy_test']):
            for r in rows:r.update(provider='yahoo_legacy_test',rawProviderId='yahoo_legacy_test')
            other=R.candidate(req,'yahoo_legacy_test',rows,'fixture-provider-v1',NOW,evidence())
            C.verify(other)
            self.assertEqual(other['sourceContract']['canonicalProvider'],'yahoo')
            self.assertEqual(other['sourceContract']['rawProviderId'],'yahoo_legacy_test')
            Store('unused')._revalidate(other,req)

    def test_historical_added_date_is_not_append(self):
        new=bars();old=new[:20]+new[21:]
        report=R.inspect(old,new,contract(new))
        self.assertEqual(report['classification'],'SAME_PROVIDER_REVISION')
        self.assertEqual(report['comparison']['historicalAddedDates'],[new[20]['date']])

    def test_claimed_volume_explanation_cannot_clear_unimplemented_rule(self):
        _,req,c=make_candidate(volume=True)
        ev=evidence();ev['volumeDifferenceEvidence']={'status':'confirmed','reference':'arbitrary claim'}
        other=R.candidate(req,'yahoo',c['stock']['priceHistory'],'fixture-provider-v1',NOW,ev)
        self.assertIn('VOLUME_DIFFERENCE_UNEXPLAINED',other['blockers'])

    def test_legacy_candidate_approval_cannot_bypass_volume_gate(self):
        _,req,current=make_candidate(volume=True)
        legacy=C.candidate(req,'yahoo',current['stock']['priceHistory'],'fixture-provider-v1',NOW,evidence())
        with tempfile.TemporaryDirectory() as root:
            store=Store(Path(root)/'fixture.sqlite');cid,rid=store.save(req,legacy)
            with self.assertRaisesRegex(ValueError,'candidate_invalid'):
                store.approve(cid,rid,'Approve candidate '+legacy['candidateHash'],'yahoo',{k:'fixture' for k in legacy['reviewItems']},'fixture')

    def test_perfect_factor_never_auto_applies(self):
        old=bars();new=copy.deepcopy(old)
        for r in new:
            for key in R.PRICE:r[key]=round(r[key]*.5,6)
        req=C.request({'priceHistory':old},'2899.HK',old[-1]['date'],NOW)
        ev=evidence();ev['events']=[dict(date='2027-01-01',cashDividend=5,previousClose=10)]
        c=R.candidate(req,'yahoo',new,'fixture-provider-v1',NOW,ev)
        self.assertEqual(c['eventFactors'][0]['difference'],0)
        self.assertEqual(c['approvalMode'],'USER_REVIEW')
        with tempfile.TemporaryDirectory() as root:
            store=Store(Path(root)/'fixture.sqlite');cid,rid=store.save(req,c)
            self.assertIsNone(store.active('2899.HK'))
            with self.assertRaisesRegex(ValueError,'explicit_approval'):store.apply(cid,rid,req['base'])

    def test_source_unit_contract_change_is_not_revision(self):
        previous=contract(bars());other=copy.deepcopy(previous);other['units']['yahoo']['volume']['scale']=100
        self.assertEqual(R.inspect(bars(),bars(),other,previous)['classification'],'SOURCE_CONTRACT_MISMATCH')

    def test_ratio_series_event_evidence_generic(self):
        _, req, c = make_candidate()
        ev = evidence(); ev['events'] = [dict(date='2026-05-01', cashDividend=.5, previousClose=20, reference='fixture')]
        changed = R.candidate(req, 'yahoo', c['stock']['priceHistory'], 'fixture-provider-v1', NOW, ev)
        self.assertEqual(len(changed['revisionReport']['comparison']['ratioSeries']), 140)
        self.assertEqual(changed['eventFactors'][0]['expectedFactor'], .975)
        self.assertEqual(changed['technicalPreview']['technicalData']['priceActionEvent']['status'], 'unavailable')

    def test_dual_hash_and_preview_tamper_rejected(self):
        _, _, c = make_candidate()
        for field in ('technicalPreview', 'eventFactors', 'unitStatuses'):
            other = copy.deepcopy(c); other[field] = {}
            with self.assertRaisesRegex(ValueError, 'hash'): C.verify(other)

    def test_candidate_approval_apply_atomic_on_fixture_only(self):
        stock, req, c = make_candidate(); before = copy.deepcopy(stock)
        with tempfile.TemporaryDirectory() as root:
            store = Store(Path(root) / 'fixture.sqlite'); cid, rid = store.save(req, c)
            self.assertIsNone(store.active('2899.HK'))
            with self.assertRaisesRegex(ValueError, 'explicit_approval'): store.apply(cid, rid, stock)
            store.approve(cid, rid, 'Approve candidate '+c['candidateHash'], 'yahoo', {k:'fixture reviewed' for k in c['reviewItems']}, 'fixture')
            store.apply(cid, rid, stock)
            bundle = store.active('2899.HK')['bundle']['stock']
            for key in ('marketDataFreshness', 'technicalData', 'technicalIndicators'):
                self.assertEqual(bundle[key]['dataContentVersion'], c['contentHash'])
                self.assertEqual(bundle[key]['technicalVersion'], c['stock']['technicalData']['technicalVersion'])
            self.assertEqual(stock, before)

    def test_changed_approval_evidence_cannot_reuse_approval(self):
        stock, req, c = make_candidate()
        with tempfile.TemporaryDirectory() as root:
            store = Store(Path(root) / 'fixture.sqlite'); cid, rid = store.save(req, c)
            store.approve(cid, rid, 'Approve candidate '+c['candidateHash'], 'yahoo', {k:'fixture' for k in c['reviewItems']}, 'fixture')
            ev = evidence(); ev['extra'] = 'new review'
            changed = R.candidate(req, 'yahoo', c['stock']['priceHistory'], 'fixture-provider-v1', NOW, ev)
            cid2, rid2 = store.save(req, changed)
            with self.assertRaisesRegex(ValueError, 'explicit_approval'): store.apply(cid2, rid2, stock)


class FakeBar:
    def __init__(self, row): self.__dict__.update(copy.deepcopy(row))
    def to_dict(self): return copy.deepcopy(self.__dict__)


class IntegrationTests(unittest.TestCase):
    def test_strict_yahoo_rejects_missing_adjustment_factor(self):
        from scripts.provider_rebase.integration import provider_classes
        from scripts.provider_rebase import fetch
        module=types.SimpleNamespace(DailyBar=FakeBar,EastMoneyDailyProvider=object)
        adapter=provider_classes(module)['yahoo']()
        with unittest.mock.patch.object(fetch,'fetch',return_value=(bars(),{'adjustmentConfirmed':False},'fixture')):
            with self.assertRaisesRegex(ValueError,'SOURCE_CONTRACT_MISMATCH'):
                adapter.fetch_daily(types.SimpleNamespace(canonical='2899.HK'),date(2026,1,1),date(2026,10,1))

    def test_companion_package_runs_without_workbench_imports(self):
        from scripts.provider_rebase.pc_patch import build
        source=Path(os.environ.get('MARKET_SOURCE_ROOT',''))
        if not (source/'src/market_data/updater.py').exists():self.skipTest('PC source not configured')
        plan=build(source)
        with tempfile.TemporaryDirectory() as root:
            root=Path(root);package=root/'src'/'market_data';package.mkdir(parents=True)
            (root/'src'/'__init__.py').write_text('')
            for name in ('__init__.py','provider.py','symbols.py'):
                (package/name).write_bytes((source/'src/market_data'/name).read_bytes())
            (package/'updater.py').write_text(plan['updatedSource'],encoding='utf-8')
            (package/'continuity_guard.py').write_text(plan['guardSource'],encoding='utf-8')
            shared=package/'provider_rebase';shared.mkdir()
            for name,text in plan['sharedSources'].items():(shared/name).write_text(text,encoding='utf-8')
            (root/'bars.json').write_text(json.dumps(bars()),encoding='utf-8')
            code='''import json,copy
from src.market_data.updater import update_market_data
from src.market_data.provider import DailyBar
rows=json.load(open('bars.json'));stock={'code':'2899.HK','priceHistory':copy.deepcopy(rows),'shares':7,'plans':['keep']}
class Chain:
 def fetch_daily(self,symbol,start,end):return [DailyBar(**r) for r in rows],'yahoo',[]
result=update_market_data({'stocks':[stock]},provider_chain=Chain())
assert result[0]['success'],result
assert stock['marketDataFreshness']['revisionStatus']=='revision_stable'
assert stock['shares']==7 and stock['plans']==['keep']
print('companion_package_passed')
'''
            child=subprocess.run([sys.executable,'-B','-c',code],cwd=root,env={**os.environ,'LOCALAPPDATA':str(root/'private'),'PYTHONPATH':str(root)},capture_output=True,text=True)
            self.assertEqual(child.returncode,0,child.stderr+child.stdout)
            self.assertIn('companion_package_passed',child.stdout)

    def test_full_retained_probe_overrides_seven_day_start(self):
        history = bars(900); calls = []
        class Chain:
            def fetch_daily(self, symbol, start, end):
                calls.append(start); return [FakeBar(r) for r in history], 'yahoo', []
        guard = ContinuityChain(Chain(), history, stock={'code':'2899.HK','priceHistory':history})
        guard.fetch_daily(types.SimpleNamespace(market='HK'), date(2028, 6, 1), date(2028, 7, 1))
        self.assertEqual(calls, [date(2026, 1, 1)])
        self.assertEqual(len(guard.probed_rows), 900)

    def test_probe_failure_no_write_or_secret_in_error(self):
        class Chain:
            def fetch_daily(self, *args): raise TimeoutError('secret url')
        guard = ContinuityChain(Chain(), bars(), stock={'code':'2899.HK'})
        with self.assertRaisesRegex(ValueError, '^REVISION_PROBE_FAILED$'):
            guard.fetch_daily(types.SimpleNamespace(market='HK'), date(2026, 1, 1), date(2026, 10, 1))

    def test_batch_only_affected_symbol_pauses_candidate_isolated(self):
        state = {'stocks':[dict(code=s,priceHistory=bars(),technicalData={'aiJudgment':'keep'}) for s in ('2899.HK','1810.HK')]}
        before = copy.deepcopy(state['stocks'][0])
        class Chain:
            def fetch_daily(self, symbol, start, end):
                rows = bars(141)
                if symbol.code == '2899.HK': rows[10]['close'] += .000004
                return [FakeBar(r) for r in rows], 'yahoo', []
        def updater(doc, provider_chain):
            stock = doc['stocks'][0]
            try:
                rows, p, errors = provider_chain.fetch_daily(types.SimpleNamespace(code=stock['code'],market='HK'),date(2026,5,1),date(2026,10,1))
                stock['priceHistory'] = [r.to_dict() for r in rows]
                stock['marketDataFreshness'] = {'fetched_at':NOW,'last_trade_date':rows[-1].date}
                return [dict(success=True,provider=p)]
            except ValueError as error:
                stock['marketDataFreshness'] = {'kline_status':'failed'}
                return [dict(success=False,error=str(error))]
        with tempfile.TemporaryDirectory() as root:
            store = Store(Path(root)/'fixture.sqlite')
            result = guarded_updater(updater, types.SimpleNamespace())(state,provider_chain=Chain(),revision_store=store)
            self.assertFalse(result[0]['success']); self.assertTrue(result[1]['success'])
            self.assertEqual(state['stocks'][0], before)
            self.assertEqual(len(state['stocks'][1]['priceHistory']),141)
            self.assertEqual(result[0]['revisionClassification'],'SAME_PROVIDER_REVISION')
            with sqlite3.connect(store.path) as db:
                self.assertEqual(db.execute('select count(*) from approvals').fetchone()[0],0)
                self.assertEqual(db.execute('select count(*) from active').fetchone()[0],0)
                self.assertEqual(db.execute("select count(*) from objects where kind='candidate'").fetchone()[0],1)
            db.close()


if __name__ == '__main__': unittest.main()
