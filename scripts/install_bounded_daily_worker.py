"""Reviewable code-only installer. Default is check-only. Never starts a Worker."""
import argparse,hashlib,json,os,shutil,tempfile
from datetime import datetime,timezone
from pathlib import Path

def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def safe(root,relative,kind='workbench'):
    p=(root/relative).resolve()
    allowed=(relative=='src/market_data/provider_rebase/integration.py') if kind=='pc' else relative.startswith('scripts/') and p.suffix=='.py'
    if not p.is_relative_to(root) or not allowed:raise ValueError('unsafe_package_path')
    return p
def install(package,target,*,source_root=None,apply=False,state_dir=None):
    package=Path(package).resolve();target=Path(target).resolve();m=json.loads((package/'worker-package.json').read_text(encoding='utf-8'))
    if m['protocol']!='bounded-daily-revision-v1' or target!=Path(m['targetRoot']).resolve():raise ValueError('package_target_mismatch')
    roots={'workbench':target}
    if m.get('sourceRoot'):
        if source_root is None or Path(source_root).resolve()!=Path(m['sourceRoot']).resolve():raise ValueError('package_source_mismatch')
        roots['pc']=Path(source_root).resolve()
    files=m['files'];plan=[]
    if not files or len(files)>40 or len({(x.get('root','workbench'),x['path']) for x in files})!=len(files):raise ValueError('invalid_package')
    for entry in files:
        rel=entry['path'];kind=entry.get('root','workbench')
        if kind not in roots:raise ValueError('unsafe_package_path')
        src=safe(package/('pc' if kind=='pc' else ''),rel,kind);dest=safe(roots[kind],rel,kind)
        if sha(src)!=entry['sha256']:raise ValueError('package_integrity_failed')
        actual=sha(dest) if dest.exists() else None
        if actual!=entry['expectedBefore']:raise ValueError('installed_code_changed')
        data=src.read_bytes()
        if hashlib.sha256(data).hexdigest()!=entry['sha256']:raise ValueError('package_integrity_failed')
        compile(data.decode('utf-8'),rel,'exec');plan.append((data,dest,entry))
    if not apply:return dict(status='CHECK_ONLY_PASS',files=len(plan),startsWorker=False,credentialAccess=False)
    if os.name!='nt':raise ValueError('windows_install_only')
    if state_dir is None:raise ValueError('explicit_private_state_dir_required')
    directory=Path(state_dir).resolve()
    if not directory.is_dir() or any(directory.is_relative_to(r) for r in roots.values()) or any(x.lower().startswith('onedrive') for x in directory.parts):raise ValueError('private_state_required')
    import msvcrt
    with (directory/'worker.lock').open('a+b') as lock:
        if lock.seek(0,2)==0:lock.write(b'0');lock.flush()
        lock.seek(0);msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
        try:
            backup=directory/'code-backups'/datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ');backup.mkdir(parents=True,exist_ok=False)
            # Backup all code before the first replacement. No data or credential files.
            for data,dest,entry in plan:
                if (sha(dest) if dest.exists() else None)!=entry['expectedBefore']:raise ValueError('installed_code_changed')
                if dest.exists():
                    previous=backup/entry.get('root','workbench')/entry['path'];previous.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(dest,previous)
            (backup/'worker-package.json').write_text(json.dumps(m,indent=2),encoding='utf-8')
            changed=[]
            try:
                for data,dest,entry in plan:
                    dest.parent.mkdir(parents=True,exist_ok=True)
                    fd,tmp=tempfile.mkstemp(prefix='.worker-',dir=dest.parent)
                    try:
                        with os.fdopen(fd,'wb') as stream:stream.write(data);stream.flush();os.fsync(stream.fileno())
                        os.replace(tmp,dest);changed.append((dest,entry))
                    finally:
                        if os.path.exists(tmp):os.unlink(tmp)
            except BaseException:
                for dest,entry in reversed(changed):
                    previous=backup/entry.get('root','workbench')/entry['path']
                    if previous.exists():shutil.copyfile(previous,dest)
                    elif dest.exists():dest.unlink()
                raise
            return dict(status='CODE_INSTALLED_WORKER_STOPPED',files=len(plan),backup=str(backup),credentialAccess=False)
        finally:
            lock.seek(0);msvcrt.locking(lock.fileno(),msvcrt.LK_UNLCK,1)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--package',type=Path,required=True);p.add_argument('--target',type=Path,required=True);p.add_argument('--source-root',type=Path);p.add_argument('--state-dir',type=Path);p.add_argument('--apply',action='store_true');a=p.parse_args()
    print(json.dumps(install(a.package,a.target,source_root=a.source_root,apply=a.apply,state_dir=a.state_dir),ensure_ascii=False))
