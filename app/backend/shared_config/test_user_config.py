# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Tests for user_config.py — dotenv-format secret storage in the persistent volume.
"""

import json
import os
import stat

import pytest

from shared_config import user_config


@pytest.fixture
def volume(tmp_path, monkeypatch):
    monkeypatch.setenv("INTERNAL_PERSISTENT_STORAGE_VOLUME", str(tmp_path))
    return tmp_path


class TestSaveLoadRoundTrip:
    def test_save_and_load(self, volume):
        user_config.save_user_config({"hf_token": "hf_abc123", "tavily_api_key": "tvly-x"})
        cfg = user_config.load_user_config()
        assert cfg == {"hf_token": "hf_abc123", "tavily_api_key": "tvly-x"}

    def test_file_is_dotenv_format_with_env_keys(self, volume):
        user_config.save_user_config({"hf_token": "hf_abc123"})
        content = (volume / "backend_volume" / "user_config.env").read_text()
        assert "HF_TOKEN=hf_abc123" in content
        assert "json" not in content

    def test_file_permissions_are_0600(self, volume):
        user_config.save_user_config({"hf_token": "hf_abc123"})
        mode = stat.S_IMODE(os.stat(volume / "backend_volume" / "user_config.env").st_mode)
        assert mode == 0o600

    def test_overwrite_tightens_loose_permissions(self, volume):
        """Even if a prior file (or stale temp) was world-readable, a save must
        end up 0600 — the write creates the temp 0600 and fchmods it."""
        path = volume / "backend_volume"
        path.mkdir(parents=True)
        loose = path / "user_config.env"
        loose.write_text("HF_TOKEN=old\n")
        os.chmod(loose, 0o644)
        user_config.save_user_config({"hf_token": "hf_new"})
        mode = stat.S_IMODE(os.stat(loose).st_mode)
        assert mode == 0o600

    def test_no_temp_file_left_behind(self, volume):
        user_config.save_user_config({"hf_token": "hf_abc123"})
        assert not (volume / "backend_volume" / "user_config.env.tmp").exists()

    def test_parent_dir_stays_traversable(self, volume):
        """backend_volume is shared (model weights, deploy cache); host-side
        processes like the inference server must keep traversal access even
        though the backend container writes this file as root. Locking the
        dir to 0700 broke host deploys (PermissionError from Path.exists())."""
        user_config.save_user_config({"hf_token": "hf_abc123"})
        mode = stat.S_IMODE(os.stat(volume / "backend_volume").st_mode)
        assert mode & 0o055 == 0o055, f"backend_volume must stay world-traversable, got {oct(mode)}"

    def test_empty_update_removes_key(self, volume):
        user_config.save_user_config({"hf_token": "hf_abc123"})
        user_config.save_user_config({"hf_token": ""})
        assert "hf_token" not in user_config.load_user_config()

    def test_unknown_keys_are_ignored(self, volume):
        user_config.save_user_config({"hf_token": "hf_abc123", "evil_key": "x"})
        assert "evil_key" not in user_config.load_user_config()

    def test_setup_complete_round_trip(self, volume, monkeypatch):
        monkeypatch.delenv("HF_TOKEN", raising=False)
        assert not user_config.is_setup_complete()
        user_config.mark_setup_complete()
        assert user_config.is_setup_complete()
        content = (volume / "backend_volume" / "user_config.env").read_text()
        assert "SETUP_COMPLETE=true" in content

    def test_setup_complete_when_required_secret_configured(self, volume, monkeypatch):
        """The Welcome guide is driven by env completeness (issue #1145): a
        configured HF token counts as complete even without the flag, and a
        finished wizard counts even if every secret was skipped."""
        monkeypatch.delenv("HF_TOKEN", raising=False)
        user_config.save_user_config({"hf_token": "hf_abc123"})
        assert user_config.is_setup_complete()

    def test_setup_complete_honors_env_var_token(self, volume, monkeypatch):
        monkeypatch.setenv("HF_TOKEN", "hf_from_env")
        assert user_config.is_setup_complete()

    def test_setup_incomplete_without_flag_or_token(self, volume, monkeypatch):
        monkeypatch.delenv("HF_TOKEN", raising=False)
        user_config.save_user_config({"tavily_api_key": "tvly-x"})
        assert not user_config.is_setup_complete()


class TestValueSanitization:
    def test_newlines_stripped_no_key_injection(self, volume):
        user_config.save_user_config({"hf_token": "abc\nHF_TOKEN=evil\nJWT_SECRET=owned"})
        cfg = user_config.load_user_config()
        assert cfg["hf_token"] == "abcHF_TOKEN=evilJWT_SECRET=owned"
        assert "jwt_secret" not in cfg

    def test_quoted_values_are_unquoted_on_load(self, volume):
        path = volume / "backend_volume"
        path.mkdir(parents=True)
        (path / "user_config.env").write_text('HF_TOKEN="hf_quoted"\nTTS_API_KEY=\'single\'\n')
        cfg = user_config.load_user_config()
        assert cfg["hf_token"] == "hf_quoted"
        assert cfg["tts_api_key"] == "single"

    def test_comments_and_garbage_lines_ignored(self, volume):
        path = volume / "backend_volume"
        path.mkdir(parents=True)
        (path / "user_config.env").write_text(
            "# a comment\n\nnot a kv line\nHF_TOKEN=hf_ok\nUNKNOWN_KEY=x\n"
        )
        assert user_config.load_user_config() == {"hf_token": "hf_ok"}


class TestLegacyJsonMigration:
    def test_json_is_migrated_and_deleted(self, volume):
        path = volume / "backend_volume"
        path.mkdir(parents=True)
        legacy = path / "user_config.json"
        legacy.write_text(json.dumps({
            "hf_token": "hf_legacy",
            "jwt_secret": "old-jwt",
            "setup_complete": True,
        }))

        cfg = user_config.load_user_config()

        assert cfg["hf_token"] == "hf_legacy"
        assert cfg["jwt_secret"] == "old-jwt"
        assert cfg["setup_complete"] is True
        assert not legacy.exists()
        assert (path / "user_config.env").exists()

    def test_env_file_wins_over_leftover_json(self, volume):
        path = volume / "backend_volume"
        path.mkdir(parents=True)
        (path / "user_config.env").write_text("HF_TOKEN=hf_current\n")
        (path / "user_config.json").write_text(json.dumps({"hf_token": "hf_stale"}))
        assert user_config.load_user_config()["hf_token"] == "hf_current"

    def test_corrupt_json_is_ignored(self, volume):
        path = volume / "backend_volume"
        path.mkdir(parents=True)
        (path / "user_config.json").write_text("{not json")
        assert user_config.load_user_config() == {}


class TestGetters:
    def test_jwt_secret_auto_generated_and_persisted(self, volume, monkeypatch):
        monkeypatch.delenv("JWT_SECRET", raising=False)
        first = user_config.get_jwt_secret()
        assert first
        assert user_config.get_jwt_secret() == first
        content = (volume / "backend_volume" / "user_config.env").read_text()
        assert f"JWT_SECRET={first}" in content

    def test_file_value_beats_env_var(self, volume, monkeypatch):
        monkeypatch.setenv("HF_TOKEN", "hf_from_env")
        user_config.save_user_config({"hf_token": "hf_from_file"})
        assert user_config.get_hf_token() == "hf_from_file"

    def test_env_var_fallback(self, volume, monkeypatch):
        monkeypatch.setenv("TAVILY_API_KEY", "tvly-env")
        assert user_config.get_tavily_api_key() == "tvly-env"

    def test_tts_api_key_defaults_to_media_server_key(self, volume, monkeypatch):
        # Unconfigured TTS key must resolve to the media server's default so
        # TTS/STT models authenticate out of the box (see _DEFAULT_TTS_API_KEY).
        monkeypatch.delenv("TTS_API_KEY", raising=False)
        assert user_config.get_tts_api_key() == "your-secret-key"

    def test_tts_api_key_config_beats_default(self, volume):
        user_config.save_user_config({"tts_api_key": "custom-key"})
        assert user_config.get_tts_api_key() == "custom-key"
