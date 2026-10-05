import copy,json,tempfile,unittest
from pathlib import Path
from tests.test_provider_evidence import make,candidate
from scripts.provider_rebase import remote,core as C
from scripts.provider_rebase.store import Store
class RemoteMigrationTests(unittest.TestCase):
 def setup_candidate(self):
  req,rows,ev=make('9999.HK');ev['migrationDeployment']={'rpcVersion':remote.RPC_VERSION,'unsafeWritePathCount':0}
  return req,candidate(req,rows,ev)
 def test_capsule_revalidates_full_evidence_and_preserves_all_hashes(self):
  req,c=self.setup_candidate();p=remote.capsule(c,req)
  for field,target in [('candidate','candidateHash'),('package','approvalPackageHash'),('content','contentHash')]:self.assertEqual(C.digest(json.loads(p[field])),c[target])
  self.assertEqual(json.loads(p['base']),req['base'])
 def test_hash_consistent_but_quality_tampered_candidate_is_rejected(self):
  req,c=self.setup_candidate();c['technicalValidation']['complete']=False
  c.pop('candidateHash');c.pop('candidateId');c.pop('approvalPackageHash');c['approvalPackageHash']=C.digest(c);c['candidateHash']=C.digest(c);c['candidateId']='rebase_'+c['candidateHash']
  with self.assertRaisesRegex(ValueError,'candidate_validation_outdated'):remote.capsule(c,req)
 def test_worker_cannot_trust_task_self_reported_context_or_wrong_owner(self):
  context={'protocol':remote.RPC_VERSION,'owner':'owner','symbol':'9999.HK','status':'applied','approvalId':'receipt','previousVersion':'previous','bundle':{k:[] if k=='priceHistory' else {} for k in C.FIELDS}}
  self.assertIsNotNone(remote.worker_baseline(context,'owner','9999.HK'))
  with self.assertRaisesRegex(ValueError,'VERSION_CONFLICT'):remote.worker_baseline(context,'outsider','9999.HK')
  with self.assertRaisesRegex(ValueError,'VERSION_CONFLICT'):remote.worker_baseline(context,'owner','9998.HK')
  context['dailyAdvanced']=True;self.assertIsNone(remote.worker_baseline(context,'owner','9999.HK'))
 def test_supersession_retains_original_approval_audit_and_cannot_apply(self):
  req,c=self.setup_candidate()
  with tempfile.TemporaryDirectory() as tmp:
   store=Store(Path(tmp)/'test.sqlite');cid,rid=store.save(req,c)
   original=store.approve(cid,rid,'Approve candidate '+c['candidateHash'],'yahoo',{k:'fixture' for k in c['reviewItems']},'fixture_user')
   receipt=store.supersede_approval(c['candidateHash'],{'commit':'fixture'})
   self.assertEqual(receipt['status'],'SUPERSEDED_BY_RELEASE_BINDING');self.assertEqual(receipt['approvedAt'],original['approvedAt'])
   with self.assertRaisesRegex(ValueError,'approval_superseded'):store.apply(cid,rid,req['base'])
   import sqlite3
   from contextlib import closing
   with closing(sqlite3.connect(store.path)) as db:
    self.assertEqual(db.execute('select count(*) from approvals').fetchone()[0],1)
    self.assertEqual(db.execute('select count(*) from active').fetchone()[0],0)
    last=json.loads(db.execute('select body from events order by seq desc limit 1').fetchone()[0]);self.assertEqual(last['originalApproval'],original)
if __name__=='__main__':unittest.main()
