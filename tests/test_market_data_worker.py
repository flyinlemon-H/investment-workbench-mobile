import copy
from datetime import date, datetime
import importlib
import json
import os
from pathlib import Path
import tempfile
import unittest
import uuid
from scripts import market_data_worker as W

SOURCE=Path(os.environ.get('MARKET_SOURCE_ROOT',str(Path(__file__).resolve().parents[2]/'投资分析程序')))
if not (SOURCE/'src'/'market_data'/'updater.py').is_file():
    raise unittest.SkipTest('Set MARKET_SOURCE_ROOT to the existing PC daily pipeline checkout')
W.load_source_updater(SOURCE)
P=importlib.import_module('src.market_data.provider')


def bar(day='2026-09-29',provider='fixture',complete=True):
    return P.DailyBar(day,10,12,9,11,1000,None,'qfq','adjusted',provider,'2026-10-01T08:00:00Z',complete)


def task():
    return dict(taskId=str(uuid.uuid4()),taskType=W.TASK_TYPE,symbol='601869.SS',requestedBy=str(uuid.uuid4()),requestedAt='2026-10-01T08:00:00Z',status='running',workerId=str(uuid.uuid4()),startedAt='2026-10-01T08:00:01Z')


class Chain:
    def __init__(self,bars):self.bars=bars;self.calls=[]
    def fetch_daily(self,symbol,start,end):
        self.calls.append((symbol,start,end))
        return copy.deepcopy(self.bars),self.bars[0].provider,[]


class WorkerTests(unittest.TestCase):
    def test_incremental_no_change_idempotence_and_indicators(self):
        t=task();seed={'priceHistory':[bar().to_dict()]};frozen=copy.deepcopy(seed)
        chain=Chain([bar(),bar('2026-09-30')]);r=W.execute_task(t,seed,SOURCE,chain)
        self.assertEqual(len(r['stock']['priceHistory']),2);self.assertEqual(r['technicalAsOf'],'2026-09-30')
        self.assertEqual(chain.calls[0][1],date(2026,9,22));self.assertTrue(r['dataUpdated']);self.assertEqual(seed,frozen)
        t['previousResult']=r;r2=W.execute_task(t,None,SOURCE,chain)
        self.assertFalse(r2['dataUpdated']);self.assertEqual(r2['fingerprint'],r['fingerprint']);self.assertEqual(r2['resultVersion'],r['resultVersion'])
        self.assertEqual(r2['stock']['technicalIndicators']['last_trade_date'],'2026-09-30')

    def test_failure_preserves_previous(self):
        class Failure:
            def fetch_daily(self,*args):raise TimeoutError('secret token URL must not leak')
        seed={'priceHistory':[bar().to_dict()]};before=copy.deepcopy(seed)
        with self.assertRaisesRegex(ValueError,'provider_or_pipeline_failure'):W.execute_task(task(),seed,SOURCE,Failure())
        self.assertEqual(seed,before)

    def test_adjustment_provider_and_revision_rejected(self):
        cases=[('adjustment_mismatch',{'adjustment':'raw'}),('adjustment_mismatch',{'price_basis':'raw'}),('provider_mismatch',{'provider':'yahoo'}),('adjustment_revision_requires_full_rebuild',{'close':10.5})]
        for error,patch in cases:
            seed={'priceHistory':[{**bar().to_dict(),**patch}]}
            with self.subTest(error=error),self.assertRaisesRegex(ValueError,error):W.execute_task(task(),seed,SOURCE,Chain([bar()]))

    def test_incomplete_today_never_latest(self):
        r=W.execute_task(task(),None,SOURCE,Chain([bar(),bar('2026-09-30',complete=False)]))
        self.assertEqual(r['latestCompleteBar'],'2026-09-29')
        self.assertEqual(len(r['stock']['priceHistory']),1)
        self.assertFalse(P.is_complete_trade_date(date(2026,9,30),'CN',datetime.fromisoformat('2026-09-30T14:00:00+08:00')))

    def test_no_arbitrary_input(self):
        for patch in [{'symbol':'../x'},{'taskType':'SHELL'},{'command':'calc'},{'path':'C:/x'},{'url':'https://evil'}]:
            with self.subTest(patch=patch),self.assertRaises(ValueError):W.validate_task({**task(),**patch})

    def test_publish_outbox_replay_without_refetch(self):
        t=task();result=W.execute_task(t,None,SOURCE,Chain([bar()]))
        class Registry:
            credential={'workerId':t['workerId'],'userId':t['requestedBy']}
            count=0
            def rpc(self,action,payload):
                self.count+=1
                if action=='claim':raise AssertionError('must not refetch after restart')
                if self.count==1:raise TimeoutError('lost response')
                return {**t,'status':'succeeded','resultVersion':t['taskId']}
        registry=Registry()
        with tempfile.TemporaryDirectory() as directory:
            journal=Path(directory)/'outbox.json';W.write_json(journal,{'workerId':t['workerId'],'owner':t['requestedBy'],'payload':{'taskId':t['taskId'],'result':result}})
            with self.assertRaises(TimeoutError):W.run_once(registry,SOURCE,journal)
            self.assertTrue(journal.exists());self.assertEqual(W.run_once(registry,SOURCE,journal)['status'],'succeeded');self.assertFalse(journal.exists())

if __name__=='__main__':unittest.main()
