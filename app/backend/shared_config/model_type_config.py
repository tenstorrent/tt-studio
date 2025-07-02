from enum import Enum

class ModelTypes(Enum):
    MOCK = "mock"
    CHAT = "chat"
    OBJECT_DETECTION = "object_detection"
    IMAGE_GENERATION = "image_generation"
    SPEECH_RECOGNITION = "speech_recognition"