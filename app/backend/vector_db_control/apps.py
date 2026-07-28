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
        from vector_db_control.data import INTERNAL_KNOWLEDGE, knowledge_corpus_revision
        from vector_db_control.documents import chunk_texts

        logger.info(f"{__name__} ready.")
        # Preload the singleton to initialize the model at startup
        get_embedding_function(model_name=settings.CHROMA_DB_EMBED_MODEL)
        ChromaClient(host=settings.CHROMA_DB_HOST, port=settings.CHROMA_DB_PORT)

        # Create default internal knowledge collection if it doesn't exist
        try:
            collections = list_collections()
            internal_collection_name = "tenstorrent_internal_knowledge"
            revision = knowledge_corpus_revision()

            # Check if internal knowledge collection already exists
            existing_internal = next(
                (col for col in collections if col.name == internal_collection_name),
                None
            )

            # An existing collection seeded from an older corpus is stale — documents
            # added to data.py since then would never be embedded, because seeding
            # only ever ran on first creation. Compare the stored corpus revision and
            # rebuild when it has moved on.
            if existing_internal:
                stored_revision = (existing_internal.metadata or {}).get("corpus_revision")
                if stored_revision == revision:
                    logger.info(
                        f"Internal knowledge collection is up to date (revision {revision}): "
                        f"{internal_collection_name}"
                    )
                    return
                logger.info(
                    f"Internal knowledge corpus changed ({stored_revision} -> {revision}); "
                    f"rebuilding {internal_collection_name}"
                )
                # Delete through the client directly: the chroma.delete_collection
                # helper re-fetches the collection without its embedding function,
                # which is an avoidable failure mode on a rebuild path.
                ChromaClient().delete_collection(name=internal_collection_name)
                existing_internal = None

            logger.info(f"Creating default internal knowledge collection: {internal_collection_name}")

            # Create collection with special metadata to mark it as internal
            create_collection(
                collection_name=internal_collection_name,
                metadata={
                    "type": "internal_knowledge",
                    "description": "Tenstorrent internal documentation and knowledge base",
                    "created_by": "system",
                    "corpus_revision": revision,
                },
                embedding_func_name=settings.CHROMA_DB_EMBED_MODEL,
            )

            # Chunk before loading: the embedding model truncates long inputs,
            # so the large documentation corpus must be split to be searchable.
            logger.info(f"Loading internal knowledge into {internal_collection_name}")
            chunks = chunk_texts(
                INTERNAL_KNOWLEDGE,
                metadatas=[
                    {"source": "internal_knowledge", "type": "documentation"}
                    for _ in INTERNAL_KNOWLEDGE
                ],
            )
            documents = [chunk.page_content for chunk in chunks]
            ids = [f"internal_{i}" for i in range(len(documents))]
            logger.info(
                f"Chunked {len(INTERNAL_KNOWLEDGE)} documents into {len(documents)} chunks"
            )
            insert_to_chroma_collection(
                collection_name=internal_collection_name,
                documents=documents,
                ids=ids,
                metadatas=[chunk.metadata for chunk in chunks],
                embedding_func_name=settings.CHROMA_DB_EMBED_MODEL,
            )

            logger.info(
                f"Successfully created internal knowledge collection: "
                f"{internal_collection_name} (revision {revision})"
            )

        except Exception as e:
            logger.error(f"Error creating internal knowledge collection: {str(e)}", exc_info=True)
