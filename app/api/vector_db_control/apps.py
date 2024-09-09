from django.apps import AppConfig

from shared_config.logger_config import get_logger
logger = get_logger(__name__)
from vector_db_control.singletons import ChromaClient, get_embedding_function
class VectorDbConfig(AppConfig):
    name = 'vector_db_control'
    default_auto_field = "django.db.models.BigAutoField"

    def ready(self):
        from django.conf import settings
        logger.info(f"{__name__} ready.")
        # Preload the singleton to initialize the model at startup
        get_embedding_function(model_name=settings.CHROMA_DB_EMBED_MODEL)
        ChromaClient(host=settings.CHROMA_DB_HOST, port=settings.CHROMA_DB_PORT)

