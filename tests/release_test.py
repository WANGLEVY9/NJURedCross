"""Synthetic deployment checks: no SSH, service restarts or external requests."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('receiver', Path(__file__).resolve().parents[1] / 'scripts/receive-release.py')
receiver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(receiver)


def archive(files, names=None):
    manifest = {'commit': 'a' * 40, 'files': {p: hashlib.sha256(v).hexdigest() for p, v in files.items()}}
    out = io.BytesIO()
    with tarfile.open(fileobj=out, mode='w:gz') as tar:
        for name, content in {**files, 'manifest.json': json.dumps(manifest).encode()}.items():
            entry = tarfile.TarInfo((names or {}).get(name, name))
            entry.size = len(content)
            tar.addfile(entry, io.BytesIO(content))
    out.seek(0)
    return out


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        base = Path(self.temp.name)
        self.root = base / 'app'
        self.root.mkdir()
        (self.root / '.env').write_text('SYNTHETIC_SECRET=unchanged')
        self.patches = [patch.object(receiver, 'ROOT', self.root), patch.object(receiver, 'BACKUPS', base / 'backups'), patch.object(receiver, 'STATE', base / 'state'), patch.object(receiver, 'health'), patch.object(receiver.subprocess, 'run')]
        for p in self.patches:
            p.start()
        self.addCleanup(self.temp.cleanup)
        for p in self.patches:
            self.addCleanup(p.stop)

    def test_replacement_and_owned_deletion_preserve_environment(self):
        receiver.deploy(archive({'public/sample.css': b'first'}))
        receiver.deploy(archive({'public/next.css': b'second'}))
        self.assertFalse((self.root / 'public/sample.css').exists())
        self.assertEqual((self.root / 'public/next.css').read_bytes(), b'second')
        self.assertEqual((self.root / '.env').read_text(), 'SYNTHETIC_SECRET=unchanged')
        self.assertTrue(list(receiver.BACKUPS.glob('*/public/sample.css')))

    def test_failed_health_restores_previous_files_and_state(self):
        receiver.deploy(archive({'public/sample.css': b'first'}))
        state = (receiver.STATE / 'release.json').read_bytes()
        with patch.object(receiver, 'health', side_effect=RuntimeError('synthetic health failure')):
            with self.assertRaises(RuntimeError):
                receiver.deploy(archive({'public/sample.css': b'changed', 'public/new.css': b'new'}))
        self.assertEqual((self.root / 'public/sample.css').read_bytes(), b'first')
        self.assertFalse((self.root / 'public/new.css').exists())
        self.assertEqual((receiver.STATE / 'release.json').read_bytes(), state)

    def test_private_paths_and_traversal_are_rejected(self):
        for name in ('.env', 'lib/../../secret.js', 'public/.private/data'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                receiver.deploy(archive({name: b'no'}))

    def test_backend_restart_is_queued_and_resumed_before_public_health(self):
        with patch.object(receiver, 'bridge') as bridge:
            receiver.deploy(archive({'server.js': b'// synthetic backend'}))
        self.assertEqual([c.args for c in bridge.call_args_list], [('pause',), ('resume',)])

    def test_busy_bridge_aborts_without_restarting_the_running_application(self):
        (self.root / 'server.js').write_bytes(b'// previous backend')
        with patch.object(receiver, 'bridge', side_effect=RuntimeError('busy')), patch.object(receiver, 'run') as run:
            with self.assertRaisesRegex(RuntimeError, 'busy'):
                receiver.deploy(archive({'server.js': b'// changed backend'}))
        self.assertFalse(any(c.args[:2] == ('systemctl', 'restart') for c in run.call_args_list))
        self.assertEqual((self.root / 'server.js').read_bytes(), b'// previous backend')

    def test_health_rollback_queues_again_until_previous_backend_is_restored(self):
        (self.root / 'server.js').write_bytes(b'// previous backend')
        with patch.object(receiver, 'bridge') as bridge, patch.object(receiver, 'health', side_effect=RuntimeError('bad release')):
            with self.assertRaisesRegex(RuntimeError, 'bad release'):
                receiver.deploy(archive({'server.js': b'// changed backend'}))
        self.assertEqual([c.args for c in bridge.call_args_list], [('pause',), ('resume',), ('pause',), ('resume',)])
        self.assertEqual((self.root / 'server.js').read_bytes(), b'// previous backend')

    def test_corrupt_payload_never_changes_runtime(self):
        payload = archive({'public/sample.css': b'original'})
        out = io.BytesIO()
        with tarfile.open(fileobj=payload, mode='r:gz') as source, tarfile.open(fileobj=out, mode='w:gz') as target:
            for entry in source.getmembers():
                data = source.extractfile(entry).read()
                if entry.name == 'public/sample.css':
                    data = b'tampered'
                entry.size = len(data)
                target.addfile(entry, io.BytesIO(data))
        out.seek(0)
        with self.assertRaisesRegex(ValueError, 'Hash mismatch'):
            receiver.deploy(out)
        self.assertFalse((self.root / 'public/sample.css').exists())
        self.assertFalse((receiver.STATE / 'release.json').exists())

    def test_health_retries_startup_but_persistent_failure_is_not_hidden(self):
        # Stop the setUp mock for this method only.
        self.patches[3].stop()
        with patch.object(receiver, 'health_once', side_effect=[OSError('starting'), None]) as check, patch.object(receiver.time, 'sleep'):
            receiver.health()
            self.assertEqual(check.call_count, 2)
        with patch.object(receiver, 'health_once', side_effect=OSError('unavailable')) as check, patch.object(receiver.time, 'sleep'):
            with self.assertRaises(OSError):
                receiver.health()
            self.assertEqual(check.call_count, 5)

    def test_symlink_target_outside_runtime_is_rejected(self):
        outside = self.root.parent / 'outside'
        outside.mkdir()
        (self.root / 'public').symlink_to(outside, target_is_directory=True)
        with self.assertRaises(ValueError):
            receiver.deploy(archive({'public/sample.css': b'no'}))
        self.assertFalse((outside / 'sample.css').exists())


if __name__ == '__main__':
    unittest.main()
