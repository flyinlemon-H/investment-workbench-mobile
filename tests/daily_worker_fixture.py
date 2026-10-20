"""Synthetic stable history through the real Worker; stdin is an isolated task.

Never reads credentials or calls a provider/network/remote registry.
"""
from datetime import date, timedelta
import copy
import importlib
import json
import os
from pathlib import Path
import sys
import tempfile
from scripts import market_data_worker as W
from scripts.provider_rebase.store import Store

def run(task,initial=False):
    source=Path(os.environ['MARKET_SOURCE_ROOT']);W.load_source_updater(source)
    provider=importlib.import_module('src.market_data.provider')
    def bar(day):return provider.DailyBar(day,10,12,9,11,1000,None,'qfq','adjusted','yahoo','2026-10-01T08:00:00Z',True)
    history=[bar((date(2026,9,30)-timedelta(days=139-i)).isoformat()) for i in range(140)]
    class Chain:
        def fetch_daily(self,*args):return (copy.deepcopy(history[:-1]) if initial else copy.deepcopy(history)),'yahoo',[]
    seed={'priceHistory':[b.to_dict() for b in history[:-1]]};before=copy.deepcopy(seed)
    with tempfile.TemporaryDirectory() as directory:
        result=W.execute_task(task,seed,source,Chain(),Store(Path(directory)/'isolated.sqlite'))
    assert seed==before
    assert len(result['stock']['priceHistory'])==(139 if initial else 140)
    assert result['stock']['technicalIndicators']['technicalSnapshot']['dataContentVersion']==result['stock']['marketDataFreshness']['dataContentVersion']
    return result

if __name__=='__main__':print(json.dumps(run(json.load(sys.stdin),'--initial' in sys.argv)))
