# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Tests for sync_models_from_inference_server.py route derivation logic.
"""

import json

import pytest
from sync_models_from_inference_server import (
    HAND_OWNED_KEYS,
    _impl_id,
    _iter_v1_entries,
    load_existing_catalog,
    map_service_route,
    merge_hand_owned,
    normalize,
)


class TestServiceRouteMapping:
    """Test that service routes are correctly derived for different model types."""
    
    def test_vllm_chat_capable_models(self):
        """vLLM chat-capable models should use /v1/chat/completions."""
        assert map_service_route("vLLM", "meta-llama/Llama-3.1-8B-Instruct", "") == "/v1/chat/completions"
        assert map_service_route("vLLM", "mistralai/Mistral-7B-Instruct-v0.3", "") == "/v1/chat/completions"
        assert map_service_route("vLLM", "Qwen/QwQ-32B", "") == "/v1/chat/completions"
    
    def test_vllm_base_models(self):
        """vLLM base models should use /v1/completions."""
        assert map_service_route("vLLM", "meta-llama/Llama-3.1-70B", "") == "/v1/completions"
        assert map_service_route("vLLM", "meta-llama/Llama-3.2-1B", "") == "/v1/completions"
    
    def test_tts_media_models_use_openai_endpoint(self):
        """TTS media models should use /v1/audio/speech (OpenAI-compatible)."""
        assert map_service_route("media", "", "TEXT_TO_SPEECH") == "/v1/audio/speech"
        assert map_service_route("media", "", "TTS") == "/v1/audio/speech"
    
    def test_image_gen_media_models_use_v1_images_generations(self):
        """Image generation media models should use /v1/images/generations."""
        assert map_service_route("media", "", "IMAGE") == "/v1/images/generations"
        assert map_service_route("media", "", "IMAGE_GENERATION") == "/v1/images/generations"

    def test_non_image_media_models_use_enqueue(self):
        """Non-image/non-audio/non-video media models should use /enqueue."""
        assert map_service_route("media", "", "CNN") == "/enqueue"
        assert map_service_route("media", "", "EMBEDDING") == "/enqueue"

    def test_video_gen_media_models_use_v1_videos_generations(self):
        """T2V video generation media models should use /v1/videos/generations."""
        assert map_service_route("media", "Wan-AI/Wan2.2-T2V-A14B-Diffusers", "VIDEO") == "/v1/videos/generations"
        assert map_service_route("media", "Wan-AI/Wan2.2-I2V-A14B-Diffusers", "VIDEO") == "/v1/videos/generations/i2v"
        assert map_service_route("media", "some-org/some-T2V-model", "VIDEO") == "/v1/videos/generations"
    
    def test_forge_models_use_chat_completions(self):
        """Forge models should use /v1/chat/completions."""
        assert map_service_route("forge", "", "") == "/v1/chat/completions"
        assert map_service_route("forge", "", "CNN") == "/v1/chat/completions"


class TestHandOwnedFieldPreservation:
    """A resync rebuilds every entry from the source JSON, so hand-curated state
    has to be explicitly folded back in or it is silently lost (issue #977)."""

    def test_preserves_hand_set_field_on_synced_model(self):
        models = [{"model_name": "Qwen3-8B", "status": "COMPLETE", "version": "1.0"}]
        existing = {"Qwen3-8B": {"model_name": "Qwen3-8B", "requires_dev_catalog": True}}

        merged, preserved, retained = merge_hand_owned(models, existing)

        assert merged[0]["requires_dev_catalog"] is True
        assert preserved == ["Qwen3-8B.requires_dev_catalog"]
        assert retained == []

    def test_preserves_artifact_ref_map(self):
        models = [{"model_name": "Qwen3.5-9B", "status": "EXPERIMENTAL"}]
        existing = {
            "Qwen3.5-9B": {
                "model_name": "Qwen3.5-9B",
                "inference_artifact_ref": {"P150": "stisi/feat-qwen"},
            }
        }

        merged, preserved, _ = merge_hand_owned(models, existing)

        assert merged[0]["inference_artifact_ref"] == {"P150": "stisi/feat-qwen"}
        assert preserved == ["Qwen3.5-9B.inference_artifact_ref"]

    def test_retains_model_absent_from_source(self):
        """A dev-tier-only model can never appear in a prod release snapshot, so
        a rebuild would drop the whole entry, not just one field."""
        models = [{"model_name": "Qwen3-8B", "status": "COMPLETE"}]
        existing = {
            "Qwen3-8B": {"model_name": "Qwen3-8B"},
            "Qwen3.5-9B": {"model_name": "Qwen3.5-9B", "requires_dev_catalog": True},
        }

        merged, _, retained = merge_hand_owned(models, existing)

        assert retained == ["Qwen3.5-9B"]
        assert {m["model_name"] for m in merged} == {"Qwen3-8B", "Qwen3.5-9B"}

    def test_fresh_value_wins_over_stale_one(self):
        """Once the source JSON starts carrying a field, it is no longer
        hand-owned for that model -- don't overwrite it with the old value."""
        models = [{"model_name": "Qwen3-8B", "requires_dev_catalog": False}]
        existing = {"Qwen3-8B": {"model_name": "Qwen3-8B", "requires_dev_catalog": True}}

        merged, preserved, _ = merge_hand_owned(models, existing)

        assert merged[0]["requires_dev_catalog"] is False
        assert preserved == []

    def test_first_sync_with_no_existing_catalog(self):
        models = [{"model_name": "Qwen3-8B", "status": "COMPLETE"}]

        merged, preserved, retained = merge_hand_owned(models, {})

        assert merged == [{"model_name": "Qwen3-8B", "status": "COMPLETE"}]
        assert preserved == [] and retained == []

    def test_every_hand_owned_key_is_actually_carried(self):
        """Guards the constant against drifting out of sync with the merge."""
        models = [{"model_name": "M"}]
        existing = {"M": {"model_name": "M", **{k: "sentinel" for k in HAND_OWNED_KEYS}}}

        merged, _, _ = merge_hand_owned(models, existing)

        for key in HAND_OWNED_KEYS:
            assert merged[0][key] == "sentinel", f"{key} was not preserved"


class TestImplNormalization:
    """The inference server's /run and /resolve-image expect a string impl_id;
    the artifact leaves carry the whole impl object, so the catalog must store
    only the impl_id string (issue: media/non-chat deploy HTTP 422)."""

    def test_impl_id_reduces_object_to_string(self):
        obj = {
            "impl_id": "whisper",
            "impl_name": "whisper",
            "repo_url": "https://github.com/tenstorrent/tt-metal",
            "code_path": "models/demos/whisper",
        }
        assert _impl_id(obj) == "whisper"

    def test_impl_id_passes_through_string(self):
        assert _impl_id("tt_transformers") == "tt_transformers"

    def test_impl_id_handles_none_and_missing_id(self):
        assert _impl_id(None) is None
        assert _impl_id({}) is None
        assert _impl_id("") is None

    def test_v1_entries_yield_impl_id_string(self):
        """A leaf whose impl is the full object should surface as its impl_id."""
        model_specs = {
            "org/distil-large-v3": {
                "P150": {
                    "media": {
                        "whisper": {
                            "model_name": "distil-large-v3",
                            "impl": {"impl_id": "whisper", "impl_name": "whisper"},
                        }
                    }
                }
            }
        }
        entries = list(_iter_v1_entries(model_specs))
        assert [e["impl"] for e in entries] == ["whisper"]

    def test_v1_entries_fall_back_to_nesting_key(self):
        """A leaf with no impl object should fall back to the nesting key so the
        catalog can still disambiguate engine specs."""
        model_specs = {
            "org/some-model": {
                "P150": {
                    "vLLM": {
                        "tt_transformers": {
                            "model_name": "some-model",
                        }
                    }
                }
            }
        }
        entries = list(_iter_v1_entries(model_specs))
        assert [e["impl"] for e in entries] == ["tt_transformers"]

    def test_retained_entry_dict_impl_is_normalized(self):
        """A hand-retained model bypasses normalize() and can carry a stale impl
        object; the main() normalization loop reduces it to its impl_id string."""
        models = [{"model_name": "Synced", "status": "COMPLETE", "impl": "whisper"}]
        existing = {
            "Retained": {
                "model_name": "Retained",
                "requires_dev_catalog": True,
                "impl": {"impl_id": "qwen36_blackhole", "impl_name": "qwen36"},
            }
        }

        merged, _, retained = merge_hand_owned(models, existing)
        # Mirror main(): normalize impl across every merged entry.
        for m in merged:
            if "impl" in m:
                m["impl"] = _impl_id(m.get("impl"))

        assert retained == ["Retained"]
        by_name = {m["model_name"]: m for m in merged}
        assert by_name["Retained"]["impl"] == "qwen36_blackhole"
        assert by_name["Synced"]["impl"] == "whisper"


def _leaf(model_name, impl_id, *, model_type="LLM", engine="vLLM"):
    """A minimal model_spec leaf sufficient for normalize()."""
    return {
        "model_name": model_name,
        "model_type": model_type,
        "inference_engine": engine,
        "hf_model_repo": f"org/{model_name}",
        "status": "COMPLETE",
        "version": "1.0.0",
        "docker_image": f"ghcr.io/x/{model_name}:1.0.0",
        "impl": {"impl_id": impl_id, "impl_name": impl_id},
    }


def _normalize_specs(tmp_path, model_specs):
    """Write a v0.1.0 model_specs doc and return {model_name: catalog entry}.

    Mirrors the real artifact, where each leaf carries a device_type equal to its
    nesting key (that field is what normalize() uses to skip GPU specs)."""
    for by_device in model_specs.values():
        for device_type, by_engine in by_device.items():
            for by_impl in by_engine.values():
                for leaf in by_impl.values():
                    leaf.setdefault("device_type", device_type)
    src = tmp_path / "model_spec.json"
    src.write_text(json.dumps({"schema_version": "0.1.0", "model_specs": model_specs}))
    return {m["model_name"]: m for m in normalize(src)}


class TestImplAmbiguity:
    """An impl is only worth recording when it disambiguates multiple engine
    specs for a model. Recording a redundant impl makes the server's stricter
    (model, device, impl) lookup miss non-prod-tier specs and 404 (speecht5_tts
    on Blackhole)."""

    def test_single_impl_across_devices_yields_null(self, tmp_path):
        model_specs = {
            "org/speecht5_tts": {
                "P150": {"media": {"speecht5_tts": _leaf("speecht5_tts", "speecht5_tts", engine="media")}},
                "N150": {"media": {"speecht5_tts": _leaf("speecht5_tts", "speecht5_tts", engine="media")}},
                "P300X2": {"media": {"speecht5_tts": _leaf("speecht5_tts", "speecht5_tts", engine="media")}},
            }
        }
        by_name = _normalize_specs(tmp_path, model_specs)
        assert by_name["speecht5_tts"]["impl"] is None

    def test_multiple_impls_retains_impl(self, tmp_path):
        model_specs = {
            "org/Llama-3.2-3B": {
                "P150": {
                    "vLLM": {"tt_transformers": _leaf("Llama-3.2-3B", "tt_transformers")},
                    "forge": {"training": _leaf("Llama-3.2-3B", "training", engine="forge")},
                }
            }
        }
        by_name = _normalize_specs(tmp_path, model_specs)
        assert by_name["Llama-3.2-3B"]["impl"] in {"tt_transformers", "training"}
        assert by_name["Llama-3.2-3B"]["impl"] is not None

    def test_gpu_only_second_impl_is_not_ambiguous(self, tmp_path):
        """normalize() skips GPU entries, so a second impl that appears only on a
        GPU spec must not make the model look ambiguous."""
        model_specs = {
            "org/some-model": {
                "P150": {"vLLM": {"tt_transformers": _leaf("some-model", "tt_transformers")}},
                "GPU": {"vLLM": {"gpu_impl": _leaf("some-model", "gpu_impl")}},
            }
        }
        by_name = _normalize_specs(tmp_path, model_specs)
        assert by_name["some-model"]["impl"] is None


class TestLoadExistingCatalog:
    def test_missing_file_is_not_fatal(self, tmp_path):
        assert load_existing_catalog(tmp_path / "nope.json") == {}

    def test_malformed_file_is_not_fatal(self, tmp_path):
        """A corrupt catalog must not block a resync -- it just means there is
        nothing to preserve."""
        path = tmp_path / "catalog.json"
        path.write_text("{not valid json")
        assert load_existing_catalog(path) == {}

    def test_indexes_models_by_name(self, tmp_path):
        path = tmp_path / "catalog.json"
        path.write_text(json.dumps({"models": [
            {"model_name": "A", "requires_dev_catalog": True},
            {"model_name": "B"},
            {"no_name": "skipped"},
        ]}))

        loaded = load_existing_catalog(path)

        assert set(loaded) == {"A", "B"}
        assert loaded["A"]["requires_dev_catalog"] is True


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
