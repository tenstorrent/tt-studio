# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

from dataclasses import dataclass
from typing import List, Optional
from unittest.mock import patch

from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from docker_control.chip_allocator import ChipSlotAllocator
from docker_control.deployment_sync import _classify_failure
from docker_control.docker_utils import (
    claims_whole_board,
    deploys_whole_board,
    equivalent_mesh_device,
    infer_inference_server_device,
    media_image_override,
    trace_region_override,
    vllm_mesh_fallback_fits,
)
from docker_control.views import (
    _LLAMA_V014_IMAGE,
    _resolve_artifact_ref,
    _resolve_override_docker_image,
)
from shared_config.model_config import (
    DeviceConfigurations,
    ModelTypes,
    model_implmentations,
)


@dataclass
class _FakeDeployment:
    id: int
    model_name: str
    device_id: int
    device_ids: Optional[List[int]] = None
    port: Optional[int] = None


class ChipAllocatorDeviceIdsTests(TestCase):
    def _make_allocator(self) -> ChipSlotAllocator:
        with patch.object(ChipSlotAllocator, "_detect_board_type", return_value="P300x2"):
            return ChipSlotAllocator()

    def test_get_chip_status_marks_all_device_ids_occupied(self):
        allocator = self._make_allocator()
        deployment = _FakeDeployment(
            id=101,
            model_name="Llama-3.1-8B",
            device_id=0,
            device_ids=[0, 1],
            port=7000,
        )
        with patch.object(allocator, "_get_active_deployments", return_value=[deployment]):
            with patch.object(allocator, "_get_chips_required", return_value=1):
                chip_status = allocator.get_chip_status()

        occupied_slots = {
            slot["slot_id"]
            for slot in chip_status["slots"]
            if slot["status"] == "occupied"
        }
        self.assertEqual(occupied_slots, {0, 1})

    def test_validate_manual_allocation_rejects_slot_in_reserved_pair(self):
        allocator = self._make_allocator()
        deployment = _FakeDeployment(
            id=102,
            model_name="Llama-3.1-8B",
            device_id=0,
            device_ids=[0, 1],
        )
        with patch.object(allocator, "_get_active_deployments", return_value=[deployment]):
            with patch.object(allocator, "_get_chips_required", return_value=1):
                result = allocator._validate_manual_allocation(1, 1, "Whisper")

        self.assertFalse(result["valid"])
        self.assertIn("occupied", result["message"].lower())

    def test_legacy_single_device_record_still_occupies_one_slot(self):
        allocator = self._make_allocator()
        deployment = _FakeDeployment(
            id=103,
            model_name="Llama-3.1-8B",
            device_id=2,
            device_ids=None,
            port=7002,
        )
        with patch.object(allocator, "_get_active_deployments", return_value=[deployment]):
            with patch.object(allocator, "_get_chips_required", return_value=1):
                chip_status = allocator.get_chip_status()

        occupied_slots = {
            slot["slot_id"]
            for slot in chip_status["slots"]
            if slot["status"] == "occupied"
        }
        self.assertEqual(occupied_slots, {2})


class ClassifyFailureTests(SimpleTestCase):
    def test_hf_auth_sentinel(self):
        msg = (
            "HF_TOKEN authentication failed: your Hugging Face token is "
            "invalid, expired, or does not have access to this model."
        )
        self.assertEqual(_classify_failure(msg), ("hf_auth", msg))

    def test_unknown_failure(self):
        msg = "CUDA out of memory"
        self.assertEqual(_classify_failure(msg), ("unknown", msg))

    def test_empty_message(self):
        self.assertEqual(_classify_failure(None), (None, None))
        self.assertEqual(_classify_failure(""), (None, None))


class DeployViewHfPreCheckTests(SimpleTestCase):
    def setUp(self):
        self.client = APIClient()
        self.impl_id = next(
            (mid for mid, impl in model_implmentations.items() if impl.hf_model_id),
            None,
        )
        self.assertIsNotNone(
            self.impl_id,
            "Expected at least one impl with hf_model_id for pre-check test",
        )
        self.hf_repo = model_implmentations[self.impl_id].hf_model_id

    @patch("api.hf_access._check_repo", return_value=403)
    @patch("shared_config.user_config.get_hf_token", return_value="fake-token")
    def test_returns_400_when_hf_access_denied(self, _token_mock, _repo_mock):
        with patch(
            "docker_control.models.ModelDeployment.objects.filter"
        ) as filter_mock:
            response = self.client.post(
                "/docker/deploy/",
                {"model_id": self.impl_id, "weights_id": ""},
                format="json",
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data.get("error_code"), "hf_access_denied")
        self.assertEqual(
            response.data.get("hf_url"),
            f"https://huggingface.co/{self.hf_repo}",
        )
        # Pre-check must short-circuit before any ModelDeployment query.
        filter_mock.assert_not_called()

    @patch("api.hf_access._check_repo", side_effect=[404, 403])
    @patch("shared_config.user_config.get_hf_token", return_value="fake-token")
    def test_diffusers_repo_falls_back_to_model_index(self, _token_mock, repo_mock):
        """A diffusers repo has no root config.json (404); the pre-check must
        retry model_index.json so gated access is still detected as denied."""
        with patch("docker_control.models.ModelDeployment.objects.filter"):
            response = self.client.post(
                "/docker/deploy/",
                {"model_id": self.impl_id, "weights_id": ""},
                format="json",
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data.get("error_code"), "hf_access_denied")
        # First probe config.json (default), then fall back to model_index.json.
        self.assertEqual(repo_mock.call_count, 2)
        self.assertEqual(repo_mock.call_args_list[1].args[2], "model_index.json")


@dataclass
class _FakeModelImpl:
    model_name: str = "SomeModel"
    requires_dev_catalog: bool = False
    image_version: str = "ghcr.io/example/img:v1"
    inference_artifact_ref: Optional[dict] = None


class OverrideDockerImageResolutionTests(SimpleTestCase):
    def test_llama_v014_pin_takes_priority(self):
        impl = _FakeModelImpl(model_name="Llama-3.1-8B", requires_dev_catalog=True)
        self.assertEqual(_resolve_override_docker_image(impl), _LLAMA_V014_IMAGE)

    def test_dev_catalog_model_forwards_its_own_catalog_image(self):
        impl = _FakeModelImpl(requires_dev_catalog=True, image_version="ghcr.io/x/dev:0.19.0")
        self.assertEqual(_resolve_override_docker_image(impl), "ghcr.io/x/dev:0.19.0")

    def test_ordinary_model_gets_no_override(self):
        impl = _FakeModelImpl()
        self.assertIsNone(_resolve_override_docker_image(impl))


class ArtifactRefResolutionTests(SimpleTestCase):
    """Per-(model, device) tt-inference-server build selection.

    Every path except an explicit, matched, eligible pin must return None, which
    the caller reads as "use the globally pinned artifact".
    """

    def test_matches_resolved_runtime_device(self):
        impl = _FakeModelImpl(
            requires_dev_catalog=True,
            inference_artifact_ref={"P150": "stisi/feat-qwen"},
        )
        self.assertEqual(_resolve_artifact_ref(impl, "p150", "P150"), "stisi/feat-qwen")

    def test_matches_board_type_when_device_differs(self):
        """P300x2 hardware deploys with --tt-device p150 (_BOARD_TO_SINGLE_CHIP_DEVICE),
        so a pin keyed on the board the user actually sees must still match."""
        impl = _FakeModelImpl(
            requires_dev_catalog=True,
            inference_artifact_ref={"P300x2": "stisi/feat-p300"},
        )
        self.assertEqual(_resolve_artifact_ref(impl, "p150", "P300x2"), "stisi/feat-p300")

    def test_device_match_wins_over_board_match(self):
        impl = _FakeModelImpl(
            requires_dev_catalog=True,
            inference_artifact_ref={"p150": "by-device", "P300x2": "by-board"},
        )
        self.assertEqual(_resolve_artifact_ref(impl, "p150", "P300x2"), "by-device")

    def test_key_matching_is_case_insensitive(self):
        impl = _FakeModelImpl(
            requires_dev_catalog=True,
            inference_artifact_ref={"p150": "stisi/feat-qwen"},
        )
        self.assertEqual(_resolve_artifact_ref(impl, "P150", "P150"), "stisi/feat-qwen")

    def test_unmatched_device_falls_back_to_global(self):
        impl = _FakeModelImpl(
            requires_dev_catalog=True,
            inference_artifact_ref={"P150": "stisi/feat-qwen"},
        )
        self.assertIsNone(_resolve_artifact_ref(impl, "n300", "N300"))

    def test_non_dev_catalog_model_ignores_its_ref(self):
        """Only the dev-catalog path runs run.py as a subprocess, which is the only
        way to target a different artifact -- honouring a ref elsewhere would
        silently deploy against the wrong build."""
        impl = _FakeModelImpl(
            requires_dev_catalog=False,
            inference_artifact_ref={"P150": "stisi/feat-qwen"},
        )
        self.assertIsNone(_resolve_artifact_ref(impl, "p150", "P150"))

    def test_no_ref_configured(self):
        impl = _FakeModelImpl(requires_dev_catalog=True)
        self.assertIsNone(_resolve_artifact_ref(impl, "p150", "P150"))

    def test_empty_ref_map(self):
        impl = _FakeModelImpl(requires_dev_catalog=True, inference_artifact_ref={})
        self.assertIsNone(_resolve_artifact_ref(impl, "p150", "P150"))


@dataclass
class _FakeDeviceImpl:
    """Only what device resolution reads — a real ModelImpl's __post_init__ builds
    volume mounts and env this never touches."""
    model_name: str
    model_type: ModelTypes
    device_configurations: set
    inference_engine: str = None


def _device_impl(config_names, model_type=ModelTypes.CHAT, model_name="SomeModel", inference_engine=None):
    return _FakeDeviceImpl(
        model_name=model_name,
        model_type=model_type,
        device_configurations={DeviceConfigurations[n] for n in config_names},
        inference_engine=inference_engine,
    )


class MeshEquivalentDeviceTests(SimpleTestCase):
    """vLLM can reuse the other four-chip Blackhole spec when this board has none.
    Media models must not: P150x4 and P300x2 are different topologies."""

    def test_p300x2_only_vllm_model_resolves_to_p300x2_on_p150x4(self):
        self.assertEqual(
            infer_inference_server_device(_device_impl(["P300x2"]), "P150X4"), "p300x2"
        )

    def test_fallback_holds_in_the_other_direction_for_vllm(self):
        self.assertEqual(
            infer_inference_server_device(_device_impl(["P150X4"]), "P300x2"), "p150x4"
        )

    def test_native_spec_is_preferred_over_the_fallback(self):
        self.assertEqual(
            infer_inference_server_device(_device_impl(["P150X4", "P300x2"]), "P150X4"),
            "p150x4",
        )

    def test_flux_keeps_the_board_device_even_without_a_native_mesh_spec(self):
        """FLUX.1-schnell is complete on p300x2 and listed for p150x4, but the
        p150x4 media spec is a different image/MESH_DEVICE — never rewrite it."""
        impl = _device_impl(
            ["P300x2"],
            model_type=ModelTypes.IMAGE_GENERATION,
            model_name="FLUX.1-schnell",
            inference_engine="media",
        )
        self.assertEqual(infer_inference_server_device(impl, "P150X4"), "p150x4")
        self.assertEqual(equivalent_mesh_device(impl, "p150x4"), "p150x4")

    def test_flux_with_both_specs_uses_the_native_one(self):
        impl = _device_impl(
            ["P150X4", "P300x2"],
            model_type=ModelTypes.IMAGE_GENERATION,
            model_name="FLUX.1-dev",
            inference_engine="media",
        )
        self.assertEqual(infer_inference_server_device(impl, "P150X4"), "p150x4")
        self.assertEqual(infer_inference_server_device(impl, "P300x2"), "p300x2")

    def test_single_chip_model_still_takes_the_single_chip(self):
        impl = _device_impl(["P150", "P150X4", "P300x2"])
        self.assertEqual(infer_inference_server_device(impl, "P150X4"), "p150")
        self.assertFalse(deploys_whole_board(impl, "P150X4"))

    def test_mesh_only_vllm_model_claims_the_whole_board(self):
        self.assertTrue(deploys_whole_board(_device_impl(["P300x2"]), "P150X4"))

    def test_no_fallback_across_chip_counts(self):
        """p150x8 is eight chips; it must not satisfy a four-chip board."""
        self.assertEqual(
            infer_inference_server_device(_device_impl(["P150X8"]), "P150X4"), "p150x4"
        )

    def test_wormhole_model_is_untouched(self):
        self.assertEqual(
            infer_inference_server_device(_device_impl(["T3K"]), "P150X4"), "p150x4"
        )


class EquivalentMeshDeviceTests(SimpleTestCase):
    """equivalent_mesh_device is what the chat deploy path calls directly."""

    def test_p300x2_only_vllm_model_is_swapped(self):
        impl = _device_impl(["P300x2"], model_name="Qwen3.8-27B")
        self.assertEqual(equivalent_mesh_device(impl, "p150x4"), "p300x2")

    def test_declared_device_is_never_swapped(self):
        impl = _device_impl(["P150X4", "P300x2"])
        self.assertEqual(equivalent_mesh_device(impl, "p150x4"), "p150x4")

    def test_media_model_is_never_swapped(self):
        impl = _device_impl(
            ["P300x2"],
            model_type=ModelTypes.IMAGE_GENERATION,
            model_name="FLUX.1-dev",
            inference_engine="media",
        )
        self.assertEqual(equivalent_mesh_device(impl, "p150x4"), "p150x4")

    def test_single_chip_device_is_never_promoted(self):
        """A pinned chip must not become a whole-board deploy: the chat path
        reserves one slot for it (mesh_whole_board excludes CHAT models)."""
        impl = _device_impl(["N150X4", "N300"], model_name="Qwen2.5-7B")
        self.assertEqual(equivalent_mesh_device(impl, "n150"), "n150")

    def test_device_with_no_fallback_is_unchanged(self):
        self.assertEqual(equivalent_mesh_device(_device_impl(["T3K"]), "t3k"), "t3k")
        self.assertEqual(
            equivalent_mesh_device(_device_impl(["P150X8"]), "p150x4"), "p150x4"
        )


class ClaimsWholeBoardTests(SimpleTestCase):
    def test_board_own_name_and_equivalent_both_claim_it(self):
        self.assertTrue(claims_whole_board("p150x4", "p150x4"))
        self.assertTrue(claims_whole_board("p300x2", "p150x4"))

    def test_single_chip_does_not_claim_the_board(self):
        self.assertFalse(claims_whole_board("p150", "p150x4"))
        self.assertFalse(claims_whole_board("n150", "n150x4"))


class VllmMeshFallbackFitsTests(SimpleTestCase):
    def test_p300x2_only_vllm_fits_p150x4(self):
        self.assertTrue(vllm_mesh_fallback_fits(_device_impl(["P300x2"]), "P150X4"))

    def test_media_p300x2_only_does_not_fit_p150x4(self):
        impl = _device_impl(
            ["P300x2"],
            model_type=ModelTypes.IMAGE_GENERATION,
            inference_engine="media",
        )
        self.assertFalse(vllm_mesh_fallback_fits(impl, "P150X4"))

    def test_native_p150x4_is_not_a_fallback(self):
        self.assertFalse(
            vllm_mesh_fallback_fits(_device_impl(["P150X4", "P300x2"]), "P150X4")
        )


class MediaImageOverrideTests(SimpleTestCase):
    """The p150x4 FLUX specs resolve to 0.10.0-555f240, whose image API 404s
    /v1/models and 422s a prompt-only /v1/images/generations."""

    def test_flux_dev_on_p150x4_is_pinned_to_the_p300x2_image(self):
        self.assertEqual(
            media_image_override("FLUX.1-dev", "p150x4"),
            "ghcr.io/tenstorrent/tt-media-inference-server:0.17.0-8c48a10",
        )

    def test_flux_schnell_on_p150x4_is_pinned_to_its_own_newer_image(self):
        self.assertEqual(
            media_image_override("FLUX.1-schnell", "p150x4"),
            "ghcr.io/tenstorrent/tt-media-inference-server:0.18.0-c49bb76",
        )

    def test_flux_on_p300x2_keeps_the_spec_image(self):
        """p300x2 already resolves to 0.17.0/0.18.0, so pinning there would only
        create a second place to update."""
        self.assertIsNone(media_image_override("FLUX.1-dev", "p300x2"))
        self.assertIsNone(media_image_override("FLUX.1-schnell", "p300x2"))

    def test_wan_is_pinned_on_every_device(self):
        image = "ghcr.io/tenstorrent/tt-media-inference-server:0.17.0-8c48a10"
        for device in ("p150x4", "p300x2", "t3k", "galaxy"):
            self.assertEqual(
                media_image_override("Wan2.2-T2V-A14B-Diffusers", device), image
            )

    def test_unpinned_model_returns_none(self):
        self.assertIsNone(media_image_override("whisper-large-v3", "p150"))
        self.assertIsNone(media_image_override("Llama-3.1-8B-Instruct", "p150x4"))


class MediaTraceRegionOverrideTests(SimpleTestCase):
    def test_both_flux_variants_reserve_p300x2_trace_region_on_p150x4(self):
        self.assertEqual(
            trace_region_override("FLUX.1-dev", "p150x4"), 51_000_000
        )
        self.assertEqual(
            trace_region_override("FLUX.1-schnell", "p150x4"), 51_000_000
        )

    def test_other_devices_and_models_keep_their_spec_setting(self):
        self.assertIsNone(trace_region_override("FLUX.1-dev", "p300x2"))
        self.assertIsNone(trace_region_override("whisper-large-v3", "p150"))
