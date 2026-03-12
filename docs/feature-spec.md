# TT-Studio Feature Specification

Unified feature specification for all TT-Studio blueprints. Each section documents the current state, known gaps (including open TODOs in the codebase), and upcoming features with user stories and acceptance criteria.

---

## Blueprint Completeness Matrix

A quick view of which capability categories each blueprint has today.

| Blueprint | Streaming | History / Persistence | Parameter Controls | Multi-Model | Export | Observability |
|-----------|:---------:|:--------------------:|:-----------------:|:-----------:|:------:|:-------------:|
| LLM Chat | ✅ | ✅ IndexedDB | ✅ | — | ⚠️ partial | ✅ TTFT/TPOT |
| VLM | ✅ | — | ✅ | — | — | ⚠️ partial |
| Image Generation | — async | — | ⚠️ partial | — | — | — |
| Video Generation | — async | — | — | — | — | — |
| RAG | ✅ | ✅ ChromaDB | — | ✅ LLM+Embed | — | — |
| AI Agent | ✅ | ✅ threads | — | ✅ auto-disc | — | — |
| Voice Pipeline | ✅ SSE | — | ⚠️ sys prompt | ✅ 3-model | — | — |
| Object Detection | — sync | — | — | — | — | — |
| Application Integrations | — | — | — | ⚠️ LiteLLM planned | — | — |

✅ = implemented · ⚠️ = partial · — = not yet implemented

---

## Blueprint Specs

---

### 1. LLM Chat

Interactive streaming chat for instruction-tuned LLMs deployed via vLLM on Tenstorrent hardware.

**Reference:** [`docs/blueprints/llm-chat.md`](blueprints/llm-chat.md)

#### Current Feature Inventory

| Feature | Status | Notes |
|---------|--------|-------|
| SSE token streaming | ✅ Complete | `model_control/views.py:InferenceView` |
| Sampling params (temp, top_k, top_p, max_tokens) | ✅ Complete | |
| OpenAI-compatible `/v1/chat/completions` | ✅ Complete | via vLLM |
| Multi-turn conversation history | ✅ Complete | |
| Cloud LLM fallback | ✅ Complete | `CLOUD_CHAT_UI_URL` |
| RAG context injection | ✅ Complete | paired with ChromaDB collection |
| 24 pre-configured models (1B–120B) | ✅ Complete | see model catalog |
| Thinking tokens display (DeepSeek, QwQ) | ✅ Complete | |
| Per-request inference metrics (TTFT, TPOT) | ✅ Complete | `metrics_tracker.py` |
| Persistent chat history (IndexedDB) | ✅ Complete | |

#### Known Gaps / TODOs

- `deploy_id` is the Docker container ID, not a stable semantic identifier — breaks if container restarts (`docker_control/serializers.py:29`)
- `weight_id` is currently the filename, not a stable slug (`serializers.py:29`)
- No per-user or per-session rate limiting on the inference endpoint
- No standardized conversation export format

#### Upcoming Features

---

**Stable `deploy_id` / `weight_id`**

Replace container-ID-based identifiers with stable, persistent UUIDs so client integrations survive container restarts.

- **User Story:** As a developer integrating the API, I want `deploy_id` to be stable across container restarts so my client code does not break when a model is restarted.
- **Acceptance Criteria:**
  - [ ] `deployment_store.py` generates a UUID `deploy_id` at first deploy and persists it in `deployments.json`
  - [ ] `weight_id` maps to a human-readable slug (e.g., `llama-3.1-8b-instruct`), not a filename
  - [ ] All views, the deploy cache in `model_utils.py`, and the serializer use the new ID without regression
  - [ ] Changelog documents the breaking change for API consumers
- **Affected Files:** `app/backend/docker_control/deployment_store.py`, `app/backend/docker_control/serializers.py`, `app/backend/model_control/model_utils.py`

---

**LiteLLM Inference Gateway**

Route all LLM inference through a single OpenAI-compatible LiteLLM gateway with Postgres-backed logging.

- **User Story:** As a platform operator, I want a single stable entry point for all deployed LLMs so I can audit traffic, swap backends without frontend changes, and avoid stale deploy-cache entries across restarts.
- **Acceptance Criteria:** See full spec in [`docs/bounties/litellm-inference-gateway.md`](bounties/litellm-inference-gateway.md) (Stages 1–3).
- **Affected Files:** `app/backend/model_control/views.py`, `app/backend/model_control/model_utils.py`, `app/docker-compose.yml`, new `app/docker-compose.gateway.yml`
- **Dependencies:** Stable `deploy_id`

---

**Conversation Export**

Export any chat thread as JSONL or Markdown directly from the chat UI.

- **User Story:** As a researcher, I want to export a conversation with all turns, timestamps, and inference stats so I can include it in a report or reproduce the results.
- **Acceptance Criteria:**
  - [ ] Export button in the chat history panel produces `.jsonl` (OpenAI message format) or `.md`
  - [ ] Export includes model name, `deploy_id`, sampling params, and per-message inference stats
  - [ ] Works from IndexedDB-persisted history (no server round-trip required)
- **Affected Files:** `app/frontend/src/components/chatui/HistoryPanel.tsx`

---

**System Prompt Templates**

Pre-built and user-defined system prompt templates selectable from the settings panel.

- **User Story:** As a developer evaluating a model for a specific use case (coding assistant, customer support), I want to switch system prompts quickly without typing from scratch.
- **Acceptance Criteria:**
  - [ ] Settings panel exposes a dropdown with built-in templates: Code Assistant, Analyst, Generic
  - [ ] User can save custom templates to browser local storage
  - [ ] Active template name is displayed in the chat header
- **Affected Files:** `app/frontend/src/components/chatui/Settings.tsx`

---

**Side-by-Side Model Comparison**

Run the same prompt against two deployed models simultaneously in a split view.

- **User Story:** As a researcher, I want to send one prompt to two models at the same time and see their responses and inference stats side-by-side so I can compare quality and throughput.
- **Acceptance Criteria:**
  - [ ] New `/compare` route or modal accepts a second `deploy_id`
  - [ ] Both SSE streams run concurrently; inference stats shown per model
  - [ ] Works with any two deployed CHAT or VLM models
- **Affected Files:** New `app/frontend/src/components/chatui/CompareView.tsx`, `app/backend/model_control/views.py`

---

**Benchmark / Throughput Test Mode**

A headless benchmark runner that sends N prompts and aggregates latency statistics.

- **User Story:** As a hardware evaluator, I want to run a repeatable throughput test against a deployed model so I can publish performance numbers for a specific TT device.
- **Acceptance Criteria:**
  - [ ] `GET /api/models/benchmark/` accepts `deploy_id`, `prompt`, `n_runs`, `concurrency`
  - [ ] Returns aggregated p50/p95/p99 TTFT and TPOT
  - [ ] Results downloadable as CSV
- **Affected Files:** New `app/backend/model_control/benchmark_views.py`

---

### 2. VLM (Vision Language Model)

Multimodal chat combining text and image understanding via vLLM on Tenstorrent hardware.

**Reference:** [`docs/blueprints/vlm.md`](blueprints/vlm.md)

#### Current Feature Inventory

| Feature | Status | Notes |
|---------|--------|-------|
| Text + image multimodal input | ✅ Functional | |
| File upload + URL image sources | ✅ Functional | |
| SSE token streaming | ✅ Functional | same endpoint as LLM Chat |
| Multi-turn with mixed content history | ✅ Functional | |
| OpenAI vision message format | ✅ Functional | `image_url` content blocks |
| Sampling params | ✅ Functional | |
| 12 pre-configured models (3B–90B) | ✅ Functional/Experimental | incl. MedGemma |

#### Known Gaps / TODOs

- Only one image per conversation turn is supported in the current UI
- MedGemma models (`medgemma-4b-it`, `medgemma-27b-it`) have no domain-specific UI affordances
- No visual feedback when the model references a specific region of the image

#### Upcoming Features

---

**Multi-Image Per Turn**

Allow users to attach multiple images in a single conversation turn.

- **User Story:** As a researcher, I want to compare two images in the same message so I can ask the model to identify differences between them.
- **Acceptance Criteria:**
  - [ ] Up to 4 images per turn supported in the `messages` array
  - [ ] UI shows an image thumbnail strip with per-image remove controls
  - [ ] Backend formats as multiple `image_url` content blocks per the OpenAI vision spec
- **Affected Files:** `app/frontend/src/components/chatui/InputArea.tsx`, `app/frontend/src/components/chatui/processUploadedFiles.tsx`, `app/backend/model_control/views.py`

---

**Medical / Domain-Specific UI for MedGemma**

When a MedGemma model is deployed, surface a dedicated upload flow and pre-filled prompt templates for clinical language.

- **User Story:** As a clinician evaluating AI-assisted diagnosis, I want a UI tailored to medical imaging so I do not need to manually configure a general VLM interface.
- **Acceptance Criteria:**
  - [ ] Model type detection: if `model_id` contains `medgemma`, activate MedVLM mode
  - [ ] Medical prompt templates pre-loaded (e.g., "Describe the findings in this chest X-ray")
  - [ ] DICOM → PNG conversion on the frontend before upload (using a JS DICOM library)
- **Affected Files:** `app/frontend/src/components/chatui/Header.tsx`, new `app/frontend/src/components/chatui/MedVLMTemplates.ts`

---

**Image Annotation Overlay**

Render bounding box coordinates from the VLM response as overlays on the source image.

- **User Story:** As a developer, I want the VLM to visually mark regions it references in its response so the spatial grounding is visible.
- **Acceptance Criteria:**
  - [ ] Response parser detects JSON bounding box output `[x1, y1, x2, y2, label]`
  - [ ] Canvas overlay renders labeled bounding boxes on the attached image
  - [ ] Overlay togglable with a button
- **Affected Files:** `app/frontend/src/components/chatui/ImagePreview.tsx`

---

**Video Frame Extraction for VLM Queries**

Accept a short video clip, extract N frames, and send them as a multi-image VLM query.

- **User Story:** As a developer, I want to ask a VLM questions about a video clip without manually extracting frames.
- **Acceptance Criteria:**
  - [ ] Frontend accepts WebM/MP4 clips up to 30 seconds
  - [ ] Extracts evenly-spaced frames (default: 4) using the Canvas API
  - [ ] Frames submitted as a multi-image turn; model responds about the sequence
- **Affected Files:** `app/frontend/src/components/chatui/InputArea.tsx`

---

### 3. Image Generation

Text-to-image generation using diffusion models via the Media Engine on Tenstorrent hardware.

**Reference:** [`docs/blueprints/image-generation.md`](blueprints/image-generation.md)

#### Current Feature Inventory

| Feature | Status | Notes |
|---------|--------|-------|
| Text-to-image | ✅ Complete | async task queue + polling |
| Image-to-image (SDXL img2img) | ✅ Complete | |
| Inpainting (SDXL) | ✅ Complete | |
| Async task queue + status polling | ✅ Complete | `/enqueue` → `/status/{id}` → `/fetch_image/{id}` |
| Cloud fallback | ✅ Complete | `CLOUD_STABLE_DIFFUSION_URL` |
| 9 models (SDXL, FLUX, SD3.5, Motif, Qwen) | ✅ Complete/Functional | |
| Gallery / showcase display | ✅ Complete | |

#### Known Gaps / TODOs

- No negative prompt field exposed in the UI
- No seed/reproducibility controls
- No guidance scale (CFG) or number of inference steps controls
- No generation history — results are lost on page reload
- No batch generation (single image per request)

#### Upcoming Features

---

**Full Generation Parameter Controls**

Expose negative prompt, seed, guidance scale, and inference steps in the generation UI.

- **User Story:** As a power user, I want control over CFG scale and seed so I can reproduce results and tune the quality/speed trade-off.
- **Acceptance Criteria:**
  - [ ] Settings panel adds: `negative_prompt` (text), `seed` (integer, optional), `guidance_scale` (float 1–20, default 7.5), `num_inference_steps` (integer, default 30)
  - [ ] All parameters passed through to the Media Engine enqueue request
  - [ ] Seed is displayed on the result card so results are reproducible
- **Affected Files:** `app/frontend/src/components/imageGen/ImageInputArea.tsx`, `app/frontend/src/components/imageGen/StableDiffusionChat.tsx`, `app/backend/model_control/views.py`

---

**Generation History with Persistent Gallery**

Store all generated images in IndexedDB with their prompts, parameters, and timestamps.

- **User Story:** As a designer, I want to revisit images I generated earlier and replay the exact prompt and settings so I can iterate on results across sessions.
- **Acceptance Criteria:**
  - [ ] Each completed generation saved to IndexedDB: `{task_id, prompt, params, image_data_url, timestamp, model_id}`
  - [ ] History panel shows thumbnails with prompt and model name
  - [ ] One-click "Remix" re-populates the input form with stored params
  - [ ] History persists across page reloads
- **Affected Files:** `app/frontend/src/components/imageGen/ShowcaseGallery.tsx`, new `app/frontend/src/components/imageGen/generationHistoryManager.ts`

---

**Batch Generation**

Submit one prompt and generate N images in parallel, displayed as a grid.

- **User Story:** As a researcher, I want to generate 4 images from one prompt simultaneously so I can compare outputs across different seeds.
- **Acceptance Criteria:**
  - [ ] `num_images` parameter (1–4) added to the UI and request payload
  - [ ] Backend fans out N concurrent enqueue calls
  - [ ] Gallery renders a 2×2 or 1×4 grid for batch results
- **Affected Files:** `app/backend/model_control/views.py`, `app/frontend/src/components/imageGen/ImageGenParentComponent.tsx`

---

**Prompt Enhancement via LLM**

Optional "Enhance Prompt" button that uses a deployed LLM to expand the user's raw prompt into a more detailed diffusion-optimized one.

- **User Story:** As a non-expert user, I want the system to help me write better image prompts so my outputs are higher quality without requiring diffusion expertise.
- **Acceptance Criteria:**
  - [ ] Button only appears when an LLM is also deployed
  - [ ] Calls `/api/models/inference/` with a system prompt that instructs prompt expansion
  - [ ] Fills the prompt field with the enhanced result; user can edit before generating
- **Affected Files:** `app/frontend/src/components/imageGen/ImageInputArea.tsx`

---

**ControlNet / Style Reference Input**

Accept an optional reference image to steer generation style when supported by the underlying model.

- **User Story:** As an artist, I want to provide a style reference image so the model generates output in a similar visual style.
- **Acceptance Criteria:**
  - [ ] Optional reference image upload shown when model supports ControlNet
  - [ ] Reference image passed to the Media Engine endpoint alongside the text prompt

---

### 4. Video Generation

Text-to-video generation using diffusion models via the Media Engine on Tenstorrent hardware.

**Reference:** [`docs/blueprints/video-generation.md`](blueprints/video-generation.md)

#### Current Feature Inventory

| Feature | Status | Notes |
|---------|--------|-------|
| Text-to-video | ✅ Complete | async task queue + polling |
| 2 models (Mochi-1, Wan2.2-T2V-A14B) | ✅ Complete | T3K / Galaxy only |

#### Known Gaps / TODOs

- No progress feedback — user sees a spinner with no indication of how long remains
- No in-browser video player or download button
- No generation history; video URLs are lost on reload
- No parameter controls (duration, fps, resolution)
- No image-to-video (i2v) input path

#### Upcoming Features

---

**Generation Progress Events**

Stream progress updates from the task queue to the UI so users see a progress bar rather than a spinner.

- **User Story:** As a user waiting for a video to generate (which can take minutes), I want to see progress so I know the system is working and can estimate how long to wait.
- **Acceptance Criteria:**
  - [ ] Backend polls task status at a configurable interval and emits `progress` SSE events (`{step, total_steps}`) when the Media Engine exposes them
  - [ ] Frontend shows a progress bar with step count and estimated time remaining
  - [ ] Graceful fallback to an animated spinner if the Media Engine does not provide step count
- **Affected Files:** `app/backend/model_control/views.py`, frontend video generation component

---

**In-Browser Video Player with Download**

Play and download generated MP4s directly in the TT-Studio interface.

- **User Story:** As a content creator, I want to preview and download my generated video without leaving TT-Studio.
- **Acceptance Criteria:**
  - [ ] HTML5 `<video>` element with play/pause/seek/mute controls
  - [ ] Download button sets the prompt text as the default filename
  - [ ] Autoplays muted on generation completion
- **Affected Files:** Frontend video generation component

---

**Video Generation History**

Persist generated video references (prompt, params, video URL) in IndexedDB across browser sessions.

- **User Story:** As a user, I want to find videos I generated yesterday without having to regenerate them.
- **Acceptance Criteria:**
  - [ ] Same IndexedDB pattern as image generation history
  - [ ] Each entry stores: `{prompt, params, video_url, timestamp, model_id}`
  - [ ] History panel shows thumbnails (first frame) with prompt preview

---

**Generation Parameter Controls**

Expose duration, resolution, and number of inference steps in the UI.

- **User Story:** As a researcher, I want to control video length and resolution so I can trade off generation time against output quality.
- **Acceptance Criteria:**
  - [ ] `duration_seconds`, `resolution` (e.g., 480p/720p), `num_inference_steps` exposed when the deployed model supports them
  - [ ] Defaults match model-recommended settings

---

**Image-to-Video**

Accept an initial frame image and animate it with a text prompt.

- **User Story:** As a designer, I want to animate a static image I provide so I can create motion from existing artwork.
- **Acceptance Criteria:**
  - [ ] Optional image upload alongside text prompt when model supports i2v
  - [ ] Image passed as `init_image` in the enqueue request

---

### 5. RAG (Retrieval-Augmented Generation)

Document-grounded LLM chat using ChromaDB vector storage.

**Reference:** [`docs/blueprints/rag.md`](blueprints/rag.md)

#### Current Feature Inventory

| Feature | Status | Notes |
|---------|--------|-------|
| Multi-format ingestion (PDF, DOCX, TXT, PPTX, XLSX) | ✅ Complete | LangChain splitters |
| ChromaDB vector store | ✅ Complete | cosine similarity search |
| Session-scoped collections | ✅ Complete | isolated per browser session |
| Context injection into LLM chat | ✅ Complete | |
| Admin UI for collection management | ✅ Complete | `VITE_ENABLE_RAG_ADMIN` flag |
| CPU SentenceTransformer embeddings | ✅ Complete | `all-MiniLM-L6-v2` |
| Multi-collection query | ✅ Complete | `/collections/query-all` |

#### Known Gaps / TODOs

- Retrieved chunks have no source metadata displayed to the user; no citation in responses (`vector_db_control/chroma.py:42` — metadata noted as future use)
- Only fixed-size chunking strategy available; no semantic or paragraph-based splitting
- Embeddings run on CPU even when an EMBEDDING model is deployed on TT hardware
- No metadata filtering on ChromaDB queries (`chroma.py:42` comment)
- No re-ranking of retrieved results before context injection

#### Upcoming Features

---

**Source Citation in RAG Responses**

Display which document chunk(s) backed each LLM response, with filename and position reference.

- **User Story:** As a business user querying company documents, I want to see which source document backed each answer so I can verify accuracy and trust the response.
- **Acceptance Criteria:**
  - [ ] ChromaDB query returns document metadata (`source`, `page`, `chunk_index`) alongside content — resolves `chroma.py:42` TODO
  - [ ] Backend includes citation metadata in the SSE stream as a separate `sources` event type
  - [ ] Chat UI renders collapsible source citations below the LLM response (filename + page/chunk reference)
- **Affected Files:** `app/backend/vector_db_control/chroma.py`, `app/backend/model_control/views.py`, `app/frontend/src/components/chatui/StreamingMessage.tsx`

---

**On-Hardware Embedding via Deployed Embedding Models**

Route document embedding through a deployed TT EMBEDDING model instead of the CPU SentenceTransformer when one is available.

- **User Story:** As a platform operator, I want embeddings to run on Tenstorrent hardware so the full RAG pipeline demonstrates TT throughput end-to-end.
- **Acceptance Criteria:**
  - [ ] Backend detects deployed EMBEDDING-type models via the deployment store
  - [ ] If an embedding model is deployed, `chroma.py` calls it over HTTP rather than using local SentenceTransformer
  - [ ] CPU SentenceTransformer fallback preserved when no embedding model is deployed
  - [ ] No change to the ChromaDB collection schema (embeddings remain dimensionally compatible)
- **Affected Files:** `app/backend/vector_db_control/chroma.py`, `app/backend/docker_control/deployment_store.py`

---

**Chunking Strategy Selection**

Allow users to choose between fixed-size, sentence, and paragraph chunking strategies per collection.

- **User Story:** As a technical user, I want semantic chunking for prose documents and fixed-size chunking for structured data so retrieval quality matches the document type.
- **Acceptance Criteria:**
  - [ ] Upload form adds a `chunking_strategy` dropdown: Fixed (default), Sentence, Paragraph
  - [ ] Backend routes to the appropriate LangChain splitter based on selection
  - [ ] Chunk count and average chunk length reported on the collection detail view
- **Affected Files:** `app/backend/vector_db_control/`, `app/frontend/src/components/rag/RagDataSourceForm.tsx`

---

**Collection Metadata Filtering**

Scope semantic queries to a subset of documents in a collection using metadata filters.

- **User Story:** As an analyst with a collection of 20 reports, I want to query only the most recent report without creating a separate collection.
- **Acceptance Criteria:**
  - [ ] `chroma.py` passes an optional `where` clause to ChromaDB queries — resolves `chroma.py:42` TODO
  - [ ] Frontend collection query interface supports optional document filter (dropdown of documents in the collection)
- **Affected Files:** `app/backend/vector_db_control/chroma.py`

---

**Multi-Collection Result Fusion**

Merge results from multiple collections using reciprocal rank fusion before context injection.

- **User Story:** As a user with separate collections for different document sets, I want a cross-collection query to intelligently blend the best results rather than just concatenating them.
- **Acceptance Criteria:**
  - [ ] `query-all` endpoint applies RRF scoring across per-collection result sets
  - [ ] Top-K merged results passed as context; citation indicates which collection each chunk came from

---

### 6. AI Agent

Autonomous AI assistant with tool use, model auto-discovery, and persistent conversation threads.

**Reference:** [`docs/blueprints/ai-agent.md`](blueprints/ai-agent.md)

#### Current Feature Inventory

| Feature | Status | Notes |
|---------|--------|-------|
| Auto-discovery of deployed LLMs | ✅ Complete | scans `tt_studio_network` |
| Persistent conversation threads | ✅ Complete | `thread_id` tracking |
| Tavily web search tool | ✅ Complete | requires `TAVILY_API_KEY` |
| Cloud LLM fallback | ✅ Complete | |
| SSE streaming | ✅ Complete | |

#### Known Gaps / TODOs

- Tool registry is hardcoded to Tavily only — no extension mechanism
- Tool invocations are invisible to the user; no reasoning trace shown in the chat
- No agent memory across sessions (each thread starts fresh)
- No way to register custom tools without modifying agent source code

#### Upcoming Features

---

**Visible Tool Call Trace**

Display each tool invocation (name, input, output) inline as collapsible "thinking steps" before the final response.

- **User Story:** As a developer debugging agent behavior, I want to see what tools the agent called and with what arguments so I can understand why it produced a particular answer.
- **Acceptance Criteria:**
  - [ ] Agent service emits `tool_call` SSE events: `{tool_name, input, output, duration_ms}`
  - [ ] Frontend renders collapsible tool step cards in the message stream, clearly distinguished from final response text
  - [ ] Tool errors shown with clear messages rather than swallowed silently
- **Affected Files:** Agent FastAPI service (`app/`), frontend agent UI component

---

**Pluggable Tool Registry**

A structured tool registry allowing new tools to be added via a `tools/` directory convention.

- **User Story:** As a developer, I want to add a custom tool (e.g., a SQL executor, a file reader) to the agent without forking the agent service source code.
- **Acceptance Criteria:**
  - [ ] Tool defined as a Python class with `name`, `description`, `parameters` (JSON Schema), and `execute()` method
  - [ ] Tools auto-registered from a `tools/` directory at agent startup
  - [ ] New tool available after a container restart (no code change to agent core)
  - [ ] Tool inventory endpoint: `GET /api/models/agent/tools/`
- **Affected Files:** Agent FastAPI service

---

**RAG Tool Integration**

Agent can query ChromaDB collections as a tool, automatically consulting documents when relevant.

- **User Story:** As an operator who has uploaded company documents to a RAG collection, I want the agent to consult those documents as part of its reasoning without the user needing to manually switch to RAG mode.
- **Acceptance Criteria:**
  - [ ] Agent auto-discovers active ChromaDB collections via the backend API
  - [ ] `query_documents(collection_name, query)` registered as a built-in tool
  - [ ] Agent cites the source document in its final response when RAG was used
- **Affected Files:** Agent FastAPI service, `app/backend/vector_db_control/`
- **Dependencies:** Pluggable Tool Registry (P1 above)

---

**Cross-Session Episodic Memory**

Agent maintains a lightweight memory store of key facts extracted from conversations, persisted across sessions.

- **User Story:** As a returning user, I want the agent to remember facts I shared in a previous session (e.g., "I am a Python developer working on a Django project") so I do not need to repeat context.
- **Acceptance Criteria:**
  - [ ] Memory items stored in a JSON file (same pattern as `deployments.json`)
  - [ ] Agent injects relevant memories into system prompt at session start
  - [ ] `GET /api/models/agent/memory/` returns current memory; `DELETE` clears it
  - [ ] Memory extraction happens passively — user does not need to explicitly "save" facts

---

**Multi-Agent Orchestration**

A lead agent that delegates subtasks to specialized agents (e.g., a code agent, a research agent).

---

### 7. Voice Pipeline

End-to-end voice conversation pipeline: STT → LLM → TTS chained via SSE.

**Reference:** [`docs/blueprints/voice-pipeline.md`](blueprints/voice-pipeline.md)

#### Current Feature Inventory

| Feature | Status | Notes |
|---------|--------|-------|
| Whisper STT | ✅ Complete | whisper-large-v3, distil-large-v3 |
| LLM generation | ✅ Complete | any deployed CHAT model |
| SpeechT5 TTS | ✅ Complete | optional, graceful fallback |
| Per-stage SSE events (transcript, llm_chunk, audio_url, done) | ✅ Complete | |
| Configurable LLM system prompt | ✅ Complete | |
| Multipart audio file upload | ✅ Complete | |
| Text-only fallback when no TTS deployed | ✅ Complete | |

#### Known Gaps / TODOs

- Entire audio file must be recorded and uploaded before transcription begins — no streaming STT
- Conversation history is not preserved across voice turns (each request is stateless)
- UX is record-then-stop-then-submit; no hold-to-talk / push-to-talk
- Only one TTS voice (SpeechT5 default speaker embedding)

#### Upcoming Features

---

**Stateful Multi-Turn Voice Conversation**

Maintain conversation history across multiple voice exchanges so the LLM has context from prior turns.

- **User Story:** As a user having a voice conversation with the assistant, I want it to remember what I said two turns ago so the conversation is coherent.
- **Acceptance Criteria:**
  - [ ] Frontend accumulates `{role, content}` history across voice turns in component state
  - [ ] Each pipeline request includes prior turns as `conversation_history` in the request body
  - [ ] Backend passes history as the `messages` array to the LLM stage in the pipeline
  - [ ] "Clear Conversation" button resets history
- **Affected Files:** `app/frontend/src/components/pipeline/VoicePipelineDemo.tsx`, `app/backend/model_control/pipeline_views.py`

---

**Push-to-Talk UX**

Replace the record-stop-submit flow with a hold-to-speak button.

- **User Story:** As a user, I want to hold a button to speak and release to send — like a walkie-talkie — so the interaction feels natural and immediate.
- **Acceptance Criteria:**
  - [ ] `mousedown`/`touchstart` begins `MediaRecorder` capture with live waveform visualization
  - [ ] `mouseup`/`touchend` stops capture and immediately submits to the pipeline
  - [ ] Minimum recording duration of 0.5s to avoid accidental triggers
  - [ ] Keyboard shortcut (spacebar) also triggers push-to-talk
- **Affected Files:** `app/frontend/src/components/pipeline/VoicePipelineDemo.tsx`

---

**Streaming / Incremental STT Transcript**

Emit partial transcript tokens as they become available rather than waiting for the full Whisper pass.

- **User Story:** As a user who recorded a 30-second audio clip, I want to see words appear as they are transcribed so I know the pipeline is working.
- **Acceptance Criteria:**
  - [ ] Backend streams partial `transcript` SSE events if the Whisper endpoint supports chunked output
  - [ ] Frontend renders partial transcript with a typing cursor indicator
  - [ ] Graceful fallback to single-shot transcript if streaming is not supported
- **Affected Files:** `app/backend/model_control/pipeline_views.py`, `app/frontend/src/components/pipeline/VoicePipelineDemo.tsx`

---

**Multiple TTS Voice Options**

Allow users to select from available TTS voice presets.

- **User Story:** As a user, I want to choose the voice character of the assistant response so the output matches my preference.
- **Acceptance Criteria:**
  - [ ] Voice selector dropdown shown when TTS is available
  - [ ] Selected `speaker_embedding` or voice preset passed to the TTS stage
  - [ ] Voice preference persisted in browser local storage

---

**Wake Word Detection**

Browser-side wake word that initiates a voice turn without pressing any button.

---

### 8. Object Detection

Image classification and object detection using CNN models via Forge on Tenstorrent hardware.

**Reference:** [`docs/blueprints/object-detection.md`](blueprints/object-detection.md)

#### Current Feature Inventory

| Feature | Status | Notes |
|---------|--------|-------|
| Image file upload | ✅ Complete | |
| 320×320 preprocessing | ✅ Complete | handled by control plane |
| CNN inference via Forge | ✅ Complete | |
| Bounding boxes, class labels, confidence scores | ✅ Complete | |
| Cloud fallback | ✅ Complete | `CLOUD_YOLOV4_API_URL` |
| 7 models (ResNet, EfficientNet, ViT, VoVNet, MobileNetV2, SegFormer, UNet) | ✅ Complete | Wormhole only |
| Webcam single-frame capture | ✅ Complete | |
| Detection results table | ✅ Complete | |

#### Known Gaps / TODOs

- No confidence threshold filter — all detections shown regardless of confidence
- Segmentation models (SegFormer, UNet) display results in the same table as detection models — no mask overlay
- Webcam is single-frame only; no continuous real-time inference loop
- CNN models validated only on Wormhole (N150/N300) — Blackhole/Galaxy untested

#### Upcoming Features

---

**Confidence Threshold Filter**

A slider that filters detections below a user-specified confidence level.

- **User Story:** As a user reviewing detection results, I want to hide low-confidence detections so I focus on the meaningful ones.
- **Acceptance Criteria:**
  - [ ] Threshold slider (0–100%) in the detection results panel
  - [ ] Results table and bounding box overlay update reactively as slider moves (no re-inference required)
  - [ ] Default threshold: 50%
  - [ ] Threshold value persisted in local storage
- **Affected Files:** `app/frontend/src/components/object_detection/DetectionResultsTable.tsx`, `app/frontend/src/components/object_detection/ObjectDetectionComponent.tsx`

---

**Segmentation Mask Overlay**

For SegFormer and UNet models, render colored segmentation masks as an overlay on the input image.

- **User Story:** As a researcher using semantic segmentation, I want to see pixel-level class boundaries visually on the image so I can assess segmentation quality at a glance.
- **Acceptance Criteria:**
  - [ ] Backend detects model type (segmentation vs. detection) from deployment metadata and returns mask data (per-pixel class or RLE-encoded)
  - [ ] Frontend renders per-class colored overlay with an opacity slider
  - [ ] Class color legend displayed alongside the image
  - [ ] Segmentation UI is shown only when a segmentation model is deployed; detection UI shown otherwise
- **Affected Files:** `app/backend/model_control/views.py`, `app/frontend/src/components/object_detection/ObjectDetectionComponent.tsx`

---

**Real-Time Webcam Inference**

Continuously send webcam frames for inference and overlay detection results in near-real-time.

- **User Story:** As a developer demonstrating the platform, I want to show live object detection from a webcam feed so stakeholders can see the hardware's inference latency characteristics.
- **Acceptance Criteria:**
  - [ ] Frontend captures frames at a configurable rate (default: 2 fps)
  - [ ] Each frame submitted as an inference request; results overlaid on the live video feed
  - [ ] FPS counter and per-frame inference latency shown in the overlay
  - [ ] Rate automatically throttled if inference latency exceeds the frame interval
  - [ ] "Stop" button exits live mode and returns to single-frame upload
- **Affected Files:** `app/frontend/src/components/object_detection/WebcamPicker.tsx`

---

**Multi-Model Ensemble**

Run the same image through two deployed CNN models and merge their detections.

- **User Story:** As a researcher, I want to combine a ResNet classifier with a VoVNet detector so I get both classification confidence and localization in a single result view.
- **Acceptance Criteria:**
  - [ ] Optional second model selector in the detection UI
  - [ ] Backend fans out two concurrent inference requests and merges results (union of bounding boxes, deduplication by IoU)

---

**Video File Inference**

Accept an MP4/WebM file, run frame-by-frame detection, and return an annotated video.

---

---

## Cross-Cutting Platform Specs

---

### Deployment & Lifecycle Management

**Current state:** JSON deployment store (`docker_control/deployment_store.py`), health monitor background thread, JWT-secured docker-control-service, multi-chip `device_id` support.

---

**Container Health Events to Frontend**

Push container crash/exit events to the browser in real-time.

- **User Story:** As a user with a model deployed, I want a toast notification when my container crashes so I know to redeploy without having to refresh the page.
- **Acceptance Criteria:**
  - [ ] `health_monitor.py:48,62` TODOs resolved: emits events on container state change
  - [ ] New `GET /api/health/events/` SSE endpoint streams container events
  - [ ] Frontend subscribes on load and shows a toast notification with the container name and exit code
  - [ ] `ModelsDeployedTable` status badge updates reactively without a page refresh
- **Affected Files:** `app/backend/docker_control/health_monitor.py`, new `app/backend/docker_control/event_stream.py`, `app/frontend/src/`

---

**Device Management API**

Expose available Tenstorrent devices with their allocation state and health.

- **User Story:** As an operator managing a multi-chip board (T3K/Galaxy), I want to see which devices are free and which are running containers so I can make informed deployment decisions.
- **Acceptance Criteria:**
  - [ ] `docker_utils.py:379` TODO resolved: `get_available_devices()` returns real device enumeration
  - [ ] `GET /api/devices/` returns `[{device_id, type, status, allocated_to_container_id}]`
  - [ ] Frontend deployment wizard shows a device picker with availability indicators
- **Affected Files:** `app/backend/docker_control/docker_utils.py`, `app/backend/docker_control/views.py`, `app/frontend/src/components/deployment/`

---

**Stop Container by `container_id`**

`StopView` resolves the target container from the deployment store by `container_id` rather than fragile matching.

- **User Story:** As a platform operator, I want to stop a specific deployment by its ID so I do not accidentally stop the wrong container when multiple models are running.
- **Acceptance Criteria:**
  - [ ] `views.py:657` TODO resolved: `StopView` accepts `container_id` and resolves from deployment store
  - [ ] Stop is idempotent — no error returned if container is already stopped
- **Affected Files:** `app/backend/docker_control/views.py`

---

**Minimal Container Permissions (drop `cap_add: ALL`)**

Replace the blanket `cap_add: ALL` Docker capability with the minimal required set per model type.

- **User Story:** As a security-conscious operator, I want inference containers to run with least-privilege capabilities so a compromised container cannot easily escalate.
- **Acceptance Criteria:**
  - [ ] `model_config.py:211` TODO resolved: capability set defined per `ModelType`
  - [ ] `cap_add: ALL` removed from all model configurations
  - [ ] All existing model types pass integration tests with the reduced capability set
- **Affected Files:** `app/backend/shared_config/model_config.py`

---

### Inference Gateway

Full specification in [`docs/bounties/litellm-inference-gateway.md`](bounties/litellm-inference-gateway.md).

**LiteLLM Gateway — Stages 1–3**

- **Stage 1:** `docker-compose.gateway.yml` brings up LiteLLM + Postgres on `tt_studio_network`
- **Stage 2:** Backend routes LLM inference through `http://litellm:4000/v1/...` when `USE_LITELLM_GATEWAY=true`
- **Stage 3:** Runtime endpoint management API; new deployments auto-register with the gateway

**Key files:** `app/docker-compose.gateway.yml` (new), `app/gateway/litellm_config.yaml` (new), `app/backend/model_control/views.py`, `app/backend/docker_control/views.py`, `run.py`

---

### Security & Permissions

**Current state:** JWT between backend and docker-control-service. No user-facing auth (empty DRF auth classes — intentional for local/dev deployments).

---

**Input Validation Hardening**

Validate all user-supplied inputs at the API boundary.

- **User Story:** As a security engineer, I want all API inputs validated at the Django view layer so injection-style attacks are rejected before they reach the container orchestration layer.
- **Acceptance Criteria:**
  - [ ] `docker_utils.py:700` TODO resolved: `run_container()` validates `image_name`, `container_name`, and `volume` against an allowlist pattern before use
  - [ ] `backend_config.py:27` TODO resolved: path inputs validated with `pathlib.Path` before use
  - [ ] All `model_id` and `deploy_id` inputs validated as UUID or known slug format
  - [ ] Invalid inputs return 400 with a descriptive message — never reach subprocess or Docker calls
- **Affected Files:** `app/backend/docker_control/docker_utils.py`, `app/backend/shared_config/backend_config.py`

---

**Optional Multi-User Auth**

Feature-flagged user authentication layer so teams can run a shared TT-Studio instance.

- **User Story:** As a team lead managing a shared Tenstorrent server, I want each team member to have their own login so their RAG collections and deployment history are private.
- **Acceptance Criteria:**
  - [ ] Opt-in via `VITE_ENABLE_AUTH=true` feature flag
  - [ ] Django SimpleJWT or API-key auth added to DRF settings when enabled
  - [ ] Deployment store and ChromaDB collections scoped to `user_id` when auth is active
  - [ ] No behavior change when flag is off — current no-auth local dev UX preserved
- **Affected Files:** `app/backend/` DRF settings, `app/backend/docker_control/deployment_store.py`, `app/backend/vector_db_control/`

---

**Container Network Isolation Per Deployment**

Restrict inference containers to communicate only with the backend proxy.

- **User Story:** As a security-conscious operator, I want each inference container on its own network segment so a compromised container cannot reach other inference containers or internal services.
- **Acceptance Criteria:**
  - [ ] Each inference container placed on a per-deployment Docker network
  - [ ] Only the backend container can reach the inference container port
  - [ ] `tt_studio_network` used only for control-plane traffic between TT-Studio services

---

### Observability & Metrics

**Current state:** `InferenceMetricsTracker` captures TTFT, TPOT, p95/p99 per request. Metrics are in-memory only — no persistence, no aggregation, no export.

---

**Persistent Request Log**

Write every inference request to a structured append-only log file.

- **User Story:** As a platform operator, I want a record of all inference requests so I can analyze usage patterns and identify performance regressions over time.
- **Acceptance Criteria:**
  - [ ] Log written to `$INTERNAL_PERSISTENT_STORAGE_VOLUME/backend_volume/inference_log.jsonl`
  - [ ] Each entry: `{timestamp, deploy_id, model_id, prompt_tokens, completion_tokens, ttft_s, tpot_s, total_s, blueprint}`
  - [ ] Log rotation at 100 MB with 5 retained files
  - [ ] `GET /api/metrics/summary/` returns aggregated stats for the last 24 hours
- **Affected Files:** `app/backend/model_control/metrics_tracker.py`, new `app/backend/model_control/request_log.py`

---

**Prometheus Metrics Endpoint**

Export request counts, latency histograms, and token throughput in Prometheus format.

- **User Story:** As an infrastructure engineer, I want to scrape TT-Studio metrics into Prometheus/Grafana so I can build dashboards and set up alerts.
- **Acceptance Criteria:**
  - [ ] `GET /metrics` returns Prometheus text format
  - [ ] Metrics exposed: `ttstudio_inference_requests_total{model,blueprint}`, `ttstudio_ttft_seconds{model}` histogram, `ttstudio_tokens_per_second{model}` gauge
  - [ ] Opt-in via `ENABLE_PROMETHEUS=true`
- **Affected Files:** New `app/backend/metrics_export.py`

---

**Per-Blueprint Performance Dashboard**

A `/performance` page in the frontend showing aggregate TTFT, TPOT, and token throughput charts per deployed model.

- **User Story:** As a hardware evaluator, I want an in-app dashboard showing inference performance so I can share it with stakeholders without external tooling.
- **Acceptance Criteria:**
  - [ ] Charts for: TTFT over time, TPOT distribution, tokens/second per model
  - [ ] Filter by model, blueprint, and time range
  - [ ] Data sourced from the persistent request log

---

### Developer Experience

**Current state:** `run.py` CLI with `--device-id`, `--easy`, `--dev`, `--cleanup` modes; pre-commit hooks; feature flags via `VITE_*` env vars; blueprint docs in `docs/blueprints/`.

---

**Startup Path Validation**

Validate all configurable paths at startup with clear, actionable error messages.

- **User Story:** As a first-time deployer, I want a clear error message if a required volume path is misconfigured so I can fix it without digging through logs.
- **Acceptance Criteria:**
  - [ ] `backend_config.py:27` TODO resolved
  - [ ] Startup check function validates all path configs using `pathlib.Path` and exits with a descriptive message on any misconfiguration
  - [ ] Invalid path produces: `ERROR: INTERNAL_PERSISTENT_STORAGE_VOLUME path '/foo' does not exist. Create it or set a valid path.`
- **Affected Files:** `app/backend/shared_config/backend_config.py`

---

**Blueprint Scaffold CLI**

`run.py --new-blueprint <name>` generates the boilerplate for a new blueprint.

- **User Story:** As a contributor adding a new blueprint, I want a scaffold command so I spend time on logic rather than wiring up boilerplate across four layers.
- **Acceptance Criteria:**
  - [ ] Generates `app/backend/model_control/<name>_views.py` with a stub view
  - [ ] Appends a URL entry to `app/backend/model_control/urls.py`
  - [ ] Generates `app/frontend/src/pages/<Name>Page.tsx`
  - [ ] Adds a route entry to `app/frontend/src/route-config.tsx`
  - [ ] Creates `docs/blueprints/<name>.md` from the existing template structure
- **Affected Files:** `run.py`

---

**OpenAPI Schema Auto-Generation**

Generate and serve an OpenAPI 3.0 spec from the Django views.

- **User Story:** As a developer building an external application on top of TT-Studio, I want a Swagger/OpenAPI spec so I can generate typed client code without reading Django source.
- **Acceptance Criteria:**
  - [ ] `drf-spectacular` added to requirements
  - [ ] `GET /api/schema/` serves OpenAPI YAML
  - [ ] Swagger UI served at `/api/docs/`
  - [ ] All existing views decorated with schema annotations
- **Affected Files:** `app/backend/requirements.txt`, `app/backend/` DRF settings, view files

---

**One-Command E2E Test Suite**

`python run.py --test` runs all blueprint integration tests headlessly without Tenstorrent hardware.

- **User Story:** As a CI engineer, I want a single command to validate all blueprints against a mock inference backend so tests run in any CI environment.
- **Acceptance Criteria:**
  - [ ] Mock inference server responds to all Media Engine and vLLM endpoints with fixture data
  - [ ] Tests cover the happy path for each of the 8 blueprints
  - [ ] Suite exits 0 on success, non-zero on any failure with a summary of which blueprints failed

---

**Remote Deployment Mode**

`run.py --remote <host>` configures TT-Studio to proxy inference to a remote Tenstorrent host.

- **User Story:** As a developer without local hardware, I want to run TT-Studio from my laptop while pointing at a remote server so I can develop and demo without physical access to TT hardware.
- **Acceptance Criteria:**
  - [ ] `--remote <host>` sets up an SSH tunnel to the specified host for Docker Control Service communication
  - [ ] All inference endpoints proxy through the tunnel transparently
  - [ ] Documented in `docs/remote-endpoint-setup.md`

---

### 9. Application Integrations

OpenAI-compatible access to TT-Studio deployed models from third-party clients including Open WebUI, AnythingLLM, Continue, LangChain, and any OpenAI SDK.

**Reference:** [`docs/blueprints/application-integrations.md`](blueprints/application-integrations.md)

#### Current Feature Inventory

| Feature | Status | Notes |
|---------|--------|-------|
| `/v1/chat/completions` on deployed vLLM containers | ✅ Complete | direct port access |
| `/v1/models` endpoint on deployed containers | ✅ Complete | |
| No-auth access (api_key ignored) | ✅ Complete | any string accepted as API key |
| Stable port / stable endpoint URL | ❌ Missing | port is dynamic, changes on container restart |
| LiteLLM Gateway (single front-door for all models) | ❌ Missing | see bounty spec |
| Documented integration guides (per-app) | ❌ Missing | this blueprint |
| Host-exposed port surfaced in TT-Studio UI | ⚠️ Partial | visible in status API but not prominently displayed on model card |

#### Known Gaps

- **No stable URL** — Dynamic port assignment means client configs break on container restart; no static endpoint exists at the TT-Studio layer
- **No authentication** — Deployed model containers do not enforce API key validation; unsafe on shared or public networks
- **Port not prominently surfaced in UI** — Users must inspect `/api/docker/status/` or the Docker CLI to find the container's host port
- **No `/v1/` passthrough at Django backend** — External tools must connect directly to model container ports; TT-Studio's Django backend does not proxy or expose `/v1/chat/completions` or `/v1/models`

#### Upcoming Features

**LiteLLM Gateway (Stage 1–3)**

See [`docs/bounties/litellm-inference-gateway.md`](bounties/litellm-inference-gateway.md).

- **User Story:** As a developer using Open WebUI, I want a single stable endpoint for all TT-Studio models so I don't have to reconfigure my client every time a model restarts.
- **Acceptance Criteria:**
  - [ ] `http://<host>:4000/v1/chat/completions` routes to any currently deployed model
  - [ ] `GET /v1/models` lists all active deployments dynamically
  - [ ] LiteLLM config survives `docker compose down && up`

---

**Stable Deploy Port / Expose Port in UI**

Surface the exact OpenAI base URL directly on the model card so users don't need to query the API.

- **User Story:** As a developer integrating a third-party client, I want to see the exact base URL right from the TT-Studio model card so I don't have to look it up via API.
- **Acceptance Criteria:**
  - [ ] Model card in UI shows "OpenAI Base URL: `http://localhost:XXXX/v1`"
  - [ ] Copy-to-clipboard button on the URL
  - [ ] Port is stable across container restarts (or LiteLLM gateway is used instead)
- **Affected Files:** `app/frontend/src/components/` (model card / deployed model component)

---

**API Key Enforcement (Optional)**

Allow platform operators to require a shared API key for all model access.

- **User Story:** As a platform operator, I want to optionally require an API key for model access so I can share the TT-Studio host without exposing unrestricted inference.
- **Acceptance Criteria:**
  - [ ] Optional env var `TT_STUDIO_API_KEY` — if set, all `/v1/` requests on deployed containers require `Authorization: Bearer <key>`
  - [ ] Works transparently with all supported client applications (Open WebUI, LangChain, etc.)
  - [ ] Documented in deployment and integration guides

---

## Appendix: Status Definitions

| Status | Meaning |
|--------|---------|
| ✅ Complete | Fully tested and production-ready on all supported hardware |
| ✅ Functional | Works end-to-end; may have edge cases or limited hardware coverage |
| ⚠️ Experimental | Implemented but not validated across all supported devices |
| — | Not yet implemented |
