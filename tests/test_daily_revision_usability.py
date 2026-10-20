"""Offline policy calibration/negative controls. No production client or writes."""
import copy
from datetime import datetime, timedelta, timezone
import json
import struct
import unittest
from unittest.mock import patch
from scripts.provider_rebase import precision_audit as A, daily_policy as D, revision as R

ASOF='2026-10-20T02:42:27+00:00'

def fixture(n=430):
    start=datetime(2024,1,1,8,tzinfo=timezone.utc)
    quotes={k:[] for k in (*A.PRICE,'volume')};adj=[];times=[]
    for i in range(n):
        price=20+i/100
        times.append(int((start+timedelta(days=i)).timestamp()))
        for k,delta in [('open',0),('high',1),('low',-1),('close',.2)]:quotes[k].append(price+delta)
        quotes['volume'].append(10000+i)
        adj.append(struct.unpack('!f',struct.pack('!f',price+.2))[0])
    return dict(chart=dict(result=[dict(meta={'currency':'HKD','symbol':'2899.HK'},timestamp=times,indicators=dict(quote=[quotes],adjclose=[{'adjclose':adj}]))],error=None))

def raw(value):return json.dumps(value,separators=(',',':')).encode()
def rows(value):
    return [dict(date=day,**{k:r['fields'][k]['production'] for k in A.PRICE},volume=int(r['volume']) if r['volume'] is not None else None,amount=None,provider='yahoo',adjustment='qfq',price_basis='adjusted',is_complete_bar=True)
        for day,r in A.trace(raw(value),ASOF)['rows'].items()]
def contract(bars):
    units={'yahoo':{'price':dict(unit='HKD/share',currency='HKD',scale=1,confirmed=True,evidence='synthetic fixture'),
        'volume':dict(unit='shares',scale=1,confirmed=True,evidence='synthetic fixture')}}
    return R.source_contract('2899.HK','yahoo',bars,'fixture-v1',units)
def shift(value,index=0,steps=1):
    array=value['chart']['result'][0]['indicators']['adjclose'][0]['adjclose']
    bits=struct.unpack('!I',struct.pack('!f',array[index]))[0]
    array[index]=struct.unpack('!f',struct.pack('!I',bits+steps))[0]

class DailyPolicyTests(unittest.TestCase):
    def setUp(self):
        self.a=fixture();self.b=fixture(431);shift(self.b)
    def evaluate(self,**kwargs):
        old,new=rows(self.a),rows(self.b)
        args=dict(old_raw=raw(self.a),new_raw=raw(self.b),repeat_raw=raw(self.b),old_asof=ASOF,new_asof=ASOF,repeat_asof=ASOF,expected_version='v1',current_version='v1')
        args.update(kwargs)
        return D.evaluate(old,new,contract(old),contract(new),**args)
    def test_calibrated_revision_not_equal_not_permission(self):
        before=copy.deepcopy((self.a,self.b));value=self.evaluate()
        self.assertEqual(value['tier'],'AUDITED_REVISION')
        self.assertFalse(value['productionWriteAuthorized'])
        self.assertEqual(R.inspect(rows(self.a),rows(self.b),contract(rows(self.b)))['classification'],'SAME_PROVIDER_REVISION')
        self.assertEqual((self.a,self.b),before)
    def test_stable_append(self):
        self.b=fixture(431);self.assertEqual(self.evaluate()['reason'],'STABLE_APPEND')
    def test_version_conflict(self):self.assertEqual(self.evaluate(current_version='v2')['reason'],'VERSION_CONFLICT')
    def test_missing_raw_is_not_small_delta_permission(self):self.assertEqual(self.evaluate(old_raw=None)['reason'],'RAW_PROVENANCE_REQUIRED')
    def test_repeated_unstable_observation_blocks(self):
        repeated=copy.deepcopy(self.b);shift(repeated,index=1)
        self.assertEqual(self.evaluate(repeat_raw=raw(repeated))['reason'],'UNSTABLE_PROVIDER_OBSERVATION')
        self.assertEqual(self.evaluate(repeat_raw=None)['reason'],'REPEAT_OBSERVATION_REQUIRED')
    def test_quote_change_blocks_even_when_tiny(self):
        self.b['chart']['result'][0]['indicators']['quote'][0]['open'][0]+=.000001
        self.assertEqual(self.evaluate()['reason'],'RAW_QUOTE_CHANGED')
    def test_volume_plus_one_blocks(self):
        self.b['chart']['result'][0]['indicators']['quote'][0]['volume'][0]+=1
        self.assertEqual(self.evaluate()['reason'],'QUANTITY_REVISION')
    def test_outside_calibration_blocks(self):
        shift(self.b,steps=3);self.assertEqual(self.evaluate()['reason'],'ADJCLOSE_STEP_EXCEEDED')
    def test_missing_history_blocks(self):
        self.a=fixture(431);self.b=fixture(430)
        self.assertEqual(self.evaluate()['tier'],'REVIEW_REQUIRED')
    def test_changed_decision_boundary_blocks(self):
        original=R.technical_preview
        def preview(bars,c):
            result=original(bars,c)
            if bars[0]['close']!=rows(self.a)[0]['close']:result['relationships'][20]['priceVsMA20']=-99
            return result
        with patch.object(R,'technical_preview',preview):self.assertEqual(self.evaluate()['reason'],'TECHNICAL_DECISION_BOUNDARY_CHANGED')
    def test_unit_and_provider_contracts_not_relaxed(self):
        old,new=rows(self.a),rows(self.b)
        for change in ({'canonicalProvider':'eastmoney'},{'adjustment':'raw'},{'units':{}}):
            with self.subTest(change=change):
                value=D.evaluate(old,new,contract(old),{**contract(new),**change},expected_version='v1',current_version='v1')
                self.assertEqual(value['tier'],'REVIEW_REQUIRED')
    def test_null_is_not_zero(self):
        self.a['chart']['result'][0]['indicators']['quote'][0]['volume'][0]=None
        self.b['chart']['result'][0]['indicators']['quote'][0]['volume'][0]=0
        self.assertEqual(self.evaluate()['reason'],'QUANTITY_REVISION')
    def test_decimal_representation_and_actual_change(self):
        a=raw(fixture(1));b=a.replace(b'20.0',b'20.0000')
        self.assertEqual(A.compare_raw(a,b,ASOF,ASOF)['summary']['rawQuoteDriftDates'],0)
        self.assertEqual(A.compare_raw(raw(self.a),raw(self.b),ASOF,ASOF)['summary']['rawAdjcloseDriftDates'],1)
    def test_adjclose_missing_fails_closed(self):
        self.b['chart']['result'][0]['indicators']['adjclose'][0]['adjclose'][0]=None
        with self.assertRaisesRegex(ValueError,'missing_adjclose'):rows(self.b)
    def test_incomplete_tail_excluded(self):
        value=fixture(1);value['chart']['result'][0]['timestamp'][0]=int(datetime(2026,10,20,2,tzinfo=timezone.utc).timestamp())
        with self.assertRaisesRegex(ValueError,'provider_empty'):A.trace(raw(value),ASOF)
    def test_actual_parser_arithmetic_golden(self):
        value=fixture(1);record=value['chart']['result'][0]
        record['indicators']['quote'][0].update(open=[14.68],high=[15.0],low=[14.0],close=[14.680000305175781])
        record['indicators']['adjclose'][0]['adjclose']=[13.902870178222656]
        a=A.trace(raw(value),ASOF);record['indicators']['adjclose'][0]['adjclose']=[13.90286922454834]
        b=A.trace(raw(value),ASOF)
        for trace in (a,b):
            for field in next(iter(trace['rows'].values()))['fields'].values():
                self.assertEqual(float(field['decimalRound6']),field['production'])
                self.assertEqual(field['alternateOrder'],field['production'])
        self.assertEqual(next(iter(a['rows'].values()))['fields']['close']['production'],13.902870)
        self.assertEqual(next(iter(b['rows'].values()))['fields']['close']['production'],13.902869)

if __name__=='__main__':unittest.main()
