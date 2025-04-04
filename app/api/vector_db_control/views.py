# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import os
import uuid
import json
from typing import List
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
from vector_db_control.documents import chunk_pdf_document

logger = get_logger(__name__)
logger.info(f"importing {__name__}")

class VectorCollectionsAPIView(ViewSet):
    EMBED_MODEL = None
    chromadb_client = None
    query_results_limit = 2

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
        
        return Response(data=map(serialize_collection, filtered_collections))

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
            
        return Response(data=serialize_collection(collection))

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
        
        file = request.FILES["file"]
        logger.info(f"Processing uploaded file: {file.name}")
        loaded_document = pypdf.PdfReader(stream=file)
        chunks = chunk_pdf_document(loaded_document)
        ids = [str(uuid.uuid4()) for _ in range(len(chunks))]
        documents = [chunk.page_content for chunk in chunks]

        logger.info(f"Inserting {len(chunks)} chunks to collection {pk}")
        insert_to_chroma_collection(
            collection_name=pk,
            documents=documents,
            ids=ids,
            metadatas=[],
            embedding_func_name=self.EMBED_MODEL,
        )
        collection = get_collection(collection_name=pk, embedding_func_name=self.EMBED_MODEL)
        metadata = collection.metadata or {}
        metadata.update({"last_uploaded_document": file.name})
        collection.modify(metadata={k: v for k, v in metadata.items() if k != "hnsw:space"})
        logger.info(f"Document {file.name} added to collection {pk} successfully")

        return Response(status=200)

    @action(methods=["GET"], detail=True, url_path="query")
    def query(self, request, pk=None):
        logger.info(f"Query request for collection: {pk}")
        logger.info(f"Query params: {request.query_params}")
        
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
            
        query = request.query_params.get("query")
        if isinstance(query, str):
            query = [query]
        
        logger.info(f"Executing query: {query}")
        query_result = query_collection(
            collection_name=pk, embedding_func_name=self.EMBED_MODEL, query_texts=query
        )
        
        # Fix broken logging of result length
        documents = query_result.get("documents", [[]])
        num_results = len(documents[0]) if documents and len(documents) > 0 else 0
        logger.info(f"Query completed with {num_results} results")
        
        return Response(data=query_result)

# rag admin views
@api_view(['POST'])
def rag_admin_authenticate(request):
    """Authenticate admin access with password from environment variable"""
    try:
        # Get the password from the request
        password = request.data.get('password')
        
        # Get the admin password from settings or environment
        admin_password = getattr(settings, 'RAG_ADMIN_PASSWORD', os.environ.get('RAG_ADMIN_PASSWORD'))
        
        if not admin_password:
            logger.error("RAG_ADMIN_PASSWORD not configured in settings or environment")
            return Response(
                {"error": "Admin authentication not configured"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
            
        # Validate password
        if password != admin_password:
            logger.warning(f"Failed admin authentication attempt")
            return Response(
                {"error": "Invalid credentials"},
                status=status.HTTP_401_UNAUTHORIZED
            )
            
        # Password is correct, return success
        return Response({"authenticated": True}, status=status.HTTP_200_OK)
        
    except Exception as e:
        logger.error(f"Error in admin authentication: {str(e)}", exc_info=True)
        return Response(
            {"error": f"Authentication error: {str(e)}"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )

@api_view(['POST'])
def rag_admin_list_all_collections(request):
    """List all collections regardless of user_id, requires authentication"""
    try:
        # Get the password from the request
        password = request.data.get('password')
        
        # Get the admin password from settings or environment
        admin_password = getattr(settings, 'RAG_ADMIN_PASSWORD', os.environ.get('RAG_ADMIN_PASSWORD'))
        
        if not admin_password:
            logger.error("RAG_ADMIN_PASSWORD not configured in settings or environment")
            return Response(
                {"error": "Admin authentication not configured"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
            
        # Validate password
        if password != admin_password:
            logger.warning(f"Failed admin authentication attempt")
            return Response(
                {"error": "Invalid credentials"},
                status=status.HTTP_401_UNAUTHORIZED
            )
        
        # Get all collections without filtering by user_id
        collections = list_collections()
        logger.info(f"Admin view: Retrieved {len(collections)} total collections")
        
        # Serialize collections
        serialized_collections = list(map(serialize_collection, collections))
        
        # Add detailed user info to response
        for collection in serialized_collections:
            user_id = collection.get('metadata', {}).get('user_id', 'Unknown')
            
            if user_id and user_id.startswith('session_'):
                collection['user_type'] = 'Anonymous (Browser Session)'
                collection['user_identifier'] = user_id[8:]  # Remove 'session_' prefix
            elif user_id and user_id.startswith('user_'):
                collection['user_type'] = 'Authenticated User'
                collection['user_identifier'] = user_id[5:]  # Remove 'user_' prefix
            else:
                collection['user_type'] = 'Unknown'
                collection['user_identifier'] = user_id
        
        return Response(data=serialized_collections)
        
    except Exception as e:
        logger.error(f"Error in admin collections view: {str(e)}", exc_info=True)
        return Response(
            {"error": f"Error retrieving collections: {str(e)}"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )

@api_view(['POST'])
def rag_admin_delete_collection(request):
    """Delete a collection with admin privileges, regardless of owner"""
    logger.info(f"@@***Admin delete collection request received. Headers: {request.headers}")
    logger.info(f"Request data: {request.data}")
    
    # Get request parameters
    password = request.data.get('password')
    collection_name = request.data.get('collection_name')
    logger.info(f"Attempting to delete collection: {collection_name}")
    
    # Validate input
    if not collection_name:
        logger.error("No collection name provided for deletion")
        return Response(
            {"error": "No collection name provided"},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    # Authenticate admin
    admin_password = getattr(settings, 'RAG_ADMIN_PASSWORD', os.environ.get('RAG_ADMIN_PASSWORD'))
    if not admin_password:
        logger.error("RAG_ADMIN_PASSWORD not configured")
        return Response(
            {"error": "Admin authentication not configured"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )
    
    if password != admin_password:
        logger.warning(f"Failed admin authentication attempt for deletion")
        return Response(
            {"error": "Invalid credentials"},
            status=status.HTTP_401_UNAUTHORIZED
        )
    
    # Admin is authenticated, delete the collection
    try:
        delete_collection(collection_name=collection_name)
        logger.info(f"Admin deleted collection: {collection_name}")
        return Response(
            {"success": True, "message": f"Collection '{collection_name}' successfully deleted"},
            status=status.HTTP_200_OK
        )
    except Exception as e:
        # Handle "collection doesn't exist" error gracefully
        if "does not exist" in str(e).lower():
            logger.info(f"Collection {collection_name} doesn't exist or was already deleted")
            return Response(
                {"success": True, "message": f"Collection '{collection_name}' already deleted or doesn't exist"},
                status=status.HTTP_200_OK
            )
        
        # Handle other errors
        logger.error(f"Error in admin delete collection: {str(e)}", exc_info=True)
        return Response(
            {"error": f"Error deleting collection: {str(e)}"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )