# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for env_store, user_state, and the user_config.json migration."""

from __future__ import annotations

import json
import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from shared_config import env_store, user_state, _migrate_user_config


class EnvStoreReadWriteTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.env_path = Path(self._tmp.name) / ".env"

    def _write(self, content: str) -> None:
        self.env_path.write_text(content)
        os.chmod(self.env_path, 0o600)

    def test_read_skips_comments_and_blanks(self) -> None:
        self._write(
            "# header comment\n"
            "\n"
            "HF_TOKEN=hf_abc\n"
            "# inline comment line\n"
            "TTS_API_KEY=\"with-quotes\"\n"
            "TAVILY_API_KEY='single-quoted'\n"
        )
        out = env_store.read_env_file(self.env_path)
        self.assertEqual(out["HF_TOKEN"], "hf_abc")
        self.assertEqual(out["TTS_API_KEY"], "with-quotes")
        self.assertEqual(out["TAVILY_API_KEY"], "single-quoted")
        self.assertNotIn("# header comment", out)

    def test_read_missing_file_returns_empty(self) -> None:
        self.assertEqual(env_store.read_env_file(Path(self._tmp.name) / "nope.env"), {})

    def test_write_preserves_comments_and_order(self) -> None:
        original = (
            "# Top-of-file comment\n"
            "\n"
            "TT_STUDIO_ROOT=/repo\n"
            "# Hugging Face section\n"
            "HF_TOKEN=hf_old\n"
            "TTS_API_KEY=tts_old\n"
            "# Tavily section\n"
            "TAVILY_API_KEY=tvly_old\n"
        )
        self._write(original)
        env_store.write_env_file({"HF_TOKEN": "hf_new"}, self.env_path)
        result = self.env_path.read_text()
        self.assertIn("# Top-of-file comment", result)
        self.assertIn("# Hugging Face section", result)
        self.assertIn("# Tavily section", result)
        self.assertIn("HF_TOKEN=hf_new", result)
        self.assertNotIn("HF_TOKEN=hf_old", result)
        self.assertIn("TT_STUDIO_ROOT=/repo", result)
        self.assertIn("TTS_API_KEY=tts_old", result)
        self.assertIn("TAVILY_API_KEY=tvly_old", result)
        lines = [ln for ln in result.splitlines() if ln.startswith("HF_TOKEN") or ln.startswith("TTS_API_KEY")]
        self.assertEqual(lines, ["HF_TOKEN=hf_new", "TTS_API_KEY=tts_old"])

    def test_write_appends_missing_key(self) -> None:
        self._write("EXISTING=foo\n")
        env_store.write_env_file({"NEW_KEY": "bar"}, self.env_path)
        result = self.env_path.read_text()
        self.assertIn("EXISTING=foo", result)
        self.assertIn("NEW_KEY=bar", result)

    def test_write_with_empty_value_deletes_key(self) -> None:
        self._write("KEEP=yes\nDROP=removeme\n")
        env_store.write_env_file({"DROP": ""}, self.env_path)
        result = self.env_path.read_text()
        self.assertIn("KEEP=yes", result)
        self.assertNotIn("DROP=", result)

    def test_write_is_atomic_and_sets_perms(self) -> None:
        self._write("KEY=val\n")
        env_store.write_env_file({"KEY": "new"}, self.env_path)
        mode = self.env_path.stat().st_mode & 0o777
        self.assertEqual(mode, 0o600)
        leftover = list(self.env_path.parent.glob(".env.*.tmp"))
        self.assertEqual(leftover, [])

    def test_get_prefers_file_over_environ(self) -> None:
        self._write("HF_TOKEN=from-file\n")
        with patch.dict(os.environ, {"TT_STUDIO_ENV_FILE": str(self.env_path), "HF_TOKEN": "from-env"}, clear=False):
            self.assertEqual(env_store.get_hf_token(), "from-file")

    def test_get_falls_back_to_environ_if_file_missing(self) -> None:
        missing = Path(self._tmp.name) / "absent.env"
        with patch.dict(os.environ, {"TT_STUDIO_ENV_FILE": str(missing), "HF_TOKEN": "from-env"}, clear=False):
            self.assertEqual(env_store.get_hf_token(), "from-env")


class UserStateTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self._patcher = patch.dict(
            os.environ,
            {"INTERNAL_PERSISTENT_STORAGE_VOLUME": self._tmp.name},
            clear=False,
        )
        self._patcher.start()
        self.addCleanup(self._patcher.stop)

    def test_save_and_load_round_trip(self) -> None:
        user_state.save_user_state({"setup_complete": True})
        self.assertTrue(user_state.is_setup_complete())

    def test_save_rejects_secret_keys(self) -> None:
        user_state.save_user_state({"hf_token": "leaked", "setup_complete": True})
        path = Path(self._tmp.name) / "backend_volume" / "user_state.json"
        data = json.loads(path.read_text())
        self.assertNotIn("hf_token", data)
        self.assertEqual(data.get("setup_complete"), True)

    def test_get_jwt_secret_generates_and_persists(self) -> None:
        first = user_state.get_jwt_secret()
        second = user_state.get_jwt_secret()
        self.assertEqual(first, second)
        self.assertGreater(len(first), 32)


class MigrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.persistent = Path(self._tmp.name) / "persistent"
        (self.persistent / "backend_volume").mkdir(parents=True)
        self.env_path = Path(self._tmp.name) / ".env"
        self.env_path.write_text("# pre-existing comment\nTT_STUDIO_ROOT=/repo\n")
        os.chmod(self.env_path, 0o600)

        self._patcher = patch.dict(
            os.environ,
            {
                "INTERNAL_PERSISTENT_STORAGE_VOLUME": str(self.persistent),
                "TT_STUDIO_ENV_FILE": str(self.env_path),
            },
            clear=False,
        )
        self._patcher.start()
        self.addCleanup(self._patcher.stop)

    def _write_legacy(self, data: dict) -> Path:
        path = self.persistent / "backend_volume" / "user_config.json"
        path.write_text(json.dumps(data))
        return path

    def test_migrates_secrets_and_state_and_deletes_legacy(self) -> None:
        legacy = self._write_legacy({
            "hf_token": "hf_xxx",
            "tts_api_key": "tts_xxx",
            "tavily_api_key": "tvly_xxx",
            "setup_complete": True,
            "jwt_secret": "jwt_xxx",
        })
        _migrate_user_config.migrate_if_needed()

        env_text = self.env_path.read_text()
        self.assertIn("HF_TOKEN=hf_xxx", env_text)
        self.assertIn("TTS_API_KEY=tts_xxx", env_text)
        self.assertIn("TAVILY_API_KEY=tvly_xxx", env_text)
        self.assertIn("# pre-existing comment", env_text)

        state_path = self.persistent / "backend_volume" / "user_state.json"
        state = json.loads(state_path.read_text())
        self.assertTrue(state.get("setup_complete"))
        self.assertEqual(state.get("jwt_secret"), "jwt_xxx")

        self.assertFalse(legacy.exists())

    def test_does_not_overwrite_existing_env_value(self) -> None:
        self.env_path.write_text("HF_TOKEN=hf_existing\n")
        self._write_legacy({"hf_token": "hf_from_legacy"})
        _migrate_user_config.migrate_if_needed()
        self.assertEqual(env_store.read_env_file(self.env_path)["HF_TOKEN"], "hf_existing")

    def test_is_idempotent(self) -> None:
        self._write_legacy({"hf_token": "hf_xxx"})
        _migrate_user_config.migrate_if_needed()
        # Second run is a no-op.
        _migrate_user_config.migrate_if_needed()
        env_text = self.env_path.read_text()
        self.assertEqual(env_text.count("HF_TOKEN="), 1)


if __name__ == "__main__":
    unittest.main()
