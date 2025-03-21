# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import uuid
from typing import List

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


class VectorCollectionsAPIView(ViewSet):
    EMBED_MODEL = None
    chromadb_client = None
    query_results_limit = 2

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        if hasattr(settings, "CHROMA_DB_EMBED_MODEL"):
            self.EMBED_MODEL = settings.CHROMA_DB_EMBED_MODEL

    def list(self, request):
        collections: List[Collection] = list_collections()
        return Response(data=map(serialize_collection, collections))

    def post(self, request):
        name = request.data["name"]
        collection = create_collection(
            collection_name=name,
            metadata=request.data.get("metadata", dict()),
            embedding_func_name=self.EMBED_MODEL,
        )
        return Response(data=serialize_collection(collection))

    def retrieve(self, request, pk=None):
        if not pk:
            return self.list(request)
        collection = get_collection(
            collection_name=pk, embedding_func_name=self.EMBED_MODEL
        )
        return Response(data=serialize_collection(collection))

    @action(methods=["DELETE"], detail=True)
    def delete(self, request, pk=None):
        if not pk:
            return Response(
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                data={"error": "No collection name provided"},
            )
        delete_collection(collection_name=pk)
        return Response(status=200)

    @action(methods=["POST"], detail=True)
    def insert_document(self, request, pk=None):
        file = request.FILES["file"]
        loaded_document = pypdf.PdfReader(stream=file)
        chunks = chunk_pdf_document(loaded_document)
        ids = [str(uuid.uuid4()) for _ in range(len(chunks))]
        documents = [chunk.page_content for chunk in chunks]

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

        return Response(status=200)

    @action(methods=["GET"], detail=True, url_path="query")
    def query(self, request, pk=None):
        query = request.query_params.get("query")
        if isinstance(query, str):
            query = [query]
        query_result = query_collection(
            collection_name=pk, embedding_func_name=self.EMBED_MODEL, query_texts=query
        )
        return Response(data=query_result)
