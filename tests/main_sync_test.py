import hashlib
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from importlib.util import module_from_spec, spec_from_file_location

ROOT = Path(__file__).resolve().parents[1]
SPEC = spec_from_file_location("main_sync", ROOT / "scripts/main_sync.py")
MAIN_SYNC = module_from_spec(SPEC)
SPEC.loader.exec_module(MAIN_SYNC)


class RuntimeWhitelistTests(unittest.TestCase):
    def test_runtime_whitelist_matches_receiver(self):
        for name in ("server.js", "package.json", "package-lock.json", "lib/events/a.js", "public/app/main.js", "public/styles/app.css"):
            self.assertTrue(MAIN_SYNC.runtime_path(name), name)
        for name in (".env", "docs/README.md", "public/README.md", "lib/readme.md", "public/.secret", "../server.js"):
            self.assertFalse(MAIN_SYNC.runtime_path(name), name)


class QualityGateTests(unittest.TestCase):
    def test_gate_requires_a_successful_quality_gate(self):
        self.assertEqual(MAIN_SYNC.classify_quality_gate([]), "pending")
        self.assertEqual(MAIN_SYNC.classify_quality_gate([{"name": "Quality gate", "status": "in_progress", "conclusion": None}]), "pending")
        self.assertEqual(MAIN_SYNC.classify_quality_gate([{"name": "Quality gate", "status": "completed", "conclusion": "success"}]), "success")
        self.assertEqual(MAIN_SYNC.classify_quality_gate([{"name": "Quality gate", "status": "completed", "conclusion": "failure"}]), "failed")
        self.assertEqual(MAIN_SYNC.classify_quality_gate([
            {"name": "Quality gate", "status": "completed", "conclusion": "failure"},
            {"name": "Quality gate", "status": "completed", "conclusion": "success"},
        ]), "success")


class ArchiveTests(unittest.TestCase):
    def _source_tar(self, path):
        files = {
            "repo-sha/server.js": b"console.log('ok')\n",
            "repo-sha/package.json": b"{}\n",
            "repo-sha/package-lock.json": b"{}\n",
            "repo-sha/lib/a.js": b"export {};\n",
            "repo-sha/public/index.html": b"<h1>ok</h1>\n",
            "repo-sha/public/README.md": b"excluded\n",
            "repo-sha/.env": b"SECRET=not-in-release\n",
            "repo-sha/docs/readme.md": b"excluded\n",
        }
        with tarfile.open(path, "w:gz") as archive:
            for name, data in files.items():
                entry = tarfile.TarInfo(name)
                entry.size = len(data)
                archive.addfile(entry, io.BytesIO(data))

    def test_extracts_only_runtime_files_and_builds_valid_manifest(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source.tar.gz"
            extracted = root / "runtime"
            release = root / "release.tar.gz"
            self._source_tar(source)
            MAIN_SYNC.extract_runtime_source(source, extracted)
            manifest = MAIN_SYNC.build_release(extracted, "a" * 40, release)
            self.assertEqual(set(manifest["files"]), {"server.js", "package.json", "package-lock.json", "lib/a.js", "public/index.html"})
            self.assertEqual(manifest["commit"], "a" * 40)
            with tarfile.open(release, "r:gz") as archive:
                names = {member.name for member in archive.getmembers()}
                self.assertEqual(names, set(manifest["files"]) | {"manifest.json"})
                manifest_json = json.loads(archive.extractfile("manifest.json").read())
                self.assertEqual(manifest_json["files"], manifest["files"])
                self.assertNotIn("public/README.md", names)
                self.assertNotIn(".env", names)
                for name, digest in manifest["files"].items():
                    self.assertEqual(hashlib.sha256(archive.extractfile(name).read()).hexdigest(), digest)

    def test_missing_required_runtime_file_fails_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "server.js").write_text("ok")
            with self.assertRaises(MAIN_SYNC.SyncError):
                MAIN_SYNC.build_release(root, "b" * 40, root / "release.tar.gz")

    def test_release_is_piped_to_the_existing_receiver(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            release = root / "release.tar.gz"
            release.write_bytes(b"synthetic release")
            receiver = root / "receiver.py"
            receiver.write_text(
                "import json, sys\n"
                "assert sys.stdin.buffer.read() == b'synthetic release'\n"
                "print(json.dumps({'deployedCommit': 'c' * 40}))\n"
            )
            self.assertEqual(
                MAIN_SYNC.deploy(str(receiver), release, 10),
                {"deployedCommit": "c" * 40},
            )


if __name__ == "__main__":
    unittest.main()
