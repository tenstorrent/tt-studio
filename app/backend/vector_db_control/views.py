# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

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
from vector_db_control.documents import chunk_document
from vector_db_control.data import INTERNAL_KNOWLEDGE

logger = get_logger(__name__)
logger.info(f"importing {__name__}")

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

            # Load internal knowledge into the collection
            logger.info(f"Loading internal knowledge into collection {name}")
            ids = [f"internal_{i}" for i in range(len(INTERNAL_KNOWLEDGE))]
            insert_to_chroma_collection(
                collection_name=name,
                documents=INTERNAL_KNOWLEDGE,
                ids=ids,
                metadatas=[{"source": "internal_knowledge", "type": "documentation"} for _ in INTERNAL_KNOWLEDGE],
                embedding_func_name=self.EMBED_MODEL,
            )
            logger.info(f"Internal knowledge loaded successfully into {name}")
            
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
            elif file_extension in ['.txt']:
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
            documents = [d.page_content for d in chunked_document]
            
            # Update each chunk's metadata to include the folder structure
            metadatas = []
            for d in chunked_document:
                chunk_metadata = d.metadata.copy()
                chunk_metadata.update(base_metadata)
                metadatas.append(chunk_metadata)
            
            ids = [str(uuid.uuid4()) for _ in documents]
            insert_to_chroma_collection(
                collection_name=pk,
                documents=documents,
                ids=ids,
                metadatas=metadatas,
                embedding_func_name=self.EMBED_MODEL,
            )
            
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

        # Apply RAG strict mode if enabled
        distance_threshold = None
        min_documents = None
        if settings.RAG_STRICT_MODE:
            distance_threshold = settings.RAG_CONFIDENCE_THRESHOLD
            min_documents = settings.RAG_MIN_DOCUMENTS
            logger.info(f"RAG strict mode enabled: threshold={distance_threshold}, min_docs={min_documents}")

        results = query_collection(
            collection_name=pk,
            query_texts=[query_text],
            n_results=self.query_results_limit,
            embedding_func_name=self.EMBED_MODEL,
            distance_threshold=distance_threshold,
            min_documents=min_documents,
        )
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

        # Apply RAG strict mode if enabled
        distance_threshold = None
        min_documents = None
        if settings.RAG_STRICT_MODE:
            distance_threshold = settings.RAG_CONFIDENCE_THRESHOLD
            min_documents = settings.RAG_MIN_DOCUMENTS
            logger.info(f"RAG strict mode enabled: threshold={distance_threshold}, min_docs={min_documents}")

        all_results = {"results": [], "is_answerable": True, "confidence_level": "high"}
        total_filtered_count = 0
        total_raw_count = 0

        for collection in user_collections:
            logger.info(f"Querying collection: {collection.name}")
            try:
                results = query_collection(
                    collection_name=collection.name,
                    query_texts=[query_text],
                    n_results=self.query_results_limit,
                    embedding_func_name=self.EMBED_MODEL,
                    distance_threshold=distance_threshold,
                    min_documents=min_documents,
                )

                # Track overall confidence metadata
                if results.get('filtered_count') is not None:
                    total_filtered_count += results.get('filtered_count', 0)
                    total_raw_count += results.get('raw_count', 0)

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

        # Sort all aggregated results by distance (ascending)
        all_results["results"].sort(key=lambda x: x["distance"] if x["distance"] is not None else float('inf'))

        # Limit the final results to the top N
        limit = int(request.GET.get("limit", 10))
        all_results["results"] = all_results["results"][:limit]

        # Determine overall answerability based on aggregated results
        if settings.RAG_STRICT_MODE and distance_threshold is not None:
            all_results["is_answerable"] = total_filtered_count >= min_documents
            if total_filtered_count == 0:
                all_results["confidence_level"] = "insufficient"
            elif total_filtered_count < min_documents:
                all_results["confidence_level"] = "insufficient"
            else:
                # Use best distance from results
                best_distance = all_results["results"][0]["distance"] if all_results["results"] else float('inf')
                if best_distance <= 0.5:
                    all_results["confidence_level"] = "high"
                elif best_distance <= 0.8:
                    all_results["confidence_level"] = "medium"
                else:
                    all_results["confidence_level"] = "low"

            all_results["filtered_count"] = total_filtered_count
            all_results["raw_count"] = total_raw_count
            all_results["threshold_used"] = distance_threshold

        return Response(all_results)

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