"""Read-only exact-decimal audit. No provider fetch, data rewrite, approval or apply."""
import argparse,json,sys
from collections import Counter
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from scripts.provider_rebase import canonical as K,core as C

def load(path):
 text=Path(path).read_text(encoding='utf-8-sig')
 if text.lstrip().startswith('window.MARKET_DATA_BRIDGE ='):
  text=text.split('=',1)[1].strip().rstrip(';')
 return json.loads(text),K.loads(text)

def select(data,symbol):
 if 'base' in data:return data['base']
 if 'symbols' in data:
  matches=[x['marketFacts'] for x in data['symbols'] if x['symbol']==symbol]
 else:matches=[x for x in data['stocks'] if x.get('symbol',x.get('code'))==symbol]
 if len(matches)!=1:raise ValueError('symbol_not_unique')
 # The historical facts adapter supplies empty top-level technical containers.
 # Nested fields and explicit null are preserved; canonical encode itself never defaults.
 return {k:matches[0].get(k,[] if k=='priceHistory' else {}) for k in K.FIELDS}

def compare(base,current):
 counts=Counter();paths=[]
 def visit(a,b,path='$'):
  if isinstance(a,dict) and isinstance(b,dict):
   for k in a.keys()-b.keys():counts['missingFields']+=1;paths.append(path+'.'+k)
   for k in b.keys()-a.keys():counts['extraFields']+=1;paths.append(path+'.'+k)
   for k in a.keys()&b.keys():visit(a[k],b[k],path+'.'+k)
  elif isinstance(a,list) and isinstance(b,list):
   if len(a)!=len(b):counts['barCountDifferences']+=1
   for i,(x,y) in enumerate(zip(a,b)):visit(x,y,path+'['+str(i)+']')
  elif K.encode(a)!=K.encode(b):
   key='numericValueDifferences' if isinstance(a,K.Decimal) and isinstance(b,K.Decimal) else 'dateDifferences' if path.endswith('.date') else 'sourceContractDifferences' if any(x in path for x in ('provider','Provider','adjustment','price_basis','sourceContract')) else 'metadataDifferences'
   counts[key]+=1;paths.append(path)
 visit(base,current)
 return {k:counts[k] for k in ('numericValueDifferences','missingFields','extraFields','dateDifferences','sourceContractDifferences','metadataDifferences','barCountDifferences')},paths

def audit(request,paths,symbol):
 plain,exact=load(request);base=select(exact,symbol);legacy=select(plain,symbol);results=[]
 for path in paths:
  p,e=load(path);p,e=select(p,symbol),select(e,symbol);counts,changed=compare(base,e);representation=[]
  def types(a,b,key='$'):
   if isinstance(a,dict) and isinstance(b,dict):
    for k in a.keys()&b.keys():types(a[k],b[k],key+'.'+k)
   elif isinstance(a,list) and isinstance(b,list):
    for i,(x,y) in enumerate(zip(a,b)):types(x,y,key+'['+str(i)+']')
   elif type(a)!=type(b) and isinstance(a,(int,float)) and not isinstance(a,bool) and isinstance(b,(int,float)) and not isinstance(b,bool) and K.encode(a)==K.encode(b):representation.append(key)
  types(legacy,p)
  rows=e['priceHistory'];counts.update(representationOnlyDifferences=len(representation),precisionDifferences=counts['numericValueDifferences'])
  results.append(dict(source=str(path),counts=counts,changedPaths=changed,representationPaths=representation,
   legacyBaseHash=C.digest(p),canonicalContentHash=K.facts_hash(e),barCount=len(rows),firstDate=rows[0]['date'],lastDate=rows[-1]['date']))
 return dict(symbol=symbol,canonicalSerializationVersion=K.VERSION,expectedLegacyBaseHash=C.digest(legacy),expectedCanonicalHash=K.facts_hash(base),results=results)

if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--request',required=True);parser.add_argument('--symbol',required=True);parser.add_argument('--source',action='append',required=True);parser.add_argument('--output',required=True);a=parser.parse_args()
 result=audit(a.request,a.source,a.symbol);Path(a.output).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps({**result,'results':[{k:v for k,v in x.items() if k not in ('changedPaths','representationPaths')} for x in result['results']]}))
 if any(x['changedPaths'] or x['counts']['barCountDifferences'] for x in result['results']):sys.exit(2)
