"""Real run_once, fixed-host Yahoo parser, outbox and submit against an isolated registry.
Provider HTTP is replayed from two separately archived observations, never fetched live.
"""
import json,sys,tempfile
from pathlib import Path
from datetime import datetime as RealDatetime
from unittest.mock import patch
from urllib.request import Request,urlopen
from scripts import market_data_worker as W
from scripts.provider_rebase import fetch as F

def main():
    config=json.load(sys.stdin)
    fixture=json.loads(Path('.rebase/bounded-daily-v1/fixture.json').read_text(encoding='utf-8'))
    captures=iter([fixture['observations']['B'],fixture['observations']['C']]);current={}
    class Response:
        status_code=200
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def iter_content(self,_):yield current['raw'].encode()
    class Session:
        def get(self,url,**kwargs):
            assert url=='https://query1.finance.yahoo.com/v8/finance/chart/2899.HK'
            assert kwargs['params']['interval']=='1d'
            current.clear();current.update(next(captures));return Response()
        def close(self):pass
    class Clock(RealDatetime):
        @classmethod
        def now(cls,tz=None):
            return RealDatetime.fromisoformat(current['asOf']).astimezone(tz)
    class Registry:
        credential=config['credential']
        def call(self,fn,action,payload):
            req=Request(config['url']+'/__worker',data=json.dumps(dict(fn=fn,action=action,input=payload,token=self.credential['token'])).encode(),headers={'Content-Type':'application/json'})
            with urlopen(req,timeout=60) as response:return json.load(response)
        def rpc(self,a,p):return self.call('ordinary',a,p)
        def daily_rpc(self,a,p):return self.call('daily',a,p)
    with tempfile.TemporaryDirectory() as directory,patch.object(F.requests,'Session',Session),patch.object(F,'datetime',Clock):
        status=W.run_once(Registry(),Path(config['sourceRoot']),Path(directory)/'outbox.json',seeds={},notify=lambda event:print(json.dumps(event),flush=True))
        assert status['status']=='succeeded',status.get('error')
        assert not (Path(directory)/'outbox.json').exists()
if __name__=='__main__':main()
