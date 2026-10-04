"""Operator CLI: generate/review are separate from approve/apply/rollback."""
import argparse
import json
from pathlib import Path
from .core import REGISTRY, facts, recommend, request, symbol
from .revision import candidate
from .store import Store, now

def load(path):return json.loads(Path(path).read_text(encoding='utf-8-sig'))

def stocks(path):
    text=Path(path).read_text(encoding='utf-8-sig')
    if text.lstrip().startswith('window.MARKET_DATA_BRIDGE ='):
        text=text[text.index('=')+1:].strip().rstrip(';')
    data=json.loads(text)
    if 'symbols' in data:return [{**x.get('marketFacts',{}),'symbol':x['symbol']} for x in data['symbols']]
    return data['stocks']

def find(path,ticker):
    matches=[s for s in stocks(path) if str(s.get('symbol') or s.get('code') or '').upper()==ticker]
    if len(matches)!=1:raise ValueError('symbol_not_unique_or_missing')
    return matches[0]

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--store',type=Path,required=True)
    commands=parser.add_subparsers(dest='command',required=True)
    generate=commands.add_parser('generate');generate.add_argument('--baseline',type=Path,required=True)
    generate.add_argument('--symbol',required=True);generate.add_argument('--end',required=True)
    generate.add_argument('--provider',choices=['both',*REGISTRY],default='both')
    review=commands.add_parser('review');review.add_argument('--object',required=True)
    pending=commands.add_parser('pending');pending.add_argument('--symbol')
    approve=commands.add_parser('approve');approve.add_argument('--object',required=True);approve.add_argument('--request',required=True)
    approve.add_argument('--provider',choices=REGISTRY,required=True);approve.add_argument('--phrase',required=True)
    approve.add_argument('--resolutions',type=Path,required=True);approve.add_argument('--actor',required=True)
    apply=commands.add_parser('apply');apply.add_argument('--object',required=True);apply.add_argument('--request',required=True)
    apply.add_argument('--baseline',type=Path,required=True);apply.add_argument('--expected-generation',type=int,required=True)
    rollback=commands.add_parser('rollback');rollback.add_argument('--symbol',required=True);rollback.add_argument('--expected-generation',type=int,required=True)
    rollback.add_argument('--phrase',required=True);rollback.add_argument('--reason',required=True)
    active=commands.add_parser('active');active.add_argument('--symbol',required=True)
    delivery=commands.add_parser('deliver');delivery.add_argument('--symbol',required=True);delivery.add_argument('--target',type=Path,required=True)
    delivery.add_argument('--expected-file-hash',required=True);delivery.add_argument('--expected-generation',type=int,required=True)
    args=parser.parse_args();store=Store(args.store)
    if args.command=='generate':
        from .fetch import fetch
        ticker=symbol(args.symbol);req=request(find(args.baseline,ticker),ticker,args.end,now());outcomes=[]
        for provider in REGISTRY if args.provider=='both' else [args.provider]:
            try:
                rows,evidence,version=fetch(provider,ticker,req['requestedHistoryStart'],args.end)
                value=candidate(req,provider,rows,version,now(),evidence);cid,rid=store.save(req,value)
                outcomes.append(dict(provider=provider,objectId=cid,requestObject=rid,candidateHash=value['candidateHash'],
                    barCount=value['barCount'],validationStatus=value['validationStatus'],blockers=value['blockers'],reviewItems=value['reviewItems']))
            except ValueError as e:
                # Only fixed codes, never a URL/response/credential, leave the process.
                message=str(e);safe=message if message.replace('_','').isalnum() and len(message)<80 else 'provider_parse_failure'
                outcomes.append(dict(provider=provider,status='failed',safeError=safe))
        result=recommend(outcomes)
        result['status']='PILOT_READY_FOR_USER_REVIEW' if any(x.get('candidateHash') for x in outcomes) else 'PILOT_BLOCKED_PROVIDER_UNAVAILABLE'
    elif args.command=='review':result=store.read(args.object)
    elif args.command=='pending':result=store.pending(symbol(args.symbol) if args.symbol else None)
    elif args.command=='approve':result=store.approve(args.object,args.request,args.phrase,args.provider,load(args.resolutions),args.actor)
    elif args.command=='apply':
        c=store.read(args.object);result=store.apply(args.object,args.request,find(args.baseline,c['symbol']),args.expected_generation)
    elif args.command=='rollback':result=store.rollback(symbol(args.symbol),args.expected_generation,args.phrase,args.reason)
    elif args.command=='deliver':
        from .projection import project
        result=project(store,symbol(args.symbol),args.target,args.expected_file_hash,args.expected_generation)
    else:result=store.active(symbol(args.symbol))
    print(json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False))

if __name__=='__main__':main()
