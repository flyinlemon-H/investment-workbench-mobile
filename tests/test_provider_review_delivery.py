import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from scripts.provider_rebase.review import export_review
from scripts.provider_rebase.install_companion import install
from tests.test_provider_evidence import make, candidate

class ReviewDeliveryTests(unittest.TestCase):
    def test_review_is_offline_and_blocked_action_disabled(self):
        req,rows,ev=make();ev['guardDelivery']['paths']={};c=candidate(req,rows,ev)
        with tempfile.TemporaryDirectory() as root:
            result=export_review(c,root);html=Path(result['path']).read_text(encoding='utf-8')
            self.assertIn('id="approve" disabled',html);self.assertNotIn('fetch(',html)
            self.assertIn(c['approvalPackageHash'],html);self.assertIn('Keep Current',html)
            script=html.split('<script>')[1].split('</script>')[0]
            p=Path(root)/'review.js';p.write_text(script,encoding='utf-8')
            checked=subprocess.run(['node','--check',str(p)],capture_output=True,text=True)
            self.assertEqual(checked.returncode,0,checked.stderr)
    def test_ready_review_only_exposes_explicit_phrase(self):
        c=candidate(*make())
        with tempfile.TemporaryDirectory() as root:
            result=export_review(c,root);self.assertTrue(result['readyForApproval'])
            data=json.loads((Path(root)/'approval-summary.json').read_text(encoding='utf-8'))
            self.assertFalse(data['applyExecuted']);self.assertEqual(data['approvalStatus'],'pending_user_review')
    def test_double_wrapping_is_idempotent_and_stale_guard_rejected(self):
        from scripts.provider_rebase.integration import guarded_updater
        def updater(*args, **kwargs): return []
        wrapped=guarded_updater(updater,object())
        self.assertIs(guarded_updater(wrapped,object()),wrapped)
        wrapped.__market_revision_guard__='old-implementation'
        with self.assertRaisesRegex(ValueError,'guard_implementation_changed'):
            guarded_updater(wrapped,object())

    def test_provider_runtime_hash_normalizes_line_endings(self):
        import types
        from scripts.provider_rebase.integration import runtime_version
        with tempfile.TemporaryDirectory() as temp:
            p=Path(temp)/'provider.py'
            p.write_bytes(b'# same provider\nVALUE=1\n')
            a=runtime_version(types.SimpleNamespace(__file__=p))
            p.write_bytes(b'# same provider\r\nVALUE=1\r\n')
            self.assertEqual(a,runtime_version(types.SimpleNamespace(__file__=p)))

    def test_installer_backup_and_wrong_baseline(self):
        src=Path(os.environ.get('MARKET_SOURCE_ROOT',''))/'src/market_data/updater.py'
        if not src.is_file():self.skipTest('PC source required')
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);target=root/'src/market_data/updater.py';target.parent.mkdir(parents=True);target.write_bytes(src.read_bytes())
            before=target.read_bytes();h=hashlib.sha256(before).hexdigest()
            with self.assertRaisesRegex(ValueError,'baseline'):install(root,'0'*64)
            check=install(root,h,check_only=True);self.assertEqual(check['status'],'validated');self.assertEqual(target.read_bytes(),before)
            result=install(root,h);self.assertEqual(result['status'],'installed');self.assertEqual((Path(result['backup'])/'updater.py').read_bytes(),before)
            self.assertIn('_guarded_updater',target.read_text(encoding='utf-8'))
            for rel,digest in result['files'].items():self.assertEqual(hashlib.sha256((root/rel).read_bytes()).hexdigest(),digest)

if __name__=='__main__':unittest.main()
