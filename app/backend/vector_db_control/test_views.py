# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import sys
from types import ModuleType, SimpleNamespace
from unittest.mock import MagicMock
import pytest


def _load_views(monkeypatch):
    # Stub pypdf
    sys.modules.setdefault("pypdf", ModuleType("pypdf"))

    # Stub chromadb and chromadb.types
    chromadb = ModuleType("chromadb")
    chromadb_types = ModuleType("chromadb.types")
    chromadb_types.Collection = type("Collection", (), {})
    sys.modules["chromadb"] = chromadb
    sys.modules["chromadb.types"] = chromadb_types

    # Stub django
    django = ModuleType("django")
    django_conf = ModuleType("django.conf")
    django_conf.settings = SimpleNamespace(
        RAG_RELEVANCE_THRESHOLD=None,
        RAG_RERANK_ENABLED=True,
        RAG_RERANK_MIN_SCORE=0.05,
        RAG_RERANK_FLOOR=2,
        RAG_CONTEXT_TOKEN_BUDGET=2000,
        MEDIA_ROOT="/tmp",
        RAG_ADMIN_PASSWORD=None,
        CHROMA_DB_EMBED_MODEL="default-embed",
    )
    sys.modules["django"] = django
    sys.modules["django.conf"] = django_conf

    # Stub rest_framework
    rf = ModuleType("rest_framework")
    rf_status = SimpleNamespace(
        HTTP_200_OK=200,
        HTTP_400_BAD_REQUEST=400,
        HTTP_403_FORBIDDEN=403,
        HTTP_404_NOT_FOUND=404,
        HTTP_500_INTERNAL_SERVER_ERROR=500,
        HTTP_503_SERVICE_UNAVAILABLE=503,
    )
    rf.status = rf_status

    class DummyResponse:
        def __init__(self, data=None, status=200):
            self.data = data
            self.status_code = status

    rf.Response = DummyResponse
    rf.viewsets = SimpleNamespace(ViewSet=type("ViewSet", (), {}))
    rf.decorators = SimpleNamespace(
        action=lambda *a, **k: (lambda f: f),
        api_view=lambda *a, **k: (lambda f: f),
        permission_classes=lambda *a, **k: (lambda f: f),
    )
    sys.modules["rest_framework"] = rf
    sys.modules["rest_framework.status"] = rf_status
    sys.modules["rest_framework.response"] = SimpleNamespace(Response=DummyResponse)
    sys.modules["rest_framework.viewsets"] = rf.viewsets
    sys.modules["rest_framework.decorators"] = rf.decorators

    # Stub shared_config.logger_config
    sc_log = ModuleType("shared_config.logger_config")

    class DummyLogger:
        def info(self, *a, **k): pass
        def warning(self, *a, **k): pass
        def error(self, *a, **k): pass

    sc_log.get_logger = lambda n: DummyLogger()
    sys.modules["shared_config"] = ModuleType("shared_config")
    sys.modules["shared_config.logger_config"] = sc_log

    # Stub vector_db_control dependencies
    vdb_chroma = ModuleType("vector_db_control.chroma")
    for fn in [
        "list_collections",
        "create_collection",
        "get_collection",
        "query_collection",
        "insert_to_chroma_collection",
        "serialize_collection",
        "delete_collection",
        "embedding_func_name_for",
    ]:
        setattr(vdb_chroma, fn, MagicMock())
    sys.modules["vector_db_control.chroma"] = vdb_chroma

    vdb_singletons = ModuleType("vector_db_control.singletons")
    vdb_singletons.ChromaClient = MagicMock()
    sys.modules["vector_db_control.singletons"] = vdb_singletons

    vdb_docs = ModuleType("vector_db_control.documents")
    vdb_docs.chunk_document = MagicMock(return_value=[])
    vdb_docs.deterministic_chunk_id = MagicMock(return_value="chunk-id")
    sys.modules["vector_db_control.documents"] = vdb_docs

    vdb_ret = ModuleType("vector_db_control.retrieval")
    vdb_ret.approx_token_count = MagicMock(return_value=10)
    vdb_ret.retrieve = MagicMock(
        return_value={"chunks": [], "collection_errors": {}, "reranker_used": False}
    )
    sys.modules["vector_db_control.retrieval"] = vdb_ret

    vdb_rew = ModuleType("vector_db_control.rewrite")
    vdb_rew.maybe_rewrite_query = MagicMock(side_effect=lambda q, h: (q, False))
    sys.modules["vector_db_control.rewrite"] = vdb_rew

    vdb_tt = ModuleType("vector_db_control.tt_embedding_function")
    vdb_tt.TT_EMBED_PREFIX = "tt_"
    sys.modules["vector_db_control.tt_embedding_function"] = vdb_tt

    # Pop cached views to re-import
    sys.modules.pop("vector_db_control.views", None)
    import vector_db_control.views as views
    return views


@pytest.fixture
def views_module(monkeypatch):
    return _load_views(monkeypatch)


def make_mock_collection(name, metadata=None, coll_id="mock-id"):
    coll = SimpleNamespace(name=name, metadata=metadata if metadata is not None else {}, id=coll_id)
    coll.get = MagicMock(return_value={"metadatas": []})
    return coll


class TestListCollections:
    def test_list_returns_all_collections_including_legacy_user_scoped(self, views_module, monkeypatch):
        views = views_module
        view = views.VectorCollectionsAPIView()

        # Mix of collections: no metadata, metadata without user_id, and metadata with legacy user_id
        c1 = make_mock_collection("col_no_meta", metadata={})
        c2 = make_mock_collection("col_user_a", metadata={"user_id": "session_user_a"})
        c3 = make_mock_collection("col_user_b", metadata={"user_id": "session_user_b"})

        monkeypatch.setattr(views, "list_collections", lambda: [c1, c2, c3])
        monkeypatch.setattr(views, "serialize_collection", lambda c: {"name": c.name, "metadata": c.metadata})

        request = SimpleNamespace(headers={})
        response = view.list(request)

        assert response.status_code == 200
        # All 3 collections must be returned; none filtered out by user_id
        returned_names = [c["name"] for c in response.data]
        assert returned_names == ["col_no_meta", "col_user_a", "col_user_b"]


class TestPostCollection:
    def test_duplicate_name_returns_400_with_unified_error(self, views_module, monkeypatch):
        views = views_module
        view = views.VectorCollectionsAPIView()

        # Existing collection has legacy user_id
        existing = make_mock_collection("xyz", metadata={"user_id": "legacy_other_user"})
        monkeypatch.setattr(views, "list_collections", lambda: [existing])

        request = SimpleNamespace(
            headers={},
            data={"name": "xyz", "metadata": {}}
        )
        response = view.post(request)

        assert response.status_code == 400
        # Error must be unified, without mentioning user ownership
        assert response.data == {"error": "A collection with name 'xyz' already exists."}

    def test_new_collection_created_without_user_id_in_metadata(self, views_module, monkeypatch):
        views = views_module
        view = views.VectorCollectionsAPIView()

        monkeypatch.setattr(views, "list_collections", lambda: [])
        created_mock = make_mock_collection("new_coll", metadata={"custom": "field"})
        create_mock = MagicMock(return_value=created_mock)
        monkeypatch.setattr(views, "create_collection", create_mock)
        monkeypatch.setattr(views, "serialize_collection", lambda c: {"name": c.name, "metadata": c.metadata})

        request = SimpleNamespace(
            headers={},
            data={"name": "new_coll", "metadata": {"custom": "field"}}
        )
        response = view.post(request)

        assert response.status_code == 200
        create_mock.assert_called_once()
        _, kwargs = create_mock.call_args
        assert kwargs["collection_name"] == "new_coll"
        # Assert 'user_id' was NOT added to metadata
        assert "user_id" not in kwargs["metadata"]
        assert kwargs["metadata"]["custom"] == "field"


class TestRetrieveCollection:
    def test_retrieve_succeeds_without_ownership_check(self, views_module, monkeypatch):
        views = views_module
        view = views.VectorCollectionsAPIView()

        c = make_mock_collection("legacy_coll", metadata={"user_id": "someone_else"})
        monkeypatch.setattr(views, "get_collection", lambda **k: c)
        monkeypatch.setattr(views, "serialize_collection", lambda c: {"name": c.name, "metadata": c.metadata})

        request = SimpleNamespace(headers={})
        response = view.retrieve(request, pk="legacy_coll")

        assert response.status_code == 200
        assert response.data["name"] == "legacy_coll"


class TestDeleteCollection:
    def test_delete_succeeds_without_ownership_check(self, views_module, monkeypatch):
        views = views_module
        view = views.VectorCollectionsAPIView()

        delete_mock = MagicMock()
        monkeypatch.setattr(views, "delete_collection", delete_mock)

        request = SimpleNamespace(headers={})
        response = view.delete(request, pk="legacy_coll")

        assert response.status_code == 200
        delete_mock.assert_called_once_with(collection_name="legacy_coll")


class TestQueryCollection:
    def test_query_succeeds_without_ownership_check(self, views_module, monkeypatch):
        views = views_module
        view = views.VectorCollectionsAPIView()

        query_mock = MagicMock(return_value={"documents": [["doc1"]], "ids": [["id1"]]})
        monkeypatch.setattr(views, "query_collection", query_mock)
        monkeypatch.setattr(view, "_resolve_embed_func", lambda pk: "default-embed")

        request = SimpleNamespace(
            headers={},
            GET={"query_text": "search query"}
        )
        response = view.query(request, pk="any_coll")

        assert response.status_code == 200
        query_mock.assert_called_once()


class TestQueryAllCollections:
    def test_queries_across_all_collections_including_legacy(self, views_module, monkeypatch):
        views = views_module
        view = views.VectorCollectionsAPIView()

        c1 = make_mock_collection("coll1", metadata={"user_id": "user1"})
        c2 = make_mock_collection("coll2", metadata={"user_id": "user2"})
        monkeypatch.setattr(views, "list_collections", lambda: [c1, c2])
        monkeypatch.setattr(views, "serialize_collection", lambda c: {"name": c.name})

        queried = []
        def mock_query(collection_name, **kwargs):
            queried.append(collection_name)
            return {"documents": [["doc"]], "metadatas": [[{}]], "distances": [[0.1]]}

        monkeypatch.setattr(views, "query_collection", mock_query)

        request = SimpleNamespace(
            headers={},
            GET={"query_text": "search text"}
        )
        response = view.query_all_collections(request)

        assert response.status_code == 200
        # Both collections must be queried
        assert queried == ["coll1", "coll2"]
        assert len(response.data["results"]) == 2


class TestRetrieveDocuments:
    def test_retrieve_documents_single_mode_succeeds(self, views_module, monkeypatch):
        views = views_module
        view = views.VectorCollectionsAPIView()

        c = make_mock_collection("single_coll", metadata={"user_id": "legacy_user"})
        monkeypatch.setattr(views, "get_collection", lambda **k: c)

        retrieve_mock = MagicMock(return_value={
            "chunks": [],
            "collection_errors": {},
            "reranker_used": False
        })
        monkeypatch.setattr(views, "retrieve", retrieve_mock)

        request = SimpleNamespace(
            headers={},
            data={"collection": "single_coll", "query_text": "test"}
        )
        response = view.retrieve_documents(request)

        assert response.status_code == 200
        retrieve_mock.assert_called_once()
        targets = retrieve_mock.call_args[0][1]
        assert targets == ["single_coll"]

    def test_retrieve_documents_all_mode_includes_all_collections(self, views_module, monkeypatch):
        views = views_module
        view = views.VectorCollectionsAPIView()

        c1 = make_mock_collection("coll1", metadata={"user_id": "user1"})
        c2 = make_mock_collection("coll2", metadata={"user_id": "user2"})
        monkeypatch.setattr(views, "list_collections", lambda: [c1, c2])

        retrieve_mock = MagicMock(return_value={
            "chunks": [],
            "collection_errors": {},
            "reranker_used": False
        })
        monkeypatch.setattr(views, "retrieve", retrieve_mock)

        request = SimpleNamespace(
            headers={},
            data={"query_text": "test"}
        )
        response = view.retrieve_documents(request)

        assert response.status_code == 200
        retrieve_mock.assert_called_once()
        targets = retrieve_mock.call_args[0][1]
        assert targets == ["coll1", "coll2"]


class TestInsertDocument:
    def test_insert_document_no_ownership_check(self, views_module, monkeypatch):
        views = views_module
        view = views.VectorCollectionsAPIView()

        dummy_chunk = SimpleNamespace(page_content="chunk text", metadata={})
        monkeypatch.setattr(views, "chunk_document", lambda **k: [dummy_chunk])
        insert_mock = MagicMock()
        monkeypatch.setattr(views, "insert_to_chroma_collection", insert_mock)

        mock_coll = make_mock_collection("coll1")
        monkeypatch.setattr(views, "get_collection", lambda **k: mock_coll)

        mock_file = SimpleNamespace(
            name="test.txt",
            chunks=lambda: [b"dummy content"]
        )
        request = SimpleNamespace(
            headers={},
            FILES={"document": mock_file}
        )
        response = view.insert_document(request, pk="coll1")

        assert response.status_code == 200
        insert_mock.assert_called_once()
        assert insert_mock.call_args[1]["collection_name"] == "coll1"

