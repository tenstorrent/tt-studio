# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Characterization tests for environment/preference configuration."""
import os
import tempfile
import unittest
from unittest.mock import patch

try:
    from tt_setup import env_config as M
except ImportError:  # pre-refactor
    import run as M


class TestPlaceholderAndBoolean(unittest.TestCase):
    def test_is_placeholder(self):
        self.assertTrue(M.is_placeholder(""))
        self.assertTrue(M.is_placeholder("   "))
        self.assertTrue(M.is_placeholder("hf_***"))
        self.assertFalse(M.is_placeholder("real-value"))

    def test_parse_boolean_env(self):
        for truthy in ("true", "1", "t", "y", "yes", '"true"', "TRUE"):
            self.assertTrue(M.parse_boolean_env(truthy), truthy)
        for falsy in ("false", "0", "no", "", "maybe"):
            self.assertFalse(M.parse_boolean_env(falsy), falsy)


class TestEnvFileRoundTrip(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile("w", suffix=".env", delete=False)
        self.tmp.close()
        self.p = patch.object(M, "ENV_FILE_PATH", self.tmp.name)
        self.p.start()

    def tearDown(self):
        self.p.stop()
        os.unlink(self.tmp.name)

    def test_write_get_round_trip(self):
        M.write_env_var("FOO", "bar")
        self.assertEqual(M.get_env_var("FOO"), "bar")

    def test_write_updates_existing(self):
        M.write_env_var("FOO", "one")
        M.write_env_var("FOO", "two")
        self.assertEqual(M.get_env_var("FOO"), "two")
        with open(self.tmp.name) as f:
            lines = [l for l in f if l.startswith("FOO=")]
        self.assertEqual(len(lines), 1)

    def test_get_missing_returns_default(self):
        self.assertEqual(M.get_env_var("NOPE", "fallback"), "fallback")

    def test_comment_out(self):
        M.write_env_var("FOO", "bar")
        M.comment_out_env_var("FOO")
        self.assertEqual(M.get_env_var("FOO", "gone"), "gone")
        with open(self.tmp.name) as f:
            self.assertIn("# FOO=", f.read())

    def test_get_existing_env_vars(self):
        M.write_env_var("A", "1")
        M.write_env_var("B", "2")
        existing = M.get_existing_env_vars()
        self.assertEqual(existing.get("A"), "1")
        self.assertEqual(existing.get("B"), "2")


class TestConsistentQuoting(unittest.TestCase):
    """write_env_var must produce ONE consistent (unquoted) format."""

    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile("w", suffix=".env", delete=False)
        self.tmp.close()
        self.p = patch.object(M, "ENV_FILE_PATH", self.tmp.name)
        self.p.start()

    def tearDown(self):
        self.p.stop()
        os.unlink(self.tmp.name)

    def _raw(self):
        with open(self.tmp.name) as f:
            return f.read()

    def test_value_written_unquoted(self):
        M.write_env_var("TOKEN", "hf_abc123")
        self.assertIn("TOKEN=hf_abc123", self._raw())
        self.assertNotIn('TOKEN="', self._raw())

    def test_value_with_space_stays_unquoted(self):
        M.write_env_var("VITE_APP_TITLE", "TT Studio")
        self.assertIn("VITE_APP_TITLE=TT Studio", self._raw())
        self.assertNotIn('"TT Studio"', self._raw())

    def test_quote_value_flag_is_ignored(self):
        # Even if a caller passes the legacy quote_value=True, output stays unquoted.
        M.write_env_var("K", "v", quote_value=True)
        self.assertIn("K=v", self._raw())
        self.assertNotIn('K="v"', self._raw())

    def test_no_mixed_styles_after_multiple_writes(self):
        M.write_env_var("A", "1")
        M.write_env_var("B", "two words")
        M.write_env_var("C", "http://host:8002")
        raw = self._raw()
        self.assertNotIn('"', raw)  # nothing is quoted anywhere

    def test_reads_legacy_quoted_value(self):
        # A pre-existing quoted line must still read back without the quotes.
        with open(self.tmp.name, "w") as f:
            f.write('LEGACY="quoted value"\n')
        self.assertEqual(M.get_env_var("LEGACY"), "quoted value")


class TestShouldConfigureVar(unittest.TestCase):
    def test_force_overwrite_forces_true(self):
        with patch.object(M, "FORCE_OVERWRITE", True):
            self.assertTrue(M.should_configure_var("ANY", "already-set"))


class TestPreferences(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.prefs = os.path.join(self.dir.name, "prefs.json")
        self.easy = os.path.join(self.dir.name, "easy.json")
        self.p1 = patch.object(M, "PREFS_FILE_PATH", self.prefs)
        self.p2 = patch.object(M, "EASY_CONFIG_FILE_PATH", self.easy)
        self.p1.start()
        self.p2.start()

    def tearDown(self):
        self.p1.stop()
        self.p2.stop()
        self.dir.cleanup()

    def test_first_time_setup_true_when_no_prefs(self):
        self.assertTrue(M.is_first_time_setup())

    def test_save_get_preference(self):
        M.save_preference("theme", "dark")
        self.assertEqual(M.get_preference("theme"), "dark")
        self.assertFalse(M.is_first_time_setup())

    def test_get_preference_default(self):
        self.assertEqual(M.get_preference("missing", "def"), "def")

    def test_clear_preferences(self):
        M.save_preference("x", 1)
        self.assertTrue(M.clear_preferences())
        self.assertTrue(M.is_first_time_setup())

    def test_easy_config_round_trip(self):
        M.save_easy_config({"mode": "easy"})
        self.assertEqual(M.load_easy_config(), {"mode": "easy"})


if __name__ == "__main__":
    unittest.main()
