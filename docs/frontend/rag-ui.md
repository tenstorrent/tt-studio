# RAG Management UI

<details>
<summary>Relevant source files</summary>
<ul>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/chatui/MessageActions.tsx">app/frontend/src/components/chatui/MessageActions.tsx</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/chatui/runInference.ts">app/frontend/src/components/chatui/runInference.ts</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/chatui/types.ts">app/frontend/src/components/chatui/types.ts</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/rag/RagDataSourceForm.tsx">app/frontend/src/components/rag/RagDataSourceForm.tsx</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/rag/RagManagement.tsx">app/frontend/src/components/rag/RagManagement.tsx</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/ui/file-upload.tsx">app/frontend/src/components/ui/file-upload.tsx</a></li>
</ul>
</details>



The RAG (Retrieval-Augmented Generation) Management UI provides a comprehensive interface for managing vector database collections, uploading documents, and configuring context injection for chat sessions. It allows users to create isolated knowledge bases, track document chunking, and perform administrative operations on collections.

## Core Components

### RagManagement Component
The primary interface for users to interact with their RAG data sources. It handles the display of existing collections, their associated documents, and the primary actions for data ingestion [app/frontend/src/components/rag/RagManagement.tsx:125-131](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/rag/RagManagement.tsx#L125-L131). It maintains state for `ragDataSources`, `loading` status, and `expandedRows` to show document details [app/frontend/src/components/rag/RagManagement.tsx:130-140](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/rag/RagManagement.tsx#L130-L140).

**Key Features:**
*   **Collection Lifecycle:** Users can create new collections via the `RagDataSourceForm` [app/frontend/src/components/rag/RagDataSourceForm.tsx:11-15](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/rag/RagDataSourceForm.tsx#L11-L15) and delete them with a confirmation dialog [app/frontend/src/components/rag/RagManagement.tsx:244-250](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/rag/RagManagement.tsx#L244-L250).
*   **Document Management:** Displays document metadata including chunk counts, file extensions, and upload dates [app/frontend/src/components/rag/RagManagement.tsx:107-115](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/rag/RagManagement.tsx#L107-L115).
*   **Loading States:** Uses `RagManagementSkeleton` to provide visual feedback during data fetching [app/frontend/src/components/rag/RagManagement.tsx:32-32](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/rag/RagManagement.tsx#L32-L32).
*   **Expanded Rows:** Users can toggle collection details to view specific `DocumentInfo` entries [app/frontend/src/components/rag/RagManagement.tsx:140-150](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/rag/RagManagement.tsx#L140-L150).

### RagAdmin Component
A restricted interface requiring authentication to manage all collections across the system, regardless of the browser session.

**Key Features:**
*   **Authentication:** Access is protected by a password-based challenge.
*   **Global Visibility:** Lists all collections in the system, identifying them by user type (e.g., "Anonymous (Browser Session)" or "Authenticated User").
*   **Bulk Management:** Allows administrators to refresh the global collection list or delete any collection in the system.

**Sources:** [app/frontend/src/components/rag/RagManagement.tsx:125-150](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/rag/RagManagement.tsx#L125-L150), [app/frontend/src/components/rag/RagDataSourceForm.tsx:11-25](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/rag/RagDataSourceForm.tsx#L11-L25)

---

## Session Tracking & Security

TT-Studio utilizes a unique `X-Browser-ID` to track and isolate RAG collections for anonymous users.

### X-Browser-ID Implementation
The system generates a persistent UUID stored in `localStorage` under the key `tt_studio_browser_id` to identify the browser session [app/frontend/src/components/rag/RagManagement.tsx:64-76](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/rag/RagManagement.tsx#L64-L76).

1.  **Generation:** If no ID exists, a new UUID is created using `uuidv4()` [app/frontend/src/components/rag/RagManagement.tsx:71-72](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/rag/RagManagement.tsx#L71-L72).
2.  **Interception:** The application wraps the native `window.fetch` to automatically inject the `X-Browser-ID` header into every request [app/frontend/src/components/rag/RagManagement.tsx:79-97](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/rag/RagManagement.tsx#L79-L97).

### Data Flow: Session-Aware API Requests
The following diagram illustrates how the `X-Browser-ID` bridges the frontend components to the backend API.

**Session-Aware Request Architecture**
```mermaid
graph TD
    subgraph "Frontend Space [React]"
        A["RagManagement.tsx"] -- "calls" --> B["fetchCollections()"]
        C["window.fetch override"] -- "injects header" --> B
        D["localStorage: tt_studio_browser_id"] -- "provides ID" --> C
    end

    subgraph "Network Layer"
        B -- "HTTP GET /collections-api/" --> E["Request with X-Browser-ID header"]
    end

    subgraph "Backend Space [Django]"
        E -- "Auth Check" --> F["vector_db_control app"]
        F -- "Filter by X-Browser-ID" --> G["ChromaDB Collections"]
    end
```
**Sources:** [app/frontend/src/components/rag/RagManagement.tsx:64-97](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/rag/RagManagement.tsx#L64-L97)

---

## Document Ingestion

The UI supports multi-modal document ingestion, primarily focusing on PDF and text-based documents.

### Upload Workflow
1.  **Trigger:** Users utilize the `GentleFileUpload` component or drag-and-drop files onto a collection row [app/frontend/src/components/rag/RagManagement.tsx:31-31](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/rag/RagManagement.tsx#L31-L31), [app/frontend/src/components/rag/RagManagement.tsx:137-138](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/rag/RagManagement.tsx#L137-L138).
2.  **Validation:** The system detects file types (PDF, text, etc.) defined in `FileData` [app/frontend/src/components/chatui/types.ts:14-14](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/chatui/types.ts#L14-L14). The `RagDataSourceForm` validates collection names to ensure they contain no spaces and are at least 2 characters long [app/frontend/src/components/rag/RagDataSourceForm.tsx:16-25](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/rag/RagDataSourceForm.tsx#L16-L25).
3.  **Transmission:** Files are uploaded using the `uploadDocument` function which interfaces with the backend RAG endpoints [app/frontend/src/components/rag/RagManagement.tsx:17-19](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/rag/RagManagement.tsx#L17-L19).

### UI Interaction
The `FileUpload` component uses `react-dropzone` to handle file selection and provides visual feedback via `framer-motion` animations [app/frontend/src/components/ui/file-upload.tsx:7-19](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/ui/file-upload.tsx#L7-L19), [app/frontend/src/components/ui/file-upload.tsx:47-50](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/ui/file-upload.tsx#L47-L50).

**Sources:** [app/frontend/src/components/rag/RagManagement.tsx:137-140](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/rag/RagManagement.tsx#L137-L140), [app/frontend/src/components/ui/file-upload.tsx:30-50](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/ui/file-upload.tsx#L30-L50), [app/frontend/src/components/chatui/types.ts:11-29](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/chatui/types.ts#L11-L29), [app/frontend/src/components/rag/RagDataSourceForm.tsx:16-25](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/rag/RagDataSourceForm.tsx#L16-L25)

---

## Context Injection (getRagContext)

Before an inference request is sent to the LLM, the system retrieves relevant snippets from the selected RAG datasource.

### Retrieval Logic
The `getRagContext` function performs the following:
*   **Single Collection:** Queries a specific collection using the user's prompt.
*   **Special-All:** If the "All Collections" source is selected, it queries across all available collections and prefixes the context with the source collection name.

### Integration with runInference
`runInference.ts` orchestrates the retrieval before calling the model API:
1.  It calls `getRagContext` if a `ragDatasource` is provided [app/frontend/src/components/chatui/runInference.ts:44-50](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/chatui/runInference.ts#L44-L50).
2.  The returned documents are passed to `generatePrompt`, which formats them into a system-level context block for the LLM [app/frontend/src/components/chatui/runInference.ts:143-149](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/chatui/runInference.ts#L143-L149).
3.  **File-based Context:** If a user uploads a text file directly in chat, `runInference` processes it as an ad-hoc RAG context via `processUploadedFiles`, merging it with any existing collection context [app/frontend/src/components/chatui/runInference.ts:15-15](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/chatui/runInference.ts#L15-L15), [app/frontend/src/components/chatui/runInference.ts:57-76](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/chatui/runInference.ts#L57-L76).

**RAG Retrieval to Prompt Flow**
```mermaid
sequenceDiagram
    participant UI as "ChatComponent.tsx"
    participant RI as "runInference.ts"
    participant GRC as "getRagContext.ts"
    participant API as "Vector DB API"

    UI->>RI: runInference(request, ragDatasource)
    RI->>GRC: getRagContext(request, ragDatasource)
    GRC->>API: GET /collections-api/{name}/query
    API-->>GRC: { documents: [...] }
    GRC-->>RI: ragContext
    RI->>RI: generatePrompt(chatHistory, ragContext)
    RI->>API: POST /models-api/inference/
```
**Sources:** [app/frontend/src/components/chatui/runInference.ts:42-50](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/chatui/runInference.ts#L42-L50), [app/frontend/src/components/chatui/runInference.ts:143-150](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/chatui/runInference.ts#L143-L150), [app/frontend/src/components/chatui/runInference.ts:57-76](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/chatui/runInference.ts#L57-L76)

---

## Key Data Structures

### RagDataSource
Defines the metadata and document list for a specific vector collection [app/frontend/src/components/rag/RagManagement.tsx:99-105](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/rag/RagManagement.tsx#L99-L105).

| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | `string` | Unique identifier for the collection. |
| `name` | `string` | User-defined name (validated to have no spaces) [app/frontend/src/components/rag/RagDataSourceForm.tsx:22-24](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/rag/RagDataSourceForm.tsx#L22-L24). |
| `metadata` | `Record<string, string>` | Includes `created_at`, `embedding_func_name`, and `last_uploaded_document` [app/frontend/src/components/chatui/types.ts:65-69](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/chatui/types.ts#L65-L69). |
| `documents` | `DocumentInfo[]` | List of files ingested into this collection [app/frontend/src/components/rag/RagManagement.tsx:103-103](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/rag/RagManagement.tsx#L103-L103). |

### DocumentInfo
Details regarding individual files within a collection [app/frontend/src/components/rag/RagManagement.tsx:107-115](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/rag/RagManagement.tsx#L107-L115).

| Field | Type | Description |
| :--- | :--- | :--- |
| `filename` | `string` | Original name of the uploaded file. |
| `chunks_count` | `number` | Number of vector segments created from the file. |
| `upload_date` | `string` | ISO timestamp of ingestion. |
| `file_extension` | `string` | Extension used for icon rendering (e.g., PDF, TXT). |

**Sources:** [app/frontend/src/components/rag/RagManagement.tsx:99-115](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/rag/RagManagement.tsx#L99-L115), [app/frontend/src/components/chatui/types.ts:62-70](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/chatui/types.ts#L62-L70), [app/frontend/src/components/rag/RagDataSourceForm.tsx:16-25](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/rag/RagDataSourceForm.tsx#L16-L25)2c:T2ac3,# Specialized Model Interfaces
