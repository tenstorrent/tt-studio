# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests for allocating a mesh smaller than the board.

Community bundles declare a real chip count in their manifest (1 for a p150 profile,
2 for a p300 one), so the allocator has to place a group of chips rather than only the
single-slot and whole-board cases the catalog needs. Alignment is the point: a 2-chip
mesh must land on one card ([0,1] or [2,3]) and never straddle two ([1,2]).
"""

import unittest
from unittest.mock import patch

from docker_control.chip_allocator import AllocationError, ChipSlotAllocator


def _allocator(total_slots=4, occupied=()):
    """A ChipSlotAllocator with board detection and live occupancy stubbed out."""
    with patch.object(ChipSlotAllocator, "_detect_board_type", return_value="P300x2"), \
         patch.object(ChipSlotAllocator, "_get_total_slots", return_value=total_slots):
        allocator = ChipSlotAllocator()
    patcher = patch.object(ChipSlotAllocator, "_get_occupied_slots", return_value=set(occupied))
    patcher.start()
    return allocator, patcher


class ChipGroupAllocationTests(unittest.TestCase):
    def _make(self, total_slots=4, occupied=()):
        allocator, patcher = _allocator(total_slots, occupied)
        self.addCleanup(patcher.stop)
        return allocator

    def test_two_chip_mesh_takes_the_first_free_card(self):
        allocator = self._make()
        self.assertEqual(
            allocator.allocate_chip_slot("bundle", chips_required=2), 0
        )

    def test_two_chip_mesh_skips_a_partly_busy_card(self):
        # Slot 1 busy makes card [0,1] unusable, so the next aligned card wins.
        allocator = self._make(occupied=[1])
        self.assertEqual(
            allocator.allocate_chip_slot("bundle", chips_required=2), 2
        )

    def test_two_chip_mesh_is_refused_when_no_card_is_fully_free(self):
        allocator = self._make(occupied=[1, 2])
        with self.assertRaises(AllocationError):
            allocator.allocate_chip_slot("bundle", chips_required=2)

    def test_slot_group_spans_the_whole_mesh(self):
        allocator = self._make()
        self.assertEqual(allocator.slot_group(2, 2), [2, 3])
        self.assertEqual(allocator.slot_group(1, 1), [1])

    def test_catalog_four_chips_still_means_the_whole_board(self):
        # The catalog's sentinel: 4 claims every slot, even on a board with more.
        allocator = self._make(total_slots=8)
        with patch.object(ChipSlotAllocator, "_get_chips_required", return_value=4), \
             patch.object(ChipSlotAllocator, "_allocate_multi_chip", return_value=0) as whole:
            self.assertEqual(allocator.allocate_chip_slot("catalog"), 0)
        whole.assert_called_once()

    def test_an_explicit_four_chip_mesh_leaves_the_rest_of_a_larger_board_free(self):
        allocator = self._make(total_slots=8, occupied=[0])
        self.assertEqual(allocator.allocate_chip_slot("bundle", chips_required=4), 4)
        self.assertEqual(allocator.slot_group(4, 4), [4, 5, 6, 7])

    def test_a_manual_pin_must_be_aligned(self):
        allocator = self._make()
        result = allocator._validate_manual_allocation(1, 2, "bundle")
        self.assertFalse(result["valid"])
        self.assertIn("multiple of 2", result["message"])

    def test_a_manual_pin_rejects_a_busy_group(self):
        allocator = self._make(occupied=[3])
        result = allocator._validate_manual_allocation(2, 2, "bundle")
        self.assertFalse(result["valid"])
        self.assertIn("3", result["message"])

    def test_a_manual_pin_rejects_a_group_running_past_the_board(self):
        allocator = self._make(total_slots=2)
        result = allocator._validate_manual_allocation(2, 2, "bundle")
        self.assertFalse(result["valid"])

    def test_a_free_aligned_group_is_accepted(self):
        allocator = self._make(occupied=[0])
        self.assertTrue(allocator._validate_manual_allocation(2, 2, "bundle")["valid"])

    def test_single_chip_allocation_is_unchanged(self):
        allocator = self._make(occupied=[0, 1])
        self.assertEqual(allocator.allocate_chip_slot("bundle", chips_required=1), 2)


if __name__ == "__main__":
    unittest.main()
