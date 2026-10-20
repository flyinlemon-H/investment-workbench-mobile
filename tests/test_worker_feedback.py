import contextlib
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from scripts import market_data_worker as W, market_worker_launcher as L
from scripts.market_worker_errors import PUBLIC_ERRORS, PipelineFailure, public_error

class FeedbackTests(unittest.TestCase):
    def test_only_exact_enum_crosses_boundary(self):
        for code in PUBLIC_ERRORS:self.assertEqual(public_error(ValueError(code)),code)
        for code in ('SAME_PROVIDER_REVISION:token=secret','https://private','../path','secret'):
            self.assertEqual(public_error(ValueError(code)),'pipeline_failure')
    def test_worker_finish_preserves_classification_and_local_candidate_receipt(self):
        task=dict(taskId='11111111-1111-4111-8111-111111111111',taskType=W.TASK_TYPE,symbol='2899.HK',status='running',requestedBy='owner',workerId='worker',startedAt='2026-10-01T08:00:00Z')
        class Registry:
            credential={'workerId':'worker','userId':'owner'}
            def rpc(self,action,payload):
                if action=='claim':return task
                self.payload=payload;return {**task,'status':'failed','error':payload['error']}
        with tempfile.TemporaryDirectory() as directory:
            for code in PUBLIC_ERRORS:
                registry=Registry();events=[]
                with patch.object(W,'execute_task',side_effect=PipelineFailure(code,True)):
                    W.run_once(registry,Path(directory),Path(directory)/'journal.json',notify=events.append)
                self.assertEqual(registry.payload,{'taskId':task['taskId'],'error':code})
                self.assertTrue(events[-1]['candidateSaved']);self.assertEqual(events[-1]['error'],code)
    def test_console_sanitizes_and_honestly_reports_candidate(self):
        output=io.StringIO()
        with contextlib.redirect_stdout(output):
            L.Console()({'status':'failed','symbol':'2899.HK','error':'UNIT_CONTRACT_INCOMPLETE','candidateSaved':True})
            L.Console()({'status':'failed','symbol':'secret-token','error':'private URL'})
        text=output.getvalue();self.assertIn('单位证据',text);self.assertIn('隔离候选已保存',text)
        self.assertIn('未确认隔离候选已保存',text);self.assertNotIn('secret-token',text);self.assertNotIn('private URL',text)
    def test_launcher_delegates_existing_callback_interface(self):
        class Worker:
            def main(self,args,notify=None):
                self.args=args;self.notify=notify
        worker=Worker()
        with patch.object(L,'preflight',return_value=worker),contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(L.main(['--source-root','fixture','--state-dir','fixture-private']),0)
        self.assertTrue(callable(worker.notify));self.assertIn('--source-root',worker.args)

if __name__=='__main__':unittest.main()
