# TT Studio Architecture Diagrams

This folder contains architecture diagrams for TT Studio.

## Files

- `tt-studio-architecture.mmd` - Main architecture diagram in Mermaid format (editable)
- `tt-studio-architecture.excalidraw` - Alternative Excalidraw diagram (optional)

## Editing Diagrams

### Mermaid Diagram (Primary)

To edit the Mermaid diagram:

1. Open `tt-studio-architecture.mmd` in any text editor
2. Edit the Mermaid syntax directly
3. Preview changes:
   - **In VS Code/Cursor**: Install [Markdown Preview Mermaid Support](https://marketplace.visualstudio.com/items?itemName=bierner.markdown-mermaid) or [Mermaid Preview](https://marketplace.visualstudio.com/items?itemName=vstirbu.vscode-mermaid-preview)
   - **Online**: Copy/paste to [Mermaid Live Editor](https://mermaid.live)
4. Copy the updated code to the README.md mermaid code block

### Excalidraw Diagram (Optional)

1. Install the [Excalidraw extension](https://marketplace.visualstudio.com/items?itemName=pomdtr.excalidraw-editor) for VS Code/Cursor
2. Open the `.excalidraw` file directly in your editor
3. Edit the diagram visually
4. Save the file

## Architecture Overview

The TT Studio architecture consists of several layers:

1. **Client Layer**: Browser-based UI
2. **Application Layer**: Docker Compose services (Frontend, Backend, Agent, ChromaDB)
3. **Orchestration Layer**: Docker Control Service running on host
4. **Inference Layer**: On-demand inference containers (vLLM, Media Engine, Forge)
5. **Hardware Layer**: Tenstorrent accelerators (Wormhole, Blackhole, Galaxy)

## Key Flows

- **Deployment**: Browser → Frontend → Backend → Docker Control Service → Inference Containers
- **Inference**: Browser → Frontend → Backend (proxy) → Inference Containers → Hardware
- **AI Agent**: Frontend → Agent → vLLM (auto-discovery)
- **RAG**: Backend → ChromaDB (vector storage)
