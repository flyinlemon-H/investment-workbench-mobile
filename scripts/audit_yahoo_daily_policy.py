"""Replay retained A/B/C evidence locally. No network, approval, or current write.

Input directory contains context-before.json, summary.json, A/B/C-raw.json and
C-rows.json. Output excludes owner IDs and business data. It is evidence only.
"""
import argparse
import copy
import json
from pathlib import Path
from .provider_rebase import daily_policy as D, revision as R, canonical as K

def audit(directory):
    read=lambda name:json.loads((directory/name).read_text(encoding='utf-8'))
    context=read('context-before.json');summary=read('summary.json')
    old=context['bundle']['priceHistory'];new=read('C-rows.json')
    contract=context['targetSourceContract'];target=copy.deepcopy(contract)
    target['historyWindow']={'start':new[0]['date'],'end':new[-1]['date']}
    before=R.technical_preview(old,contract);overlap=R.technical_preview(new[:len(old)],contract)
    after=R.technical_preview(new,target)
    policy=D.evaluate(old,new,contract,target,
        old_raw=(directory/'A-raw.json').read_bytes(),new_raw=(directory/'C-raw.json').read_bytes(),
        repeat_raw=(directory/'B-raw.json').read_bytes(),old_asof=summary['A']['asOf'],
        new_asof=summary['C']['asOf'],repeat_asof=summary['B']['asOf'],
        expected_version=context['currentVersion'],current_version=context['currentVersion'])
    return dict(policy=policy,calibration=D.CALIBRATION,
        originalCurrent=context['currentVersion'],originalContent=context['contentHash'],
        originalCanonical=K.facts_hash(context['bundle']),
        oldBars=len(old),candidateBars=len(new),firstDate=new[0]['date'],lastDate=new[-1]['date'],
        observedRevisionContentHash=R.content_hash(new,target),
        indicatorsBefore=before['indicators'],indicatorsRevisedOverlap=overlap['indicators'],indicatorsWithNewBars=after['indicators'],
        oldDiscreteSignals=before['technicalData']['programRiskFlags'],revisedOverlapDiscreteSignals=overlap['technicalData']['programRiskFlags'],
        newDiscreteSignals=after['technicalData']['programRiskFlags'],
        productionWrite=False,approvalCreated=False,productionPolicyImplemented=False)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence-dir',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();result=audit(args.evidence_dir)
    args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(dict(policy=result['policy'],bars=result['candidateBars'],last=result['lastDate'])))

if __name__=='__main__':main()
