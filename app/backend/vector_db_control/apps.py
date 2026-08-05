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
            get_collection,
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
            # refresh when it has moved on.
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
                    f"refreshing {internal_collection_name} in place"
                )
            else:
                logger.info(f"Creating default internal knowledge collection: {internal_collection_name}")

                # corpus_revision is stamped only once the documents are in (below),
                # so an interrupted seed is retried on the next start rather than
                # being mistaken for a complete one.
                create_collection(
                    collection_name=internal_collection_name,
                    metadata={
                        "type": "internal_knowledge",
                        "description": "Tenstorrent internal documentation and knowledge base",
                        "created_by": "system",
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
            # Upsert rather than clear-then-load: the previous corpus stays
            # searchable until each chunk is overwritten, so a failure part-way
            # through leaves a usable collection instead of an empty one.
            insert_to_chroma_collection(
                collection_name=internal_collection_name,
                documents=documents,
                ids=ids,
                metadatas=[chunk.metadata for chunk in chunks],
                embedding_func_name=settings.CHROMA_DB_EMBED_MODEL,
                upsert=True,
            )

            collection = get_collection(
                collection_name=internal_collection_name,
                embedding_func_name=settings.CHROMA_DB_EMBED_MODEL,
            )

            # Drop chunks left behind by a longer previous corpus. Only our own
            # internal_* ids are considered, so uploaded documents are untouched.
            new_ids = set(ids)
            stale_ids = [
                doc_id
                for doc_id in collection.get(include=[])["ids"]
                if doc_id.startswith("internal_") and doc_id not in new_ids
            ]
            if stale_ids:
                logger.info(f"Removing {len(stale_ids)} chunks from the previous corpus")
                collection.delete(ids=stale_ids)

            # Stamp the revision last — while it differs, the next start retries.
            # hnsw:* keys are dropped: Chroma rejects a modify that echoes them back
            # as an attempt to change the distance function.
            metadata = {
                key: value
                for key, value in (collection.metadata or {}).items()
                if not key.startswith("hnsw:")
            }
            metadata["corpus_revision"] = revision
            collection.modify(metadata=metadata)

            logger.info(
                f"Successfully loaded internal knowledge collection: "
                f"{internal_collection_name} (revision {revision})"
            )

        except Exception as e:
            logger.error(f"Error creating internal knowledge collection: {str(e)}", exc_info=True)
