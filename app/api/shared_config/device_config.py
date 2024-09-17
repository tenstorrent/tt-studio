# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

from enum import Enum, auto


class DeviceConfigurations(Enum):
    CPU = auto()
    E150 = auto()
    N150 = auto()
    N300x4 = auto()


def detect_available_devices():
    # TODO
    pass
