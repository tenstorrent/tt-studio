# TT-Studio Development Roadmap - EPICs

This document outlines the major EPICs and development initiatives for TT-Studio. Each EPIC represents a significant feature area with multiple related issues and tasks.

---

## 🧩 EPIC 1 — Model Type Synchronization Across Inference Server

### 🎯 Goal

Ensure TT-Studio fully synchronizes, understands, and supports **all model types exposed by Inference Server**, including catalog metadata, display types, and deployment compatibility.

---

### Issue 1.1 — Design & Implement Model Synchronization Mechanism

**Description**

Create a robust sync mechanism that pulls all supported model types from Inference Server and normalizes them into TT-Studio's internal catalog schema.

**Sub-Tasks**

* [ ] Define canonical model schema (id, type, display_type, hardware_support, ports, capabilities)
* [ ] Add backend sync endpoint `/api/models/sync`
* [ ] Fetch model list from inference server registry
* [ ] Normalize model types (LLM, VLLM, Image, Video, TTS, STT, Embeddings, CNN)
* [ ] Store synchronized state in persistent storage
* [ ] Add sync timestamp + version tracking
* [ ] Add error handling + retry logic

**Acceptance Criteria**

* Sync correctly imports all available model types
* No hardcoded model type assumptions remain
* Sync is idempotent

---

### Issue 1.2 — State Management for Model Sync

**Sub-Tasks**

* [ ] Add global store (Redux/Zustand/etc.) for model catalog
* [ ] Track:
  * sync status
  * last updated timestamp
  * supported hardware
  * display type
* [ ] Add UI indicator for sync state
* [ ] Handle partial failures gracefully

**Acceptance Criteria**

* UI always reflects backend sync state
* No stale model entries after resync

---

### Issue 1.3 — Frontend Integration for Display Types

**Sub-Tasks**

* [ ] Introduce `display_type` abstraction
* [ ] Map display types to UI components:
  * Chat → LLM/VLLM
  * Image canvas → Image models
  * Video preview → Video models
  * Audio player → TTS/STT
  * Feature vector view → Embeddings
  * Classification view → CNN
* [ ] Remove model-type-specific hardcoding
* [ ] Ensure extensibility for future types

**Acceptance Criteria**

* Adding a new model type requires no UI rewrite
* Display logic is data-driven

---

## 🧪 EPIC 2 — End-to-End Model Validation (Full UI + Backend)

### 🎯 Goal

End-to-end validation of every model type with complete UI workflow testing.

---

### Issue 2.1 — Define E2E Test Protocol Template

**Sub-Tasks**

* [ ] Create reusable test checklist:
  * Deployment
  * Health check
  * Inference call
  * Streaming support
  * UI interaction
  * Resource cleanup
* [ ] Add logging validation
* [ ] Define failure state behavior

---

### Issue 2.2 — E2E: LLM Models

* [ ] Deploy LLM
* [ ] Validate chat UI
* [ ] Validate streaming
* [ ] Validate multi-device support
* [ ] Validate port handling

---

### Issue 2.3 — E2E: VLLM Models

* [ ] Validate OpenAI-compatible endpoint
* [ ] Validate concurrency
* [ ] Validate memory utilization

---

### Issue 2.4 — E2E: Image Models

* [ ] Validate generation
* [ ] Validate preview
* [ ] Validate regeneration
* [ ] Validate caching

---

### Issue 2.5 — E2E: Video Models

* [ ] Validate upload
* [ ] Validate inference
* [ ] Validate playback
* [ ] Validate parallel processing

---

### Issue 2.6 — E2E: Audio Models (Whisper, TTS)

* [ ] Validate recording
* [ ] Validate transcription
* [ ] Validate playback
* [ ] Validate streaming responses

---

### Issue 2.7 — E2E: Embeddings

* [ ] Validate vector output
* [ ] Validate dimension consistency
* [ ] Validate downstream compatibility

---

### Issue 2.8 — E2E: CNN

* [ ] Validate classification response
* [ ] Validate confidence display
* [ ] Validate batch processing

---

## 🎥 EPIC 3 — Multi-Device Video Demo Pipeline

### 🎯 Goal

Support real multi-device inference orchestration with UI-driven chip selection.

---

### Issue 3.1 — Device Enumeration Layer

**Sub-Tasks**

* [ ] Detect connected `/dev/tenstorrent/*`
* [ ] Count devices dynamically
* [ ] Expose `/api/devices`
* [ ] Handle hot-plug scenarios

**Acceptance Criteria**

* Multi-device count accurate
* API returns device metadata

---

### Issue 3.2 — UI Device Selection

* [ ] Add device selector dropdown
* [ ] Store device-id in deployment config
* [ ] Persist device assignment
* [ ] Show chip allocation in deployments table

---

### Issue 3.3 — Modify TT-Studio FastAPI Layer

(Not modifying core inference server — only TT-Studio API layer)

**Sub-Tasks**

* [ ] Add workflow deployment endpoint
* [ ] Support dynamic port assignment (7000, 7001, 7002…)
* [ ] Map device-id → container mount
* [ ] Ensure no port collisions
* [ ] Add workflow configuration object

---

### Issue 3.4 — Parallel Execution Validation

* [ ] Deploy models on separate chips
* [ ] Run simultaneous inference
* [ ] Validate no cross-device conflicts
* [ ] Measure throughput scaling

---

### Issue 3.5 — Deployment Cache System

**Sub-Tasks**

* [ ] Create persistent deployment registry
* [ ] Store:
  * model
  * device-id
  * port
  * container id
  * timestamp
* [ ] Add recovery on restart
* [ ] Add UI visualization

---

## 🎙 EPIC 4 — Wake Word → STT → LLM → TTS Pipeline

### 🎯 Goal

End-to-end conversational pipeline inside TT-Studio.

---

### Issue 4.1 — Integrate OpenWakeWord

* [ ] Add wake word listener
* [ ] Background audio capture
* [ ] Trigger inference pipeline
* [ ] Add sensitivity configuration

---

### Issue 4.2 — Unified Audio Pipeline

* [ ] Record speech
* [ ] Send to Whisper
* [ ] Stream LLM response
* [ ] Send to TTS
* [ ] Auto-play output
* [ ] Add stage indicator UI:
  * Listening
  * Transcribing
  * Generating
  * Speaking

---

### Issue 4.3 — Backend Pipeline Orchestration

* [ ] Create `/api/pipeline/voice`
* [ ] Chain:
  * STT
  * LLM
  * TTS
* [ ] Support streaming intermediate results
* [ ] Add timeout handling
* [ ] Add error recovery

---

## 🧠 EPIC 5 — Pipecat Blueprint Integration

### 🎯 Goal

Transform this into a hardware-aware conversational blueprint aligned with NVIDIA-style microservices.

---

### Issue 5.1 — Research Pipecat Architecture

* [ ] Map Pipecat services to TT-Studio equivalents
* [ ] Identify overlap vs replacement
* [ ] Document integration surface

---

### Issue 5.2 — API Compatibility Layer

* [ ] Abstract TT-Studio orchestration layer
* [ ] Make pluggable backend:
  * Native
  * Pipecat
* [ ] Create service adapter interface

---

### Issue 5.3 — Replace Custom Workflow (Optional)

* [ ] Route pipeline calls through Pipecat
* [ ] Validate latency
* [ ] Validate scaling
* [ ] Benchmark against native version

---

### Issue 5.4 — Publish Blueprint Documentation

* [ ] Architecture diagram
* [ ] Multi-device workflow diagram
* [ ] Audio pipeline diagram
* [ ] Port allocation strategy
* [ ] Deployment lifecycle model
* [ ] Scaling strategy

---

## 📌 Final Deliverable State

When complete:

* ✅ All model types synchronized
* ✅ Full UI coverage for every category
* ✅ Multi-device orchestration stable
* ✅ Voice pipeline working end-to-end
* ✅ Deployment state never lost
* ✅ Pipecat-compatible architecture documented
* ✅ Blueprint reusable for enterprise demos

---

## How to Use This Document

1. **Create GitHub Issues**: Use the sections above to create individual GitHub issues for each sub-EPIC
2. **Track Progress**: Check off items as they are completed
3. **Reference**: Link to this document from related PRs and issues
4. **Update**: Keep this document updated as priorities and requirements evolve

## Related Documentation

- [Development Guide](./development.md)
- [Model Interface](./model-interface.md)
- [FAQ](./FAQ.md)
