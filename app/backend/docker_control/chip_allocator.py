# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

"""
Chip slot allocator for automatic device_id assignment.

Manages automatic chip slot allocation based on:
- Current deployments (from deployment_store)
- Model chip requirements (single vs multi-chip)
- Board topology
"""

import threading
from typing import Dict, List, Optional, Set

from shared_config.logger_config import get_logger
from shared_config.model_config import get_model_chip_requirement
from docker_control.deployment_store import ModelDeployment

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Exception Classes
# ---------------------------------------------------------------------------

class AllocationError(Exception):
    """Base exception for chip slot allocation errors"""
    pass


class MultiChipConflictError(AllocationError):
    """
    Exception raised when multi-chip model deployment conflicts with existing deployments.

    Attributes:
        message: Error message
        conflicts: List of conflicting deployment info dicts
    """
    def __init__(self, message: str, conflicts: List[Dict] = None):
        super().__init__(message)
        self.conflicts = conflicts or []


# ---------------------------------------------------------------------------
# Chip Slot Allocator
# ---------------------------------------------------------------------------

# Board type to slot count mapping (matching frontend MULTI_CHIP_BOARD_SLOTS)
MULTI_CHIP_BOARD_SLOTS = {
    "T3K": 4,
    "T3000": 4,
    "N150X4": 4,
    "N300x4": 4,
    "P150X4": 4,
    "P150X8": 8,
    "P300Cx2": 4,
    "P300Cx4": 8,
    "GALAXY": 32,
    "GALAXY_T3K": 32,
}


class ChipSlotAllocator:
    """
    Manages automatic chip slot allocation.

    Thread-safe allocator that determines the best chip slot for a model
    based on current deployments and chip requirements.
    """

    def __init__(self):
        """Initialize allocator with current board type and slot count"""
        self._lock = threading.Lock()
        self.board_type = self._detect_board_type()
        self.total_slots = self._get_total_slots()
        logger.info(f"ChipSlotAllocator initialized: board={self.board_type}, slots={self.total_slots}")

    def _detect_board_type(self) -> str:
        """Detect current board type"""
        from docker_control.docker_utils import detect_board_type
        return detect_board_type()

    def _get_total_slots(self) -> int:
        """Get total number of chip slots for current board"""
        # Multi-chip boards have multiple slots
        if self.board_type in MULTI_CHIP_BOARD_SLOTS:
            return MULTI_CHIP_BOARD_SLOTS[self.board_type]

        # Single-chip boards (N150, N300, E150, P100, P150, P300c) have 1 slot
        return 1

    def get_chip_status(self) -> Dict:
        """
        Returns current chip slot occupancy status.

        Returns:
            Dictionary with board_type, total_slots, and per-slot status:
            {
              "board_type": "T3K",
              "total_slots": 4,
              "slots": [
                {"slot_id": 0, "status": "occupied", "model_name": "...", "deployment_id": 123, "is_multi_chip": False},
                {"slot_id": 1, "status": "available"},
                ...
              ]
            }
        """
        active_deployments = self._get_active_deployments()
        slots_info = []
        occupied_map = {}

        # Build occupied slots map
        for deployment in active_deployments:
            model_chips = self._get_chips_required(deployment.model_name)

            if model_chips == 4:
                # Multi-chip: mark ALL slots as occupied
                for slot_id in range(min(4, self.total_slots)):  # Multi-chip models use up to 4 slots
                    occupied_map[slot_id] = {
                        "model_name": deployment.model_name,
                        "deployment_id": deployment.id,
                        "is_multi_chip": True,
                        "port": deployment.port,
                    }
            else:
                # Single-chip: mark specific slot
                if deployment.device_id < self.total_slots:
                    occupied_map[deployment.device_id] = {
                        "model_name": deployment.model_name,
                        "deployment_id": deployment.id,
                        "is_multi_chip": False,
                        "port": deployment.port,
                    }

        # Build slot status list
        for slot_id in range(self.total_slots):
            if slot_id in occupied_map:
                slots_info.append({
                    "slot_id": slot_id,
                    "status": "occupied",
                    **occupied_map[slot_id]
                })
            else:
                slots_info.append({
                    "slot_id": slot_id,
                    "status": "available"
                })

        return {
            "board_type": self.board_type,
            "total_slots": self.total_slots,
            "slots": slots_info
        }

    def allocate_chip_slot(self, model_name: str, manual_override: Optional[int] = None) -> int:
        """
        Auto-allocate chip slot or use manual override.

        Args:
            model_name: Name of the model being deployed
            manual_override: Optional manual device_id for advanced mode

        Returns:
            Allocated device_id (0-based slot number)

        Raises:
            AllocationError: If allocation fails (all slots occupied)
            MultiChipConflictError: If multi-chip model conflicts with existing deployments
        """
        with self._lock:
            chips_required = self._get_chips_required(model_name)

            # Advanced mode: manual override
            if manual_override is not None:
                validation = self._validate_manual_allocation(manual_override, chips_required, model_name)
                if not validation["valid"]:
                    raise AllocationError(validation["message"])
                logger.info(f"Manual allocation: device_id={manual_override} for {model_name}")
                return manual_override

            # Auto-allocation
            if chips_required == 4:
                device_id = self._allocate_multi_chip(model_name)
            else:
                device_id = self._allocate_single_chip(model_name)

            logger.info(f"Auto-allocated: device_id={device_id} for {model_name} ({chips_required} chips)")
            return device_id

    def _allocate_single_chip(self, model_name: str) -> int:
        """
        Find first available slot for single-chip model.

        Args:
            model_name: Name of the model

        Returns:
            Device ID of first available slot

        Raises:
            AllocationError: If all slots are occupied
        """
        occupied_slots = self._get_occupied_slots()

        for slot_id in range(self.total_slots):
            if slot_id not in occupied_slots:
                return slot_id

        raise AllocationError(
            f"All {self.total_slots} chip slots are occupied. "
            f"Stop at least one model to free up a slot."
        )

    def _allocate_multi_chip(self, model_name: str) -> int:
        """
        Validate all slots are free for multi-chip model, return 0.

        Args:
            model_name: Name of the model

        Returns:
            Device ID 0 (multi-chip models always use device_id=0)

        Raises:
            MultiChipConflictError: If any slots are occupied
        """
        occupied_slots = self._get_occupied_slots()

        if occupied_slots:
            # Build detailed conflict information
            active_deployments = self._get_active_deployments()
            conflicts = []

            for deployment in active_deployments:
                model_chips = self._get_chips_required(deployment.model_name)
                conflicts.append({
                    "model": deployment.model_name,
                    "deployment_id": deployment.id,
                    "slot": deployment.device_id,
                    "chips": model_chips
                })

            raise MultiChipConflictError(
                f"{model_name} requires all 4 chip slots. "
                f"Currently occupied: {len(occupied_slots)} slot(s). "
                f"Stop all running models first.",
                conflicts=conflicts
            )

        return 0  # Multi-chip models always use device_id=0

    def _validate_manual_allocation(self, device_id: int, chips_required: int, model_name: str) -> Dict:
        """
        Validate manual chip slot selection in advanced mode.

        Args:
            device_id: Manually selected device ID
            chips_required: Number of chips required by model
            model_name: Name of the model

        Returns:
            Dictionary with "valid" boolean and optional "message"
        """
        # Check bounds
        if device_id < 0 or device_id >= self.total_slots:
            return {
                "valid": False,
                "message": f"Invalid device_id {device_id}. Must be 0-{self.total_slots - 1}."
            }

        occupied_slots = self._get_occupied_slots()

        if chips_required == 4:
            # Multi-chip: ensure all slots are free
            if occupied_slots:
                return {
                    "valid": False,
                    "message": f"{model_name} requires all 4 chip slots. Currently occupied: {len(occupied_slots)} slot(s)."
                }
        else:
            # Single-chip: ensure selected slot is free
            if device_id in occupied_slots:
                # Find which model is using this slot
                active_deployments = self._get_active_deployments()
                occupying_model = None
                for deployment in active_deployments:
                    if deployment.device_id == device_id:
                        occupying_model = deployment.model_name
                        break
                    # Check if a multi-chip model is occupying all slots
                    model_chips = self._get_chips_required(deployment.model_name)
                    if model_chips == 4:
                        occupying_model = f"{deployment.model_name} (multi-chip)"
                        break

                return {
                    "valid": False,
                    "message": f"Chip slot {device_id} is occupied by {occupying_model or 'another model'}."
                }

        return {"valid": True}

    def _get_active_deployments(self) -> List[ModelDeployment]:
        """
        Get list of active deployments (starting or running status).

        Returns:
            List of ModelDeployment objects
        """
        return list(ModelDeployment.objects.filter(status__in=['starting', 'running']))

    def _get_occupied_slots(self) -> Set[int]:
        """
        Returns set of occupied slot IDs.

        Multi-chip deployments occupy slots 0-3.
        Single-chip deployments occupy their specific device_id slot.

        Returns:
            Set of occupied slot IDs
        """
        active = self._get_active_deployments()
        occupied = set()

        for deployment in active:
            chips = self._get_chips_required(deployment.model_name)
            if chips == 4:
                # Multi-chip: occupies all 4 slots
                occupied.update(range(min(4, self.total_slots)))
            else:
                # Single-chip: occupies specific slot
                if deployment.device_id < self.total_slots:
                    occupied.add(deployment.device_id)

        return occupied

    def _get_chips_required(self, model_name: str) -> int:
        """
        Get number of chips required for a model.

        On P300Cx2 (QB2), every deployment uses --device p300x2 which occupies
        the entire board, so always return the total slot count regardless of
        the model's own chip requirement.

        Args:
            model_name: Name of the model

        Returns:
            Number of chips required (1 or 4)
        """
        if self.board_type == "P300Cx2":
            return self.total_slots  # QB2: p300x2 always uses the whole board
        return get_model_chip_requirement(model_name)
