# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Tests for model_config._impl_id — the boundary that reduces the catalog's impl
object to the impl_id string the inference server's /run and /resolve-image
endpoints expect. Django SimpleTestCase so it runs where TT_STUDIO_ROOT (read at
import by backend_config) is set.
"""

from django.test import SimpleTestCase

from shared_config.model_config import _impl_id


class ImplIdTests(SimpleTestCase):
    def test_reduces_object_to_impl_id(self):
        obj = {
            "impl_id": "tt_transformers",
            "impl_name": "tt-transformers",
            "repo_url": "https://github.com/tenstorrent/tt-metal",
            "code_path": "models/tt_transformers",
        }
        self.assertEqual(_impl_id(obj), "tt_transformers")

    def test_passes_through_plain_string(self):
        self.assertEqual(_impl_id("whisper"), "whisper")

    def test_none_returns_none(self):
        self.assertIsNone(_impl_id(None))

    def test_object_missing_impl_id_returns_none(self):
        self.assertIsNone(_impl_id({"impl_name": "orphan"}))

    def test_empty_string_returns_none(self):
        self.assertIsNone(_impl_id(""))
