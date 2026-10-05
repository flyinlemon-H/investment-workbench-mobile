"""Read-only public release attestation immediately before an authorized Apply."""
from datetime import datetime, timezone
import requests

PUBLIC_BASE='https://flyinlemon-h.github.io/investment-workbench-mobile/'
def verify_public_deployment(expected):
    if expected.get('baseUrl')!=PUBLIC_BASE or not expected.get('guardFiles'):
        raise ValueError('production_guard_attestation_invalid')
    try:
        with requests.Session() as session:
            response=session.get(PUBLIC_BASE+'publish-manifest.json',params={'verify_guard':datetime.now(timezone.utc).isoformat()},timeout=(10,20),allow_redirects=False)
            if response.status_code!=200 or len(response.content)>1024*1024:raise ValueError('production_guard_verification_failed')
            manifest=response.json()
    except (requests.RequestException,TypeError,KeyError):
        raise ValueError('production_guard_verification_failed') from None
    files={x['path']:x['sha256'] for x in manifest.get('files',[])}
    if manifest.get('deploymentCommit')!=expected.get('commit') or manifest.get('assetVersion')!=expected.get('assetVersion') or any(files.get(p)!=h for p,h in expected['guardFiles'].items()):
        raise ValueError('production_guard_version_changed')
    return expected
