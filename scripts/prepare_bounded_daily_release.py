"""Prepare exact code package and hashes; read installed code, never install or deploy."""
import argparse,hashlib,json,shutil,subprocess,zipfile
from pathlib import Path

def build(root,target,output,source_root):
    root=Path(root).resolve();target=Path(target).resolve();output=Path(output).resolve();source_root=Path(source_root).resolve()
    if output.exists():raise ValueError('release_output_exists')
    output.mkdir(parents=True)
    names=['scripts/'+n for n in ('market_data_worker.py','market_worker_launcher.py','market_worker_errors.py','market_symbol_contract.py','fetch_cloud_universe.py','update_market_universe.py')]
    names += ['scripts/provider_rebase/'+p.name for p in sorted((root/'scripts/provider_rebase').glob('*.py'))]
    sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
    records=[]
    for rel in names:
        source=root/rel;dest=output/rel;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,dest)
        records.append(dict(path=rel,sha256=sha(source),expectedBefore=sha(target/rel) if (target/rel).exists() else None))
    pc_rel='src/market_data/provider_rebase/integration.py';pc_dest=output/'pc'/pc_rel;pc_dest.parent.mkdir(parents=True)
    shutil.copyfile(root/'scripts/provider_rebase/integration.py',pc_dest)
    records.append(dict(root='pc',path=pc_rel,sha256=sha(pc_dest),expectedBefore=sha(source_root/pc_rel)))
    manifest=dict(protocol='bounded-daily-revision-v1',policyVersion='yahoo-hk-adjclose-ulp-pilot-v1',targetRoot=str(target),sourceRoot=str(source_root),
        sourceCommit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),files=records,
        shortcut='existing start_market_worker.ps1 → market_worker_launcher.py → market_data_worker.py',
        modifiesPcMarketSource=True,pcChange='integration.py evidence profile only; no data changes',modifiesCredential=False,startsWorker=False,productionEnabled=False)
    (output/'worker-package.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    shutil.copyfile(root/'scripts/install_bounded_daily_worker.py',output/'install_bounded_daily_worker.py')
    migration=root/'supabase/migrations/20261020033733_bounded_daily_revision_v1.sql';shutil.copyfile(migration,output/migration.name)
    with zipfile.ZipFile(output.with_suffix('.zip'),'w',zipfile.ZIP_DEFLATED) as z:
        for f in sorted(output.rglob('*')):
            if f.is_file():z.write(f,f.relative_to(output))
    result=dict(package=str(output),zip=str(output.with_suffix('.zip')),zipSha256=sha(output.with_suffix('.zip')),migrationSha256=sha(migration),files=len(records))
    (output.parent/(output.name+'-summary.json')).write_text(json.dumps(result,indent=2),encoding='utf-8');return result

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--target',type=Path,required=True);p.add_argument('--source-root',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    print(json.dumps(build(Path(__file__).resolve().parents[1],a.target,a.output,a.source_root),ensure_ascii=False))
