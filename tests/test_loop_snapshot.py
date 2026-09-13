"""Behavioral tests of evidence identity; no model calls or network access."""

import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "loop_snapshot.py"
SPEC = importlib.util.spec_from_file_location("loop_snapshot", SCRIPT)
SNAPSHOT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SNAPSHOT)


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        self.git("init", "-q")
        self.git("config", "user.name", "Snapshot Test")
        self.git("config", "user.email", "snapshot@example.invalid")
        self.git("config", "commit.gpgsign", "false")
        self.git("config", "core.hooksPath", str(self.repo / "no-hooks"))
        (self.repo / ".gitignore").write_text("ignored/\n", encoding="utf-8")
        (self.repo / "code.py").write_text("value = 1\n", encoding="utf-8")
        self.git("add", ".")
        self.git("commit", "-qm", "Fixture")

    def git(self, *args):
        return subprocess.run(["git", "-C", str(self.repo), *args], check=True, capture_output=True, timeout=15)

    def identity(self):
        return SNAPSHOT.capture(self.repo)["snapshot_id"]

    def test_uncommitted_content_invalidates_same_head(self):
        before = SNAPSHOT.capture(self.repo)
        (self.repo / "code.py").write_text("value = 2\n", encoding="utf-8")
        after = SNAPSHOT.capture(self.repo)
        self.assertEqual(before["head"], after["head"])
        self.assertNotEqual(before["snapshot_id"], after["snapshot_id"])

    def test_new_files_edits_and_tracked_deletion_are_visible(self):
        identities = [self.identity()]
        new = self.repo / "new file.py"
        new.write_text("first\n", encoding="utf-8")
        identities.append(self.identity())
        new.write_text("second\n", encoding="utf-8")
        identities.append(self.identity())
        (self.repo / "code.py").unlink()
        state = SNAPSHOT.capture(self.repo)
        identities.append(state["snapshot_id"])
        self.assertEqual(len(set(identities)), 4)
        self.assertEqual(next(x for x in state["files"] if x["path"] == "code.py")["kind"], "missing")

    def test_journal_and_ignored_artifacts_do_not_change_candidate(self):
        before = self.identity()
        for folder in [".dspatch-loop", "ignored"]:
            (self.repo / folder).mkdir()
            (self.repo / folder / "log.txt").write_text("runtime log", encoding="utf-8")
        self.assertEqual(before, self.identity())

    def test_cli_mismatch_and_existing_snapshot_preserved(self):
        destination = self.repo / ".dspatch-loop" / "candidate.json"
        command = [sys.executable, str(SCRIPT), "--repo", str(self.repo)]
        first = subprocess.run(command + ["--output", str(destination)], capture_output=True, timeout=15)
        self.assertEqual(first.returncode, 0, first.stderr)
        saved = destination.read_bytes()
        repeat = subprocess.run(command + ["--output", str(destination)], capture_output=True, timeout=15)
        self.assertEqual(repeat.returncode, 1)
        self.assertEqual(saved, destination.read_bytes())
        match = subprocess.run(command + ["--expect", str(destination)], capture_output=True, timeout=15)
        self.assertEqual(match.returncode, 0, match.stderr)
        (self.repo / "code.py").write_text("changed\n", encoding="utf-8")
        mismatch = subprocess.run(command + ["--expect", str(destination)], capture_output=True, timeout=15)
        self.assertEqual(mismatch.returncode, 2)
        self.assertFalse(json.loads(mismatch.stdout)["matches"])

    def test_probe_must_be_a_real_separate_repository(self):
        child = self.repo / "probe"
        child.mkdir()
        with self.assertRaisesRegex(ValueError, "repository root"):
            SNAPSHOT.capture(child)


if __name__ == "__main__":
    unittest.main()
