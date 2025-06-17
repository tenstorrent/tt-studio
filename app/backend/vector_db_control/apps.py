# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

from django.apps import AppConfig

from shared_config.logger_config import get_logger

logger = get_logger(__name__)
from vector_db_control.singletons import ChromaClient, get_embedding_function


class VectorDbConfig(AppConfig):
    name = "vector_db_control"
    default_auto_field = "django.db.models.BigAutoField"

    def ready(self):
        from django.conf import settings
        from vector_db_control.chroma import (
            list_collections,
            create_collection,
            insert_to_chroma_collection,
        )
        from vector_db_control.data import INTERNAL_KNOWLEDGE

        logger.info(f"{__name__} ready.")
        # Preload the singleton to initialize the model at startup
        get_embedding_function(model_name=settings.CHROMA_DB_EMBED_MODEL)
        ChromaClient(host=settings.CHROMA_DB_HOST, port=settings.CHROMA_DB_PORT)
        
        # Create default internal knowledge collection if it doesn't exist
        try:
            collections = list_collections()
            internal_collection_name = "tenstorrent_internal_knowledge"
            
            # Check if internal knowledge collection already exists
            existing_internal = next(
                (col for col in collections if col.name == internal_collection_name), 
                None
            )
            
            if not existing_internal:
                logger.info(f"Creating default internal knowledge collection: {internal_collection_name}")
                
                # Create collection with special metadata to mark it as internal
                collection = create_collection(
                    collection_name=internal_collection_name,
                    metadata={
                        "type": "internal_knowledge",
                        "description": "Tenstorrent internal documentation and knowledge base",
                        "created_by": "system"
                    },
                    embedding_func_name=settings.CHROMA_DB_EMBED_MODEL,
                )
                
                # Load internal knowledge into the collection
                logger.info(f"Loading internal knowledge into {internal_collection_name}")
                ids = [f"internal_{i}" for i in range(len(INTERNAL_KNOWLEDGE))]
                insert_to_chroma_collection(
                    collection_name=internal_collection_name,
                    documents=INTERNAL_KNOWLEDGE,
                    ids=ids,
                    metadatas=[
                        {"source": "internal_knowledge", "type": "documentation"} 
                        for _ in INTERNAL_KNOWLEDGE
                    ],
                    embedding_func_name=settings.CHROMA_DB_EMBED_MODEL,
                )
                
                logger.info(f"Successfully created internal knowledge collection: {internal_collection_name}")
            else:
                logger.info(f"Internal knowledge collection already exists: {internal_collection_name}")
                
        except Exception as e:
            logger.error(f"Error creating internal knowledge collection: {str(e)}", exc_info=True)
