# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

from enum import Enum, auto


class DeviceConfigurations(Enum):
    """The *WH_ARCH_YAML enumerations signal to use the wormhole_b0_80_arch_eth_dispatch.yaml"""
    CPU = auto()
    
    # Wormhole devices
    E150 = auto()
    N150 = auto()
    N300 = auto()
    N150_WH_ARCH_YAML = auto()
    N300_WH_ARCH_YAML = auto()
    
    # Wormhole multi-device
    N150X4 = auto()
    N300x4 = auto()
    N300x4_WH_ARCH_YAML = auto()
    T3K = auto()
    T3K_RING = auto()
    T3K_LINE = auto()
    
    # Blackhole devices
    P100 = auto()
    P150 = auto()
    P300c = auto()

    # Blackhole multi-device
    P150X4 = auto()
    P150X8 = auto()
    P300Cx2 = auto()  # 2 cards (4 chips)
    P300Cx4 = auto()  # 4 cards (8 chips)
    
    # Galaxy systems
    GALAXY = auto()
    GALAXY_T3K = auto()


def detect_available_devices():
    # TODO
    pass
