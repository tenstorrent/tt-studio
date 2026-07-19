# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for the Cursor connect helper (pure logic; no network/tunnel)."""
import unittest
from unittest.mock import patch

from tt_setup import cursor as M


class TestParseTunnelUrl(unittest.TestCase):
    def test_extracts_trycloudflare_url(self):
        line = "2026-07-19T00:00:00Z INF +  https://brave-otter-quick.trycloudflare.com  + "
        self.assertEqual(M.parse_tunnel_url(line),
                         "https://brave-otter-quick.trycloudflare.com")

    def test_ignores_unrelated_lines(self):
        self.assertIsNone(M.parse_tunnel_url("INF Starting tunnel"))
        self.assertIsNone(M.parse_tunnel_url("visit https://cloudflare.com for docs"))
        self.assertIsNone(M.parse_tunnel_url(""))
        self.assertIsNone(M.parse_tunnel_url(None))


class TestBuildCursorValues(unittest.TestCase):
    def test_appends_v1_to_tunnel_url(self):
        base, key, models = M.build_cursor_values(
            "https://a-b.trycloudflare.com", "sk-test", ["Llama-3.1-8B-Instruct"])
        self.assertEqual(base, "https://a-b.trycloudflare.com/v1")
        self.assertEqual(key, "sk-test")
        self.assertEqual(models, ["Llama-3.1-8B-Instruct"])

    def test_tolerates_trailing_slash(self):
        base, _, _ = M.build_cursor_values("https://a-b.trycloudflare.com/", "k", [])
        self.assertEqual(base, "https://a-b.trycloudflare.com/v1")


class TestGatewayPort(unittest.TestCase):
    def test_defaults_to_4000(self):
        with patch.object(M, "get_env_var", side_effect=lambda name, default="": default):
            self.assertEqual(M._gateway_port(), 4000)

    def test_reads_litellm_port(self):
        with patch.object(M, "get_env_var", return_value="4321"):
            self.assertEqual(M._gateway_port(), 4321)

    def test_garbage_falls_back_to_4000(self):
        with patch.object(M, "get_env_var", return_value="not-a-port"):
            self.assertEqual(M._gateway_port(), 4000)


class TestGatewayModelNames(unittest.TestCase):
    def test_returns_model_names(self):
        info = {"health": "healthy", "models": [
            {"name": "Llama-3.1-8B-Instruct", "type": "chat"},
            {"name": "Qwen3-32B-thinking", "type": "chat"},
        ]}
        self.assertEqual(M.gateway_model_names(info),
                         ["Llama-3.1-8B-Instruct", "Qwen3-32B-thinking"])

    def test_missing_info_returns_empty(self):
        self.assertEqual(M.gateway_model_names(None), [])
        self.assertEqual(M.gateway_model_names({}), [])


class TestCloudflaredDownloadUrl(unittest.TestCase):
    def test_linux_amd64(self):
        with patch.object(M.platform, "system", return_value="Linux"), \
             patch.object(M.platform, "machine", return_value="x86_64"):
            self.assertTrue(M._cloudflared_download_url().endswith("cloudflared-linux-amd64"))

    def test_linux_arm64(self):
        with patch.object(M.platform, "system", return_value="Linux"), \
             patch.object(M.platform, "machine", return_value="aarch64"):
            self.assertTrue(M._cloudflared_download_url().endswith("cloudflared-linux-arm64"))

    def test_non_linux_is_manual_install(self):
        with patch.object(M.platform, "system", return_value="Darwin"):
            self.assertIsNone(M._cloudflared_download_url())


if __name__ == "__main__":
    unittest.main()
