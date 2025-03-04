# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

from enum import Enum

class ModelTypes(Enum):
    MOCK = "mock"
    CHAT = "chat"
    OBJECT_DETECTION = "object_detection"
    IMAGE_GENERATION = "image_generation"