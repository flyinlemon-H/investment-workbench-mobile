import copy,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch,MagicMock
from tests.test_provider_evidence import make,candidate
from scripts.provider_rebase.store import Store
from scripts.provider_rebase.deployment import verify_public_deployment,PUBLIC_BASE
class DeploymentTests(unittest.TestCase):
 def expected(self):return dict(baseUrl=PUBLIC_BASE,commit='1'*40,assetVersion='fixture',guardFiles={'src/state.js':'2'*64})
 def test_exact_public_manifest_and_reject_changed_deployment(self):
  e=self.expected();response=MagicMock(status_code=200,content=b'{}');response.json.return_value=dict(deploymentCommit=e['commit'],assetVersion=e['assetVersion'],files=[dict(path='src/state.js',sha256='2'*64)])
  with patch('scripts.provider_rebase.deployment.requests.Session') as session:
   session.return_value.__enter__.return_value.get.return_value=response
   self.assertEqual(verify_public_deployment(e),e)
   response.json.return_value['deploymentCommit']='3'*40
   with self.assertRaisesRegex(ValueError,'production_guard_version_changed'):verify_public_deployment(e)
 def test_untrusted_destination_rejected_before_network(self):
  e=self.expected();e['baseUrl']='http://127.0.0.1/'
  with self.assertRaisesRegex(ValueError,'attestation_invalid'):verify_public_deployment(e)
 def test_final_package_requires_deployment_for_apply(self):
  req,rows,ev=make();ev['productionDeployment']=self.expected();c=candidate(req,rows,ev)
  with tempfile.TemporaryDirectory() as temp:
   s=Store(Path(temp)/'fixture.sqlite');cid,rid=s.save(req,c)
   s.approve(cid,rid,'Approve candidate '+c['candidateHash'],'yahoo',{k:'fixture' for k in c['reviewItems']},'fixture')
   with self.assertRaisesRegex(ValueError,'production_guard_verification_required'):s.apply(cid,rid,req['base'])
   with self.assertRaisesRegex(ValueError,'production_guard_verification_required'):s.apply(cid,rid,req['base'],production_deployment={})
   s.apply(cid,rid,req['base'],production_deployment=ev['productionDeployment'])
   self.assertIsNotNone(s.active(req['symbol']))
if __name__=='__main__':unittest.main()
