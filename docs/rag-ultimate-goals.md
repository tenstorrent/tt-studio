# RAG in TT-Studio: Ultimate Goals

## 1. Vision

TT-Studio's RAG capability should be a production-grade, hardware-accelerated retrieval system that lets teams securely ingest, query, and cite their own knowledge bases — with every response grounded in verifiable sources, all embedding and inference running on Tenstorrent silicon, and the full pipeline configurable without touching code.

---

## 2. Current Feature Inventory

| Feature | Status | Notes |
|---------|--------|-------|
| Document upload (PDF, TXT, DOCX) | ✅ | Via `/rag-api/upload/` |
| Collection create / list / delete | ✅ | Weaviate-backed collections |
| Chunk + embed on ingest | ✅ | External embedding provider (OpenAI-compatible) |
| Semantic search (`/rag-api/query/`) | ✅ | Top-K cosine similarity |
| Context injection into LLM prompt | ✅ | Appended to system prompt |
| RAG-augmented chat in frontend | ✅ | `RagChatComponent`, collection selector |
| Multi-collection list in UI | ✅ | Dropdown bound to `/rag-api/collections/` |

---

## 3. Planned Features (User Stories)

---

### F1 — Source Citation in Responses

**User story:** As a knowledge-worker using RAG chat, I want each answer to include clickable citations (document name, page/chunk number) so I can verify claims without hunting through raw files.

**Acceptance criteria:**
- [ ] Retrieved chunk metadata (document name, chunk index, page number if available) is returned alongside the LLM answer in the API response
- [ ] Frontend renders citations as a collapsible "Sources" section below the assistant message
- [ ] Hovering / clicking a citation shows the verbatim chunk text in a tooltip or side panel
- [ ] If no chunks were retrieved (fallback answer), the UI shows "No sources used"
- [ ] Citation data is preserved in chat history export

**Affected files:**
- `app/backend/rag_api/query_views.py` — include chunk metadata in response payload
- `app/frontend/src/components/rag/RagChatComponent.tsx` — render citation UI
- `app/frontend/src/components/rag/CitationPanel.tsx` *(new)*

---

### F2 — Strict Grounding Mode

**User story:** As a compliance-sensitive operator, I want to toggle "strict grounding" so the LLM only answers from retrieved context and explicitly refuses to speculate when no relevant chunks are found.

**Acceptance criteria:**
- [ ] A `strict_grounding: bool` flag is accepted by `/rag-api/query/` (default `false`)
- [ ] When `strict_grounding=true` and retrieval score is below threshold, the API returns a structured `{"answer": null, "reason": "insufficient_context"}` response rather than a hallucinated answer
- [ ] System prompt template for strict mode includes an explicit instruction: *"Answer only from the provided context. If the context does not contain enough information, respond with: I don't have enough information to answer this."*
- [ ] Frontend RAG settings panel exposes a "Strict Grounding" toggle (see F3)
- [ ] Strict mode status is reflected in the chat UI (e.g., badge or indicator)
- [ ] Unit tests cover the strict-mode path for both sufficient and insufficient context cases

**Affected files:**
- `app/backend/rag_api/query_views.py` — grounding logic, prompt selection
- `app/backend/rag_api/prompt_templates.py` *(new)* — separate strict vs. default system prompts
- `app/frontend/src/components/rag/RagSettingsPanel.tsx` *(new)*

---

### F3 — RAG Settings UI Panel

**User story:** As a developer iterating on RAG quality, I want a settings panel in the TT-Studio UI where I can tune chunking strategy, top-K, similarity threshold, and strict grounding — without editing config files or restarting the server.

**Acceptance criteria:**
- [ ] Settings panel accessible from the RAG chat view via a gear icon
- [ ] Configurable parameters include:
  - **Chunk size** (tokens; range 128–2048, step 128)
  - **Chunk overlap** (tokens; range 0–512, step 64)
  - **Top-K** (1–20)
  - **Similarity threshold** (0.0–1.0, step 0.05)
  - **Strict grounding** toggle (see F2)
  - **Embedding model** selector (lists available EMBEDDING-type deployments from `/models-api/`)
- [ ] Settings are persisted per-collection in browser `localStorage` and sent with each query
- [ ] Backend `/rag-api/query/` accepts all parameters above and applies them at query time (no server restart)
- [ ] Default values are displayed and restorable via a "Reset to defaults" button
- [ ] Changing chunk size / overlap triggers a warning: *"Re-ingestion required for this collection"*

**Affected files:**
- `app/frontend/src/components/rag/RagSettingsPanel.tsx` *(new)*
- `app/frontend/src/components/rag/RagChatComponent.tsx` — wire settings into query payload
- `app/backend/rag_api/query_views.py` — accept and apply dynamic query parameters
- `app/backend/rag_api/ingest_views.py` — accept chunk size/overlap on upload

---

### F4 — On-Hardware Embedding (TT EMBEDDING Model Routing)

**User story:** As a TT hardware operator, I want document chunks to be embedded using a model deployed on a Tenstorrent card (via the existing `EMBEDDING` model type) so that I get hardware-accelerated, cost-free embedding without relying on external API keys.

**Acceptance criteria:**
- [ ] `ModelTypes.EMBEDDING` deployments are surfaced in the embedding model selector (F3)
- [ ] When an EMBEDDING deployment is selected, the RAG backend POSTs to that deployment's `/embeddings` endpoint (OpenAI-compatible interface) instead of the default external provider
- [ ] Embedding endpoint URL is dynamically resolved from the deployment store at ingest and query time
- [ ] Fallback behavior: if the selected TT embedding model is unavailable, the system raises a clear error (no silent fallback to external provider)
- [ ] Integration test: ingest a document, query it, confirm embeddings were generated by the TT deployment (via log inspection or mock)

**Affected files:**
- `app/backend/rag_api/embedding_client.py` *(new)* — routing logic
- `app/backend/rag_api/ingest_views.py` — use `embedding_client`
- `app/backend/rag_api/query_views.py` — use `embedding_client` for query embedding
- `app/backend/docker_control/deployment_store.py` — query by `ModelTypes.EMBEDDING`

---

### F5 — Collection Metadata Filtering

**User story:** As a multi-project user, I want to filter RAG retrieval by metadata tags (e.g., `project`, `department`, `doc_type`) so that queries return only contextually relevant chunks without creating a separate collection per tag.

**Acceptance criteria:**
- [ ] Document upload accepts an optional `metadata: dict` field per document
- [ ] Metadata key-value pairs are stored on Weaviate objects at ingest time
- [ ] `/rag-api/query/` accepts an optional `filters: list[{key, op, value}]` parameter (supports `eq`, `contains`, `gte`, `lte`)
- [ ] Filters are translated to Weaviate `where` filters and applied before top-K selection
- [ ] Frontend RAG settings panel (F3) exposes a metadata filter builder UI
- [ ] API documentation updated with filter schema and examples

**Affected files:**
- `app/backend/rag_api/ingest_views.py` — store metadata on Weaviate objects
- `app/backend/rag_api/query_views.py` — translate and apply filters
- `app/backend/rag_api/filter_builder.py` *(new)*
- `app/frontend/src/components/rag/RagSettingsPanel.tsx` — filter builder UI

---

### F6 — Multi-Collection Result Fusion (RRF)

**User story:** As a researcher, I want to query across multiple RAG collections simultaneously and receive a unified, relevance-ranked result set so I don't have to repeat my question for each collection.

**Acceptance criteria:**
- [ ] `/rag-api/query/` accepts `collections: list[str]` (queries all listed collections in parallel)
- [ ] Results from each collection are fused using Reciprocal Rank Fusion (RRF) with configurable `k` constant (default 60)
- [ ] Fused result set is deduplicated by chunk content hash before LLM injection
- [ ] Each chunk in the fused set retains its source collection name for citation (F1)
- [ ] Single-collection queries are unaffected in latency by this change
- [ ] Frontend collection selector supports multi-select mode

**Affected files:**
- `app/backend/rag_api/query_views.py` — parallel fetch + RRF fusion
- `app/backend/rag_api/rrf.py` *(new)* — RRF implementation
- `app/frontend/src/components/rag/CollectionSelector.tsx` *(new or updated)*

---

### F7 — Re-ranking Retrieved Chunks

**User story:** As a RAG power user, I want retrieved chunks to be re-ranked by a cross-encoder model before being injected into the LLM prompt so that the most semantically relevant chunks appear first and irrelevant ones are dropped.

**Acceptance criteria:**
- [ ] An optional `rerank: bool` parameter on `/rag-api/query/` enables re-ranking (default `false`)
- [ ] When enabled, top-K×2 chunks are fetched from Weaviate, then scored and sorted by a cross-encoder (configurable model endpoint)
- [ ] Only the top-K re-ranked chunks are passed to the LLM
- [ ] Re-ranking model can be any OpenAI-compatible `/rerank` endpoint; defaults to a local deployment if available
- [ ] Re-rank scores are included in citation metadata (F1)
- [ ] Latency overhead of re-ranking is logged and surfaced in the API response as `rerank_latency_ms`
- [ ] Frontend settings panel (F3) exposes a "Re-rank results" toggle

**Affected files:**
- `app/backend/rag_api/query_views.py` — over-fetch + rerank path
- `app/backend/rag_api/reranker_client.py` *(new)*
- `app/frontend/src/components/rag/RagSettingsPanel.tsx`

---

## 4. Production Readiness Roadmap

### 4.1 Observability

| Item | Description |
|------|-------------|
| Retrieval metrics | Log `top_k`, `similarity_scores[]`, `collection`, and `rerank_latency_ms` per query |
| Ingestion metrics | Track chunk count, embedding latency, and error rate per upload |
| Structured logging | All RAG views emit JSON-structured logs (document ID, query hash, latency breakdown) |
| Tracing | Optional OpenTelemetry spans wrapping embed → retrieve → rerank → generate |
| Dashboard | Grafana or TT-Studio internal metrics page showing query volume and p95 latency |

### 4.2 Async Ingestion

| Item | Description |
|------|-------------|
| Background task queue | Move chunking + embedding to a Celery/RQ worker so large uploads don't block the HTTP response |
| Ingestion status endpoint | `GET /rag-api/jobs/{job_id}/` returns `{status, progress, error}` |
| Webhook / SSE notification | Notify frontend when ingestion completes (SSE stream or polling) |
| Retry logic | Automatically retry failed embedding calls with exponential backoff |

### 4.3 Auth / Multi-tenancy

| Item | Description |
|------|-------------|
| Collection ownership | Associate collections with an `owner_id` (user or team); enforce read/write scopes |
| API key gating | Optional per-collection API key for external integrations |
| Row-level isolation | Weaviate tenant isolation or namespace separation per owner |
| Audit log | Append-only log of who queried or modified which collection and when |

### 4.4 Document Lifecycle

| Item | Description |
|------|-------------|
| Document versioning | Re-upload replaces chunks atomically; prior version optionally archived |
| Delete by document | `DELETE /rag-api/collections/{id}/documents/{doc_id}/` removes all chunks for one document |
| TTL / expiry | Optional `expires_at` on collections; cron job purges expired data |
| Re-ingest trigger | API endpoint to re-chunk and re-embed an existing collection with new settings |

### 4.5 Scalability

| Item | Description |
|------|-------------|
| Horizontal embedding workers | Stateless workers pull from an ingest queue; scale independently of the API |
| Weaviate sharding | Configure Weaviate replication factor and shard count for large collections |
| Query caching | Cache embedding vectors for repeated queries (Redis, 5-minute TTL) |
| Load testing | Establish baseline: target 50 concurrent queries at < 2 s p95 with on-hardware embeddings |

### 4.6 Security / Governance

| Item | Description |
|------|-------------|
| PII scrubbing | Optional pre-ingest hook to detect and redact PII before chunks reach the vector store |
| Content filtering | Block upload of file types not explicitly allowlisted (default: PDF, TXT, DOCX, MD) |
| Chunk-level access control | Tag chunks as `restricted`; enforce at query time based on caller identity |
| Data residency | Document that all vectors stay on-premises when using TT embedding models; no data leaves the cluster |

### 4.8 Pluggable Embedding Endpoint

The embedding provider should be swappable at runtime — no code changes, no redeployment.

| Item | Description |
|------|-------------|
| `EMBEDDING_ENDPOINT` env var | Single URL that the RAG backend sends all embed requests to (OpenAI-compatible `/v1/embeddings`). Change the var and restart; everything else is automatic. |
| Per-collection override | `POST /rag-api/collections/` accepts an optional `embedding_endpoint` field stored in collection metadata. Queries use the collection's endpoint, not the global default. |
| Embedding model selector in UI | F3 settings panel lists all live `EMBEDDING`-type deployments from `/models-api/` as well as any manually entered URL, so users can point-and-click to switch. |
| Hot-swap validation | When an endpoint is changed, the backend sends a test embed (`"ping"`) and rejects the change if the call fails, so broken endpoints are caught before ingestion. |
| Model dimension guard | If the new model outputs a different vector dimension than the collection was originally indexed with, the system rejects the swap and surfaces a clear error: *"Collection indexed at dim=768; new model outputs dim=1536. Re-ingest required."* |

**Affected files:**
- `app/backend/rag_api/embedding_client.py` *(new)* — reads `EMBEDDING_ENDPOINT`, supports per-call override
- `app/backend/rag_api/ingest_views.py` — pass endpoint from collection metadata
- `app/backend/rag_api/query_views.py` — same
- `app/frontend/src/components/rag/RagSettingsPanel.tsx` — endpoint selector UI

---

### 4.9 Embedding Benchmark: CPU vs. TT Hardware

**Why this matters:** On-hardware embedding removes the only external API dependency in the RAG pipeline and is the key performance differentiator for TT-Studio. We need empirical data to guide user recommendations and surface the hardware advantage clearly in docs and demos.

#### What to measure

| Metric | Description |
|--------|-------------|
| Throughput (tokens/sec) | Batch embed a fixed corpus (e.g., 10 k chunks × 512 tokens); measure wall-clock time |
| Latency (ms/chunk) | Single-chunk embed latency at p50, p95, p99 |
| Latency under load | Same as above at 8, 16, 32 concurrent embed requests |
| Retrieval quality (nDCG@10) | Run a fixed Q&A eval set; compare answer quality when embeddings come from CPU vs. TT model to confirm the swap doesn't degrade recall |
| Cost proxy | CPU core-seconds consumed vs. TT card utilization % — useful for TCO framing |

#### How to run the benchmark

A reproducible benchmark script will live at `tests/benchmarks/embedding_benchmark.py`:

```
python tests/benchmarks/embedding_benchmark.py \
  --corpus docs/sample_corpus/ \
  --cpu-endpoint http://localhost:8001/v1/embeddings \
  --tt-endpoint  http://localhost:8002/v1/embeddings \
  --model all-MiniLM-L6-v2 \
  --batch-sizes 1,8,32 \
  --output results/embedding_benchmark.json
```

**Acceptance criteria for the benchmark suite:**
- [ ] Script runs end-to-end against both a CPU embedding server and a TT embedding deployment
- [ ] Results written to JSON with schema: `{provider, model, batch_size, throughput_tps, p50_ms, p95_ms, p99_ms}`
- [ ] A markdown summary table is auto-generated at `results/embedding_benchmark.md`
- [ ] CI job (`make benchmark-embed`) runs the benchmark nightly and uploads results to a shared artifact store
- [ ] Minimum expected result: TT hardware achieves ≥ 2× throughput vs. CPU at batch size 32 (this target is revised once baseline data is collected)

**Expected outcome / hypothesis:**

TT hardware should outperform CPU significantly at higher batch sizes because the Tenstorrent architecture is optimized for matrix-multiply-heavy workloads (the core of transformer embedding). CPU embedding is bottlenecked by memory bandwidth at large batch sizes; TT cards have higher on-chip SRAM and purpose-built MatMul engines. At batch size 1 (single-chunk, low-latency path), the gap narrows because launch overhead dominates.

**Affected files:**
- `tests/benchmarks/embedding_benchmark.py` *(new)*
- `tests/benchmarks/README.md` *(new)* — how to provision both endpoints for the test
- `Makefile` — `benchmark-embed` target

---

### 4.7 Developer Experience

| Item | Description |
|------|-------------|
| OpenAPI spec | Auto-generate Swagger docs for all `/rag-api/` endpoints via DRF Spectacular |
| Python SDK snippet | One-page guide: ingest a folder, query it, get citations — using `requests` |
| Local dev fixture | `make rag-seed` command that loads a sample collection so new contributors can test without uploading real documents |
| End-to-end test suite | Pytest suite covering upload → query → citation roundtrip against a local Weaviate instance |
| Changelog | `docs/rag-changelog.md` tracking shipped RAG features by release |
