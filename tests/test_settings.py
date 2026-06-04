# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for the Pydantic settings model."""
import os
import tempfile
import unittest

from tt_setup import settings as S


class TestIsPlaceholderValue(unittest.TestCase):
    def test_empty_and_placeholders(self):
        self.assertTrue(S.is_placeholder_value(""))
        self.assertTrue(S.is_placeholder_value("   "))
        self.assertTrue(S.is_placeholder_value(None))
        self.assertTrue(S.is_placeholder_value("hf_***"))
        self.assertTrue(S.is_placeholder_value('"hf_***"'))

    def test_real_value(self):
        self.assertFalse(S.is_placeholder_value("hf_realtoken123"))


class TestSettingsModel(unittest.TestCase):
    def _settings_from(self, env_text):
        with tempfile.NamedTemporaryFile("w", suffix=".env", delete=False) as f:
            f.write(env_text)
            path = f.name
        self.addCleanup(os.unlink, path)
        # Load from an isolated env file, ignoring the process environment.
        return S.TTStudioSettings(_env_file=path)

    def test_loads_values_and_coerces_bool(self):
        s = self._settings_from(
            "HF_TOKEN=hf_real\n"
            "JWT_SECRET=abc\n"
            "DJANGO_SECRET_KEY=def\n"
            "VITE_ENABLE_DEPLOYED=true\n"
            "VITE_ENABLE_RAG_ADMIN=false\n"
        )
        self.assertEqual(s.hf_token, "hf_real")
        self.assertIs(s.vite_enable_deployed, True)
        self.assertIs(s.vite_enable_rag_admin, False)

    def test_placeholders_become_none(self):
        s = self._settings_from("HF_TOKEN=hf_***\nDJANGO_SECRET_KEY=django-insecure-default\n")
        self.assertIsNone(s.hf_token)
        self.assertIsNone(s.django_secret_key)

    def test_missing_required_reported(self):
        s = self._settings_from("HF_TOKEN=hf_real\n")  # jwt + django missing
        missing = s.missing_required()
        self.assertIn("jwt_secret", missing)
        self.assertIn("django_secret_key", missing)
        self.assertNotIn("hf_token", missing)

    def test_defaults_when_empty(self):
        s = self._settings_from("")
        self.assertIsNone(s.hf_token)
        self.assertFalse(s.vite_enable_deployed)
        self.assertEqual(s.missing_required(), ["hf_token", "jwt_secret", "django_secret_key"])


if __name__ == "__main__":
    unittest.main()
