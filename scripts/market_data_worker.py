"""Daily-only executor. Local paths are operator configuration, never task parameters."""
from __future__ import annotations
import argparse
import copy
from datetime import date, datetime, timezone
import hashlib
import importlib
import json
import math
import os
from pathlib import Path
import re
import sys
import time
import uuid
from urllib.request import Request, build_opener

try:
    from .fetch_cloud_universe import PROJECTS, NoRedirect, protect
    from .market_symbol_contract import canonical_symbol
    from .update_market_universe import load_source_updater
    from .provider_rebase.revision import SAFE_ERRORS
except ImportError:
    from fetch_cloud_universe import PROJECTS, NoRedirect, protect
    from market_symbol_contract import canonical_symbol
    from update_market_universe import load_source_updater
    from provider_rebase.revision import SAFE_ERRORS

sys.dont_write_bytecode = True

TASK_TYPE = 'UPDATE_DAILY_MARKET_DATA'


def fingerprint(rows):
    facts = [{k: v for k, v in row.items() if k != 'fetched_at'} for row in rows]
    return hashlib.sha256(json.dumps(facts, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def validate_task(task):
    allowed = {'taskId','taskType','symbol','requestedBy','requestedAt','status','startedAt','completedAt','workerId','resultVersion','error','previousResult'}
    if not isinstance(task, dict) or set(task)-allowed or task.get('taskType') != TASK_TYPE or task.get('status') != 'running':
        raise ValueError('invalid_task')
    if not canonical_symbol(task.get('symbol')) or canonical_symbol(task['symbol']) != task['symbol']:
        raise ValueError('invalid_symbol')
    uuid.UUID(task['taskId'])
    return task


def validate_rows(rows):
    if not rows or len(rows)>3000:
        raise ValueError('invalid_history')
    dates=[]
    for row in rows:
        date.fromisoformat(row['date'])
        vals=[row.get(k) for k in ('open','high','low','close')]
        if any(isinstance(v,bool) or not isinstance(v,(float,int)) or not math.isfinite(v) or v<=0 for v in vals):
            raise ValueError('invalid_ohlc')
        if row['high']<max(row['open'],row['close'],row['low']) or row['low']>min(row['open'],row['close']):
            raise ValueError('invalid_ohlc')
        if row.get('adjustment')!='qfq' or row.get('price_basis')!='adjusted':
            raise ValueError('adjustment_mismatch')
        dates.append(row['date'])
    if dates!=sorted(set(dates)):
        raise ValueError('invalid_bar_order')


def execute_task(task, seed, source_root, chain=None, rebase_store=None):
    validate_task(task)
    updater=load_source_updater(Path(source_root))
    provider=importlib.import_module('src.market_data.provider')
    prior=task.get('previousResult')
    incoming=prior.get('stock') if prior else seed
    if rebase_store is not None:
        try:
            from .provider_rebase.integration import resolve_baseline
        except ImportError:
            from provider_rebase.integration import resolve_baseline
        incoming=resolve_baseline(rebase_store,task['symbol'],incoming)
    stock={'code':task['symbol'],'priceHistory':copy.deepcopy((incoming or {}).get('priceHistory',[]))}
    stock['marketDataFreshness']=copy.deepcopy((incoming or {}).get('marketDataFreshness') or {})
    stock['technicalIndicators']=copy.deepcopy((incoming or {}).get('technicalIndicators') or {})
    stock['technicalData']=copy.deepcopy((incoming or {}).get('technicalData') or stock['technicalIndicators'].pop('technicalSnapshot',None) or {})
    before=[b for b in stock['priceHistory'] if b.get('is_complete_bar') is True]
    outcome=updater({'stocks':[stock]},symbols={task['symbol']},provider_chain=chain,revision_store=rebase_store)[0]
    if not outcome['success']:
        # Only fixed errors cross the boundary; provider exceptions can contain URLs.
        reason=outcome.get('error','')
        safe={'provider_mismatch','adjustment_mismatch','adjustment_revision_requires_full_rebuild','invalid_ohlc','invalid_bar_order','invalid_history'} | SAFE_ERRORS
        raise ValueError(reason if reason in safe else 'provider_or_pipeline_failure')
    stock['priceHistory']=[b for b in stock['priceHistory'] if b.get('is_complete_bar') is True]
    validate_rows(stock['priceHistory'])
    latest=stock['priceHistory'][-1]['date']
    if latest!=stock['technicalIndicators']['last_trade_date'] or latest!=stock['marketDataFreshness']['last_trade_date']:
        raise ValueError('unaligned_result')
    value=fingerprint(stock['priceHistory'])
    warnings=['provider_fallback'] if stock['marketDataFreshness'].get('provider_errors') else []
    stock['marketDataFreshness']['provider_errors']=[]
    stock['marketDataFreshness']['resultVersion']=task['taskId']
    snapshot={'symbol':task['symbol'],**{k:stock[k] for k in ('priceHistory','marketDataFreshness','technicalIndicators')}}
    # The existing RPC permits these four stock keys only. Keep the complete
    # technical facts inside its existing extensible indicators object.
    snapshot['technicalIndicators']={**snapshot['technicalIndicators'],'technicalSnapshot':stock['technicalData']}
    return {'schemaVersion':1,'taskId':task['taskId'],'resultVersion':task['taskId'],'symbol':task['symbol'],
            'provider':outcome['provider'],'requestedAt':task['requestedAt'],'completedAt':datetime.now(timezone.utc).isoformat(),
            'latestCompleteBar':latest,'technicalAsOf':latest,'fingerprint':value,'dataUpdated':value!=fingerprint(before),
            'warnings':warnings,'stock':snapshot}


class Registry:
    def __init__(self, credential):
        self.credential=credential
        if set(credential)!={'projectRef','userId','workerId','token','expiresAt'} or credential['projectRef'] not in PROJECTS or not re.fullmatch('[0-9a-f]{64}',credential['token']):
            raise ValueError('invalid_worker_credential')
        uuid.UUID(credential['userId']);uuid.UUID(credential['workerId'])
        if datetime.fromisoformat(credential['expiresAt'].replace('Z','+00:00'))<=datetime.now(timezone.utc):
            raise ValueError('worker_credential_expired')

    def rpc(self, action, payload):
        ref=self.credential['projectRef']
        req=Request(f'https://{ref}.supabase.co/rest/v1/rpc/market_data_worker',data=json.dumps({'p_token':self.credential['token'],'p_action':action,'p_input':payload},allow_nan=False).encode(),headers={'apikey':PROJECTS[ref],'Content-Type':'application/json'},method='POST')
        with build_opener(NoRedirect()).open(req,timeout=25) as response:
            data=response.read(2*1024*1024+1)
            if len(data)>2*1024*1024:raise ValueError('response_too_large')
            return json.loads(data)

    def migration_current(self, symbol):
        ref=self.credential['projectRef']
        req=Request(f'https://{ref}.supabase.co/rest/v1/rpc/market_data_migration_current',data=json.dumps({'p_token':self.credential['token'],'p_symbol':symbol}).encode(),headers={'apikey':PROJECTS[ref],'Content-Type':'application/json'},method='POST')
        with build_opener(NoRedirect()).open(req,timeout=25) as response:
            data=response.read(8*1024*1024+1)
            if len(data)>8*1024*1024:raise ValueError('response_too_large')
            return json.loads(data)


def write_json(path, value):
    path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_suffix('.tmp')
    with temp.open('w',encoding='utf-8') as f:
        json.dump(value,f,ensure_ascii=False,allow_nan=False);f.flush();os.fsync(f.fileno())
    temp.replace(path)


def run_once(registry, source_root, journal, seeds=None, rebase_store=None):
    # Persist an outbox before publishing. A lost HTTP response replays finish,
    # whose transaction is idempotent, rather than recalculating/replacing a result.
    if journal.exists():
        outbox=json.loads(journal.read_text(encoding='utf-8'))
        if outbox['workerId']!=registry.credential['workerId'] or outbox['owner']!=registry.credential['userId']:
            raise ValueError('outbox_owner_mismatch')
        payload=outbox['payload']
    else:
        task=registry.rpc('claim',{})
        if not task:return None
        validate_task(task)
        if task['requestedBy']!=registry.credential['userId'] or task['workerId']!=registry.credential['workerId']:
            raise ValueError('task_owner_mismatch')
        baseline=(task.get('previousResult') or {}).get('stock') or (seeds or {}).get(task['symbol']) or {}
        before_date=max((b['date'] for b in baseline.get('priceHistory',[]) if b.get('is_complete_bar') is True),default=None)
        print(json.dumps({'taskId':task['taskId'],'symbol':task['symbol'],'status':'running','worker':task['workerId'],'startedAt':task['startedAt'],'latestCompleteBarBefore':before_date}),flush=True)
        try:
            if hasattr(registry,'migration_current'):
                try:
                    from .provider_rebase.remote import worker_baseline
                except ImportError:
                    from provider_rebase.remote import worker_baseline
                migrated=worker_baseline(registry.migration_current(task['symbol']),registry.credential['userId'],task['symbol'])
                if migrated is not None:
                    task=copy.deepcopy(task)
                    task['previousResult']={'stock':migrated}
            result=execute_task(task,(seeds or {}).get(task['symbol']),source_root,rebase_store=rebase_store)
            payload={'taskId':task['taskId'],'result':result}
        except Exception as error:
            allowed={'provider_mismatch','adjustment_mismatch','adjustment_revision_requires_full_rebuild','invalid_ohlc','invalid_bar_order','invalid_history','provider_or_pipeline_failure','unaligned_result'} | SAFE_ERRORS
            payload={'taskId':task['taskId'],'error':str(error) if str(error) in allowed else 'pipeline_failure'}
        write_json(journal,{'workerId':registry.credential['workerId'],'owner':registry.credential['userId'],'payload':payload})
    status=registry.rpc('finish',payload)
    result=payload.get('result',{})
    print(json.dumps({**{k:status.get(k) for k in ('taskId','symbol','status','startedAt','completedAt','workerId','resultVersion','error')},'provider':result.get('provider'),'latestCompleteBarAfter':result.get('latestCompleteBar'),'warnings':result.get('warnings',[])}),flush=True)
    if status['status'] in ('succeeded','failed'):journal.unlink()
    return status


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root',type=Path,required=True)
    parser.add_argument('--state-dir',type=Path,required=True,help='Private local worker directory; outside any repository')
    parser.add_argument('--seed-bridge',type=Path,default=Path(__file__).resolve().parents[1]/'data'/'market_data_bridge.js',help='Read-only existing MARKET_DATA_BRIDGE file')
    parser.add_argument('--pair',action='store_true',help='Read credential JSON from hidden prompt, protect using Windows DPAPI')
    parser.add_argument('--once',action='store_true')
    parser.add_argument('--rebase-store',type=Path,help='Explicit opt-in active rebase store; candidates alone have no active pointer')
    args=parser.parse_args()
    try:
        from .provider_rebase.store import Store
    except ImportError:
        from provider_rebase.store import Store
    rebase_store=Store(args.rebase_store or args.state_dir/'revision-candidates.sqlite')
    directory=args.state_dir.resolve()
    if directory.is_relative_to(Path(__file__).resolve().parents[1]):raise ValueError('private_directory_required')
    directory.mkdir(parents=True,exist_ok=True)
    credential_path=directory/'market-worker.bin'
    if args.pair:
        import getpass
        credential=json.loads(getpass.getpass('Worker credential JSON (hidden): '));Registry(credential)
        credential_path.write_bytes(protect(json.dumps(credential).encode()))
        return
    registry=Registry(json.loads(protect(credential_path.read_bytes(),decrypt=True)))
    seeds={}
    if args.seed_bridge:
        raw=args.seed_bridge.read_text(encoding='utf-8-sig').strip()
        if not raw.startswith('window.MARKET_DATA_BRIDGE = '):raise ValueError('invalid_seed_bridge')
        seeds={s['symbol']:s for s in json.loads(raw.split('=',1)[1].strip().rstrip(';'))['stocks']}
    # OS-owned advisory lock automatically releases on process death.
    lock=(directory/'worker.lock').open('a+b')
    if os.name=='nt':
        import msvcrt
        if lock.seek(0,2)==0:lock.write(b'0');lock.flush()
        lock.seek(0);msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
    else:
        import fcntl
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    while True:
        failed=False
        try:
            outcome=run_once(registry,args.source_root,directory/'outbox.json',seeds,rebase_store=rebase_store)
            failed=bool(outcome and outcome['status']=='failed')
        except Exception:
            failed=True
            print(json.dumps({'status':'connection_or_delivery_error','message':'Retry pending; inspect registry status. Credentials are not logged.'}),flush=True)
        if args.once:
            if failed:raise SystemExit(1)
            break
        time.sleep(5)


if __name__=='__main__':main()
