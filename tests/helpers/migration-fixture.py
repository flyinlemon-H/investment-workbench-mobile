"""Deterministic synthetic candidates, no real symbols or network calls."""
import json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from tests.test_provider_evidence import make, candidate
from scripts.provider_rebase import remote
out=Path(__file__).resolve().parents[2]/'.rebase/approved-migration-delivery'
out.mkdir(exist_ok=True)
for symbol in ('9999.HK','9998.HK'):
    req,rows,ev=make(symbol)
    ev['migrationDeployment']={'rpcVersion':remote.RPC_VERSION,'unsafeWritePathCount':0}
    ev['productionDeployment']={'assetVersion':'approved-provider-rebase-apply-v1-20261005','commit':'0'*40}
    c=candidate(req,rows,ev)
    (out/('fixture-'+symbol+'.json')).write_text(json.dumps(remote.capsule(c,req)),encoding='utf-8')
print('Synthetic migration fixtures ready')
