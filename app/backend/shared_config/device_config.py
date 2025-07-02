# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

from enum import Enum, auto


class DeviceConfigurations(Enum):
    """The *WH_ARCH_YAML enumerations signal to use the wormhole_b0_80_arch_eth_dispatch.yaml"""
    CPU = auto()
    E150 = auto()
    N150 = auto()
    N300 = auto()
    T3K_RING = auto()
    T3K_LINE = auto()
    N150_WH_ARCH_YAML = auto()
    N300_WH_ARCH_YAML = auto()
    N300x4 = auto()
    N300x4_WH_ARCH_YAML = auto()


def detect_available_devices():
    # TODO
    pass
