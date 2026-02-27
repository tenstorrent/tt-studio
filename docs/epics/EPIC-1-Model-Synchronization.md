# EPIC 1 — Model Type Synchronization Across Inference Server

**Status:** 📋 Planned  
**Priority:** High  
**Owner:** TBD

---

## 🎯 Goal

Ensure TT-Studio fully synchronizes, understands, and supports **all model types exposed by Inference Server**, including catalog metadata, display types, and deployment compatibility.

---

## Background

Currently, TT-Studio may have hardcoded assumptions about model types. This EPIC aims to create a dynamic, extensible system that automatically discovers and supports all model types available from the Inference Server.

---

## Issues

### Issue 1.1 — Design & Implement Model Synchronization Mechanism

**Status:** 📋 Not Started  
**Priority:** High

**Description**

Create a robust sync mechanism that pulls all supported model types from Inference Server and normalizes them into TT-Studio's internal catalog schema.

**Sub-Tasks**

- [ ] Define canonical model schema (id, type, display_type, hardware_support, ports, capabilities)
- [ ] Add backend sync endpoint `/api/models/sync`
- [ ] Fetch model list from inference server registry
- [ ] Normalize model types (LLM, VLLM, Image, Video, TTS, STT, Embeddings, CNN)
- [ ] Store synchronized state in persistent storage
- [ ] Add sync timestamp + version tracking
- [ ] Add error handling + retry logic

**Acceptance Criteria**

- [ ] Sync correctly imports all available model types
- [ ] No hardcoded model type assumptions remain
- [ ] Sync is idempotent

**Estimated Effort:** 5-8 days

**Dependencies:** None

---

### Issue 1.2 — State Management for Model Sync

**Status:** 📋 Not Started  
**Priority:** High

**Description**

Implement global state management for the model catalog to ensure the UI always reflects the current sync state.

**Sub-Tasks**

- [ ] Add global store (Redux/Zustand/etc.) for model catalog
- [ ] Track:
  - [ ] sync status
  - [ ] last updated timestamp
  - [ ] supported hardware
  - [ ] display type
- [ ] Add UI indicator for sync state
- [ ] Handle partial failures gracefully

**Acceptance Criteria**

- [ ] UI always reflects backend sync state
- [ ] No stale model entries after resync

**Estimated Effort:** 3-5 days

**Dependencies:** Issue 1.1

---

### Issue 1.3 — Frontend Integration for Display Types

**Status:** 📋 Not Started  
**Priority:** Medium

**Description**

Create a data-driven display type system that maps model types to appropriate UI components without hardcoding.

**Sub-Tasks**

- [ ] Introduce `display_type` abstraction
- [ ] Map display types to UI components:
  - [ ] Chat → LLM/VLLM
  - [ ] Image canvas → Image models
  - [ ] Video preview → Video models
  - [ ] Audio player → TTS/STT
  - [ ] Feature vector view → Embeddings
  - [ ] Classification view → CNN
- [ ] Remove model-type-specific hardcoding
- [ ] Ensure extensibility for future types

**Acceptance Criteria**

- [ ] Adding a new model type requires no UI rewrite
- [ ] Display logic is data-driven

**Estimated Effort:** 5-7 days

**Dependencies:** Issue 1.1, Issue 1.2

---

## Technical Design

### Model Schema

```typescript
interface Model {
  id: string;
  type: ModelType;
  display_type: DisplayType;
  hardware_support: HardwareCapability[];
  ports: PortConfiguration;
  capabilities: ModelCapability[];
  metadata: {
    name: string;
    description: string;
    version: string;
    tags: string[];
  };
}

enum ModelType {
  LLM = "llm",
  VLLM = "vllm",
  IMAGE = "image",
  VIDEO = "video",
  TTS = "tts",
  STT = "stt",
  EMBEDDINGS = "embeddings",
  CNN = "cnn"
}

enum DisplayType {
  CHAT = "chat",
  IMAGE_CANVAS = "image_canvas",
  VIDEO_PREVIEW = "video_preview",
  AUDIO_PLAYER = "audio_player",
  VECTOR_VIEW = "vector_view",
  CLASSIFICATION = "classification"
}
```

### API Endpoints

- `GET /api/models/sync` - Trigger synchronization
- `GET /api/models/status` - Get sync status
- `GET /api/models` - Get all synchronized models

---

## Success Metrics

- [ ] All model types from Inference Server are discoverable
- [ ] Zero hardcoded model type checks in UI code
- [ ] Sync completes in < 5 seconds
- [ ] System handles new model types without code changes

---

## Risks and Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Inference Server API changes | High | Version the sync protocol, add fallback logic |
| Large model catalogs | Medium | Implement pagination and caching |
| Sync failures | High | Add retry logic with exponential backoff |

---

## Related Documentation

- [Main EPIC Roadmap](../ROADMAP_EPICS.md)
- [Model Interface Documentation](../model-interface.md)

---

## Timeline

- **Week 1-2:** Issue 1.1 - Model Synchronization Mechanism
- **Week 2-3:** Issue 1.2 - State Management
- **Week 3-4:** Issue 1.3 - Frontend Integration
- **Week 4:** Testing and refinement

**Total Estimated Duration:** 4-5 weeks
