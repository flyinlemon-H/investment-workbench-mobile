import hashlib,json,tempfile,unittest
from unittest.mock import patch
from pathlib import Path
from scripts.install_bounded_daily_worker import install

class WorkerPackageTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.package=self.root/'package';self.target=self.root/'target'
        for p in (self.package,self.target):(p/'scripts').mkdir(parents=True)
        (self.package/'scripts/worker.py').write_text('VERSION=2\n');(self.target/'scripts/worker.py').write_text('VERSION=1\n')
        sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
        self.m=dict(protocol='bounded-daily-revision-v1',targetRoot=str(self.target),files=[dict(path='scripts/worker.py',sha256=sha(self.package/'scripts/worker.py'),expectedBefore=sha(self.target/'scripts/worker.py'))]);self.save()
    def tearDown(self):self.temp.cleanup()
    def save(self):(self.package/'worker-package.json').write_text(json.dumps(self.m))
    def test_default_is_readonly(self):
        self.assertEqual(install(self.package,self.target)['status'],'CHECK_ONLY_PASS');self.assertEqual((self.target/'scripts/worker.py').read_text(),'VERSION=1\n')
    def test_changed_installed_code_denied(self):
        (self.target/'scripts/worker.py').write_text('VERSION=3\n')
        with self.assertRaisesRegex(ValueError,'installed_code_changed'):install(self.package,self.target)
    def test_package_tamper_denied(self):
        (self.package/'scripts/worker.py').write_text('VERSION=4\n')
        with self.assertRaisesRegex(ValueError,'package_integrity_failed'):install(self.package,self.target)
    def test_escape_path_denied(self):
        self.m['files'][0]['path']='scripts/../../escape.py';self.save()
        with self.assertRaisesRegex(ValueError,'unsafe_package_path'):install(self.package,self.target)
    def test_wrong_target_denied(self):
        with self.assertRaisesRegex(ValueError,'package_target_mismatch'):install(self.package,self.root)
    def add_pc(self):
        self.pc=self.root/'pc';rel='src/market_data/provider_rebase/integration.py'
        for root,body in ((self.pc,'PROFILE=1\n'),(self.package/'pc','PROFILE=2\n')):
            path=root/rel;path.parent.mkdir(parents=True);path.write_text(body)
        sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
        self.m['sourceRoot']=str(self.pc);self.m['files'].append(dict(root='pc',path=rel,sha256=sha(self.package/'pc'/rel),expectedBefore=sha(self.pc/rel)));self.save()
        return self.pc/rel
    def test_pc_root_explicit_and_check_only(self):
        dest=self.add_pc()
        with self.assertRaisesRegex(ValueError,'package_source_mismatch'):install(self.package,self.target)
        self.assertEqual(install(self.package,self.target,source_root=self.pc)['files'],2)
        self.assertEqual(dest.read_text(),'PROFILE=1\n')
    def test_pc_changed_baseline_denied(self):
        dest=self.add_pc();dest.write_text('PROFILE=3\n')
        with self.assertRaisesRegex(ValueError,'installed_code_changed'):install(self.package,self.target,source_root=self.pc)
    def test_pc_whitelist_denies_other_code(self):
        self.add_pc();self.m['files'][-1]['path']='src/market_data/provider.py';self.save()
        with self.assertRaisesRegex(ValueError,'unsafe_package_path'):install(self.package,self.target,source_root=self.pc)
    @unittest.skipUnless(__import__('os').name=='nt','Windows lock')
    def test_two_root_install_failure_restores_workbench(self):
        dest=self.add_pc();state=self.root/'private';state.mkdir()
        import os
        replace=os.replace;calls=[]
        def fail_second(src,target):
            calls.append(target)
            if len(calls)==2:raise OSError('injected')
            return replace(src,target)
        with patch('scripts.install_bounded_daily_worker.os.replace',side_effect=fail_second):
            with self.assertRaisesRegex(OSError,'injected'):install(self.package,self.target,source_root=self.pc,apply=True,state_dir=state)
        self.assertEqual((self.target/'scripts/worker.py').read_text(),'VERSION=1\n');self.assertEqual(dest.read_text(),'PROFILE=1\n')

if __name__=='__main__':unittest.main()
