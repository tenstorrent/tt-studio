# TT Studio Architecture Diagrams

This folder contains architecture diagrams for TT Studio.

## How we store Mermaid code

- **Standalone diagrams**: Use `.mmd` files (e.g. `tt-studio-main/tt-studio-main.mmd`). This is the standard Mermaid source format and works with editors, Mermaid CLI, and [Mermaid Live](https://mermaid.live).
- **Inline in docs**: Use ` ```mermaid ` code blocks inside Markdown (e.g. in blueprints or feature specs).

## Files

- `tt-studio-main/tt-studio-main.mmd` – Main architecture diagram (Mermaid source)
- `tt-studio-main/tt-studio-main-arch.png` – Rendered PNG (generate from the `.mmd` when you update it)
- `rag/rag-arch.png` – RAG blueprint architecture diagram (referenced from [RAG blueprint](../blueprints/rag.md))

## Editing the main diagram

1. Open `tt-studio-main/tt-studio-main.mmd` in any text editor.
2. Edit the Mermaid syntax.
3. Preview: use [Mermaid Live Editor](https://mermaid.live) or a VS Code/Cursor extension (e.g. [Markdown Preview Mermaid Support](https://marketplace.visualstudio.com/items?itemName=bierner.markdown-mermaid) or [Mermaid Preview](https://marketplace.visualstudio.com/items?itemName=vstirbu.vscode-mermaid-preview)).
4. To refresh the PNG: paste the `.mmd` content into Mermaid Live and export, or run:
   ```bash
   npx -p @mermaid-js/mermaid-cli mmdc -i docs/architecture/tt-studio-main/tt-studio-main.mmd -o docs/architecture/tt-studio-main/tt-studio-main-arch.png
   ```

## Architecture Overview

The TT Studio architecture consists of several layers:

1. **Client Layer**: Browser-based UI
2. **Application Layer**: Docker Compose services (Frontend, Backend, Agent, ChromaDB)
3. **Orchestration Layer**: Docker Control Service running on host
4. **Device Discovery Layer**: TT-SMI inventories Tenstorrent devices and reports health status
5. **Inference Layer**: On-demand inference containers (vLLM, Media Engine, Forge)
6. **Hardware Layer**: Tenstorrent accelerators (Wormhole, Blackhole, Galaxy)

## Key Flows

- **Deployment**: Browser → Frontend → Backend → Docker Control Service → Inference Containers
- **Inference**: Browser → Frontend → Backend (proxy) → Inference Containers → Hardware
- **AI Agent**: Frontend → Agent → vLLM (auto-discovery)
- **RAG**: Backend → ChromaDB (vector storage)
- **Device Discovery**: TT-SMI → device inventory → Docker Control Service → model catalog filter → deployment routing

## Device Discovery Flow

TT-SMI runs at startup and inventories all attached Tenstorrent devices, reporting chip type, health status, and slot assignment. The Docker Control Service consumes this device map to:

1. Filter the model catalog — only models compatible with detected hardware are shown
2. Route deployments to specific chips in multi-chip configurations (via `device_id`)
3. Prevent hardware mismatch failures before a container is launched

This means TT-Studio adapts automatically to whatever hardware is present — an N150 setup sees a different model catalog than a T3K or Galaxy system.
