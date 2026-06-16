# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

from enum import IntEnum, auto

class SetupTypes(IntEnum):
    NO_SETUP = auto()  # 1
    MAKE_VOLUMES = auto()  # 2
    TT_INFERENCE_SERVER = auto()  # 3
