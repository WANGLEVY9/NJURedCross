#!/usr/bin/env python3
"""Package tracked runtime source, never environment files or database content."""
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile


def runtime_path(name):
    path = Path(name)
    if path.is_absolute() or '..' in path.parts or any(p.startswith('.') for p in path.parts):
        return False
    return name in ('server.js', 'package.json', 'package-lock.json') or (name.startswith('lib/') and name.endswith('.js')) or (name.startswith('public/') and not name.endswith('README.md'))


def package(destination, baseline=None):
    names = subprocess.check_output(['git', 'ls-files', '-z']).decode().split('\0')
    files = {name: hashlib.sha256(Path(name).read_bytes()).hexdigest() for name in names if name and runtime_path(name)}
    manifest = {'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(), 'files': files}
    present = baseline.get('files', {}) if isinstance(baseline, dict) else {}
    included = [name for name, digest in files.items() if present.get(name) != digest]
    with tarfile.open(destination, 'w:gz') as archive:
        for name in included:
            archive.add(name, arcname=name, recursive=False)
        content = json.dumps(manifest, sort_keys=True).encode()
        entry = tarfile.TarInfo('manifest.json')
        entry.size = len(content)
        entry.mode = 0o600
        archive.addfile(entry, io.BytesIO(content))
    print(f"Packaged {len(files)} runtime files from {manifest['commit']}")


if __name__ == '__main__':
    baseline = json.loads(Path(sys.argv[2]).read_text()) if len(sys.argv) > 2 else None
    package(sys.argv[1] if len(sys.argv) > 1 else '/tmp/njuredcross-release.tar.gz', baseline)
