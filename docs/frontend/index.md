# Frontend Application

<details>
<summary>Relevant source files</summary>
<ul>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/LICENSE">LICENSE</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/package-lock.json">app/frontend/package-lock.json</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/package.json">app/frontend/package.json</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/App.tsx">app/frontend/src/App.tsx</a></li>
</ul>
</details>



The TT-Studio frontend is a modern, responsive single-page application (SPA) built with **React 18**, **TypeScript**, and **Vite**. It provides the primary interface for hardware discovery, model deployment orchestration, and multi-modal AI interaction. The application is designed to handle real-time data streaming via Server-Sent Events (SSE) for both deployment progress and model inference.

## Core Technology Stack
| Category | Technology |
| :--- | :--- |
| **Framework** | React 18 (Functional Components, Hooks) [app/frontend/package.json:65](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/package.json#L65) |
| **Build Tool** | Vite 6 + SWC (Fast Refresh, Optimized Bundling) [app/frontend/package.json:90,102](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/package.json#L90) |
| **Styling** | Tailwind CSS 4 + Framer Motion (Animations) [app/frontend/package.json:61,80](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/package.json#L61) |
| **UI Components** | Radix UI Primitives + Lucide Icons [app/frontend/package.json:32-50,62](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/package.json#L32-L50) |
| **State/Data** | TanStack Query (React Query) + React Context API [app/frontend/package.json:54](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/package.json#L54) |
| **Routing** | React Router DOM v6 [app/frontend/package.json:73](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/package.json#L73) |

## Application Architecture

The application is structured around a centralized layout shell that manages navigation and global state providers. The frontend communicates with the Django backend through a series of proxied API routes defined in the Vite configuration.

### System Entry and Routing
The application initializes in `App.tsx`, wrapping the component tree in essential providers for theming, data fetching, and layout visibility [app/frontend/src/App.tsx:25-34](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/App.tsx#L25-L34). Routing is managed by `AppRouter`, which dynamically generates routes based on a configuration file [app/frontend/src/App.tsx:6,29](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/App.tsx#L6). The application also uses `QueryClient` from `@tanstack/react-query` to manage server state and caching [app/frontend/src/App.tsx:17-19](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/App.tsx#L17-L19).

### Component Hierarchy Diagram
The following diagram illustrates the relationship between the main application shell and the functional UI modules.

**Frontend Entity Map**
```mermaid
graph TD
    subgraph "App_Shell_(MainLayout)"
        "App.tsx"App_tsx["App.tsx"] --> "AppRouter"AppRouter["AppRouter"]
        "AppRouter" --> "MainLayout"MainLayout_tsx["MainLayout.tsx"]
    end

    subgraph "State_Providers"
        "ModelsProvider"ModelsContext_tsx["ModelsContext.tsx"]
        "DeviceProvider"DeviceStateContext_tsx["DeviceStateContext.tsx"]
        "RefreshProvider"RefreshContext_tsx["RefreshContext.tsx"]
        "ThemeProvider"ThemeProvider_tsx["ThemeProvider.tsx"]
        "HeroSectionProvider"HeroSectionContext_tsx["HeroSectionContext.tsx"]
        "FooterVisibilityProvider"FooterVisibilityContext_tsx["FooterVisibilityContext.tsx"]
    end

    subgraph "Functional_Modules"
        "MainLayout" --> "DeploymentWizard"SelectionSteps_tsx["SelectionSteps.tsx"]
        "MainLayout" --> "ChatUI"ChatComponent_tsx["ChatComponent.tsx"]
        "MainLayout" --> "RAG"RagManagement_tsx["RagManagement.tsx"]
        "MainLayout" --> "Specialized"ObjectDetection_STT_TTS["ObjectDetection/STT/TTS"]
    end

    "App.tsx" -.-> "ThemeProvider"
    "App.tsx" -.-> "HeroSectionProvider"
    "App.tsx" -.-> "FooterVisibilityProvider"
    "AppRouter" -.-> "ModelsProvider"
    "AppRouter" -.-> "DeviceProvider"
    "AppRouter" -.-> "RefreshProvider"
```
Sources: [app/frontend/src/App.tsx:25-34](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/App.tsx#L25-L34), [app/frontend/package.json:73](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/package.json#L73), [app/frontend/src/App.tsx:5-11](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/App.tsx#L5-L11)

## Key UI Sections

The frontend is divided into several specialized modules, each handling a specific part of the AI lifecycle.

### 1. Application Shell & Navigation
The application uses a persistent layout framework to manage global state. It utilizes `ModelsContext` to track which AI models are currently deployed and `DeviceStateContext` to monitor hardware health and chip status.
*   **Details:** See [Application Shell: Routing, Layout & Providers](app-shell.md).

### 2. Model Deployment
The deployment interface is a multi-step wizard (`SelectionSteps`) that guides users through hardware selection, chip configuration, and container deployment. It uses `useDeploymentProgress` to track real-time logs and status from the backend.
*   **Details:** See [Model Deployment UI](model-deployment-ui.md).

### 3. Chat & Inference
The core interaction hub for LLMs and Vision-Language Models. It supports streaming responses via `StreamingMessage` and handles multi-modal inputs through a unified `InputArea`.
*   **Details:** See [Chat UI](chat-ui.md).

### 4. RAG Management
A dedicated interface for managing vector databases. Users can create collections, upload documents (PDF/Text), and monitor embedding progress using session tracking via `X-Browser-ID`.
*   **Details:** See [RAG Management UI](rag-ui.md).

### 5. Specialized Interfaces
Custom UIs for non-chat models, such as Object Detection, Stable Diffusion, and Speech-to-Text. This also includes the `VoiceAgent` pipeline and `wakeword_control` integration for hands-free interaction.
*   **Details:** See [Specialized Model Interfaces](specialized-models.md).

## Build and Proxy Configuration

The application uses Vite to manage the development server and production build. A critical feature is the proxy mapping that routes frontend requests to the appropriate backend microservices.

**API Proxy Mapping**
```mermaid
graph LR
    subgraph "Frontend_Port_3000"
        "UI"React_UI["React UI"]
    end

    subgraph "Vite_Proxy"
        "D-API"docker_api["/docker-api"]
        "M-API"models_api["/models-api"]
        "C-API"collections_api["/collections-api"]
        "W-API"ws_api["/ws-api"]
    end

    subgraph "Backend_Port_8000"
        "Django"tt_studio_backend_api["tt-studio-backend-api"]
    end

    "UI" --> "D-API"
    "UI" --> "M-API"
    "UI" --> "C-API"
    "UI" --> "W-API"
    
    "D-API" --> "Django"
    "M-API" --> "Django"
    "C-API" --> "Django"
    "W-API" --> "Django"
```
Sources: [app/frontend/package.json:7-16](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/package.json#L7-L16), [app/frontend/package.json:102](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/package.json#L102)

### Build Pipeline
*   **Development:** `npm run dev` starts the Vite server on port 3000 with Hot Module Replacement (HMR) [app/frontend/package.json:7](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/package.json#L7).
*   **Production:** `npm run build` executes TypeScript type-checking (`tsc`) followed by `vite build` for optimized assets [app/frontend/package.json:8](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/package.json#L8).
*   **Asset Management:** The build process includes copying static assets for specialized features like ONNX Runtime (`onnxruntime-web`) for web-based inference [app/frontend/package.json:64,83](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/package.json#L64).
*   **Tooling:** Includes ESLint for code quality and custom scripts for enforcing SPDX license headers (`header:check`, `header:fix`) [app/frontend/package.json:19-28](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/package.json#L19-L28).
*   **Details:** See [Frontend Build, Tooling & UI Component Library](build-tooling.md).

## Directory Structure
*   `src/api/`: Axios instances and API call definitions [app/frontend/src/App.tsx:8](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/App.tsx#L8).
*   `src/components/`: Reusable UI components (buttons, cards, chat elements) [app/frontend/src/App.tsx:11](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/App.tsx#L11).
*   `src/hooks/`: Custom React hooks for global state and logic.
*   `src/layouts/`: Page structure templates (e.g., `MainLayout`).
*   `src/providers/`: React Context providers for global state [app/frontend/src/App.tsx:5-10](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/App.tsx#L5-L10).
*   `src/routes/`: Route definitions and path constants [app/frontend/src/App.tsx:6](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/App.tsx#L6).

Sources: [app/frontend/package.json:1-105](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/package.json#L1-L105), [app/frontend/src/App.tsx:1-47](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/App.tsx#L1-L47)28:T259e,# Application Shell: Routing, Layout & Providers


```{toctree}
:hidden:
:maxdepth: 2

app-shell
model-deployment-ui
chat-ui
rag-ui
specialized-models
build-tooling
```
