# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import uuid
import json
from typing import List
from shared_config.logger_config import get_logger
import pypdf
from chromadb.types import Collection
from django.conf import settings
from rest_framework import status
from rest_framework.decorators import action
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
        logger.info(f"Delete request for collection: {pk}")
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
