"""Replay archived provider responses only. No network, credential or production writes."""
import json,os,sys,gzip,copy,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'scripts'))
from provider_rebase import daily_protocol as D,canonical as K,revision as R
archive=json.loads(gzip.decompress((ROOT/'tests/fixtures/bounded_daily_archived.json.gz').read_bytes()))
bundle=archive['bundle'];observations=archive['observations']
from provider_rebase.daily_policy import CALIBRATION
assert [observations[n]['rawHash'] for n in 'ABC']==[CALIBRATION[k] for k in ('oldRawHash','observedRawHash','repeatRawHash')]
daily=dict(protocol=D.VERSION,symbol='2899.HK',owner='11111111-1111-4111-8111-111111111111',enabled=True,generation=0,
 versionId='33333333-3333-4333-8333-333333333333',bundle=bundle,bundleHash=K.facts_hash(bundle),identityHash=D.identity(bundle),observation=observations['A'])
task=dict(taskId='44444444-4444-4444-8444-444444444444')
submission=D.build(daily,task,observations['B'],observations['C'])
prefix=json.loads(observations['B']['raw']);raw=prefix['chart']['result'][0];raw['timestamp']=raw['timestamp'][:430]
for key in raw['indicators']['quote'][0]:raw['indicators']['quote'][0][key]=raw['indicators']['quote'][0][key][:430]
raw['indicators']['adjclose'][0]['adjclose']=raw['indicators']['adjclose'][0]['adjclose'][:430]
rawtext=json.dumps(prefix,separators=(',',':'));first=D.observation(rawtext,observations['B']['asOf']);repeat=D.observation(rawtext,observations['C']['asOf'])
# Synthetic retained prefix of the revised real history, for pure append acceptance.
prefix_bundle=D.build(daily,task,first,repeat)['bundle']
stable={**copy.deepcopy(daily),'bundle':prefix_bundle,'bundleHash':K.facts_hash(prefix_bundle),'identityHash':D.identity(prefix_bundle),'observation':first}
stable_submission=D.build(stable,task,observations['B'],observations['C'])
out=dict(baseline=daily,submission=submission,observations=observations,rebaseVersion=archive['rebaseVersion'],
 previousVersion=archive['previousVersion'],previousBundle=copy.deepcopy(bundle),preview=R.technical_preview(submission['bundle']['priceHistory'],submission['bundle']['marketDataFreshness']['sourceContract']),
 stableBaseline=stable,stableSubmission=stable_submission)
path=ROOT/'.rebase/bounded-daily-v1/fixture.json';path.parent.mkdir(parents=True,exist_ok=True)
import os,tempfile
fd,temporary=tempfile.mkstemp(prefix='fixture-',suffix='.json',dir=path.parent)
try:
    with os.fdopen(fd,'w',encoding='utf-8') as stream:stream.write(json.dumps(out,ensure_ascii=False,allow_nan=False))
    os.replace(temporary,path)
finally:
    if os.path.exists(temporary):os.unlink(temporary)
print(json.dumps(dict(bars=len(submission['bundle']['priceHistory']),bundleHash=submission['bundleHash'],latest=submission['bundle']['priceHistory'][-1]['date'])))
