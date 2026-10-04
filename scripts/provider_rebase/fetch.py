"""Bounded, daily-only probes of two fixed hosts. No ProviderChain fallback."""
from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo
import hashlib
import json
from pathlib import Path
import requests
from .core import symbol, VERSION

def fetch(provider,ticker,start,end):
    symbol(ticker);first=date.fromisoformat(start);last=date.fromisoformat(end)
    if first>last:raise ValueError('invalid_window')
    hk=ticker.endswith('.HK');tz=ZoneInfo('Asia/Hong_Kong' if hk else 'Asia/Shanghai')
    code=ticker.split('.')[0]
    if provider=='eastmoney':
        url='https://push2his.eastmoney.com/api/qt/stock/kline/get'
        params=dict(secid=('116.'+code.zfill(5)) if hk else ('1.' if ticker.endswith('.SS') else '0.')+code,
            klt='101',fqt='1',beg=first.strftime('%Y%m%d'),end=last.strftime('%Y%m%d'),
            fields1='f1,f2,f3,f4,f5,f6',fields2='f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61')
    elif provider=='yahoo':
        url='https://query1.finance.yahoo.com/v8/finance/chart/'+ticker
        params=dict(interval='1d',period1=int(datetime.combine(first,time.min,tzinfo=tz).timestamp()),
            period2=int(datetime.combine(last,time.max,tzinfo=tz).timestamp()),events='history')
    else:raise ValueError('unsupported_provider')
    session=requests.Session()
    # Do not inspect/read any user credential, browser state or CLI configuration.
    try:
        with session.get(url,params=params,headers={'User-Agent':'Mozilla/5.0','Accept':'application/json'},timeout=(10,25),allow_redirects=False,stream=True) as response:
            if response.status_code!=200:raise ValueError('provider_http_'+str(response.status_code))
            content=bytearray()
            for chunk in response.iter_content(65536):
                content.extend(chunk)
                if len(content)>8*1024*1024:raise ValueError('provider_response_too_large')
        data=json.loads(content)
    except requests.Timeout:raise ValueError('provider_timeout') from None
    except requests.RequestException:raise ValueError('provider_network_error') from None
    finally:session.close()
    now=datetime.now(timezone.utc);stamp=now.isoformat();rows=[];missing_adj=0;currency=None
    def complete(day):
        local=now.astimezone(tz);cut=time(16,10) if hk else time(15,10)
        return day<local.date() or (day==local.date() and day.weekday()<5 and local.time().replace(tzinfo=None)>=cut)
    if provider=='eastmoney':
        for raw in (data.get('data') or {}).get('klines') or []:
            p=raw.split(',')
            if len(p)<7:raise ValueError('provider_parse_failure')
            d=date.fromisoformat(p[0]);values=[float(p[i]) for i in (1,3,4,2,5,6)]
            if complete(d):rows.append(dict(date=p[0],**dict(zip(('open','high','low','close','volume','amount'),values))))
        algorithm='eastmoney_fqt1'
    else:
        chart=data.get('chart') or {}
        if chart.get('error'):raise ValueError('provider_chart_error')
        result=(chart.get('result') or [None])[0]
        if not result:raise ValueError('provider_empty')
        currency=(result.get('meta') or {}).get('currency')
        quotes=result['indicators']['quote'][0];adj=(result['indicators'].get('adjclose') or [{}])[0].get('adjclose') or []
        for i,ts in enumerate(result.get('timestamp') or []):
            d=datetime.fromtimestamp(ts,tz).date()
            vals={k:(quotes.get(k) or [])[i] for k in ('open','high','low','close','volume')}
            if any(vals[k] is None for k in ('open','high','low','close')):continue
            factor=adj[i]/vals['close'] if i<len(adj) and adj[i] is not None and vals['close'] else None
            if factor is None:missing_adj+=1;factor=1
            if complete(d):rows.append(dict(date=d.isoformat(),**{k:round(vals[k]*factor,6) for k in ('open','high','low','close')},volume=vals['volume'],amount=None))
        algorithm='yahoo_adjclose_ratio_ohlc_round6'
    if not rows:raise ValueError('provider_empty')
    for r in rows:r.update(provider=provider,adjustment='qfq',price_basis='adjusted',fetched_at=stamp,is_complete_bar=True)
    evidence=dict(provider=provider,responseHash=hashlib.sha256(content).hexdigest(),httpStatus=200,
        requestedHistoryStart=start,requestedHistoryEnd=end,returnedBarCount=len(rows),fetchedAt=stamp,
        adjustmentAlgorithmVersion=algorithm,adjustmentConfirmed=missing_adj==0,
        adjustmentEvidence='explicit fqt=1 request' if provider=='eastmoney' else 'adjclose available for all parsed bars',
        missingAdjustmentFactors=missing_adj,calendarConfirmed=False,currency=currency,
        units={provider:{'price':dict(unit='quote_currency',currency=currency,scale=1,confirmed=currency in ('HKD','CNY'),evidence='response.meta.currency'),
            'volume':dict(unit=None,scale=None,confirmed=False,evidence='provider unit not established by response'),
            'amount':dict(unit=None,currency=currency,confirmed=False,evidence='unsupported' if provider=='yahoo' else 'unit requires verification')}})
    return rows,evidence,VERSION+':'+hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
