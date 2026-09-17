# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

from dataclasses import dataclass
from typing import List, Optional
from unittest.mock import Mock, patch

from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from docker_control.chip_allocator import (
    AllocationError,
    ChipSlotAllocator,
    MultiChipConflictError,
)
from docker_control.deployment_sync import _classify_failure
from docker_control.artifact_resolution import _LLAMA_V014_IMAGE, training_image_override
from docker_control.docker_utils import (
    claims_whole_board,
    deploys_whole_board,
    equivalent_mesh_device,
    infer_inference_server_device,
    media_image_override,
    run_container,
    trace_region_override,
    vllm_mesh_fallback_fits,
)
from docker_control.views import (
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


def _container(name, devices, container_id="0123456789abcdef"):
    """A container entry as the docker-control service lists it."""
    return {
        "id": container_id,
        "name": name,
        "HostConfig": {
            "Devices": [{"PathOnHost": d, "PathInContainer": d} for d in devices],
        },
    }


class _FakeDockerClient:
    def __init__(self, containers=None, error=None):
        self._containers = containers or []
        self._error = error

    def list_containers(self, all=False):
        if self._error:
            raise self._error
        return {"status": "success", "containers": self._containers}


class ChipAllocatorExternalContainerTests(TestCase):
    """Chips held by containers TT-Studio did not deploy must read as occupied."""

    def _make_allocator(self) -> ChipSlotAllocator:
        with patch.object(ChipSlotAllocator, "_detect_board_type", return_value="P300x2"):
            return ChipSlotAllocator()

    def _with_docker(self, allocator, containers=None, error=None, deployments=None):
        client = _FakeDockerClient(containers=containers, error=error)
        return (
            patch("docker_control.docker_control_client.get_docker_client", return_value=client),
            patch.object(allocator, "_get_active_deployments", return_value=deployments or []),
            patch.object(allocator, "_get_chips_required", return_value=1),
        )

    def _enter(self, patches):
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def test_single_chip_bound_by_foreign_container_is_occupied_and_not_allocatable(self):
        allocator = self._make_allocator()
        self._enter(self._with_docker(allocator, [_container("tt-model-devstral", ["/dev/tenstorrent/2"])]))

        status = allocator.get_chip_status()
        slot = status["slots"][2]
        self.assertEqual(slot["status"], "occupied")
        self.assertEqual(slot["model_name"], "tt-model-devstral")
        self.assertIsNone(slot["deployment_id"])
        self.assertEqual(slot["source"], "external")
        self.assertEqual([s["status"] for s in status["slots"]], ["available", "available", "occupied", "available"])

        # Auto placement skips the held chip, manual placement on it is refused by name.
        self.assertEqual(allocator.allocate_chip_slot("bge-m3"), 0)
        with self.assertRaises(AllocationError) as ctx:
            allocator.allocate_chip_slot("bge-m3", manual_override=2)
        self.assertIn("tt-model-devstral", str(ctx.exception))
        self.assertIn("not deployed by TT-Studio", str(ctx.exception))

    def test_whole_device_directory_bound_by_foreign_container_holds_every_chip(self):
        allocator = self._make_allocator()
        self._enter(self._with_docker(allocator, [_container("tt-model-devstral", ["/dev/tenstorrent"])]))

        status = allocator.get_chip_status()
        self.assertTrue(all(s["status"] == "occupied" for s in status["slots"]))
        self.assertTrue(all(s["is_multi_chip"] for s in status["slots"]))

        with self.assertRaises(AllocationError):
            allocator.allocate_chip_slot("bge-m3")
        with patch.object(allocator, "_get_chips_required", return_value=4):
            with self.assertRaises(MultiChipConflictError) as ctx:
                allocator.allocate_chip_slot("Llama-3.3-70B")
        self.assertEqual(
            [(c["model"], c["deployment_id"], c["source"]) for c in ctx.exception.conflicts],
            [("tt-model-devstral", None, "external")],
        )

    def test_tt_studio_infrastructure_containers_are_ignored(self):
        allocator = self._make_allocator()
        infra = [
            _container("tt_studio_backend_api_dev", ["/dev/tenstorrent"], container_id="aaa"),
            _container("docker-control-service", ["/dev/tenstorrent"], container_id="bbb"),
        ]
        self._enter(self._with_docker(allocator, infra))

        status = allocator.get_chip_status()
        self.assertTrue(all(s["status"] == "available" for s in status["slots"]))
        self.assertEqual(allocator._get_occupied_slots(), set())

    def test_container_tracked_as_a_deployment_is_counted_once_from_its_record(self):
        allocator = self._make_allocator()
        deployment = _FakeDeployment(id=7, model_name="bge-m3", device_id=0, device_ids=[0], port=7000)
        deployment.container_id = "feedfacefeedfacefeedface"
        deployment.container_name = "bge-m3"
        containers = [_container("bge-m3", ["/dev/tenstorrent/0"], container_id="feedfacefeedfacefeedface")]
        self._enter(self._with_docker(allocator, containers, deployments=[deployment]))

        status = allocator.get_chip_status()
        slot = status["slots"][0]
        self.assertEqual(slot["status"], "occupied")
        self.assertEqual(slot["deployment_id"], 7)
        self.assertNotIn("source", slot)
        self.assertEqual(allocator._get_occupied_slots(), {0})

    def test_get_chip_status_reuses_active_deployments_snapshot_for_external_occupancy(self):
        allocator = self._make_allocator()
        with patch("docker_control.docker_control_client.get_docker_client", return_value=_FakeDockerClient()), \
             patch.object(allocator, "_get_active_deployments", return_value=[]) as active_mock, \
             patch.object(allocator, "_get_chips_required", return_value=1):
            status = allocator.get_chip_status()

        self.assertTrue(all(slot["status"] == "available" for slot in status["slots"]))
        self.assertEqual(active_mock.call_count, 1)

    def test_get_occupied_slots_reuses_active_deployments_snapshot_for_external_occupancy(self):
        allocator = self._make_allocator()
        with patch("docker_control.docker_control_client.get_docker_client", return_value=_FakeDockerClient()), \
             patch.object(allocator, "_get_active_deployments", return_value=[]) as active_mock, \
             patch.object(allocator, "_get_chips_required", return_value=1):
            occupied = allocator._get_occupied_slots()

        self.assertEqual(occupied, set())
        self.assertEqual(active_mock.call_count, 1)

    def test_docker_listing_failure_falls_back_to_deployment_records(self):
        allocator = self._make_allocator()
        deployment = _FakeDeployment(id=3, model_name="bge-m3", device_id=1, device_ids=[1], port=7001)
        self._enter(self._with_docker(allocator, error=RuntimeError("docker-control unreachable"), deployments=[deployment]))

        status = allocator.get_chip_status()
        self.assertEqual([s["status"] for s in status["slots"]], ["available", "occupied", "available", "available"])
        self.assertEqual(allocator.allocate_chip_slot("whisper"), 0)

    def test_containers_without_tenstorrent_devices_are_ignored(self):
        allocator = self._make_allocator()
        self._enter(self._with_docker(allocator, [_container("chromadb", ["/dev/fuse"]), _container("plain", [])]))
        self.assertEqual(allocator._get_occupied_slots(), set())


class ClassifyFailureTests(SimpleTestCase):
    def test_hf_auth_sentinel(self):
        msg = (
            "HF_TOKEN authentication failed: your Hugging Face token is "
            "invalid, expired, or does not have access to this model."
        )
        self.assertEqual(_classify_failure(msg), ("hf_auth", msg))

    def test_hf_model_not_found_repository_error(self):
        msg = "huggingface_hub.utils._errors.RepositoryNotFoundError: 404 Client Error: Repository Not Found for url"
        self.assertEqual(_classify_failure(msg), ("hf_model_not_found", msg))

    def test_hf_model_not_found_entry_error(self):
        msg = "EntryNotFoundError: 404 Client Error: Entry Not Found for url"
        self.assertEqual(_classify_failure(msg), ("hf_model_not_found", msg))

    def test_hf_model_not_found_generic_404(self):
        msg = "Model meta-llama/non-existent could not be loaded from hugging face: 404 client error: repository not found"
        self.assertEqual(_classify_failure(msg), ("hf_model_not_found", msg))

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
        self.assertIn("does not have access", response.data.get("message", ""))
        self.assertEqual(
            response.data.get("hf_url"),
            f"https://huggingface.co/{self.hf_repo}",
        )
        # Pre-check must short-circuit before any ModelDeployment query.
        filter_mock.assert_not_called()

    @patch("api.hf_access._check_repo", return_value=401)
    @patch("shared_config.user_config.get_hf_token", return_value=None)
    def test_returns_400_when_hf_access_denied_without_token(self, _token_mock, _repo_mock):
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
        self.assertIn("token is required", response.data.get("message", ""))
        self.assertEqual(
            response.data.get("hf_url"),
            f"https://huggingface.co/{self.hf_repo}",
        )
        filter_mock.assert_not_called()

    @patch("api.hf_access._check_repo", return_value=404)
    @patch("shared_config.user_config.get_hf_token", return_value="fake-token")
    def test_returns_400_when_hf_repo_not_found(self, _token_mock, _repo_mock):
        with patch(
            "docker_control.models.ModelDeployment.objects.filter"
        ) as filter_mock:
            response = self.client.post(
                "/docker/deploy/",
                {"model_id": self.impl_id, "weights_id": ""},
                format="json",
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data.get("error_code"), "hf_model_not_found")
        self.assertIn("could not be found", response.data.get("message", ""))
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
    model_type: ModelTypes = ModelTypes.CHAT


class TrainingImageOverrideTests(SimpleTestCase):
    """A TRAINING row's catalog docker_image is the deploy image, verbatim."""

    _STUDIO_TAG = "ghcr.io/tenstorrent/tt-studio/studio_images:training-llama-3.1-8b-20260908"

    def test_training_row_forwards_its_catalog_image(self):
        impl = _FakeModelImpl(model_type=ModelTypes.TRAINING, image_version=self._STUDIO_TAG)
        self.assertEqual(training_image_override(impl), self._STUDIO_TAG)

    def test_local_build_tag_is_forwarded_verbatim(self):
        impl = _FakeModelImpl(model_type=ModelTypes.TRAINING, image_version="tt-media-server-forge:local")
        self.assertEqual(training_image_override(impl), "tt-media-server-forge:local")

    def test_non_training_row_gets_no_override(self):
        impl = _FakeModelImpl(model_type=ModelTypes.CHAT, image_version=self._STUDIO_TAG)
        self.assertIsNone(training_image_override(impl))

    def test_training_row_without_image_leaves_server_spec_in_charge(self):
        # model_config renders an empty catalog docker_image as ":latest".
        impl = _FakeModelImpl(model_type=ModelTypes.TRAINING, image_version=":latest")
        self.assertIsNone(training_image_override(impl))


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

    def test_mochi_on_p300x2_is_pinned_to_the_patched_studio_image(self):
        """The spec's 0.10.0 image rejects the P300x2 2x2 mesh, and stock 0.18.0
        still carries the pre-refactor runner; only the studio_images build runs."""
        self.assertEqual(
            media_image_override("mochi-1-preview", "p300x2"),
            "ghcr.io/tenstorrent/tt-studio/studio_images:mochi-1-preview-qb2-20260813-0.18.0-c49bb76",
        )

    def test_mochi_on_other_boards_keeps_the_spec_image(self):
        """The patched build was only verified on p300x2; the other boards are untested on it."""
        for device in ("t3k", "galaxy", "p150x4", "p150x8"):
            self.assertIsNone(media_image_override("mochi-1-preview", device))


class RunContainerMediaPinTests(SimpleTestCase):
    """What run_container actually posts to /run for a pinned media model, next
    to an unpinned one, with board detection and the inference server mocked."""

    MOCHI_PIN = "ghcr.io/tenstorrent/tt-studio/studio_images:mochi-1-preview-qb2-20260813-0.18.0-c49bb76"

    def _payload_for(self, model_name):
        impl = next(
            i for i in model_implmentations.values()
            if i.model_name == model_name and i.model_type != ModelTypes.TRAINING
        )
        response = Mock(status_code=202)
        response.json.return_value = {}
        with (
            patch("docker_control.docker_utils.detect_board_type", return_value="P300x2"),
            patch("docker_control.docker_utils.get_next_service_port", return_value=20001),
            patch("shared_config.user_config.get_hf_token", return_value=None),
            patch("shared_config.user_config.get_jwt_secret", return_value=None),
            patch("docker_control.docker_utils.requests.post", return_value=response) as post,
        ):
            run_container(impl, weights_id="", device_id=0)
        return post.call_args.kwargs["json"]

    def test_mochi_on_p300x2_deploys_the_pin_through_its_derived_spec(self):
        payload = self._payload_for("mochi-1-preview")
        self.assertEqual(payload["device"], "p300x2")
        self.assertEqual(payload["override_docker_image"], self.MOCHI_PIN)
        # run.py loads a runtime spec as-is, so the env var and the pin travel in
        # the derived spec file (see serve_override env_vars in model_overrides.toml).
        self.assertTrue(
            payload["runtime_model_spec_json"].endswith(
                "app/backend/shared_config/runtime_model_specs/mochi-1-preview-p300x2.json"
            ),
            payload["runtime_model_spec_json"],
        )
        self.assertNotIn("device_id", payload, "whole-board mesh deploys are not pinned to a chip")

    def test_unpinned_media_model_sends_neither(self):
        payload = self._payload_for("FLUX.1-schnell")
        self.assertNotIn("override_docker_image", payload)
        self.assertNotIn("runtime_model_spec_json", payload)


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
