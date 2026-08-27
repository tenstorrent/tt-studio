# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Tests for external_model_config.py — the stand-in model_impl used for containers
registered through Register Model that have no catalog entry.
"""

from shared_config.coding_agent_config import is_coding_agent_eligible
from shared_config.external_model_config import (
    build_external_model_impl,
    normalize_external_model_type,
)
from shared_config.model_type_config import ModelTypes


class TestNormalizeExternalModelType:
    def test_known_type(self):
        assert normalize_external_model_type("tts") == ModelTypes.TTS

    def test_case_insensitive(self):
        assert normalize_external_model_type("Speech_Recognition") == (
            ModelTypes.SPEECH_RECOGNITION
        )

    def test_unroutable_type_is_unknown(self):
        # A valid ModelTypes value TT Studio has no external routing for.
        assert normalize_external_model_type("training") == ModelTypes.UNKNOWN

    def test_garbage_and_empty_are_unknown(self):
        assert normalize_external_model_type("not-a-type") == ModelTypes.UNKNOWN
        assert normalize_external_model_type(None) == ModelTypes.UNKNOWN
        assert normalize_external_model_type("") == ModelTypes.UNKNOWN


class TestBuildExternalModelImpl:
    def test_identified_model_gets_its_type_route_and_engine(self):
        impl = build_external_model_impl("my-tts", "tts", "org/my-tts", 8000)
        assert impl.model_type == ModelTypes.TTS
        assert impl.service_route == "/v1/audio/speech"
        assert impl.inference_engine == "media"
        assert impl.service_port == 8000
        assert impl.hf_model_id == "org/my-tts"

    def test_chat_model_routes_like_a_catalog_chat_model(self):
        impl = build_external_model_impl("some-llm", "chat")
        assert impl.service_route == "/v1/chat/completions"
        assert impl.inference_engine == "vllm"

    def test_unidentified_model_still_gets_an_impl(self):
        impl = build_external_model_impl("mystery-container", None)
        assert impl.model_type == ModelTypes.UNKNOWN
        # Bare route: nothing in the UI offers inference against it.
        assert impl.service_route == "/"
        assert impl.health_route == "/health"
        # hf_model_id falls back to the name so callers always have a label.
        assert impl.hf_model_id == "mystery-container"

    def test_accepts_a_model_types_enum(self):
        impl = build_external_model_impl("x", ModelTypes.VLM)
        assert impl.model_type == ModelTypes.VLM

    def test_asdict_is_serializable_shape(self):
        d = build_external_model_impl("x", "chat").asdict()
        assert d["model_name"] == "x"
        assert d["model_type"] == ModelTypes.CHAT
        assert d["is_external"] is True


class TestCodingAgentEligibility:
    """An external chat/VLM model is coding-agent eligible on structure, since it
    has no catalog entry to be allowlisted by. Catalog models keep the allowlist."""

    def test_external_chat_model_is_eligible(self):
        impl = build_external_model_impl("some-off-catalog-llm", "chat", tool_calling_enabled=True)
        assert is_coding_agent_eligible(impl) is True

    def test_external_vlm_is_eligible(self):
        assert is_coding_agent_eligible(build_external_model_impl("x", "vlm")) is True

    def test_external_non_chat_types_are_not_eligible(self):
        assert is_coding_agent_eligible(build_external_model_impl("x", "tts")) is False
        assert is_coding_agent_eligible(build_external_model_impl("x", None)) is False

    def test_tool_calling_flag_is_carried_not_gating(self):
        # Eligibility is structural; callers filter on tool_calling_enabled so a
        # container launched without it can still be explained in the UI.
        impl = build_external_model_impl("x", "chat", tool_calling_enabled=False)
        assert is_coding_agent_eligible(impl) is True
        assert impl.tool_calling_enabled is False

    def test_catalog_models_still_use_the_allowlist(self):
        class FakeCatalogImpl:
            model_type = ModelTypes.CHAT
            def __init__(self, name):
                self.model_name = name

        assert is_coding_agent_eligible(FakeCatalogImpl("Qwen3-32B")) is True
        assert is_coding_agent_eligible(FakeCatalogImpl("Some-Unvetted-Model")) is False

    def test_none_impl(self):
        assert is_coding_agent_eligible(None) is False
