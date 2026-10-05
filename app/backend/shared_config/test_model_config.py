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

import json
import tempfile
from pathlib import Path

from django.test import SimpleTestCase

from shared_config.model_config import (
    _impl_selector,
    load_model_implementations_from_json,
    register_model_implementations,
)


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


def _catalog_row(model_name, engine, *, model_type="CHAT", version="1.0.0", **extra):
    return {
        "model_name": model_name,
        "model_type": model_type,
        "inference_engine": engine,
        "hf_model_id": f"org/{model_name}",
        "device_configurations": ["N150"],
        "docker_image": f"ghcr.io/x/{engine}:{version}",
        "service_route": "/v1/chat/completions",
        "version": version,
        **extra,
    }


class CrossEngineModelIdTests(SimpleTestCase):
    """A model_name can appear once per engine; same-version rows must still get
    distinct model_ids or registration raises on import."""

    def _load(self, rows):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "catalog.json"
            path.write_text(json.dumps({"models": rows}))
            return load_model_implementations_from_json(path)

    def test_same_version_cross_engine_rows_get_distinct_ids(self):
        impls = self._load([
            _catalog_row("Llama-3.1-8B-Instruct", "vLLM", impl="tt-transformers"),
            _catalog_row("Llama-3.1-8B-Instruct", "forge", model_type="TRAINING",
                         impl="trainer-training-lora"),
        ])

        ids = {impl.inference_engine: impl.model_id for impl in impls}
        self.assertEqual(ids, {
            "vLLM": "id_tt-metal-Llama-3.1-8B-Instruct-vllm-v1.0.0",
            "forge": "id_tt-metal-Llama-3.1-8B-Instruct-forge-v1.0.0",
        })
        registry = register_model_implementations(impls)
        self.assertEqual(len(registry), 2)

    def test_single_engine_model_keeps_legacy_id(self):
        """Ids name the volume_{model_id} dir holding a model's weights, so
        models with no cross-engine sibling must keep their existing id."""
        impls = self._load([
            _catalog_row("Qwen3-8B", "vLLM"),
            _catalog_row("Llama-3.1-8B-Instruct", "vLLM"),
            _catalog_row("Llama-3.1-8B-Instruct", "forge", model_type="TRAINING"),
        ])

        qwen = next(impl for impl in impls if impl.model_name == "Qwen3-8B")
        self.assertEqual(qwen.model_id, "id_tt-metal-Qwen3-8B-v1.0.0")

    def test_unavailable_sibling_still_scopes_the_id(self):
        """Hiding one engine's row must not flip the other row's model_id."""
        impls = self._load([
            _catalog_row("Llama-3.2-3B", "vLLM"),
            _catalog_row("Llama-3.2-3B", "forge", model_type="TRAINING",
                         available_in_studio=False, unavailable_reason="known_broken"),
        ])

        self.assertEqual([impl.model_id for impl in impls],
                         ["id_tt-metal-Llama-3.2-3B-vllm-v1.0.0"])

    def test_same_engine_duplicate_still_fails_loudly(self):
        impls = self._load([
            _catalog_row("Qwen3-8B", "vLLM"),
            _catalog_row("Qwen3-8B", "vLLM"),
        ])

        with self.assertRaisesRegex(ValueError, "Duplicate model_id"):
            register_model_implementations(impls)
