# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for the consolidated launcher config store (issue #807)."""
import json
import os
import tempfile
import unittest
from unittest.mock import patch

from tt_setup import config_store as cs


class ConfigStoreTests(unittest.TestCase):
    def setUp(self):
        # Isolate the store to a throwaway file and neuter the legacy migration so
        # the repo's real dotfiles never seed a test store.
        self.dir = tempfile.TemporaryDirectory()
        self.cfg = os.path.join(self.dir.name, "config.json")
        self.env = patch.dict(os.environ, {"TT_STUDIO_CONFIG_PATH": self.cfg})
        self.mig = patch.object(cs, "_migrate_or_default", cs._empty_config)
        self.env.start()
        self.mig.start()

    def tearDown(self):
        self.mig.stop()
        self.env.stop()
        self.dir.cleanup()

    def test_version_and_all_namespaces_present(self):
        data = cs.load()
        self.assertEqual(data["version"], cs.CONFIG_VERSION)
        for ns in cs.NAMESPACES:
            self.assertIn(ns, data)
            self.assertIsInstance(data[ns], dict)

    def test_set_get_roundtrip(self):
        cs.set("preferences", "terms_accepted", True)
        self.assertTrue(cs.get("preferences", "terms_accepted"))
        self.assertEqual(cs.get("preferences", "missing", "def"), "def")

    def test_get_ns_returns_copy(self):
        cs.set("features", "a", 1)
        ns = cs.get_ns("features")
        ns["a"] = 999  # mutating the copy must not persist
        self.assertEqual(cs.get("features", "a"), 1)

    def test_update_and_set_ns(self):
        cs.update_ns("ui", {"vite_app_title": "X", "vite_enable_deployed": "false"})
        self.assertEqual(cs.get_ns("ui"), {"vite_app_title": "X", "vite_enable_deployed": "false"})
        cs.set_ns("ui", {"only": "this"})
        self.assertEqual(cs.get_ns("ui"), {"only": "this"})

    def test_corrupt_file_falls_back_to_empty(self):
        with open(self.cfg, "w") as f:
            f.write("{not json")
        # A garbled file must not crash a write; it is rebuilt from empty.
        cs.set("preferences", "ok", True)
        self.assertTrue(cs.get("preferences", "ok"))


class ConfigStoreMigrationTests(unittest.TestCase):
    """Exercises the real one-time migration from the two legacy dotfiles."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.root = self.dir.name
        self.cfg = os.path.join(self.root, "config.json")
        self.prefs = os.path.join(self.root, ".tt_studio_preferences.json")
        self.setup = os.path.join(self.root, ".tt_studio_setup_config.json")

        self._patchers = [
            patch.dict(os.environ, {"TT_STUDIO_CONFIG_PATH": self.cfg}),
            patch.object(cs, "PREFS_FILE_PATH", self.prefs),
            patch.object(cs, "SETUP_CONFIG_FILE_PATH", self.setup),
            patch.object(cs, "LEGACY_SETUP_CONFIG_FILE_PATH", os.path.join(self.root, ".nope.json")),
        ]
        for p in self._patchers:
            p.start()

    def tearDown(self):
        for p in reversed(self._patchers):
            p.stop()
        self.dir.cleanup()

    def test_migration_merges_legacy_dotfiles_into_namespaces(self):
        with open(self.prefs, "w") as f:
            json.dump({"terms_accepted": True}, f)
        with open(self.setup, "w") as f:
            json.dump({
                "mode": "quick",
                "tt_studio_mode": True,
                "ai_playground_mode": False,
                "vite_app_title": "TT Studio",
                "vite_enable_deployed": "false",
            }, f)

        data = cs.load()  # first access triggers migration

        self.assertEqual(data["version"], cs.CONFIG_VERSION)
        self.assertEqual(data["preferences"], {"terms_accepted": True})
        self.assertEqual(data["setup"], {"mode": "quick"})
        self.assertEqual(data["features"], {"tt_studio_mode": True, "ai_playground_mode": False})
        self.assertEqual(data["ui"], {"vite_app_title": "TT Studio", "vite_enable_deployed": "false"})

    def test_migration_with_no_legacy_files_yields_empty_namespaces(self):
        data = cs.load()
        self.assertEqual(data["version"], cs.CONFIG_VERSION)
        for ns in cs.NAMESPACES:
            self.assertEqual(data[ns], {})


if __name__ == "__main__":
    unittest.main()
