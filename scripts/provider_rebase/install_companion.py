"""Install the reviewed companion with updater replaced last and a recoverable backup.

This changes code only, never data. All file destinations must be under source_root.
Active processes require an operator-controlled restart before using the new code.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import tempfile
from .pc_patch import build

def install(source_root, expected_updater_hash, *, check_only=False):
    root=Path(source_root).resolve();target=root/'src/market_data/updater.py'
    actual=hashlib.sha256(target.read_bytes()).hexdigest()
    if actual!=expected_updater_hash:raise ValueError('pc_source_baseline_changed')
    plan=build(root)
    sources={'src/market_data/continuity_guard.py':plan['guardSource'],**{'src/market_data/provider_rebase/'+n:t for n,t in plan['sharedSources'].items()},'src/market_data/updater.py':plan['updatedSource']}
    for rel,text in sources.items():
        p=(root/rel).resolve()
        if not p.is_relative_to(root):raise ValueError('unsafe_install_path')
        if p.exists() and p!=target:raise ValueError('companion_already_present')
        compile(text,str(p),'exec')
    if check_only:return dict(status='validated',files=list(sources),baseSha256=actual)
    backup=root/'src/market_data/.guard-backups'/datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup.mkdir(parents=True,exist_ok=False);(backup/'updater.py').write_bytes(target.read_bytes())
    written=[]
    try:
        # Dict insertion order deliberately places the entrypoint last.
        for rel,text in sources.items():
            p=root/rel;p.parent.mkdir(parents=True,exist_ok=True)
            fd,tmp=tempfile.mkstemp(prefix='.guard-',dir=p.parent)
            try:
                with os.fdopen(fd,'w',encoding='utf-8',newline='\n') as f:f.write(text);f.flush();os.fsync(f.fileno())
                os.replace(tmp,p);written.append(p)
            finally:
                if os.path.exists(tmp):os.unlink(tmp)
    except BaseException:
        target.write_bytes((backup/'updater.py').read_bytes())
        for p in written:
            if p!=target:p.unlink()
        raise
    receipt=dict(status='installed',installedAt=datetime.now(timezone.utc).isoformat(),backup=str(backup),baseSha256=actual,
        files={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in written},runningProcessRestartVerified=False)
    (backup/'receipt.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8')
    return receipt

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source-root',required=True);p.add_argument('--expected-updater-hash',required=True);p.add_argument('--check-only',action='store_true');a=p.parse_args()
    print(json.dumps(install(a.source_root,a.expected_updater_hash,check_only=a.check_only),indent=2))
