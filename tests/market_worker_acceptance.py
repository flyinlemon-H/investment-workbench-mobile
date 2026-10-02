"""Test-only loopback Registry transport for the unmodified executor lifecycle."""
import argparse
import json
import os
from pathlib import Path
import tempfile
from urllib.request import Request, urlopen
from scripts.market_data_worker import run_once


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--url',required=True);parser.add_argument('--source-root',type=Path,required=True);parser.add_argument('--seed',type=Path,required=True);args=parser.parse_args()
    if not args.url.startswith('http://127.0.0.1:'):raise ValueError('test_loopback_only')
    credential=json.loads(os.environ['MARKET_TEST_CREDENTIAL'])
    class Registry:
        def __init__(self):self.credential=credential
        def rpc(self,action,payload):
            request=Request(args.url+'/__market_worker_test_rpc',data=json.dumps({'token':credential['token'],'action':action,'input':payload}).encode(),headers={'Content-Type':'application/json'},method='POST')
            with urlopen(request,timeout=30) as response:return json.load(response)
    seed=json.loads(args.seed.read_text(encoding='utf-8'))['stock'];seed['priceHistory']=seed['priceHistory'][:-3]
    with tempfile.TemporaryDirectory() as directory:run_once(Registry(),args.source_root,Path(directory)/'outbox.json',({} if os.environ.get('MARKET_REAL_BOOTSTRAP')=='1' else {seed['symbol']:seed}))

if __name__=='__main__':main()
