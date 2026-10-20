import copy,gzip,json,unittest
from pathlib import Path
from unittest.mock import patch
from scripts.provider_rebase import daily_protocol as D,canonical as K
from scripts.market_worker_errors import DAILY_ERRORS,public_error,error_label

class BoundedProtocolTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root=Path(__file__).resolve().parents[1]
        cls.f=json.loads(gzip.decompress((root/'tests/fixtures/bounded_daily_archived.json.gz').read_bytes()))
    def setUp(self):
        b=copy.deepcopy(self.f['bundle'])
        self.c=dict(protocol=D.VERSION,symbol='2899.HK',enabled=True,generation=0,versionId='baseline',bundle=b,
            bundleHash=K.facts_hash(b),identityHash=D.identity(b),observation=self.f['observations']['A'])
        self.task=dict(taskId='44444444-4444-4444-8444-444444444444')
    def build(self):return D.build(self.c,self.task,self.f['observations']['B'],self.f['observations']['C'])
    def test_actual_revision_retains_evidence_without_confirmed_upgrade(self):
        before=copy.deepcopy(self.c);p=self.build();self.assertEqual(len(p['bundle']['priceHistory']),436)
        units=p['bundle']['marketDataFreshness']['sourceContract']['units']['yahoo']
        for field in ('price','volume'):
            self.assertFalse(units[field]['confirmed']);self.assertEqual(units[field]['evidenceLevel'],'EMPIRICALLY_VALIDATED')
        self.assertEqual(self.c,before);self.assertNotEqual(p['bundleHash'],self.c['bundleHash'])
    def test_disabled_gate(self):
        self.c['enabled']=False
        with self.assertRaisesRegex(ValueError,'DAILY_POLICY_DISABLED'):self.build()
    def test_remote_bundle_tamper(self):
        self.c['bundle']['priceHistory'][0]['close']+=1
        with self.assertRaisesRegex(ValueError,'DAILY_BASELINE_INVALID'):self.build()
    def test_source_unit_removal_not_silently_inherited(self):
        self.c['bundle']['marketDataFreshness']['sourceContract']['units']['yahoo']['volume']['validation']={}
        self.c['bundleHash']=K.facts_hash(self.c['bundle']);self.c['identityHash']=D.identity(self.c['bundle'])
        with self.assertRaisesRegex(ValueError,'UNIT_CONTRACT_INCOMPLETE'):self.build()
    def test_technical_versions_align(self):
        b=self.build()['bundle'];meta=b['marketDataFreshness']
        for key in ('technicalData','technicalIndicators'):
            for field in ('dataContentVersion','technicalVersion','latestCompleteBar'):self.assertEqual(b[key][field],meta[field])
        self.assertEqual(b['technicalData']['aiJudgmentStatus'],'needs_review');self.assertTrue(meta['is_complete_bar'])
    def test_complete_cutoff_replays_observed_intraday_exclusion(self):
        rows=D.rows_from(self.f['observations']['C']);self.assertEqual(rows[-1]['date'],'2026-10-16')
        self.assertNotIn('2026-10-20',[r['date'] for r in rows])
    def test_raw_hash_tamper(self):
        o=copy.deepcopy(self.f['observations']['B']);o['rawHash']='0'*64
        with self.assertRaisesRegex(ValueError,'RAW_OUTPUT_MISMATCH'):D.rows_from(o)
    def test_no_old_rebase_marker_rewrite(self):
        self.assertEqual(self.build()['bundle']['marketDataFreshness']['sourceMigration'],self.c['bundle']['marketDataFreshness']['sourceMigration'])
    def test_fixed_public_reasons_and_unknown_secret_redaction(self):
        for code in DAILY_ERRORS:self.assertEqual(public_error(ValueError(code)),code);self.assertTrue(error_label(code))
        self.assertEqual(public_error(ValueError('https://private.invalid/?token=not-real')),'pipeline_failure')
    def test_review_evidence_no_authorization(self):
        error=D.ReviewRequired('PRICE_DELTA_EXCEEDED',{'status':'review_required','automaticApproval':False})
        self.assertEqual(public_error(error),'PRICE_DELTA_EXCEEDED');self.assertFalse(error.review_evidence['automaticApproval'])
    def test_ordinary_continuity_uses_empirical_units_without_allowing_revision(self):
        from scripts.provider_rebase.integration import ContinuityChain
        from types import SimpleNamespace
        from datetime import date
        rows=D.rows_from(self.f['observations']['C'])
        bars=[SimpleNamespace(is_complete_bar=True,to_dict=lambda row=r:copy.deepcopy(row)) for r in rows]
        chain=SimpleNamespace(fetch_daily=lambda *args:(bars,'yahoo',[]))
        stock=copy.deepcopy(self.c['bundle']);stock['code']='2899.HK'
        contract=stock['marketDataFreshness']['sourceContract']
        guard=ContinuityChain(chain,stock['priceHistory'],contract,stock=stock,provider_version=contract['providerVersion'])
        with self.assertRaisesRegex(ValueError,'SAME_PROVIDER_REVISION'):
            guard.fetch_daily(SimpleNamespace(canonical='2899.HK'),date(2025,1,9),date(2026,10,16))
        self.assertNotIn('UNIT_CONTRACT_INCOMPLETE',guard.candidate['blockers'])
        self.assertFalse(contract['units']['yahoo']['price']['confirmed'])
        self.assertFalse(guard.report['allowed'])

if __name__=='__main__':unittest.main()
