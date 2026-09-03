# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import os
import uuid
import json
from typing import List
from datetime import datetime
from shared_config.logger_config import get_logger
import pypdf
from chromadb.types import Collection
from django.conf import settings
from rest_framework import status
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response
from rest_framework.viewsets import ViewSet

from vector_db_control.chroma import (
    list_collections,
    create_collection,
    get_collection,
    query_collection,
    insert_to_chroma_collection,
    serialize_collection,
    delete_collection,
)
from vector_db_control.singletons import ChromaClient
from vector_db_control.documents import chunk_document, deterministic_chunk_id
from vector_db_control.retrieval import approx_token_count, retrieve
from vector_db_control.rewrite import maybe_rewrite_query

logger = get_logger(__name__)
logger.info(f"importing {__name__}")

# Shared collection holding the Tenstorrent documentation corpus. It is populated
# once at startup (see apps.py) and merged into per-collection query results so the
# corpus does not need to be re-embedded into every user collection.
INTERNAL_KNOWLEDGE_COLLECTION = "tenstorrent_internal_knowledge"


def _resolve_max_distance(request):
    """Resolve the effective cosine-distance ceiling for a query.

    A ``max_distance`` query param overrides the ``RAG_RELEVANCE_THRESHOLD`` setting;
    when neither is provided the result is ``None`` (no filtering). Raises ``ValueError``
    if the param is present but not a valid float.
    """
    raw = request.GET.get("max_distance")
    if raw is not None and raw != "":
        return float(raw)
    return settings.RAG_RELEVANCE_THRESHOLD


def _parse_where(request):
    """Parse the optional ``where`` metadata filter from a query param.

    Returns a dict (Chroma metadata filter) or ``None``. Raises ``ValueError`` if the
    param is present but is not a JSON object.
    """
    raw = request.GET.get("where")
    if not raw:
        return None
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise ValueError("`where` must be a JSON object")
    return parsed


def _filter_results_by_distance(results, max_distance):
    """Drop entries from a single-query Chroma result whose distance exceeds the ceiling."""
    if max_distance is None or not results or not results.get("documents"):
        return results
    documents = results["documents"][0]
    ids = results["ids"][0]
    metadatas = results["metadatas"][0] if results.get("metadatas") else [None] * len(documents)
    distances = results["distances"][0] if results.get("distances") else [None] * len(documents)
    kept = [
        i
        for i in range(len(documents))
        if distances[i] is not None and distances[i] <= max_distance
    ]
    return {
        "ids": [[ids[i] for i in kept]],
        "documents": [[documents[i] for i in kept]],
        "metadatas": [[metadatas[i] for i in kept]],
        "distances": [[distances[i] for i in kept]],
    }


def _merge_query_results(primary, secondary, limit):
    """Merge two Chroma query result dicts (single query), primary results first.

    The primary collection is the one the caller explicitly queried, so its matches
    take the available slots first; secondary (shared internal knowledge) results only
    fill whatever capacity remains, closest first. Merging purely by distance instead
    would let the large documentation corpus crowd the user's own documents out of the
    response entirely.

    Preserves Chroma's ``{ids, documents, metadatas, distances}`` shape with one inner
    list per query so the response contract is unchanged.
    """
    def _entries(result):
        if not result or not result.get("documents") or not result["documents"][0]:
            return []
        documents = result["documents"][0]
        ids = result["ids"][0]
        metadatas = result["metadatas"][0] if result.get("metadatas") else [None] * len(documents)
        distances = result["distances"][0] if result.get("distances") else [None] * len(documents)
        return [
            (distances[i], ids[i], documents[i], metadatas[i])
            for i in range(len(documents))
        ]

    combined = _entries(primary)[:limit]
    remaining = limit - len(combined)
    if remaining > 0:
        secondary_entries = _entries(secondary)
        secondary_entries.sort(key=lambda item: item[0] if item[0] is not None else float("inf"))
        combined.extend(secondary_entries[:remaining])

    return {
        "ids": [[item[1] for item in combined]],
        "documents": [[item[2] for item in combined]],
        "metadatas": [[item[3] for item in combined]],
        "distances": [[item[0] for item in combined]],
    }

class VectorCollectionsAPIView(ViewSet):
    EMBED_MODEL = None
    chromadb_client = None
    query_results_limit = 10

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        if hasattr(settings, "CHROMA_DB_EMBED_MODEL"):
            self.EMBED_MODEL = settings.CHROMA_DB_EMBED_MODEL
            
    def get_user_identifier(self, request):
        """Get a unique identifier for the current user/session"""
        # Check if user is authenticated (with proper None check)
        if hasattr(request, 'user') and request.user is not None and request.user.is_authenticated:
            logger.info(f"Using authenticated user ID: {request.user.id}")
            return f"user_{request.user.id}"
        
        # Check for browser ID in header
        browser_id = request.headers.get('X-Browser-ID')
        logger.info(f"Browser ID from headers: {browser_id}")
        if not browser_id:
            browser_id = str(uuid.uuid4())
            logger.info(f"Generated new browser ID: {browser_id}")
        
        return f"session_{browser_id}"

    def list(self, request):
        logger.info(f"List collections request received. Headers: {request.headers}")
        collections: List[Collection] = list_collections()
        user_id = self.get_user_identifier(request)
        logger.info(f"User identifier for list: {user_id}")
        logger.info(f"Total collections before filtering: {len(collections)}")
        
        # Filter collections by user identifier
        filtered_collections = [
            col for col in collections 
            if not col.metadata or not col.metadata.get('user_id') or col.metadata.get('user_id') == user_id
        ]
        
        logger.info(f"Filtered collections: {len(filtered_collections)}")
        for col in filtered_collections:
            logger.info(f"Collection: {col.name}, Metadata: {col.metadata}")
        
        # Serialize collections and add fallback for missing document names
        serialized_collections = []
        for collection in filtered_collections:
            serialized_collection = serialize_collection(collection)
            
            # If last_uploaded_document is missing from collection metadata, 
            # try to get it from the individual document chunks as a fallback
            if not serialized_collection.get('metadata', {}).get('last_uploaded_document'):
                try:
                    results = collection.get(include=["metadatas"])
                    if results and results.get("metadatas"):
                        # Find the most recent document based on upload_date
                        latest_document = None
                        latest_date = None
                        
                        for metadata in results["metadatas"]:
                            if metadata and metadata.get("source") and metadata.get("source") != "internal_knowledge":
                                upload_date = metadata.get("upload_date")
                                if upload_date and (not latest_date or upload_date > latest_date):
                                    latest_date = upload_date
                                    latest_document = metadata.get("source")
                        
                        # Update the serialized collection with the fallback document name
                        if latest_document:
                            if 'metadata' not in serialized_collection:
                                serialized_collection['metadata'] = {}
                            serialized_collection['metadata']['last_uploaded_document'] = latest_document
                            logger.info(f"Fallback: Found document name '{latest_document}' for collection {collection.name}")
                except Exception as e:
                    logger.error(f"Error getting fallback document name for collection {collection.name}: {str(e)}")
            
            serialized_collections.append(serialized_collection)
        
        return Response(data=serialized_collections)

    def post(self, request):
        logger.info(f"Post request received. Headers: {request.headers}")
        logger.info(f"Request data: {request.data}")
        
        try:
            name = request.data["name"]
            metadata = request.data.get("metadata", dict())
            logger.info(f"Creating collection {name} with metadata {metadata}")
            
            # Add user identifier to collection metadata
            user_id = self.get_user_identifier(request)
            logger.info(f"User identifier for post: {user_id}")
            
            # Check if collection with this name already exists
            collections: List[Collection] = list_collections()
            existing_collection = next((col for col in collections if col.name == name), None)
            
            if existing_collection:
                logger.warning(f"Collection with name {name} already exists")
                # Check if the collection is owned by the current user
                if existing_collection.metadata and existing_collection.metadata.get('user_id') == user_id:
                    return Response(
                        status=status.HTTP_400_BAD_REQUEST,
                        data={"error": f"A collection with name '{name}' already exists and is owned by you."}
                    )
                else:
                    return Response(
                        status=status.HTTP_400_BAD_REQUEST,
                        data={"error": f"A collection with name '{name}' already exists and is owned by another user."}
                    )
            
            metadata.update({"user_id": user_id})
            
            logger.info(f"Final metadata for creation: {metadata}")
            
            # Debug the EMBED_MODEL
            logger.info(f"Using EMBED_MODEL: {self.EMBED_MODEL}")
            
            collection = create_collection(
                collection_name=name,
                metadata=metadata,
                embedding_func_name=self.EMBED_MODEL,
            )

            # Internal knowledge lives once in the shared INTERNAL_KNOWLEDGE_COLLECTION
            # and is merged in at query time, so we no longer re-embed the whole corpus
            # into every new collection.
            logger.info(f"Collection created successfully: {collection.name}")
            serialized = serialize_collection(collection)
            logger.info(f"Serialized response: {serialized}")
            
            return Response(data=serialized)
        except Exception as e:
            logger.error(f"Error creating collection: {str(e)}", exc_info=True)
            return Response(
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                data={"error": f"Failed to create collection: {str(e)}"}
            )

    def retrieve(self, request, pk=None):
        logger.info(f"Retrieve request for collection: {pk}")
        if not pk:
            return self.list(request)
            
        collection = get_collection(
            collection_name=pk, embedding_func_name=self.EMBED_MODEL
        )
        
        # Check if user has access to this collection
        user_id = self.get_user_identifier(request)
        if collection.metadata and collection.metadata.get('user_id') and collection.metadata.get('user_id') != user_id:
            logger.warning(f"User {user_id} attempted to access collection {pk} owned by {collection.metadata.get('user_id')}")
            return Response(
                status=status.HTTP_403_FORBIDDEN,
                data={"error": "You don't have access to this collection"}
            )
        
        serialized_collection = serialize_collection(collection)
        
        # If last_uploaded_document is missing from collection metadata, 
        # try to get it from the individual document chunks as a fallback
        if not serialized_collection.get('metadata', {}).get('last_uploaded_document'):
            try:
                results = collection.get(include=["metadatas"])
                if results and results.get("metadatas"):
                    # Find the most recent document based on upload_date
                    latest_document = None
                    latest_date = None
                    
                    for metadata in results["metadatas"]:
                        if metadata and metadata.get("source") and metadata.get("source") != "internal_knowledge":
                            upload_date = metadata.get("upload_date")
                            if upload_date and (not latest_date or upload_date > latest_date):
                                latest_date = upload_date
                                latest_document = metadata.get("source")
                    
                    # Update the serialized collection with the fallback document name
                    if latest_document:
                        if 'metadata' not in serialized_collection:
                            serialized_collection['metadata'] = {}
                        serialized_collection['metadata']['last_uploaded_document'] = latest_document
                        logger.info(f"Fallback: Found document name '{latest_document}' for collection {pk}")
            except Exception as e:
                logger.error(f"Error getting fallback document name for collection {pk}: {str(e)}")
            
        return Response(data=serialized_collection)

    @action(methods=["DELETE"], detail=True)
    def delete(self, request, pk=None):
        logger.info(f"###Delete request for collection: {pk}")
        if not pk:
            return Response(
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                data={"error": "No collection name provided"},
            )
            
        # Check if user has access to this collection
        collection = get_collection(
            collection_name=pk, embedding_func_name=self.EMBED_MODEL
        )
        user_id = self.get_user_identifier(request)
        if collection.metadata and collection.metadata.get('user_id') and collection.metadata.get('user_id') != user_id:
            logger.warning(f"User {user_id} attempted to delete collection {pk} owned by {collection.metadata.get('user_id')}")
            return Response(
                status=status.HTTP_403_FORBIDDEN,
                data={"error": "You don't have access to this collection"}
            )
            
        delete_collection(collection_name=pk)
        logger.info(f"Collection {pk} deleted successfully")
        return Response(status=200)

    @action(methods=["POST"], detail=True)
    def insert_document(self, request, pk=None):
        logger.info(f"Insert document request for collection: {pk}")
        # Check if user has access to this collection
        collection = get_collection(
            collection_name=pk, embedding_func_name=self.EMBED_MODEL
        )
        user_id = self.get_user_identifier(request)
        if collection.metadata and collection.metadata.get('user_id') and collection.metadata.get('user_id') != user_id:
            logger.warning(f"User {user_id} attempted to insert document to collection {pk} owned by {collection.metadata.get('user_id')}")
            return Response(
                status=status.HTTP_403_FORBIDDEN,
                data={"error": "You don't have access to this collection"}
            )

        if "document" not in request.FILES:
            return Response(
                status=status.HTTP_400_BAD_REQUEST,
                data={"error": "No document provided"},
            )

        document = request.FILES["document"]
        
        # Create a temporary file to store the uploaded document
        temp_dir = os.path.join(settings.MEDIA_ROOT, 'temp')
        os.makedirs(temp_dir, exist_ok=True)
        
        # Sanitize filename to prevent directory traversal
        filename = os.path.basename(document.name)
        temp_file_path = os.path.join(temp_dir, filename)

        with open(temp_file_path, 'wb+') as temp_file:
            for chunk in document.chunks():
                temp_file.write(chunk)
        
        try:
            # Get file extension and determine folder type
            file_extension = os.path.splitext(document.name)[1].lower()
            filename = document.name
            
            # Organize by file type into virtual folders
            if file_extension in ['.pdf']:
                folder_type = "pdf"
                folder_path = f"pdf/{filename}"
            elif file_extension in ['.doc', '.docx']:
                folder_type = "docs"
                folder_path = f"docs/{filename}"
            elif file_extension in ['.txt', '.log', '.json', '.csv', '.xml', '.yaml', '.yml']:
                # Plain-text formats handled by DocumentProcessor.process_text
                folder_type = "text"
                folder_path = f"text/{filename}"
            elif file_extension in ['.ppt', '.pptx']:
                folder_type = "presentations"
                folder_path = f"presentations/{filename}"
            elif file_extension in ['.xls', '.xlsx']:
                folder_type = "spreadsheets"
                folder_path = f"spreadsheets/{filename}"
            else:
                folder_type = "other"
                folder_path = f"other/{filename}"
            
            # Enhanced metadata with folder structure
            upload_timestamp = datetime.now().isoformat()
            # Ensure filename is never empty, default to "Untitled" if missing
            if not filename or filename.strip() == "":
                filename = "Untitled"
                logger.warning(f"Document filename was empty, defaulting to 'Untitled'")
            
            base_metadata = {
                "source": filename,
                "folder_type": folder_type,
                "folder_path": folder_path,
                "file_extension": file_extension,
                "display_path": folder_path,  # This will be shown in the UI
                "upload_date": upload_timestamp
            }
            
            chunked_document = chunk_document(file_path=temp_file_path, metadata=base_metadata)
            if not chunked_document:
                raise ValueError(
                    f"No extractable text found in '{filename}'. "
                    "Scanned documents or image-only files are not supported."
                )

            documents = [d.page_content for d in chunked_document]
            
            # Update each chunk's metadata to include the folder structure
            metadatas = []
            for d in chunked_document:
                chunk_metadata = d.metadata.copy()
                chunk_metadata.update(base_metadata)
                metadatas.append(chunk_metadata)
            
            # Deterministic ids: re-uploading the same file upserts over its own
            # chunks instead of duplicating them.
            ids = [deterministic_chunk_id(filename, i) for i in range(len(documents))]
            insert_to_chroma_collection(
                collection_name=pk,
                documents=documents,
                ids=ids,
                metadatas=metadatas,
                embedding_func_name=self.EMBED_MODEL,
                upsert=True,
            )

            # Sweep chunks of this file that the new upload no longer covers
            # (shorter re-upload, or legacy random-id chunks). Upsert-then-sweep
            # keeps the collection valid even if the request dies mid-way.
            try:
                collection = get_collection(
                    collection_name=pk, embedding_func_name=self.EMBED_MODEL
                )
                existing = collection.get(where={"source": filename}, include=[])
                ids_set = set(ids)
                stale = [i for i in existing.get("ids", []) if i not in ids_set]
                if stale:
                    collection.delete(ids=stale)
                    logger.info(
                        f"Removed {len(stale)} stale chunks of '{filename}' from {pk}"
                    )
            except Exception as e:
                logger.warning(f"Stale-chunk sweep failed for '{filename}' in {pk}: {e}")

            # Update collection metadata with the last uploaded document
            metadata_update_success = False
            try:
                # Get the collection and update its metadata
                collection = get_collection(
                    collection_name=pk, embedding_func_name=self.EMBED_MODEL
                )
                
                # Update the collection metadata to include the last uploaded document
                updated_metadata = collection.metadata.copy() if collection.metadata else {}
                updated_metadata['last_uploaded_document'] = filename
                
                logger.info(f"Attempting to update collection {pk} metadata: {updated_metadata}")
                
                # Modify the collection with updated metadata
                chroma_client = ChromaClient()
                chroma_client.modify_collection(
                    name=pk,
                    metadata=updated_metadata
                )
                
                # Verify the metadata was updated by re-fetching the collection
                updated_collection = get_collection(
                    collection_name=pk, embedding_func_name=self.EMBED_MODEL
                )
                
                if updated_collection.metadata and updated_collection.metadata.get('last_uploaded_document') == filename:
                    metadata_update_success = True
                    logger.info(f"Successfully updated collection {pk} metadata with last_uploaded_document: {filename}")
                else:
                    logger.warning(f"Metadata update for collection {pk} may not have persisted correctly")
                    # Try alternative approach: Get the collection directly and check if modify_collection worked
                    try:
                        logger.info(f"Alternative check: Current collection metadata: {updated_collection.metadata}")
                        # Force a small delay to ensure consistency
                        import time
                        time.sleep(0.1)
                        
                        # Try one more verification
                        final_collection = get_collection(
                            collection_name=pk, embedding_func_name=self.EMBED_MODEL
                        )
                        if final_collection.metadata and final_collection.metadata.get('last_uploaded_document') == filename:
                            metadata_update_success = True
                            logger.info(f"Metadata update verified on second check for {pk}")
                    except Exception as alt_e:
                        logger.error(f"Alternative metadata check failed: {str(alt_e)}")
                    
            except Exception as e:
                logger.error(f"Error updating collection metadata for {pk}: {str(e)}", exc_info=True)
                # Don't fail the entire operation if metadata update fails, but log it properly
                metadata_update_success = False
            
            # Return information about the uploaded document
            upload_info = {
                "status": "success",
                "message": f"Document '{filename}' uploaded successfully",
                "document": {
                    "filename": filename,
                    "folder_type": folder_type,
                    "folder_path": folder_path,
                    "file_extension": file_extension,
                    "display_path": folder_path,
                    "chunks_count": len(documents),
                },
                "collection": pk,
                "metadata_updated": metadata_update_success
            }
            
            # Add current collection metadata to response for debugging
            try:
                current_collection = get_collection(
                    collection_name=pk, embedding_func_name=self.EMBED_MODEL
                )
                upload_info["collection_metadata"] = current_collection.metadata
            except Exception as meta_e:
                logger.error(f"Error fetching collection metadata for response: {str(meta_e)}")
                upload_info["collection_metadata"] = None
            
            if not metadata_update_success:
                upload_info["warning"] = "Document uploaded successfully but collection metadata may not have been updated. File name might not display correctly in the UI."
            
            logger.info(f"Document upload successful: {upload_info}")
            return Response(data=upload_info, status=status.HTTP_200_OK)
        except ValueError as e: # Unsupported file type
            return Response(
                status=status.HTTP_400_BAD_REQUEST,
                data={"error": str(e)},
            )
        except Exception as e:
            logger.error(f"Error processing document: {str(e)}", exc_info=True)
            return Response(
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                data={"error": f"Failed to process document: {str(e)}"}
            )
        finally:
            # Clean up the temporary file
            if os.path.exists(temp_file_path):
                os.remove(temp_file_path)

    @action(methods=["GET"], detail=True, url_path="query")
    def query(self, request, pk=None):
        logger.info(f"Query request for collection: {pk}")
        if not pk:
            return Response(
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                data={"error": "No collection name provided"},
            )

        # Check if user has access to this collection
        collection = get_collection(
            collection_name=pk, embedding_func_name=self.EMBED_MODEL
        )
        user_id = self.get_user_identifier(request)
        if collection.metadata and collection.metadata.get('user_id') and collection.metadata.get('user_id') != user_id:
            logger.warning(f"User {user_id} attempted to query collection {pk} owned by {collection.metadata.get('user_id')}")
            return Response(
                status=status.HTTP_403_FORBIDDEN,
                data={"error": "You don't have access to this collection"}
            )

        query_text = request.GET.get("query_text")
        logger.info(f"Query text: {query_text}")
        if not query_text:
            return Response(
                status=status.HTTP_400_BAD_REQUEST,
                data={"error": "No query text provided"},
            )

        try:
            where = _parse_where(request)
            max_distance = _resolve_max_distance(request)
        except ValueError as e:
            return Response(
                status=status.HTTP_400_BAD_REQUEST,
                data={"error": f"Invalid query filter: {str(e)}"},
            )

        results = query_collection(
            collection_name=pk,
            query_texts=[query_text],
            n_results=self.query_results_limit,
            embedding_func_name=self.EMBED_MODEL,
            where=where,
        )

        # Backfill leftover result slots from the shared Tenstorrent knowledge so
        # single-collection queries can still surface documentation, without copying the
        # corpus into every collection. The queried collection's own matches always take
        # priority (see _merge_query_results). Skip the merge when a metadata filter is
        # set — the caller is scoping to their own chunks.
        if pk != INTERNAL_KNOWLEDGE_COLLECTION and not where:
            try:
                internal_results = query_collection(
                    collection_name=INTERNAL_KNOWLEDGE_COLLECTION,
                    query_texts=[query_text],
                    n_results=self.query_results_limit,
                    embedding_func_name=self.EMBED_MODEL,
                )
                results = _merge_query_results(results, internal_results, self.query_results_limit)
            except Exception as e:
                logger.error(f"Error merging internal knowledge into query for {pk}: {e}")

        results = _filter_results_by_distance(results, max_distance)

        return Response(results)

    @action(methods=["GET"], detail=False, url_path="query-all")
    def query_all_collections(self, request):
        logger.info("Query all collections request received")
        query_text = request.GET.get("query_text")
        if not query_text:
            return Response(
                status=status.HTTP_400_BAD_REQUEST,
                data={"error": "No query text provided"},
            )

        try:
            where = _parse_where(request)
            max_distance = _resolve_max_distance(request)
        except ValueError as e:
            return Response(
                status=status.HTTP_400_BAD_REQUEST,
                data={"error": f"Invalid query filter: {str(e)}"},
            )

        # Get all collections the user has access to
        all_collections: List[Collection] = list_collections()
        user_id = self.get_user_identifier(request)
        user_collections = [
            col for col in all_collections 
            if not col.metadata or not col.metadata.get('user_id') or col.metadata.get('user_id') == user_id
        ]
        
        if not user_collections:
            return Response(
                status=status.HTTP_404_NOT_FOUND,
                data={"error": "No collections found for this user."}
            )

        logger.info(f"Querying across {len(user_collections)} collections for user {user_id}")
        
        all_results = {"results": []}
        for collection in user_collections:
            logger.info(f"Querying collection: {collection.name}")
            try:
                results = query_collection(
                    collection_name=collection.name,
                    query_texts=[query_text],
                    n_results=self.query_results_limit,
                    embedding_func_name=self.EMBED_MODEL,
                    where=where,
                )
                if results and results.get("documents"):
                    # Add collection name to each result for context
                    serialized_collection = serialize_collection(collection)
                    for i in range(len(results["documents"][0])):
                        result_item = {
                            "collection": serialized_collection,
                            "document": results["documents"][0][i],
                            "metadata": results["metadatas"][0][i] if results["metadatas"] else None,
                            "distance": results["distances"][0][i] if results["distances"] else None,
                        }
                        all_results["results"].append(result_item)
            except Exception as e:
                logger.error(f"Error querying collection {collection.name}: {e}")
                # Optionally skip problematic collections
                continue

        # Drop results below the relevance threshold, if one is in effect.
        if max_distance is not None:
            all_results["results"] = [
                r for r in all_results["results"]
                if r["distance"] is not None and r["distance"] <= max_distance
            ]

        # Sort all aggregated results by distance (ascending)
        all_results["results"].sort(key=lambda x: x["distance"] if x["distance"] is not None else float('inf'))

        # Limit the final results to the top N
        limit = int(request.GET.get("limit", 10))
        all_results["results"] = all_results["results"][:limit]

        return Response(all_results)

    # Named retrieve_documents because ViewSet.retrieve above is the GET-detail
    # handler; the URL is still POST /collections/retrieve.
    @action(methods=["POST"], detail=False, url_path="retrieve", url_name="retrieve-documents")
    def retrieve_documents(self, request):
        """Server-side RAG pipeline: rewrite -> dense + BM25 -> RRF -> rerank ->
        parent expansion -> relevance threshold -> token budget."""
        import time as _time

        started = _time.monotonic()
        data = request.data if isinstance(request.data, dict) else {}
        query_text = data.get("query_text")
        if not query_text or not str(query_text).strip():
            return Response(
                status=status.HTTP_400_BAD_REQUEST,
                data={"error": "No query text provided"},
            )
        query_text = str(query_text)

        collection_name = data.get("collection")
        if collection_name == "special-all":
            collection_name = None
        where = data.get("where")
        if where is not None and not isinstance(where, dict):
            return Response(
                status=status.HTTP_400_BAD_REQUEST,
                data={"error": "`where` must be a JSON object"},
            )
        try:
            max_distance = (
                float(data["max_distance"])
                if data.get("max_distance") not in (None, "")
                else settings.RAG_RELEVANCE_THRESHOLD
            )
            top_k = min(20, max(1, int(data.get("top_k") or 5)))
        except (TypeError, ValueError) as e:
            return Response(
                status=status.HTTP_400_BAD_REQUEST,
                data={"error": f"Invalid parameter: {e}"},
            )
        disable_raw = data.get("disable_stages")
        if disable_raw is None:
            disable_stages = ()
        elif isinstance(disable_raw, list):
            disable_stages = tuple(s for s in disable_raw if isinstance(s, str))
        else:
            return Response(
                status=status.HTTP_400_BAD_REQUEST,
                data={"error": "`disable_stages` must be a JSON array of strings"},
            )

        rerank_raw = data.get("rerank", settings.RAG_RERANK_ENABLED)
        use_rerank = (
            rerank_raw
            if isinstance(rerank_raw, bool)
            else str(rerank_raw).strip().lower() not in ("0", "false", "no", "")
        )

        user_id = self.get_user_identifier(request)
        if collection_name:
            # Single-collection mode: same ownership rules as /query.
            try:
                collection = get_collection(
                    collection_name=collection_name, embedding_func_name=self.EMBED_MODEL
                )
            except Exception:
                return Response(
                    status=status.HTTP_404_NOT_FOUND,
                    data={"error": f"Collection {collection_name} not found"},
                )
            owner = (collection.metadata or {}).get("user_id")
            if owner and owner != user_id:
                return Response(
                    status=status.HTTP_403_FORBIDDEN,
                    data={"error": "You don't have access to this collection"},
                )
            targets = [collection_name]
            # Merge in the shared corpus unless the caller scopes with a filter,
            # mirroring the /query behavior.
            if collection_name != INTERNAL_KNOWLEDGE_COLLECTION and not where:
                targets.append(INTERNAL_KNOWLEDGE_COLLECTION)
            mode = "single"
        else:
            all_collections: List[Collection] = list_collections()
            targets = [
                col.name
                for col in all_collections
                if not col.metadata
                or not col.metadata.get("user_id")
                or col.metadata.get("user_id") == user_id
            ]
            if not targets:
                return Response(
                    status=status.HTTP_404_NOT_FOUND,
                    data={"error": "No collections found for this user."},
                )
            mode = "all"

        history = data.get("chat_history")
        effective_query, rewritten = (
            maybe_rewrite_query(query_text, history)
            if "rewrite" not in disable_stages
            else (query_text, False)
        )

        result = retrieve(
            effective_query,
            targets,
            self.EMBED_MODEL,
            top_k=top_k,
            max_distance=max_distance,
            where=where,
            token_budget=settings.RAG_CONTEXT_TOKEN_BUDGET,
            use_rerank=use_rerank,
            rerank_min_score=settings.RAG_RERANK_MIN_SCORE,
            rerank_floor=settings.RAG_RERANK_FLOOR,
            disable_stages=disable_stages,
        )
        chunks = result["chunks"]
        if not chunks and result["collection_errors"] and len(
            result["collection_errors"]
        ) == len(targets):
            return Response(
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
                data={
                    "error": "Vector database unavailable",
                    "details": result["collection_errors"],
                },
            )

        documents = [
            f"[From {c.collection}]"
            + (f" {c.source}" if c.source else "")
            + f"\n{c.text}"
            for c in chunks
        ]
        return Response(
            {
                "documents": documents,
                "results": [
                    {
                        "id": c.id,
                        "text": c.text,
                        "collection": c.collection,
                        "source": c.source,
                        "score": c.final_score,
                        "distance": c.distance,
                        "metadata": c.metadata,
                        "signals": {
                            "dense_rank": c.dense_rank,
                            "lexical_rank": c.lexical_rank,
                            "rrf_score": c.rrf_score,
                            "rerank_score": c.rerank_score,
                        },
                    }
                    for c in chunks
                ],
                "query": {
                    "original": query_text,
                    "effective": effective_query,
                    "rewritten": rewritten,
                },
                "meta": {
                    "reranker_used": result["reranker_used"],
                    "mode": mode,
                    "collections_searched": targets,
                    "collection_errors": result["collection_errors"],
                    "token_budget": settings.RAG_CONTEXT_TOKEN_BUDGET,
                    "approx_context_tokens": sum(
                        approx_token_count(c.text) for c in chunks
                    ),
                    "latency_ms": round((_time.monotonic() - started) * 1000),
                },
            }
        )

    @action(methods=["GET"], detail=True, url_path="debug")
    def debug_collection(self, request, pk=None):
        """Debug endpoint to check collection contents"""
        logger.info(f"Debug request for collection: {pk}")
        if not pk:
            return Response(
                status=status.HTTP_400_BAD_REQUEST,
                data={"error": "No collection name provided"},
            )

        try:
            collection = get_collection(
                collection_name=pk, embedding_func_name=self.EMBED_MODEL
            )
            
            # Get all documents from the collection
            results = collection.get(
                include=["metadatas", "documents", "embeddings"]
            )
            
            debug_info = {
                "collection_name": pk,
                "total_documents": len(results.get("documents", [])) if results else 0,
                "embedding_model": self.EMBED_MODEL,
                "sample_documents": results.get("documents", [])[:3] if results else [],  # First 3 docs
                "sample_metadatas": results.get("metadatas", [])[:3] if results else [],  # First 3 metadatas
                "has_embeddings": bool(results.get("embeddings")) if results else False,
            }
            
            return Response(debug_info)
            
        except Exception as e:
            logger.error(f"Error debugging collection {pk}: {str(e)}", exc_info=True)
            return Response(
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                data={"error": f"Failed to debug collection: {str(e)}"}
            )

    @action(methods=["GET"], detail=True, url_path="documents")
    def list_documents(self, request, pk=None):
        """List all uploaded documents in a collection"""
        logger.info(f"List documents request for collection: {pk}")
        if not pk:
            return Response(
                status=status.HTTP_400_BAD_REQUEST,
                data={"error": "No collection name provided"},
            )

        # Check if user has access to this collection
        collection = get_collection(
            collection_name=pk, embedding_func_name=self.EMBED_MODEL
        )
        user_id = self.get_user_identifier(request)
        if collection.metadata and collection.metadata.get('user_id') and collection.metadata.get('user_id') != user_id:
            logger.warning(f"User {user_id} attempted to list documents in collection {pk} owned by {collection.metadata.get('user_id')}")
            return Response(
                status=status.HTTP_403_FORBIDDEN,
                data={"error": "You don't have access to this collection"}
            )

        try:
            # Get all documents from the collection
            results = collection.get(
                include=["metadatas", "documents"]
            )
            
            # Group documents by their source file
            documents_by_file = {}
            
            if results and results.get("metadatas"):
                for i, metadata in enumerate(results["metadatas"]):
                    if metadata and metadata.get("source") and metadata.get("source") != "internal_knowledge":
                        source = metadata.get("source")
                        folder_path = metadata.get("folder_path", source)
                        folder_type = metadata.get("folder_type", "other")
                        file_extension = metadata.get("file_extension", "")
                        
                        if source not in documents_by_file:
                            documents_by_file[source] = {
                                "filename": source,
                                "folder_type": folder_type,
                                "folder_path": folder_path,
                                "file_extension": file_extension,
                                "display_path": folder_path,
                                "chunks_count": 0,
                                "upload_date": metadata.get("upload_date", "Unknown")
                            }
                        
                        documents_by_file[source]["chunks_count"] += 1
            
            # Convert to list and sort by upload date or filename
            uploaded_documents = list(documents_by_file.values())
            uploaded_documents.sort(key=lambda x: x["filename"])
            
            return Response({
                "collection": pk,
                "documents": uploaded_documents,
                "total_files": len(uploaded_documents)
            })
            
        except Exception as e:
            logger.error(f"Error listing documents in collection {pk}: {str(e)}", exc_info=True)
            return Response(
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                data={"error": f"Failed to list documents: {str(e)}"}
            )


@api_view(['POST'])
def rag_admin_authenticate(request):
    """
    Dummy endpoint for admin authentication.
    In a real scenario, this would involve a proper authentication mechanism.
    """
    logger.info("RAG Admin authentication request")
    password = request.data.get("password")
    
    # Allow authentication if RAG_ADMIN_PASSWORD is not set or if it matches
    if not settings.RAG_ADMIN_PASSWORD or password == settings.RAG_ADMIN_PASSWORD:
        logger.info("RAG Admin authenticated successfully")
        # In a real app, you would return a token here
        return Response(
            {"status": "authenticated"},
            status=status.HTTP_200_OK
        )
    else:
        logger.warning("RAG Admin authentication failed")
        return Response(
            {"error": "Invalid password"},
            status=status.HTTP_401_UNAUTHORIZED
        )

@api_view(['POST'])
@permission_classes([])
def rag_admin_list_all_collections(request):
    """
    An endpoint for admins to list all collections, bypassing user/session scope.
    Requires a valid admin password.
    """
    logger.info("RAG Admin list all collections request")
    password = request.data.get("password")
    
    # Allow access if RAG_ADMIN_PASSWORD is not set or if it matches
    if not settings.RAG_ADMIN_PASSWORD or password == settings.RAG_ADMIN_PASSWORD:
        logger.info("RAG Admin authenticated for listing collections")
        collections: List[Collection] = list_collections()
        # Include user_id in the serialized response
        serialized_collections = []
        for col in collections:
            s_col = serialize_collection(col)
            s_col['user_id'] = col.metadata.get('user_id') if col.metadata else None
            serialized_collections.append(s_col)
        return Response(data=serialized_collections)
    else:
        logger.warning("RAG Admin authentication failed for listing collections")
        return Response(
            {"error": "Invalid password"},
            status=status.HTTP_401_UNAUTHORIZED
        )

@api_view(['POST'])
def rag_admin_delete_collection(request):
    """
    An endpoint for admins to delete any collection.
    Requires a valid admin password.
    """
    logger.info("RAG Admin delete collection request")
    password = request.data.get("password")
    collection_name = request.data.get("collection_name")

    if not collection_name:
        return Response(
            {"error": "Collection name not provided"},
            status=status.HTTP_400_BAD_REQUEST
        )

    # Allow access if RAG_ADMIN_PASSWORD is not set or if it matches
    if not settings.RAG_ADMIN_PASSWORD or password == settings.RAG_ADMIN_PASSWORD:
        logger.info(f"RAG Admin authenticated for deleting collection: {collection_name}")
        try:
            delete_collection(collection_name=collection_name)
            logger.info(f"Admin successfully deleted collection: {collection_name}")
            return Response(
                {"status": f"Collection '{collection_name}' deleted successfully"},
                status=status.HTTP_200_OK
            )
        except Exception as e:
            logger.error(f"Admin failed to delete collection {collection_name}: {e}")
            return Response(
                {"error": f"Failed to delete collection: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
    else:
        logger.warning(f"RAG Admin authentication failed for deleting collection: {collection_name}")
        return Response(
            {"error": "Invalid password"},
            status=status.HTTP_401_UNAUTHORIZED
        )