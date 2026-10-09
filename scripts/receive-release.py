#!/usr/bin/env python3
"""Restricted SSH receiver installed by the Owner outside the application tree."""
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
from datetime import datetime, timezone
from urllib.request import urlopen

ROOT = Path('/opt/njuredcross')
BACKUPS = Path('/opt/njuredcross-backups')
STATE = Path('/var/lib/njuredcross-deploy')
MAX_SIZE = 32 * 1024 * 1024


def runtime_path(name):
    path = Path(name)
    if path.is_absolute() or '..' in path.parts or any(p.startswith('.') for p in path.parts):
        return False
    return name in ('server.js', 'package.json', 'package-lock.json') or (name.startswith('lib/') and name.endswith('.js')) or (name.startswith('public/') and not name.endswith('README.md'))


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None


def run(*args):
    subprocess.run(args, cwd=ROOT, check=True, stdout=subprocess.DEVNULL)


def health():
    run('systemctl', 'is-active', '--quiet', 'njuredcross.service')
    for endpoint in ('/', '/outreach', '/community', '/materials'):
        with urlopen('https://njuredcross.cn' + endpoint, timeout=20) as response:
            if response.status != 200:
                raise RuntimeError('Public page check failed')


def deploy(stream):
    payload = stream.read(MAX_SIZE + 1)
    if len(payload) > MAX_SIZE:
        raise ValueError('Release exceeds size limit')
    STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (STATE / 'deploy.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        with tempfile.TemporaryDirectory(prefix='njuredcross-release-') as temporary:
            stage = Path(temporary)
            with tarfile.open(fileobj=io.BytesIO(payload), mode='r:gz') as archive:
                members = archive.getmembers()
                if len(members) > 1000 or sum(m.size for m in members) > MAX_SIZE:
                    raise ValueError('Release content exceeds limit')
                if any(not m.isfile() or (m.name != 'manifest.json' and not runtime_path(m.name)) for m in members):
                    raise ValueError('Unexpected archive entry')
                if len({m.name for m in members}) != len(members):
                    raise ValueError('Duplicate archive entry')
                for member in members:
                    destination = stage / member.name
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    with archive.extractfile(member) as source:
                        destination.write_bytes(source.read())
            manifest = json.loads((stage / 'manifest.json').read_text())
            files = manifest['files']
            if not re.fullmatch(r'[0-9a-f]{40}', manifest['commit']):
                raise ValueError('Invalid commit')
            if not isinstance(files, dict) or not files or any(not runtime_path(p) or not re.fullmatch(r'[0-9a-f]{64}', value) for p, value in files.items()):
                raise ValueError('Invalid file manifest')
            if {m.name for m in members} != set(files) | {'manifest.json'}:
                raise ValueError('Manifest does not match archive')
            for name, expected in files.items():
                if digest(stage / name) != expected:
                    raise ValueError('Hash mismatch: ' + name)
                if name.endswith('.js'):
                    subprocess.run(['node', '--check', str(stage / name)], check=True, stdout=subprocess.DEVNULL)
                target = ROOT / name
                if not target.resolve().is_relative_to(ROOT.resolve()):
                    raise ValueError('Target outside application')
            previous_path = STATE / 'release.json'
            previous = json.loads(previous_path.read_text()) if previous_path.exists() else {'files': {}}
            changed = [p for p, value in files.items() if digest(ROOT / p) != value]
            removed = [p for p in previous['files'] if p not in files and runtime_path(p) and (ROOT / p).is_file()]
            affected = changed + removed
            restart = any(not p.startswith('public/') for p in affected)
            dependencies = any(p in ('package.json', 'package-lock.json') for p in affected)
            backup = BACKUPS / ('main-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '-' + manifest['commit'][:7])
            backup.mkdir(mode=0o700, parents=True)
            before = {p: digest(ROOT / p) for p in affected}
            for name, value in before.items():
                if value is not None:
                    destination = backup / name
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(ROOT / name, destination)
            (backup / 'before.json').write_text(json.dumps(before))
            env_before = digest(ROOT / '.env')
            try:
                # Modules first, index last; unchanged files are never replaced.
                for name in sorted(changed, key=lambda p: (p == 'public/index.html', p.endswith('.css'), p)):
                    target = ROOT / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    pending = target.with_name(target.name + '.deploy-pending')
                    shutil.copyfile(stage / name, pending)
                    pending.chmod(0o644)
                    os.replace(pending, target)
                for name in removed:
                    (ROOT / name).unlink()
                if dependencies:
                    run('npm', 'ci', '--ignore-scripts', '--omit=dev')
                if restart:
                    run('systemctl', 'restart', 'njuredcross.service')
                health()
                if digest(ROOT / '.env') != env_before or any(digest(ROOT / p) != value for p, value in files.items()):
                    raise RuntimeError('Post-deployment verification failed')
            except Exception:
                for name, value in before.items():
                    if value is None:
                        (ROOT / name).unlink(missing_ok=True)
                    else:
                        shutil.copy2(backup / name, ROOT / name)
                if dependencies:
                    run('npm', 'ci', '--ignore-scripts', '--omit=dev')
                if restart:
                    run('systemctl', 'restart', 'njuredcross.service')
                raise
            manifest.update({'backup': str(backup), 'deployedAt': datetime.now(timezone.utc).isoformat()})
            pending_state = STATE / 'release.pending.json'
            pending_state.write_text(json.dumps(manifest, indent=2))
            pending_state.chmod(0o600)
            os.replace(pending_state, previous_path)
            print(json.dumps({'deployedCommit': manifest['commit'], 'changedFiles': len(changed), 'removedFiles': len(removed), 'verifiedFiles': len(files), 'restarted': restart, 'backup': str(backup)}))


if __name__ == '__main__':
    deploy(sys.stdin.buffer)
