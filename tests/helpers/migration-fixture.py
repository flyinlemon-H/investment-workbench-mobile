"""Deterministic synthetic candidates, no real symbols or network calls."""
import json,sys,gzip
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
out=Path(__file__).resolve().parents[2]/'.rebase/approved-migration-delivery'
out.mkdir(exist_ok=True)
# The old migration RPC pins its reviewed implementation hash. Test real retained
# old capsules, never silently reseal today's implementation as yesterday's release.
frozen=json.loads(gzip.decompress((Path(__file__).resolve().parents[1]/'fixtures/approved_migration_legacy.json.gz').read_bytes()))
for symbol,cap in frozen.items():
    (out/('fixture-'+symbol+'.json')).write_text(json.dumps(cap),encoding='utf-8')
print('Synthetic migration fixtures ready')
