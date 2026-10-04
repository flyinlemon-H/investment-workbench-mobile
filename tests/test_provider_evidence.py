import copy
from pathlib import Path
import tempfile
import unittest
from scripts.provider_rebase import core as C, revision as R, evidence as E
from scripts.provider_rebase.store import Store
from tests.test_provider_rebase import bars, NOW

VERSION='fixture-implementation-v1'
def make(ticker='1810.HK'):
    old=bars(140)
    for row in old[:3]:row['provider']='eastmoney'
    new=bars(140);new[20]['close']+=.000004;new[-1]['volume']-=7
    req=C.request(dict(code=ticker,priceHistory=old,technicalData={'oldAI':'preserve'},plans=['keep'],orders=['keep']),ticker,old[-1]['date'],NOW)
    ev=dict(validationProfile=E.PROFILE,guardImplementationHash=E.implementation_hash(),providerConfirmation=dict(symbol=ticker,provider='yahoo'),
        adjustmentConfirmed=True,calendarConfirmed=True,writerGuardsConfirmed=True,adjustmentAlgorithmVersion='fixture',units={},
        guardDelivery=dict(scope='isolated-fixture',paths={p:dict(status='delivered',implementationHash='a'*64,testHash='b'*64) for p in E.WRITE_PATHS}))
    for provider in ('yahoo','eastmoney'):
        ev['units'][provider]={'amount':dict(evidenceLevel='UNKNOWN',availability='NOT_AVAILABLE')}
        source=new if provider=='yahoo' else old
        for field in ('price','volume'):
            unit='HKD/share' if field=='price' else 'shares'
            samples=[dict(date=r['date'],symbol=ticker,providerValue=r['volume'],exchangeValue=r['volume'],exchangeUnit=unit,providerUnit=unit,sourceUrl='https://www.hkex.com.hk/fixture',sourceHash='c'*64) for r in source[:2]]
            proof=dict(profile=E.PROFILE,symbol=ticker,provider=provider,market='HK',field=field,canonicalField=E.FIELDS[provider][field],providerVersion=VERSION,
                normalizationVersion=R.NORMALIZATION,parserReplayHash='d'*64,rawHash='e'*64,samples=samples)
            ev['units'][provider][field]=dict(evidenceLevel='EMPIRICALLY_VALIDATED',confirmed=False,unit=unit,currency='HKD' if field=='price' else None,scale=1,evidence='fixture official cross-check',validation=proof)
    ev['volumeValidation']=dict(records=[dict(date=new[-1]['date'],symbol=ticker,provider='yahoo',canonicalField=E.FIELDS['yahoo']['volume'],oldValue=old[-1]['volume'],candidateValue=new[-1]['volume'],exchangeValue=new[-1]['volume'],sourceUrl='https://www.hkex.com.hk/fixture',sourceHash='c'*64,rawHash='e'*64,unit='shares',scale=1,scopeUnchanged=True)])
    ev['providerMetadata']=dict(canonicalField=E.FIELDS['yahoo']['volume'],canonicalValue=new[-1]['volume'],unusedField='meta.regularMarketVolume',unusedValue=old[-1]['volume'])
    return req,new,ev

def candidate(req,rows,ev):return R.candidate(req,'yahoo',rows,VERSION,NOW,ev)

class EvidenceTests(unittest.TestCase):
    def test_empirical_contract_not_promoted_to_confirmed(self):
        req,rows,ev=make();c=candidate(req,rows,ev);C.verify(c)
        self.assertFalse(c['blockers']);self.assertEqual(c['schemaVersion'],3)
        self.assertFalse(c['unitEvidence']['yahoo']['volume']['confirmed'])
        self.assertEqual(c['unitStatuses']['yahoo']['volume'],'EMPIRICALLY_VALIDATED')
    def test_other_symbol_same_policy(self):
        for ticker in ('1357.HK','2513.HK'):
            self.assertFalse(candidate(*make(ticker))['blockers'])
    def test_amount_absence_is_not_apply_blocker(self):
        self.assertNotIn('UNIT_CONTRACT_INCOMPLETE',candidate(*make())['blockers'])
        req,rows,ev=make();ev['amountRequired']=True
        self.assertIn('UNIT_CONTRACT_INCOMPLETE',candidate(req,rows,ev)['blockers'])
    def test_strong_evidence_does_not_pass(self):
        req,rows,ev=make();ev['units']['yahoo']['volume']['evidenceLevel']='STRONG_EVIDENCE'
        self.assertIn('UNIT_CONTRACT_INCOMPLETE',candidate(req,rows,ev)['blockers'])
    def test_wrong_symbol_scope_rejected(self):
        req,rows,ev=make();ev['units']['yahoo']['volume']['validation']['symbol']='2899.HK'
        self.assertIn('UNIT_CONTRACT_INCOMPLETE',candidate(req,rows,ev)['blockers'])
    def test_wrong_implementation_rejected(self):
        req,rows,ev=make();ev['units']['yahoo']['volume']['validation']['providerVersion']='other'
        self.assertIn('UNIT_CONTRACT_INCOMPLETE',candidate(req,rows,ev)['blockers'])
    def test_wrong_canonical_field_rejected(self):
        req,rows,ev=make();ev['units']['yahoo']['volume']['validation']['canonicalField']='meta.regularMarketVolume'
        self.assertIn('UNIT_CONTRACT_INCOMPLETE',candidate(req,rows,ev)['blockers'])
    def test_false_exchange_value_rejected(self):
        req,rows,ev=make();ev['units']['yahoo']['volume']['validation']['samples'][0]['exchangeValue']+=1
        self.assertIn('UNIT_CONTRACT_INCOMPLETE',candidate(req,rows,ev)['blockers'])
    def test_official_url_and_raw_hash_required(self):
        for patch in ('url','raw','single'):
            req,rows,ev=make();proof=ev['units']['yahoo']['volume']['validation']
            if patch=='url':proof['samples'][0]['sourceUrl']='https://www.hkex.com.hk.evil.invalid/x'
            elif patch=='raw':proof['rawHash']='not-a-hash'
            else:proof['samples']=proof['samples'][:1]
            self.assertIn('UNIT_CONTRACT_INCOMPLETE',candidate(req,rows,ev)['blockers'])
    def test_bad_scale_rejected(self):
        for value in (True,0,-1,100):
            req,rows,ev=make();ev['units']['yahoo']['volume']['scale']=value
            self.assertIn('UNIT_CONTRACT_INCOMPLETE',candidate(req,rows,ev)['blockers'])
    def test_all_changed_dates_need_records(self):
        req,rows,ev=make();rows[-2]['volume']+=1
        self.assertIn('VOLUME_DIFFERENCE_UNEXPLAINED',candidate(req,rows,ev)['blockers'])
    def test_volume_record_binds_old_new_official_field(self):
        for key,value in [('oldValue',1),('candidateValue',1),('exchangeValue',1),('canonicalField','meta.regularMarketVolume'),('scopeUnchanged',False)]:
            req,rows,ev=make();ev['volumeValidation']['records'][0][key]=value
            self.assertIn('VOLUME_DIFFERENCE_UNEXPLAINED',candidate(req,rows,ev)['blockers'])
    def test_meta_warning_without_canonical_override(self):
        req,rows,ev=make();c=candidate(req,rows,ev)
        self.assertIn('KNOWN_PROVIDER_INCONSISTENCY',c['warnings'])
        self.assertEqual(c['stock']['priceHistory'][-1]['volume'],rows[-1]['volume'])
        self.assertIn('PROVIDER_META_INCONSISTENCY',c['revisionCategories'])
    def test_primary_rebase_multi_field_and_ai(self):
        c=candidate(*make());self.assertEqual(c['type'],'provider_rebase')
        self.assertIn('MULTI_FIELD_REVISION',c['revisionCategories'])
        self.assertEqual(c['aiJudgmentStatus'],'needs_review');self.assertEqual(c['discussionPolicy'],'preserve_history_warn_source_changed')
        self.assertFalse(c['applyAllowed'])
    def test_deterministic_hashes_and_evidence_rebind(self):
        req,rows,ev=make();a=candidate(req,rows,ev);b=candidate(req,rows,ev)
        self.assertEqual(a['candidateHash'],b['candidateHash']);ev['auditNote']='new material';b=candidate(req,rows,ev)
        self.assertEqual(a['contentHash'],b['contentHash']);self.assertNotEqual(a['approvalPackageHash'],b['approvalPackageHash'])
    def test_full_technical_volume_preview(self):
        c=candidate(*make());td=c['stock']['technicalData'];self.assertTrue(c['technicalValidation']['complete'])
        self.assertEqual(td['volumeStatus'],'comparable');self.assertIsNotNone(td['volumeAvg20']);self.assertIsNotNone(td['volumeChangePct'])
        self.assertEqual(td['priceActionEvent']['status'],'unavailable')
    def test_incomplete_technical_blocked(self):
        req,rows,ev=make();rows[-5]['volume']=None
        self.assertIn('TECHNICAL_PREVIEW_INCOMPLETE',candidate(req,rows,ev)['blockers'])
    def test_missing_writer_never_ready(self):
        req,rows,ev=make();ev['guardDelivery']['paths']['browser_result']['status']='release_pending'
        self.assertIn('writer_deployment_not_confirmed',candidate(req,rows,ev)['blockers'])
    def test_guard_version_bound(self):
        req,rows,ev=make();ev['guardImplementationHash']='f'*64
        self.assertIn('guard_implementation_changed',candidate(req,rows,ev)['blockers'])
    def test_unapproved_hash_change_and_atomic_rollback(self):
        req,rows,ev=make();c=candidate(req,rows,ev);before=copy.deepcopy(req['base'])
        with tempfile.TemporaryDirectory() as root:
            s=Store(Path(root)/'synthetic.sqlite');cid,rid=s.save(req,c)
            with self.assertRaisesRegex(ValueError,'explicit_approval'):s.apply(cid,rid,before)
            s.approve(cid,rid,'Approve candidate '+c['candidateHash'],'yahoo',{k:'fixture' for k in c['reviewItems']},'fixture')
            ev['auditNote']='changed';other=candidate(req,rows,ev);cid2,rid2=s.save(req,other)
            with self.assertRaisesRegex(ValueError,'explicit_approval'):s.apply(cid2,rid2,before)
            def crash(stage):
                if stage=='after_pointer':raise RuntimeError('fixture crash')
            with self.assertRaises(RuntimeError):s.apply(cid,rid,before,failpoint=crash)
            self.assertIsNone(s.active(req['symbol']))
            result=s.apply(cid,rid,before);active=s.active(req['symbol'])
            for key in C.FIELDS:self.assertIn(key,active['bundle']['stock'])
            self.assertEqual(active['bundle']['stock']['technicalData']['technicalVersion'],c['stock']['technicalData']['technicalVersion'])
            with self.assertRaisesRegex(ValueError,'generation_conflict'):s.rollback(req['symbol'],0,'bad','fixture')
            s.rollback(req['symbol'],1,'Rollback '+result['version']+' to '+result['previousVersion'],'fixture')
            self.assertEqual(s.active(req['symbol'])['bundle']['stock'],before)
            self.assertEqual(s.read(result['version'])['candidateHash'],c['candidateHash'])
    def test_blocked_candidate_cannot_be_approved(self):
        req,rows,ev=make();ev['guardDelivery']['paths']={};c=candidate(req,rows,ev)
        with tempfile.TemporaryDirectory() as root:
            s=Store(Path(root)/'synthetic.sqlite');cid,rid=s.save(req,c)
            with self.assertRaisesRegex(ValueError,'candidate_invalid'):s.approve(cid,rid,'Approve candidate '+c['candidateHash'],'yahoo',{},'fixture')

if __name__=='__main__':unittest.main()
