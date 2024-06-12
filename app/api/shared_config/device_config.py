from enum import Enum, auto


class DeviceConfigurations(Enum):
    CPU = auto()
    E150 = auto()
    N150 = auto()
    N300_2X4_MESH = auto()


def detect_available_devices():
    # TODO
    pass
