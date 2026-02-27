# GitHub Issue Creation Checklist

This document provides a step-by-step guide for creating GitHub issues from the EPIC documentation.

## Prerequisites

Before creating issues, ensure you have:
- [ ] Read the relevant EPIC document
- [ ] Reviewed the technical design
- [ ] Understood the dependencies
- [ ] Identified the priority level

## Creating the Main EPIC Issue

### Template to Use
Use the [EPIC Issue Template](../.github/ISSUE_TEMPLATE/epic.md)

### Issue Details

**For EPIC 1: Model Type Synchronization**
```
Title: [EPIC] Model Type Synchronization Across Inference Server
Labels: epic, priority:high, component:backend, component:frontend
Assignees: [team lead or architect]
```

**For EPIC 2: End-to-End Model Validation**
```
Title: [EPIC] End-to-End Model Validation (Full UI + Backend)
Labels: epic, priority:high, component:testing
Assignees: [QA lead or test architect]
```

**For EPIC 3: Multi-Device Pipeline**
```
Title: [EPIC] Multi-Device Video Demo Pipeline
Labels: epic, priority:high, component:backend, component:infra
Assignees: [backend lead]
```

**For EPIC 4: Voice Pipeline**
```
Title: [EPIC] Wake Word → STT → LLM → TTS Pipeline
Labels: epic, priority:medium, component:backend, component:frontend
Assignees: [AI/ML engineer]
```

**For EPIC 5: Pipecat Integration**
```
Title: [EPIC] Pipecat Blueprint Integration
Labels: epic, priority:medium, component:architecture
Assignees: [architect or tech lead]
```

## Creating Sub-Issues

### Template to Use
Use the [EPIC Sub-Issue Template](../.github/ISSUE_TEMPLATE/epic_sub_issue.md)

### Example: EPIC 1, Issue 1.1

```markdown
Title: [EPIC-1.1] Design & Implement Model Synchronization Mechanism

Parent EPIC: #[EPIC 1 issue number]
EPIC Document: docs/epics/EPIC-1-Model-Synchronization.md

Labels: 
- priority:high
- component:backend
- status:planned
- epic-1

Assignees: [backend developer]

Description:
Create a robust sync mechanism that pulls all supported model types from 
Inference Server and normalizes them into TT-Studio's internal catalog schema.

Sub-Tasks:
- [ ] Define canonical model schema (id, type, display_type, hardware_support, ports, capabilities)
- [ ] Add backend sync endpoint `/api/models/sync`
- [ ] Fetch model list from inference server registry
- [ ] Normalize model types (LLM, VLLM, Image, Video, TTS, STT, Embeddings, CNN)
- [ ] Store synchronized state in persistent storage
- [ ] Add sync timestamp + version tracking
- [ ] Add error handling + retry logic

Acceptance Criteria:
- [ ] Sync correctly imports all available model types
- [ ] No hardcoded model type assumptions remain
- [ ] Sync is idempotent

Estimated Effort: 5-8 days
```

## Recommended Labels

### Priority Labels
- `priority:critical` - Must be done immediately
- `priority:high` - Important, should be done soon
- `priority:medium` - Normal priority
- `priority:low` - Nice to have

### Component Labels
- `component:backend` - Backend/API changes
- `component:frontend` - UI/React changes
- `component:infra` - Infrastructure/DevOps
- `component:testing` - Test infrastructure
- `component:docs` - Documentation
- `component:architecture` - Architectural changes

### Status Labels
- `status:planned` - Not yet started
- `status:in-progress` - Active development
- `status:blocked` - Waiting on something
- `status:review` - In code review
- `status:testing` - In testing phase
- `status:done` - Completed

### EPIC Labels
- `epic` - Main EPIC issue
- `epic-1` - Part of EPIC 1
- `epic-2` - Part of EPIC 2
- `epic-3` - Part of EPIC 3
- `epic-4` - Part of EPIC 4
- `epic-5` - Part of EPIC 5

## Issue Creation Order

### EPIC 1: Model Type Synchronization
1. Create main EPIC issue
2. Create Issue 1.1: Design & Implement Model Synchronization Mechanism
3. Create Issue 1.2: State Management for Model Sync
4. Create Issue 1.3: Frontend Integration for Display Types

### EPIC 2: End-to-End Model Validation
1. Create main EPIC issue
2. Create Issue 2.1: Define E2E Test Protocol Template
3. Create Issues 2.2-2.8: Individual model type tests

### EPIC 3: Multi-Device Pipeline
1. Create main EPIC issue
2. Create Issue 3.1: Device Enumeration Layer
3. Create Issue 3.2: UI Device Selection
4. Create Issue 3.3: Modify TT-Studio FastAPI Layer
5. Create Issue 3.4: Parallel Execution Validation
6. Create Issue 3.5: Deployment Cache System

### EPIC 4: Voice Pipeline
1. Create main EPIC issue
2. Create Issue 4.1: Integrate OpenWakeWord
3. Create Issue 4.2: Unified Audio Pipeline
4. Create Issue 4.3: Backend Pipeline Orchestration

### EPIC 5: Pipecat Integration
1. Create main EPIC issue
2. Create Issue 5.1: Research Pipecat Architecture
3. Create Issue 5.2: API Compatibility Layer
4. Create Issue 5.3: Replace Custom Workflow (Optional)
5. Create Issue 5.4: Publish Blueprint Documentation

## Linking Issues

### Link Child Issues to Parent EPIC
In each sub-issue, add:
```markdown
Parent EPIC: #[EPIC issue number]
```

### Link Dependencies
```markdown
Depends on: #[issue number]
Blocks: #[issue number]
```

### Link Related Issues
```markdown
Related to: #[issue number]
See also: #[issue number]
```

## Issue Tracking Best Practices

1. **Update Status Regularly**
   - Move issues through status labels as work progresses
   - Add comments with progress updates

2. **Link Pull Requests**
   - Reference issues in PR descriptions: "Fixes #123"
   - Link PRs in issue comments

3. **Use Milestones**
   - Create milestones for each EPIC
   - Assign issues to appropriate milestones

4. **Track Dependencies**
   - Clearly mark dependencies in issue descriptions
   - Update dependencies as they are resolved

5. **Close Issues Properly**
   - Only close when acceptance criteria are met
   - Link to merged PRs
   - Add final summary comment

## GitHub Project Board Setup

### Recommended Columns
1. **Backlog** - Planned but not started
2. **Ready** - Ready to be worked on
3. **In Progress** - Active development
4. **In Review** - Code review or testing
5. **Blocked** - Waiting on dependencies
6. **Done** - Completed

### Board Organization
- Create one project board per EPIC or
- Create one overall board with EPIC filters

## Example Issue URLs

Once created, issues should be accessible at:
```
https://github.com/tenstorrent/tt-studio/issues/[number]
```

## Issue Templates Location

All templates are located in:
```
.github/ISSUE_TEMPLATE/
├── epic.md              - For main EPIC issues
├── epic_sub_issue.md    - For EPIC sub-issues
├── bug_report.md        - For bug reports
└── feature_request.md   - For feature requests
```

## Reference Documentation

- [EPIC Roadmap](../docs/ROADMAP_EPICS.md)
- [EPIC Quick Reference](../docs/EPIC_QUICK_REFERENCE.md)
- [Individual EPIC Documents](../docs/epics/)

---

**Note:** This is a reference document. Actual GitHub issues cannot be created programmatically through this repository. Use GitHub's web interface or API to create issues based on this guide.

**Last Updated:** 2026-02-27
