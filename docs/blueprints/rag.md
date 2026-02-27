# RAG — Retrieval-Augmented Generation

Query your documents with AI-powered semantic search. This blueprint combines an LLM deployed on Tenstorrent hardware with ChromaDB vector storage to ground model responses in your own data.

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Document    │     │  ChromaDB    │     │  LLM         │
│  Upload      │────>│  Vector DB   │────>│  (vLLM)      │
│  (PDF, DOCX, │     │  Embeddings  │     │  Tenstorrent │
│   TXT, PPTX) │     │  + Retrieval │     │  Hardware    │
└──────────────┘     └──────────────┘     └──────────────┘
       │                    │                     │
       └────────────────────┴─────────────────────┘
                    Control Plane
              Document chunking, semantic
              search, context injection
```

## How It Works

1. **Upload** — Documents are uploaded through the experience layer (PDF, DOCX, TXT, PPTX, XLSX supported)
2. **Chunk** — Documents are split into chunks using LangChain text splitters
3. **Embed** — Chunks are embedded using SentenceTransformer models and stored in ChromaDB
4. **Query** — User questions trigger a semantic search across stored embeddings
5. **Generate** — Retrieved context is injected into the LLM prompt for grounded responses

## Key Features

- Multi-format document ingestion (PDF, DOCX, TXT, PPTX, XLSX)
- User-scoped collections with session isolation
- Cosine similarity search across document embeddings
- Context injection into LLM chat completions
- Admin interface for collection management

## Models Used

| Role | Model Type | Examples |
|------|-----------|---------|
| Generation | LLM (CHAT) | Llama-3.1-8B-Instruct, Qwen3-8B, Mistral-7B-Instruct |
| Embedding | EMBEDDING | bge-large-en-v1.5, Qwen3-Embedding-4B |

See the full [Model Catalog](../model-catalog.md) for all compatible models and hardware.

## Minimum Hardware

| Device | Notes |
|--------|-------|
| N150 | Smallest supported — runs 1B-8B LLMs + embedding |
| N300 | Recommended — supports larger LLMs |
| T3K | Full catalog support including 70B+ models |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/collections/` | POST | Create a new collection |
| `/api/collections/` | GET | List user's collections |
| `/api/collections/{name}/insert_document` | POST | Upload document to collection |
| `/api/collections/{name}/query` | GET | Query collection with semantic search |
| `/api/collections/query-all` | GET | Query across all user collections |

## Software Stack

**Tenstorrent Technology**
- TT Inference Server (LLM serving via vLLM)
- TT-Metal (execution framework)

**Third-Party**
- ChromaDB (vector storage)
- SentenceTransformers (embedding)
- LangChain (document chunking)

## Quick Start

1. Deploy TT-Studio: `python3 run.py`
2. Deploy an LLM from the model catalog
3. Navigate to **RAG Management** in the web interface
4. Create a collection and upload documents
5. Switch to **Chat** and query with RAG context enabled

See the [Quick Start Guide](../quickstart.md) for full provisioning details.
