"""Opt-in network acceptance. Writes only a test result, never portfolio/registry."""
import argparse
import copy
from datetime import datetime, timezone
import json
from pathlib import Path
import uuid
from scripts.market_data_worker import execute_task


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--source-root',type=Path,required=True);parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    def task():return {'taskId':str(uuid.uuid4()),'taskType':'UPDATE_DAILY_MARKET_DATA','symbol':'601869.SS','requestedBy':str(uuid.uuid4()),'workerId':str(uuid.uuid4()),'requestedAt':datetime.now(timezone.utc).isoformat(),'status':'running'}
    first=execute_task(task(),None,args.source_root)
    seed=copy.deepcopy(first['stock']);seed['priceHistory']=seed['priceHistory'][:-3]
    second=execute_task(task(),seed,args.source_root)
    assert len(second['stock']['priceHistory'])>len(seed['priceHistory'])
    assert second['latestCompleteBar']==second['stock']['technicalIndicators']['last_trade_date']
    args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(second,ensure_ascii=False),encoding='utf-8')
    print(json.dumps({'provider':second['provider'],'beforeBars':len(seed['priceHistory']),'afterBars':len(second['stock']['priceHistory']),'latestCompleteBar':second['latestCompleteBar'],'resultVersion':second['resultVersion'],'dataUpdated':second['dataUpdated'],'warnings':second['warnings']}))

if __name__=='__main__':main()
