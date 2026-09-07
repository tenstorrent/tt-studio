# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for the durable image-pull progress store.

The point of this store is that a pull's progress is visible from a process other
than the one running the pull — the backend serves polls from several uvicorn
workers. A test that only exercises one process would pass on the old in-memory
implementation too, so the cross-process cases here spawn real subprocesses.
"""

import json
import os
import subprocess
import sys
import tempfile
import time
import types
import unittest
from pathlib import Path

# The store only needs get_logger from shared_config; stub it so these tests run
# without Django settings configured.
if "shared_config.logger_config" not in sys.modules:
    _pkg = types.ModuleType("shared_config")
    _mod = types.ModuleType("shared_config.logger_config")
    _mod.get_logger = lambda name: types.SimpleNamespace(
        info=lambda *a, **k: None,
        debug=lambda *a, **k: None,
        warning=lambda *a, **k: None,
        error=lambda *a, **k: None,
    )
    _pkg.logger_config = _mod
    sys.modules.setdefault("shared_config", _pkg)
    sys.modules["shared_config.logger_config"] = _mod

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from docker_control import image_pull_store as store  # noqa: E402


class ImagePullStoreTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._orig_dir = store._STORE_DIR
        store._STORE_DIR = Path(self._tmp.name) / "image_pulls"
        store._fallback.clear()
        store._fallback_active = False

    def tearDown(self):
        store._STORE_DIR = self._orig_dir
        self._tmp.cleanup()

    @staticmethod
    def _entry(**over):
        base = {
            "status": "pulling",
            "downloaded_bytes": 0,
            "total_bytes": 0,
            "peak_progress": 0,
            "message": "Preparing…",
            "image_ref": "ghcr.io/example/img:1.0",
            "real_job_id": None,
            "cancelled": False,
            "started_at": time.time(),
            "updated_at": time.time(),
        }
        base.update(over)
        return base

    def test_roundtrip(self):
        store.create_entry("imgpull_a", self._entry())
        got = store.get_entry("imgpull_a")
        self.assertIsNotNone(got)
        self.assertEqual(got["image_ref"], "ghcr.io/example/img:1.0")

    def test_unknown_id_is_none(self):
        self.assertIsNone(store.get_entry("imgpull_missing"))

    def test_update_persists_and_stamps(self):
        store.create_entry("imgpull_b", self._entry())
        before = store.get_entry("imgpull_b")["updated_at"]
        time.sleep(0.01)
        store.update_entry("imgpull_b", downloaded_bytes=123, status="success")
        got = store.get_entry("imgpull_b")
        self.assertEqual(got["downloaded_bytes"], 123)
        self.assertEqual(got["status"], "success")
        self.assertGreater(got["updated_at"], before)

    def test_update_unknown_returns_none(self):
        self.assertIsNone(store.update_entry("imgpull_nope", downloaded_bytes=1))

    def test_peak_progress_never_regresses(self):
        store.create_entry("imgpull_c", self._entry())
        self.assertEqual(store.bump_peak_progress("imgpull_c", 40), 40)
        # Docker reveals layers late, so the raw ratio can dip — the clamp must hold.
        self.assertEqual(store.bump_peak_progress("imgpull_c", 12), 40)
        self.assertEqual(store.bump_peak_progress("imgpull_c", 55), 55)

    def test_stall_detection(self):
        fresh = self._entry()
        self.assertFalse(store.is_stalled(fresh))
        stale = self._entry(updated_at=time.time() - (store.STALL_AFTER_SECONDS + 10))
        self.assertTrue(store.is_stalled(stale))
        # A finished entry is never "stalled", however old it is.
        done = self._entry(status="success", updated_at=time.time() - 99999)
        self.assertFalse(store.is_stalled(done))

    def test_evict_stale_removes_finished_but_keeps_live(self):
        store.create_entry("imgpull_old", self._entry(
            status="success", updated_at=time.time() - (store.ENTRY_TTL_SECONDS + 60)))
        store.create_entry("imgpull_live", self._entry())
        removed = store.evict_stale()
        self.assertIn("imgpull_old", removed)
        self.assertIsNone(store.get_entry("imgpull_old"))
        self.assertIsNotNone(store.get_entry("imgpull_live"))

    def test_delete(self):
        store.create_entry("imgpull_d", self._entry())
        store.delete_entry("imgpull_d")
        self.assertIsNone(store.get_entry("imgpull_d"))

    def test_pull_id_cannot_escape_store_dir(self):
        # Separators are stripped rather than rejected, so a traversal attempt is
        # neutralised into a harmless name that still lands inside the store dir.
        escaped = store._path_for("../../etc/passwd")
        self.assertEqual(escaped.parent.resolve(), store._STORE_DIR.resolve())
        # A pull_id with nothing usable left is rejected outright.
        with self.assertRaises(ValueError):
            store._path_for("../../")
        # And a traversal attempt never resolves to an existing entry.
        self.assertIsNone(store.get_entry("../../etc/passwd"))

    def test_visible_across_processes(self):
        """The whole point: a different PROCESS must see the progress.

        This is what the old module-level dict could not do, and why ~3 in 4
        progress polls returned not_found under --workers 4.
        """
        store.create_entry("imgpull_x", self._entry(downloaded_bytes=5))

        script = f"""
import sys, types, json
from pathlib import Path
pkg = types.ModuleType("shared_config"); mod = types.ModuleType("shared_config.logger_config")
mod.get_logger = lambda n: types.SimpleNamespace(info=lambda *a, **k: None, debug=lambda *a, **k: None, warning=lambda *a, **k: None, error=lambda *a, **k: None)
pkg.logger_config = mod
sys.modules["shared_config"] = pkg; sys.modules["shared_config.logger_config"] = mod
sys.path.insert(0, {str(Path(__file__).resolve().parent.parent)!r})
from docker_control import image_pull_store as s
s._STORE_DIR = Path({str(store._STORE_DIR)!r})
# Read what the parent wrote, then write back from this process.
e = s.get_entry("imgpull_x")
print(json.dumps({{"read": e["downloaded_bytes"]}}))
s.update_entry("imgpull_x", downloaded_bytes=999, status="success")
"""
        proc = subprocess.run(
            [sys.executable, "-c", script], capture_output=True, text=True, timeout=60
        )
        self.assertEqual(proc.returncode, 0, f"child failed: {proc.stderr}")
        self.assertEqual(json.loads(proc.stdout.strip())["read"], 5,
                         "child process could not read the parent's entry")
        # And the child's write is visible back in the parent.
        got = store.get_entry("imgpull_x")
        self.assertEqual(got["downloaded_bytes"], 999)
        self.assertEqual(got["status"], "success")

    def test_concurrent_writers_do_not_lose_the_peak(self):
        """Interleaved bumps from several processes must still end at the max."""
        store.create_entry("imgpull_y", self._entry())
        script_tmpl = """
import sys, types
from pathlib import Path
pkg = types.ModuleType("shared_config"); mod = types.ModuleType("shared_config.logger_config")
mod.get_logger = lambda n: types.SimpleNamespace(info=lambda *a, **k: None, debug=lambda *a, **k: None, warning=lambda *a, **k: None, error=lambda *a, **k: None)
pkg.logger_config = mod
sys.modules["shared_config"] = pkg; sys.modules["shared_config.logger_config"] = mod
sys.path.insert(0, {parent!r})
from docker_control import image_pull_store as s
s._STORE_DIR = Path({store_dir!r})
for pct in range({lo}, {hi}):
    s.bump_peak_progress("imgpull_y", pct)
"""
        parent = str(Path(__file__).resolve().parent.parent)
        store_dir = str(store._STORE_DIR)
        procs = [
            subprocess.Popen([sys.executable, "-c", script_tmpl.format(
                parent=parent, store_dir=store_dir, lo=lo, hi=hi)])
            for lo, hi in ((0, 30), (30, 60), (60, 91))
        ]
        for p in procs:
            self.assertEqual(p.wait(timeout=60), 0)
        self.assertEqual(store.get_entry("imgpull_y")["peak_progress"], 90)

    def test_falls_back_to_memory_when_volume_unwritable(self):
        """A read-only volume must degrade to the old per-process behaviour, not
        make every pull look orphaned (which would be worse than the bug)."""
        ro = Path(self._tmp.name) / "readonly"
        ro.mkdir()
        os.chmod(ro, 0o500)
        store._STORE_DIR = ro / "image_pulls"
        try:
            store.create_entry("imgpull_ro", self._entry(downloaded_bytes=7))
            self.assertTrue(store._fallback_active)
            got = store.get_entry("imgpull_ro")
            self.assertIsNotNone(got, "fallback must still serve the entry")
            self.assertEqual(got["downloaded_bytes"], 7)
            store.update_entry("imgpull_ro", downloaded_bytes=8)
            self.assertEqual(store.get_entry("imgpull_ro")["downloaded_bytes"], 8)
            self.assertEqual(store.bump_peak_progress("imgpull_ro", 33), 33)
        finally:
            os.chmod(ro, 0o700)


if __name__ == "__main__":
    unittest.main(verbosity=2)
