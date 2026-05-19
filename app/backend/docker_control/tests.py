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
from shared_config.model_config import model_implmentations


@dataclass
class _FakeDeployment:
    id: int
    model_name: str
    device_id: int
    device_ids: Optional[List[int]] = None
    port: Optional[int] = None


class ChipAllocatorDeviceIdsTests(TestCase):
    def _make_allocator(self) -> ChipSlotAllocator:
        with patch.object(ChipSlotAllocator, "_detect_board_type", return_value="P300Cx2"):
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
