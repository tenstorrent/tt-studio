# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

from django.apps import AppConfig

from shared_config.logger_config import get_logger

logger = get_logger(__name__)
from vector_db_control.singletons import ChromaClient, get_embedding_function

# Name of the documentation collection older releases seeded at startup. The
# feature has been retired; any copy left in the persistent Chroma volume is
# dropped so it stops showing up in the collection pickers.
_RETIRED_INTERNAL_KNOWLEDGE_COLLECTION = "tenstorrent_internal_knowledge"


class VectorDbConfig(AppConfig):
    name = "vector_db_control"
    default_auto_field = "django.db.models.BigAutoField"

    def ready(self):
        from django.conf import settings
        from vector_db_control.chroma import delete_collection, list_collections

        logger.info(f"{__name__} ready.")
        # Preload the singleton to initialize the model at startup
        get_embedding_function(model_name=settings.CHROMA_DB_EMBED_MODEL)
        ChromaClient(host=settings.CHROMA_DB_HOST, port=settings.CHROMA_DB_PORT)

        try:
            if any(
                col.name == _RETIRED_INTERNAL_KNOWLEDGE_COLLECTION
                for col in list_collections()
            ):
                logger.info(
                    f"Removing retired collection {_RETIRED_INTERNAL_KNOWLEDGE_COLLECTION}"
                )
                delete_collection(_RETIRED_INTERNAL_KNOWLEDGE_COLLECTION)
        except Exception as e:
            logger.error(
                f"Error removing retired collection "
                f"{_RETIRED_INTERNAL_KNOWLEDGE_COLLECTION}: {e}",
                exc_info=True,
            )
