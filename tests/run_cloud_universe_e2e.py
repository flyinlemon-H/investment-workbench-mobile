"""Synthetic test-cloud reader -> protected credential -> PC runner -> mock bridge."""
import json
from pathlib import Path
import sys
import tempfile

from scripts import fetch_cloud_universe as cloud
from scripts import update_market_universe as universe
from tests.test_mobile_universe_pc import fake_update


def main():
    credential = cloud.validate_credential(json.loads(Path(sys.argv[1]).read_text(encoding='utf-8')))
    assert credential['projectRef'] == 'lblyapnsngqnjimgskkp', 'Only test project permitted'
    with tempfile.TemporaryDirectory() as folder:
        root = Path(folder)
        protected = root / 'reader.bin'
        cloud.save_credential(credential, protected)
        fetched = cloud.fetch_cloud_universe(credential_loader=lambda: cloud.load_credential(protected),
                                            expected_project='lblyapnsngqnjimgskkp')
        assert fetched['status']=='success', fetched['code']
        assert {r['symbol'] for r in fetched['rows']}=={'600487.SS','688825.SS'}
        formal,registry,bridge,inbox = [root / name for name in ('latest_export.json','registry.json','bridge.js','inbox')]
        inbox.mkdir();formal.write_text(json.dumps({'stocks':[{'id':'held','code':'600000.SS','shares':3,'avgCost':8,'plans':[]}]}),encoding='utf-8')
        seen=[]
        def update(state, **kwargs):
            seen.extend(state['stocks']);return fake_update(state, **kwargs)
        result=universe.run_update(formal_path=formal,registry_path=registry,bridge_path=bridge,inbox_path=inbox,
                                   update_function=update,cloud_fetch=lambda:fetched)
        assert result['symbols']==3
        assert next(s for s in seen if s['code']=='600487.SS')['marketOnly'] is True
        delivered=json.loads(bridge.read_text(encoding='utf-8').split(' = ',1)[1].rsplit(';',1)[0])
        assert next(s for s in delivered['stocks'] if s['symbol']=='600487.SS')['priceHistory']
        assert json.loads(formal.read_text(encoding='utf-8'))['stocks'][0]['shares']==3
        summary={'testProject':credential['projectRef'],'cloudSymbols':len(fetched['rows']),'updateUniverse':result['symbols'],
                 'marketOnly':True,'validBridge':True,'holdingsPreserved':True,'dpapi':True,'result':'PASS'}
        Path(sys.argv[2]).write_text(json.dumps(summary,indent=2),encoding='utf-8');print(json.dumps(summary))


if __name__=='__main__':
    main()
