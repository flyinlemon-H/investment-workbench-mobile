"""Explicit test-project runner: real Registry and unchanged Worker lifecycle."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import tempfile
import time
import uuid
from scripts import market_data_worker as W

TARGET='lblyapnsngqnjimgskkp'

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--source-root',type=Path,required=True);parser.add_argument('--seed',type=Path,required=True);parser.add_argument('--mode',choices=['seed','real','provider_failure'],default='real');args=parser.parse_args()
    if os.environ.get('MARKET_REMOTE_ACCEPTANCE')!=TARGET:raise ValueError('explicit_test_project_required')
    if args.mode=='seed':
        task={'taskId':str(uuid.uuid4()),'taskType':W.TASK_TYPE,'symbol':'601869.SS','requestedBy':str(uuid.uuid4()),'requestedAt':datetime.now(timezone.utc).isoformat(),'workerId':str(uuid.uuid4()),'status':'running'}
        result=W.execute_task(task,None,args.source_root)
        stock=result['stock'];stock['priceHistory']=stock['priceHistory'][:-3]
        import importlib
        stock['technicalIndicators']=importlib.import_module('src.market_data.updater').calculate_indicators(stock['priceHistory'])
        stock['marketDataFreshness']['last_trade_date']=stock['priceHistory'][-1]['date']
        args.seed.parent.mkdir(parents=True,exist_ok=True);args.seed.write_text(json.dumps(stock),encoding='utf-8')
        print(json.dumps({'seedProvider':result['provider'],'bars':len(stock['priceHistory']),'latestCompleteBar':stock['priceHistory'][-1]['date']}),flush=True)
        return
    credential=json.loads(os.environ['MARKET_REMOTE_CREDENTIAL'])
    if credential['projectRef']!=TARGET:raise ValueError('production_denied')
    class ObservedRegistry(W.Registry):
        def rpc(self,action,payload):
            value=super().rpc(action,payload)
            if action=='claim' and value:
                print(json.dumps({'observed':'remote_claim','taskId':value['taskId'],'status':value['status']}),flush=True)
                time.sleep(3) # Allow browser to observe running; no fabricated task state.
            return value
    if args.mode=='provider_failure':
        original=W.execute_task
        class Failure:
            def fetch_daily(self,*args):raise TimeoutError('deterministic acceptance failure')
        W.execute_task=lambda task,seed,source_root:original(task,seed,source_root,chain=Failure())
    seed=json.loads(args.seed.read_text(encoding='utf-8'))
    with tempfile.TemporaryDirectory(prefix='market-remote-acceptance-') as directory:
        outcome=W.run_once(ObservedRegistry(credential),args.source_root,Path(directory)/'outbox.json',{seed['symbol']:seed})
        if not outcome:raise ValueError('no_task_claimed')

if __name__=='__main__':main()
