# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

from dataclasses import dataclass
from unittest.mock import patch

from django.test import TestCase

from docker_control.chip_allocator import ChipSlotAllocator


@dataclass
class _FakeDeployment:
    id: int
    model_name: str
    device_id: int
    device_ids: list[int] | None = None
    port: int | None = None


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
