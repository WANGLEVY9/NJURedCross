"""Release packaging whitelist: only tracked runtime source may leave the repo."""
import importlib.util
import io
import json
import os
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('packager', Path(__file__).resolve().parents[1] / 'scripts/package-release.py')
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


class RuntimePathTests(unittest.TestCase):
    def test_entry_points_and_runtime_trees_are_included(self):
        for name in ['server.js', 'package.json', 'package-lock.json', 'lib/events/workflow.js', 'public/index.html', 'public/app/main.js', 'public/styles/tokens.css']:
            self.assertTrue(packager.runtime_path(name), name)

    def test_documentation_and_tooling_are_excluded(self):
        for name in ['README.md', 'public/README.md', 'docs/API.md', 'scripts/preview-site.mjs', 'tests/format.test.mjs', 'lib/events/notes.txt']:
            self.assertFalse(packager.runtime_path(name), name)

    def test_environment_and_escape_paths_are_excluded(self):
        for name in ['.env', '.github/workflows/ci.yml', '../server.js', 'lib/../server.js', '/etc/passwd']:
            self.assertFalse(packager.runtime_path(name), name)


class PackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.cwd = os.getcwd()
        os.chdir(self.root)
        self.addCleanup(lambda: os.chdir(self.cwd))
        for name in ['server.js', 'lib/events/workflow.js', 'public/index.html', 'README.md', '.env']:
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(f'synthetic {name}')

    def run_package(self, tracked):
        # git ls-files is decoded by the caller; git rev-parse is requested with text=True.
        listed = '\0'.join(tracked).encode() + b'\0'
        with patch.object(packager.subprocess, 'check_output', side_effect=[listed, 'abc123\n']):
            destination = self.root / 'out.tar.gz'
            packager.package(str(destination))
        with tarfile.open(destination, 'r:gz') as archive:
            names = archive.getnames()
            manifest = json.loads(archive.extractfile('manifest.json').read())
        return names, manifest

    def test_only_whitelisted_tracked_files_are_packaged(self):
        names, manifest = self.run_package(['server.js', 'lib/events/workflow.js', 'public/index.html', 'README.md', '.env'])
        self.assertIn('server.js', names)
        self.assertIn('lib/events/workflow.js', names)
        self.assertIn('public/index.html', names)
        self.assertNotIn('README.md', names)
        self.assertNotIn('.env', names)

    def test_manifest_records_the_commit_and_file_hashes(self):
        names, manifest = self.run_package(['server.js', 'public/index.html'])
        self.assertEqual(manifest['commit'], 'abc123')
        self.assertEqual(sorted(manifest['files']), ['public/index.html', 'server.js'])
        for name, digest in manifest['files'].items():
            self.assertEqual(len(digest), 64, name)

    def test_manifest_json_is_not_mode_readable_by_others(self):
        with patch.object(packager.subprocess, 'check_output', side_effect=[b'server.js\0', 'abc123\n']):
            destination = self.root / 'mode.tar.gz'
            packager.package(str(destination))
        with tarfile.open(destination, 'r:gz') as archive:
            entry = archive.getmember('manifest.json')
        self.assertEqual(entry.mode & 0o077, 0)


if __name__ == '__main__':
    unittest.main()
