# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Tests for model_config._impl_selector — the boundary that reduces the catalog's
impl object to the string the inference server's /run and /resolve-image
endpoints match on. Django SimpleTestCase so it runs where TT_STUDIO_ROOT (read
at import by backend_config) is set.

The server compares `spec.impl.impl_name == impl`, so the hyphenated impl_name
is the wire value. Every vector below that carries both keys deliberately gives
them DIFFERENT values: fixtures where impl_id == impl_name cannot tell a correct
implementation from one that returns impl_id.
"""

from django.test import SimpleTestCase

from shared_config.model_config import _impl_selector


class ImplSelectorTests(SimpleTestCase):
    def test_prefers_impl_name_over_impl_id(self):
        obj = {
            "impl_id": "tt_transformers",
            "impl_name": "tt-transformers",
            "repo_url": "https://github.com/tenstorrent/tt-metal",
            "code_path": "models/tt_transformers",
        }
        self.assertEqual(_impl_selector(obj), "tt-transformers")

    def test_speecht5_tts_resolves_to_hyphenated_name(self):
        """The impl from the regression this fix exists for: the two forms differ,
        and sending impl_id makes run.py reject it as an invalid --impl choice."""
        obj = {"impl_id": "speecht5_tts", "impl_name": "speecht5-tts"}
        self.assertEqual(_impl_selector(obj), "speecht5-tts")

    def test_falls_back_to_impl_id_when_name_absent(self):
        self.assertEqual(_impl_selector({"impl_id": "legacy_only"}), "legacy_only")

    def test_passes_through_plain_string(self):
        self.assertEqual(_impl_selector("whisper"), "whisper")

    def test_none_returns_none(self):
        self.assertIsNone(_impl_selector(None))

    def test_empty_object_returns_none(self):
        self.assertIsNone(_impl_selector({}))

    def test_empty_string_returns_none(self):
        self.assertIsNone(_impl_selector(""))

    def test_non_string_impl_values_return_none(self):
        """Coercion at a trust boundary: never hand a non-string to the server."""
        self.assertIsNone(_impl_selector({"impl_name": 7, "impl_id": ["a"]}))
        self.assertIsNone(_impl_selector(7))
