# EPIC Quick Reference Guide

## What are EPICs?

EPICs are large initiatives that contain multiple related issues and span several weeks or months. They help organize and track major feature development in TT-Studio.

## Available EPICs

| EPIC | Priority | Duration | Status | Documentation |
|------|----------|----------|--------|---------------|
| **EPIC 1:** Model Type Synchronization | High | 4-5 weeks | 📋 Planned | [View Details](./epics/EPIC-1-Model-Synchronization.md) |
| **EPIC 2:** End-to-End Model Validation | High | 6-7 weeks | 📋 Planned | [View Details](./epics/EPIC-2-E2E-Model-Validation.md) |
| **EPIC 3:** Multi-Device Pipeline | High | 6-7 weeks | 📋 Planned | [View Details](./epics/EPIC-3-Multi-Device-Pipeline.md) |
| **EPIC 4:** Voice Pipeline | Medium | 4-5 weeks | 📋 Planned | [View Details](./epics/EPIC-4-Voice-Pipeline.md) |
| **EPIC 5:** Pipecat Integration | Medium | 9-10 weeks | 📋 Planned | [View Details](./epics/EPIC-5-Pipecat-Integration.md) |

## Quick Links

### Documentation
- 📋 [Full Roadmap](./ROADMAP_EPICS.md) - Complete overview of all EPICs
- 📁 [EPIC Directory](./epics/) - Individual EPIC documents

### Issue Templates
- 🎯 [EPIC Template](../.github/ISSUE_TEMPLATE/epic.md) - For creating main EPIC issues
- 📝 [Sub-Issue Template](../.github/ISSUE_TEMPLATE/epic_sub_issue.md) - For creating EPIC sub-issues

## EPIC Breakdown

### EPIC 1: Model Type Synchronization (4-5 weeks)
**Goal:** Dynamic model type discovery and management

**Key Issues:**
1. Design & Implement Model Synchronization Mechanism
2. State Management for Model Sync
3. Frontend Integration for Display Types

**Deliverables:**
- `/api/models/sync` endpoint
- Global state management for model catalog
- Data-driven display type system

---

### EPIC 2: End-to-End Model Validation (6-7 weeks)
**Goal:** Comprehensive E2E testing for all model types

**Key Issues:**
1. Define E2E Test Protocol Template
2. E2E tests for: LLM, VLLM, Image, Video, Audio, Embeddings, CNN

**Deliverables:**
- Standardized test protocol
- Full test coverage for all model types
- Automated test suite

---

### EPIC 3: Multi-Device Pipeline (6-7 weeks)
**Goal:** Multi-device orchestration with UI-driven device selection

**Key Issues:**
1. Device Enumeration Layer
2. UI Device Selection
3. Modify TT-Studio FastAPI Layer
4. Parallel Execution Validation
5. Deployment Cache System

**Deliverables:**
- `/api/devices` endpoint
- Device selector UI component
- Dynamic port allocation
- Persistent deployment registry

---

### EPIC 4: Voice Pipeline (4-5 weeks)
**Goal:** End-to-end conversational AI pipeline

**Key Issues:**
1. Integrate OpenWakeWord
2. Unified Audio Pipeline
3. Backend Pipeline Orchestration

**Deliverables:**
- Wake word detection
- STT → LLM → TTS pipeline
- `/api/pipeline/voice` endpoint
- Real-time UI feedback

---

### EPIC 5: Pipecat Integration (9-10 weeks)
**Goal:** Hardware-aware conversational blueprint

**Key Issues:**
1. Research Pipecat Architecture
2. API Compatibility Layer
3. Replace Custom Workflow (Optional)
4. Publish Blueprint Documentation

**Deliverables:**
- Pluggable backend architecture
- Pipecat integration
- Comprehensive documentation
- Performance benchmarks

---

## Creating GitHub Issues from EPICs

### Step 1: Create the Main EPIC Issue
1. Go to GitHub Issues
2. Click "New Issue"
3. Select "EPIC" template
4. Fill in the details from the EPIC document
5. Add label: `epic`
6. Add priority label: `priority:high` or `priority:medium`

### Step 2: Create Sub-Issues
1. For each issue in the EPIC document
2. Click "New Issue"
3. Select "EPIC Sub-Issue" template
4. Link to the parent EPIC issue
5. Add relevant labels and assignees

### Step 3: Track Progress
1. Update the EPIC document as tasks complete
2. Check off items in GitHub issues
3. Link PRs to issues
4. Update status in EPIC document

---

## Timeline and Dependencies

```
┌─────────────────────────────────────────────────────────────────┐
│                        EPIC Timeline                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Weeks 1-5:    EPIC 1 (Model Synchronization)                  │
│                                                                  │
│  Weeks 6-12:   EPIC 2 (E2E Validation)                         │
│                                                                  │
│  Weeks 6-12:   EPIC 3 (Multi-Device) ◄─── depends on EPIC 1   │
│                                                                  │
│  Weeks 13-17:  EPIC 4 (Voice Pipeline) ◄─── benefits from 3   │
│                                                                  │
│  Weeks 18-27:  EPIC 5 (Pipecat) ◄───────── depends on EPIC 4  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

Total Duration: ~7-8 months (with some parallel work)
```

---

## Success Criteria

When all EPICs are complete, TT-Studio will have:

✅ **Dynamic Model Support**
- Automatic discovery of all Inference Server model types
- No hardcoded model type assumptions
- Extensible display type system

✅ **Comprehensive Testing**
- E2E tests for all model types
- Automated test suite
- Clear test protocols

✅ **Multi-Device Orchestration**
- UI-driven device selection
- Parallel model execution
- Persistent deployment state

✅ **Voice AI Capabilities**
- Wake word detection
- Full conversational pipeline
- Real-time UI feedback

✅ **Production-Ready Architecture**
- Pluggable backend system
- Pipecat integration
- Enterprise-ready documentation

---

## Getting Started

1. **Review the Documentation**
   - Read the [Full Roadmap](./ROADMAP_EPICS.md)
   - Explore individual [EPIC documents](./epics/)

2. **Create GitHub Issues**
   - Use the [issue templates](../.github/ISSUE_TEMPLATE/)
   - Link issues to EPICs

3. **Start Development**
   - Follow the [Development Guide](./development.md)
   - Implement according to EPIC specifications

4. **Track Progress**
   - Update EPIC documents
   - Check off tasks in issues
   - Report progress regularly

---

## Questions?

- Check the [FAQ](./FAQ.md)
- Review [Development Guide](./development.md)
- Open an issue with the `question` label

---

**Last Updated:** 2026-02-27
