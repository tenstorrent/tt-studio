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

# Post-split, constants/globals live in submodules; patches must target those.
try:
    from tt_setup.env_config import _configure as _ecfg_configure
    from tt_setup.env_config import _dotenv as _ecfg_dotenv
except ImportError:
    _ecfg_dotenv = _ecfg_configure = M


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
        self.p = patch.object(_ecfg_dotenv, "ENV_FILE_PATH", self.tmp.name)
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


class TestOsEnvironPrecedence(unittest.TestCase):
    """os.environ must take precedence over .env file values (issue #804)."""

    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile("w", suffix=".env", delete=False)
        self.tmp.close()
        self.p = patch.object(_ecfg_dotenv, "ENV_FILE_PATH", self.tmp.name)
        self.p.start()

    def tearDown(self):
        self.p.stop()
        os.unlink(self.tmp.name)

    def test_os_environ_overrides_env_file(self):
        """Shell export must win over the .env file value."""
        M.write_env_var("MY_VAR", "from-dotenv")
        with patch.dict(os.environ, {"MY_VAR": "from-shell"}):
            self.assertEqual(M.get_env_var("MY_VAR"), "from-shell")

    def test_os_environ_overrides_when_no_env_file(self):
        """Shell export must work even if .env file does not exist."""
        os.unlink(self.tmp.name)
        # Re-create so tearDown doesn't fail
        open(self.tmp.name, "w").close()
        with patch.object(_ecfg_dotenv, "ENV_FILE_PATH", "/nonexistent/.env"):
            with patch.dict(os.environ, {"MY_VAR": "from-shell"}):
                self.assertEqual(M.get_env_var("MY_VAR"), "from-shell")

    def test_env_file_used_when_no_os_environ(self):
        """Without a shell override, the .env file value is still returned."""
        M.write_env_var("MY_VAR", "from-dotenv")
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("MY_VAR", None)
            self.assertEqual(M.get_env_var("MY_VAR"), "from-dotenv")

    def test_empty_os_environ_value_still_wins(self):
        """An explicitly empty shell export must override the .env value."""
        M.write_env_var("MY_VAR", "from-dotenv")
        with patch.dict(os.environ, {"MY_VAR": ""}):
            self.assertEqual(M.get_env_var("MY_VAR"), "")


class TestConsistentQuoting(unittest.TestCase):
    """write_env_var must produce ONE consistent (unquoted) format."""

    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile("w", suffix=".env", delete=False)
        self.tmp.close()
        self.p = patch.object(_ecfg_dotenv, "ENV_FILE_PATH", self.tmp.name)
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
        with patch.object(_ecfg_configure, "FORCE_OVERWRITE", True):
            self.assertTrue(M.should_configure_var("ANY", "already-set"))


class TestPreferences(unittest.TestCase):
    def setUp(self):
        # Preferences are now backed by the consolidated config store; point it at
        # a throwaway file via the TT_STUDIO_CONFIG_PATH env override, and stub the
        # legacy migration so the repo's real dotfiles don't seed the test store.
        from tt_setup import config_store
        self.dir = tempfile.TemporaryDirectory()
        self.cfg = os.path.join(self.dir.name, "config.json")
        self.env = patch.dict(os.environ, {"TT_STUDIO_CONFIG_PATH": self.cfg})
        self.mig = patch.object(config_store, "_migrate_or_default", config_store._empty_config)
        self.env.start()
        self.mig.start()

    def tearDown(self):
        self.mig.stop()
        self.env.stop()
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

    def test_setup_config_snapshot_splits_into_namespaces(self):
        from tt_setup import config_store
        M.save_setup_config({
            "mode": "quick",
            "tt_studio_mode": True,
            "vite_app_title": "TT Studio",
        })
        self.assertEqual(config_store.get("setup", "mode"), "quick")
        self.assertEqual(config_store.get("features", "tt_studio_mode"), True)
        self.assertEqual(config_store.get("ui", "vite_app_title"), "TT Studio")


class TestSetAppVersionEnvImageTag(unittest.TestCase):
    """set_app_version_env pins TT_STUDIO_IMAGE_TAG to the current checkout."""

    def _run_with_git(self, exact_tag, full_sha):
        from tt_setup.env_config import _version as _ecfg_version

        def fake_git_run(cmd, **kwargs):
            class R:
                pass
            r = R()
            git_args = cmd[3:]  # after ["git", "-C", <root>]
            if git_args[0] == "describe":
                r.returncode = 0 if exact_tag else 128
                r.stdout = exact_tag
            elif git_args == ["rev-parse", "HEAD"]:
                r.returncode = 0 if full_sha else 128
                r.stdout = full_sha
            else:  # branch lookups
                r.returncode = 0
                r.stdout = "dev"
            return r

        writes = {}
        with patch.object(_ecfg_version.subprocess, "run", side_effect=fake_git_run), \
             patch.object(_ecfg_version, "write_env_var",
                          side_effect=lambda k, v: writes.__setitem__(k, v)):
            M.set_app_version_env()
        return writes

    def test_release_tag_checkout(self):
        writes = self._run_with_git("v2.9.0", "f" * 40)
        self.assertEqual(writes["TT_STUDIO_IMAGE_TAG"], "v2.9.0")

    def test_untagged_checkout_uses_sha(self):
        sha = "0123456789abcdef0123456789abcdef01234567"
        writes = self._run_with_git("", sha)
        self.assertEqual(writes["TT_STUDIO_IMAGE_TAG"], "sha-0123456789ab")

    def test_no_git_falls_back_to_latest(self):
        writes = self._run_with_git("", "")
        self.assertEqual(writes["TT_STUDIO_IMAGE_TAG"], "latest")


if __name__ == "__main__":
    unittest.main()
