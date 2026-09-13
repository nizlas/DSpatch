#!/usr/bin/env python3
"""Fingerprint a Git working tree without committing or changing its contents.

Includes tracked (also missing) and non-ignored untracked files. Excludes the
local .dspatch-loop journal. This is evidence identity, not a process lock or a
complete build environment capture. Python 3.10+, Git, no third-party packages.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys


def git(repo, *args, allow_failure=False):
    result = subprocess.run(
        ["git", "-C", str(repo), *args], capture_output=True, timeout=15
    )
    if result.returncode and not allow_failure:
        raise ValueError(result.stderr.decode("utf-8", "replace").strip())
    return result


def hash_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def manifest(repo):
    tracked = git(repo, "ls-files", "--stage", "-z").stdout
    entries = {}
    for entry in tracked.split(b"\0"):
        if not entry:
            continue
        info, raw_path = entry.split(b"\t", 1)
        mode, _, stage = info.decode("ascii").split()
        if stage != "0":
            raise ValueError("Unresolved Git index: reconcile conflicts first.")
        name = os.fsdecode(raw_path)
        if mode == "160000":
            raise ValueError("Submodules are not supported by this snapshot tool.")
        entries[name] = mode
    untracked = git(repo, "ls-files", "--others", "--exclude-standard", "-z").stdout
    for name in untracked.split(b"\0"):
        if name:
            entries.setdefault(os.fsdecode(name), None)

    result = []
    for name, index_mode in sorted(entries.items()):
        if name == ".dspatch-loop" or name.startswith(".dspatch-loop/"):
            continue
        path = repo / name
        item = {"path": name, "index_mode": index_mode}
        if path.is_symlink():
            item.update(kind="symlink", sha256=hashlib.sha256(os.fsencode(os.readlink(path))).hexdigest())
        elif not path.exists():
            item.update(kind="missing", sha256=None)
        elif path.is_file():
            item.update(kind="file", sha256=hash_file(path))
            item["executable"] = bool(path.stat().st_mode & 0o111)
        else:
            raise ValueError("Unsupported working-tree entry: " + name)
        result.append(item)
    return result


def capture(repo):
    repo = Path(repo).resolve()
    top = Path(os.fsdecode(git(repo, "rev-parse", "--show-toplevel").stdout).strip()).resolve()
    if top != repo:
        raise ValueError("--repo must name the Git repository root, not a subdirectory.")

    def read_head():
        response = git(repo, "rev-parse", "--verify", "HEAD", allow_failure=True)
        return response.stdout.decode("ascii").strip() if response.returncode == 0 else None

    head = read_head()
    first = manifest(repo)
    second = manifest(repo)
    if first != second or head != read_head():
        raise ValueError("Working tree changed during capture; reconcile before retrying.")
    payload = {"schema_version": 1, "head": head, "files": first}
    encoded = json.dumps(payload, sort_keys=True, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
    return {
        **payload,
        "snapshot_id": "sha256:" + hashlib.sha256(encoded).hexdigest(),
        "repository": str(repo),
        "excluded": [".dspatch-loop/", "Git-ignored untracked files"],
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=".")
    output = parser.add_mutually_exclusive_group()
    output.add_argument("--output", help="New JSON file inside the repo's .dspatch-loop directory")
    output.add_argument("--expect", help="Compare with a previously captured JSON file")
    args = parser.parse_args(argv)
    try:
        snapshot = capture(args.repo)
        if args.expect:
            expected = json.loads(Path(args.expect).read_text(encoding="utf-8"))
            if expected.get("schema_version") != 1 or "snapshot_id" not in expected:
                raise ValueError("Unsupported or incomplete snapshot file.")
            same = expected["snapshot_id"] == snapshot["snapshot_id"]
            print(json.dumps({"matches": same, "expected": expected["snapshot_id"], "actual": snapshot["snapshot_id"]}))
            return 0 if same else 2
        if args.output:
            path = Path(args.output).resolve()
            journal = Path(args.repo).resolve() / ".dspatch-loop"
            # The output must not alter the working-tree content being identified.
            if not path.is_relative_to(journal.resolve()):
                raise ValueError("--output must be inside this repo's .dspatch-loop directory.")
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("x", encoding="utf-8") as stream:
                json.dump(snapshot, stream, indent=2, ensure_ascii=True)
                stream.write("\n")
            print(json.dumps({"snapshot_id": snapshot["snapshot_id"], "output": str(path)}))
        else:
            print(json.dumps(snapshot, indent=2, ensure_ascii=True))
        return 0
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        print("Snapshot failed: " + str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
