#!/usr/bin/env python3
"""Poll GitHub main and deploy only a quality-gated runtime release.

The receiver installed at /usr/local/sbin/njuredcross-ci-deploy.py remains the
only component that mutates the running application. This script only prepares
a release archive and feeds it to that receiver, which owns locking, backups,
health checks and rollback.
"""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import io
import json
import os
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tarfile
import tempfile
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

DEFAULT_REPOSITORY = "WANGLEVY9/NJURedCross"
DEFAULT_BRANCH = "main"
DEFAULT_RECEIVER = "/usr/local/sbin/njuredcross-ci-deploy.py"
DEFAULT_RELEASE_STATE = "/var/lib/njuredcross-deploy/release.json"
DEFAULT_SYNC_STATE = "/var/lib/njuredcross-deploy/sync-state.json"
DEFAULT_LOCK = "/var/lib/njuredcross-deploy/sync.lock"
DEFAULT_QUALITY_CHECK = "Quality gate"
MAX_SOURCE_BYTES = 64 * 1024 * 1024
MAX_RELEASE_BYTES = 32 * 1024 * 1024
MAX_MEMBERS = 5000
MAX_RELEASE_FILES = 1000
SHA_RE = re.compile(r"^[0-9a-f]{40}$")


class SyncError(RuntimeError):
    """An expected, reportable synchronization failure."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def log(event: str, **fields: object) -> None:
    print(json.dumps({"event": event, "at": utc_now(), **fields}, ensure_ascii=False, separators=(",", ":")), flush=True)


def runtime_path(name: str) -> bool:
    """Match the receiver's runtime whitelist exactly."""
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts or any(part.startswith(".") for part in path.parts):
        return False
    value = path.as_posix()
    return (
        value in ("server.js", "package.json", "package-lock.json")
        or (value.startswith("lib/") and value.endswith(".js"))
        or (value.startswith("public/") and not value.endswith("README.md"))
    )


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def read_json(path: Path, default: dict) -> dict:
    try:
        value = json.loads(path.read_text())
    except FileNotFoundError:
        return default
    except (OSError, ValueError) as error:
        raise SyncError(f"无法读取状态文件 {path}: {error}") from error
    if not isinstance(value, dict):
        raise SyncError(f"状态文件不是对象: {path}")
    return value


def write_json_atomic(path: Path, value: dict) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    pending = path.with_name(path.name + ".pending")
    pending.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    pending.chmod(0o600)
    os.replace(pending, path)


@contextmanager
def exclusive_lock(path: Path):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with path.open("a+") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            log("skipped", reason="another_sync_is_running", lock=str(path))
            raise SystemExit(0)
        yield


def remote_head(remote: str, branch: str, timeout: int) -> str:
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
    try:
        result = subprocess.run(
            ["git", "ls-remote", remote, f"refs/heads/{branch}"],
            capture_output=True,
            text=True,
            timeout=timeout,
            env=env,
            check=True,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise SyncError(f"无法读取 GitHub {branch}: {error}") from error
    fields = result.stdout.strip().split()
    if len(fields) < 1 or not SHA_RE.fullmatch(fields[0]):
        raise SyncError(f"GitHub 返回了无效的 {branch} SHA")
    return fields[0]


def fetch_json(url: str, timeout: int) -> dict:
    request = Request(
        url,
        headers={"Accept": "application/vnd.github+json", "User-Agent": "njuredcross-main-sync"},
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            value = json.load(response)
    except HTTPError as error:
        raise SyncError(f"GitHub API {error.code}: {url}") from error
    except (OSError, URLError, ValueError) as error:
        raise SyncError(f"无法读取 GitHub API: {error}") from error
    if not isinstance(value, dict):
        raise SyncError("GitHub API 返回了无效 JSON")
    return value


def classify_quality_gate(runs: list[dict], check_name: str = DEFAULT_QUALITY_CHECK) -> str:
    matched = [run for run in runs if run.get("name") == check_name]
    if not matched:
        return "pending"
    if any(run.get("status") == "completed" and run.get("conclusion") == "success" for run in matched):
        return "success"
    failed = {"failure", "cancelled", "timed_out", "action_required", "neutral", "skipped"}
    if any(run.get("status") == "completed" and run.get("conclusion") in failed for run in matched):
        return "failed"
    return "pending"


def quality_gate_status(repository: str, sha: str, check_name: str, api_base: str, timeout: int) -> str:
    payload = fetch_json(f"{api_base}/repos/{repository}/commits/{sha}/check-runs?per_page=100", timeout)
    runs = payload.get("check_runs")
    if not isinstance(runs, list):
        raise SyncError("GitHub API 未返回 check_runs")
    return classify_quality_gate([run for run in runs if isinstance(run, dict)], check_name)


def download_source(repository: str, sha: str, destination: Path, timeout: int) -> None:
    request = Request(f"https://codeload.github.com/{repository}/tar.gz/{sha}", headers={"User-Agent": "njuredcross-main-sync"})
    total = 0
    try:
        with urlopen(request, timeout=timeout) as response, destination.open("wb") as output:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_SOURCE_BYTES:
                    raise SyncError("GitHub 源码包超过大小限制")
                output.write(chunk)
    except HTTPError as error:
        raise SyncError(f"下载 GitHub 源码失败: HTTP {error.code}") from error
    except (OSError, URLError) as error:
        raise SyncError(f"下载 GitHub 源码失败: {error}") from error


def extract_runtime_source(source: Path, destination: Path) -> None:
    total = 0
    seen: set[str] = set()
    roots: set[str] = set()
    try:
        with tarfile.open(source, "r:gz") as archive:
            members = archive.getmembers()
            if len(members) > MAX_MEMBERS:
                raise SyncError("GitHub 源码包文件数量超过限制")
            for member in members:
                if not member.isfile():
                    if member.issym() or member.islnk():
                        raise SyncError("GitHub 源码包包含不允许的链接")
                    continue
                path = PurePosixPath(member.name)
                if path.is_absolute() or ".." in path.parts:
                    raise SyncError("GitHub 源码包包含不安全路径")
                if len(path.parts) < 2:
                    continue
                roots.add(path.parts[0])
                relative = PurePosixPath(*path.parts[1:]).as_posix()
                if not runtime_path(relative):
                    continue
                if relative in seen:
                    raise SyncError(f"GitHub 源码包包含重复文件: {relative}")
                data = archive.extractfile(member)
                if data is None:
                    raise SyncError(f"无法读取源码文件: {relative}")
                payload = data.read()
                total += len(payload)
                if total > MAX_RELEASE_BYTES:
                    raise SyncError("运行时源码超过大小限制")
                target = destination / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(payload)
                seen.add(relative)
    except SyncError:
        raise
    except (OSError, tarfile.TarError) as error:
        raise SyncError(f"无法解压 GitHub 源码: {error}") from error
    if len(roots) != 1:
        raise SyncError("GitHub 源码包目录结构异常")
    missing = {"server.js", "package.json", "package-lock.json"} - seen
    if missing:
        raise SyncError(f"源码包缺少运行文件: {', '.join(sorted(missing))}")


def build_release(root: Path, commit: str, destination: Path) -> dict:
    files: dict[str, str] = {}
    total = 0
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.is_symlink():
            continue
        relative = path.relative_to(root).as_posix()
        if not runtime_path(relative):
            continue
        payload = path.read_bytes()
        total += len(payload)
        if total > MAX_RELEASE_BYTES:
            raise SyncError("运行时源码超过大小限制")
        files[relative] = sha256_bytes(payload)
    required = {"server.js", "package.json", "package-lock.json"}
    if not required.issubset(files):
        raise SyncError("运行文件不完整")
    if len(files) > MAX_RELEASE_FILES:
        raise SyncError("运行文件数量超过限制")
    manifest = {"commit": commit, "files": files}
    with tarfile.open(destination, "w:gz", compresslevel=9) as archive:
        for relative in sorted(files):
            archive.add(root / relative, arcname=relative, recursive=False)
        payload = json.dumps(manifest, ensure_ascii=False, sort_keys=True).encode()
        entry = tarfile.TarInfo("manifest.json")
        entry.size = len(payload)
        entry.mode = 0o600
        archive.addfile(entry, io.BytesIO(payload))
    return manifest


def deploy(receiver: str, release: Path, timeout: int) -> dict:
    with release.open("rb") as stream:
        result = subprocess.run(
            [sys.executable, receiver],
            stdin=stream,
            capture_output=True,
            text=True,
            timeout=timeout,
            env={**os.environ, "PYTHONUNBUFFERED": "1"},
        )
    if result.returncode:
        detail = (result.stderr or result.stdout or "").strip()
        raise SyncError(f"发布接收器失败: {detail[-1000:]}")
    lines = [line for line in result.stdout.splitlines() if line.strip()]
    if not lines:
        raise SyncError("发布接收器没有返回回执")
    try:
        receipt = json.loads(lines[-1])
    except ValueError as error:
        raise SyncError("发布接收器回执不是 JSON") from error
    if not isinstance(receipt, dict):
        raise SyncError("发布接收器回执格式无效")
    return receipt


def already_deployed(state_file: Path, sha: str) -> bool:
    return read_json(state_file, {}).get("commit") == sha


def run_once(args: argparse.Namespace) -> int:
    release_state = Path(args.release_state)
    sync_state_path = Path(args.sync_state)
    sync_state = {
        "checkedAt": utc_now(),
        "repository": args.repository,
        "branch": args.branch,
        "deployedCommit": read_json(release_state, {}).get("commit"),
    }
    with exclusive_lock(Path(args.lock)):
        latest = remote_head(args.remote or f"https://github.com/{args.repository}.git", args.branch, args.http_timeout)
        sync_state["latestCommit"] = latest
        if already_deployed(release_state, latest):
            sync_state.update({"status": "up_to_date", "message": "main 已同步"})
            write_json_atomic(sync_state_path, sync_state)
            log("up_to_date", latestCommit=latest)
            return 0

        if not args.skip_ci_check:
            gate = quality_gate_status(args.repository, latest, args.quality_check, args.api_base, args.http_timeout)
            sync_state["qualityGate"] = gate
            if gate == "pending":
                sync_state.update({"status": "waiting_for_quality_gate", "message": "等待 Quality gate 完成"})
                write_json_atomic(sync_state_path, sync_state)
                log("waiting_for_quality_gate", latestCommit=latest)
                return 0
            if gate != "success":
                sync_state.update({"status": "quality_gate_failed", "message": "Quality gate 未通过，不部署"})
                write_json_atomic(sync_state_path, sync_state)
                log("quality_gate_failed", latestCommit=latest)
                return 1

        with tempfile.TemporaryDirectory(prefix="njuredcross-main-sync-") as temporary:
            workspace = Path(temporary)
            source = workspace / "source.tar.gz"
            extracted = workspace / "runtime"
            release = workspace / "release.tar.gz"
            download_source(args.repository, latest, source, args.http_timeout)
            extract_runtime_source(source, extracted)
            manifest = build_release(extracted, latest, release)
            sync_state["runtimeFiles"] = len(manifest["files"])
            if args.dry_run:
                sync_state.update({"status": "dry_run", "message": "已准备好发布包，未调用接收器"})
                write_json_atomic(sync_state_path, sync_state)
                log("dry_run", latestCommit=latest, runtimeFiles=len(manifest["files"]))
                return 0
            if already_deployed(release_state, latest):
                sync_state.update({"status": "up_to_date", "message": "Quality gate 期间已由 CI 部署"})
                write_json_atomic(sync_state_path, sync_state)
                log("up_to_date", latestCommit=latest, reason="deployed_during_quality_gate")
                return 0
            receipt = deploy(args.receiver, release, args.deploy_timeout)
            sync_state.update({"status": "deployed", "message": "已调用发布接收器", "receipt": receipt, "deployedCommit": latest})
            write_json_atomic(sync_state_path, sync_state)
            log("deployed", latestCommit=latest, receipt=receipt)
            return 0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Poll GitHub main and deploy a quality-gated release")
    parser.add_argument("--repository", default=os.environ.get("SYNC_REPOSITORY", DEFAULT_REPOSITORY))
    parser.add_argument("--branch", default=os.environ.get("SYNC_BRANCH", DEFAULT_BRANCH))
    parser.add_argument("--remote", default=os.environ.get("SYNC_REMOTE", ""))
    parser.add_argument("--api-base", default=os.environ.get("SYNC_API_BASE", "https://api.github.com"))
    parser.add_argument("--quality-check", default=os.environ.get("SYNC_QUALITY_CHECK", DEFAULT_QUALITY_CHECK))
    parser.add_argument("--receiver", default=os.environ.get("SYNC_RECEIVER", DEFAULT_RECEIVER))
    parser.add_argument("--release-state", default=os.environ.get("SYNC_RELEASE_STATE", DEFAULT_RELEASE_STATE))
    parser.add_argument("--sync-state", default=os.environ.get("SYNC_STATE_FILE", DEFAULT_SYNC_STATE))
    parser.add_argument("--lock", default=os.environ.get("SYNC_LOCK", DEFAULT_LOCK))
    parser.add_argument("--http-timeout", type=int, default=int(os.environ.get("SYNC_HTTP_TIMEOUT", "30")))
    parser.add_argument("--deploy-timeout", type=int, default=int(os.environ.get("SYNC_DEPLOY_TIMEOUT", "900")))
    parser.add_argument("--skip-ci-check", action="store_true", help="Emergency override; timer must not use this")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        return run_once(args)
    except SystemExit:
        raise
    except (SyncError, OSError, subprocess.SubprocessError) as error:
        log("failed", error=str(error))
        try:
            state = read_json(Path(args.sync_state), {})
            state.update({"status": "failed", "message": str(error), "checkedAt": utc_now()})
            write_json_atomic(Path(args.sync_state), state)
        except Exception:
            pass
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
