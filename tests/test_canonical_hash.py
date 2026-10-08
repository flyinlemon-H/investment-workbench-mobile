import copy,json,sqlite3,tempfile,unittest
from contextlib import closing
from pathlib import Path
from scripts.provider_rebase import canonical as K,core as C
from scripts.provider_rebase.store import Store
from tests.test_provider_evidence import make,candidate

class CanonicalTests(unittest.TestCase):
 def test_golden_vectors(self):
  cases=json.loads(Path('tests/fixtures/canonical-hash-v1.json').read_text(encoding='utf-8'))
  for case in cases:
   with self.subTest(case=case['name']):
    def check():
     a=K.loads(case['left']);b=K.loads(case.get('right',case['left']))
     if case.get('facts'):K.facts(a);K.facts(b)
     return K.digest(a)==K.digest(b)
    if case.get('reject'):
     with self.assertRaises((ValueError,TypeError,OverflowError)):check()
    else:self.assertEqual(check(),case.get('equal',True))
 def test_native_numbers_fail_closed(self):
  for n in [float('nan'),float('inf'),9007199254740992,9007199254740992.0]:
   with self.assertRaises(ValueError):K.digest(n)
  for text in ['9007199254740993','1.00000000000000000001','1e-1000']:
   with self.assertRaises(ValueError):K.load_native(text)
  self.assertEqual(K.load_native('33.420000'),33.42)
 def test_isolated_apply_atomic_rollback_and_conflicts(self):
  req,rows,ev=make('9999.HK');ev['canonicalSerializationVersion']=K.VERSION;c=candidate(req,rows,ev)
  base=copy.deepcopy(req['base'])
  for row in base['priceHistory']:row['volume']=float(row['volume'])
  self.assertNotEqual(C.digest(base),c['baseHash']);self.assertEqual(K.facts_hash(base),c['baselineBinding']['canonicalContentHash'])
  with tempfile.TemporaryDirectory() as d:
   store=Store(Path(d)/'isolated.sqlite');cid,rid=store.save(req,c)
   apply=lambda **kw:store.apply(cid,rid,base,expected_current_version=c['baseHash'],**kw)
   with self.assertRaisesRegex(ValueError,'explicit_approval'):apply()
   approval=store.approve(cid,rid,'Approve candidate '+c['candidateHash'],'yahoo',{k:'isolated fixture' for k in c['reviewItems']},'isolated')
   with self.assertRaisesRegex(ValueError,'version_conflict'):store.apply(cid,rid,base,expected_current_version='0'*64)
   for field in ('close','volume','amount'):
    changed=copy.deepcopy(base);changed['priceHistory'][0][field]=(changed['priceHistory'][0].get(field) or 0)+0.00000001
    with self.assertRaisesRegex(ValueError,'base_version_changed'):store.apply(cid,rid,changed,expected_current_version=c['baseHash'])
   def count():
    with closing(sqlite3.connect(store.path)) as db:return [db.execute('select count(*) from '+t).fetchone()[0] for t in ('objects','active','events','approvals')]
   before=count()
   def fail(_):raise RuntimeError('injected')
   with self.assertRaisesRegex(RuntimeError,'injected'):apply(failpoint=fail)
   self.assertEqual(before,count());a=apply();self.assertTrue(apply()['idempotent'])
   active=store.active('9999.HK');old=store.read(active['previousVersion'])
   self.assertEqual(C.digest(old['stock']),C.digest(base))
   store.rollback('9999.HK',active['generation'],'Rollback '+active['version']+' to '+active['previousVersion'],'isolated test')
   self.assertEqual(store.active('9999.HK')['bundle']['stock'],base)
   self.assertGreater(count()[2],before[2]);self.assertEqual(approval['candidateHash'],c['candidateHash'])

if __name__=='__main__':unittest.main()
