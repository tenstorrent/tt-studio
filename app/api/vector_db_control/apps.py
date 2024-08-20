from django.apps import AppConfig

from shared_config.logger_config import get_logger
from vector_db_control.chroma import get_chroma_client

logger = get_logger(__name__)
logger.info(f"importing {__name__}")
prepopulated_db = False

class VectorDbConfig(AppConfig):
    name = 'vector_db_control'
    default_auto_field = "django.db.models.BigAutoField"

    def ready(self):
        from django.conf import settings
        from chromadb.utils import embedding_functions
        from vector_db_control.data import SAMPLE_DATA
        prepopulated_db_name = "prepopulated_db"
        chroma_db_host = settings.CHROMA_DB_HOST
        chroma_db_port = settings.CHROMA_DB_PORT
        global prepopulated_db
        if bool(settings.PREPOPULATE_VECTOR_DB) and not prepopulated_db:
            client = get_chroma_client(host=chroma_db_host, port=chroma_db_port)
            embedding_func = embedding_functions.SentenceTransformerEmbeddingFunction(
                model_name=settings.CHROMA_DB_EMBED_MODEL,
            )
            documents = SAMPLE_DATA
            ids = [str(i) for i in range(0, len(documents))]
            collection = client.get_or_create_collection(
                name=prepopulated_db_name,
                embedding_function=embedding_func,
            )
            collection.upsert(documents=documents, ids=ids, metadatas=None)
            prepopulated_db = True
