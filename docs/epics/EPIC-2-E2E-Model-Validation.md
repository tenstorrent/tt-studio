# EPIC 2 — End-to-End Model Validation (Full UI + Backend)

**Status:** 📋 Planned  
**Priority:** High  
**Owner:** TBD

---

## 🎯 Goal

End-to-end validation of every model type with complete UI workflow testing.

---

## Background

To ensure TT-Studio works reliably with all supported model types, we need comprehensive E2E tests that validate the entire workflow from deployment through inference to UI interaction.

---

## Issues

### Issue 2.1 — Define E2E Test Protocol Template

**Status:** 📋 Not Started  
**Priority:** High

**Description**

Create a standardized testing protocol that can be applied to all model types consistently.

**Sub-Tasks**

- [ ] Create reusable test checklist:
  - [ ] Deployment
  - [ ] Health check
  - [ ] Inference call
  - [ ] Streaming support
  - [ ] UI interaction
  - [ ] Resource cleanup
- [ ] Add logging validation
- [ ] Define failure state behavior

**Acceptance Criteria**

- [ ] Test template covers all critical paths
- [ ] Template is reusable across model types
- [ ] Clear pass/fail criteria defined

**Estimated Effort:** 3-4 days

---

### Issue 2.2 — E2E: LLM Models

**Status:** 📋 Not Started  
**Priority:** High

**Sub-Tasks**

- [ ] Deploy LLM
- [ ] Validate chat UI
- [ ] Validate streaming
- [ ] Validate multi-device support
- [ ] Validate port handling

**Estimated Effort:** 2-3 days

---

### Issue 2.3 — E2E: VLLM Models

**Status:** 📋 Not Started  
**Priority:** High

**Sub-Tasks**

- [ ] Validate OpenAI-compatible endpoint
- [ ] Validate concurrency
- [ ] Validate memory utilization

**Estimated Effort:** 2-3 days

---

### Issue 2.4 — E2E: Image Models

**Status:** 📋 Not Started  
**Priority:** Medium

**Sub-Tasks**

- [ ] Validate generation
- [ ] Validate preview
- [ ] Validate regeneration
- [ ] Validate caching

**Estimated Effort:** 2-3 days

---

### Issue 2.5 — E2E: Video Models

**Status:** 📋 Not Started  
**Priority:** Medium

**Sub-Tasks**

- [ ] Validate upload
- [ ] Validate inference
- [ ] Validate playback
- [ ] Validate parallel processing

**Estimated Effort:** 2-3 days

---

### Issue 2.6 — E2E: Audio Models (Whisper, TTS)

**Status:** 📋 Not Started  
**Priority:** Medium

**Sub-Tasks**

- [ ] Validate recording
- [ ] Validate transcription
- [ ] Validate playback
- [ ] Validate streaming responses

**Estimated Effort:** 3-4 days

---

### Issue 2.7 — E2E: Embeddings

**Status:** 📋 Not Started  
**Priority:** Low

**Sub-Tasks**

- [ ] Validate vector output
- [ ] Validate dimension consistency
- [ ] Validate downstream compatibility

**Estimated Effort:** 1-2 days

---

### Issue 2.8 — E2E: CNN

**Status:** 📋 Not Started  
**Priority:** Low

**Sub-Tasks**

- [ ] Validate classification response
- [ ] Validate confidence display
- [ ] Validate batch processing

**Estimated Effort:** 1-2 days

---

## Test Protocol Template

### Standard E2E Test Flow

```yaml
test_flow:
  1_deployment:
    - start_container
    - verify_health_endpoint
    - check_logs_for_errors
    
  2_inference:
    - send_test_request
    - validate_response_format
    - validate_response_content
    - measure_latency
    
  3_ui_interaction:
    - open_model_in_ui
    - perform_user_action
    - verify_ui_update
    - check_error_handling
    
  4_streaming:
    - initiate_streaming_request
    - validate_stream_chunks
    - verify_complete_response
    
  5_cleanup:
    - stop_container
    - verify_resources_released
    - clean_temp_files
```

### Test Automation

Tests should be automated using:
- **Backend:** pytest with async support
- **UI:** Playwright or Cypress
- **Integration:** Docker Compose for multi-service testing

---

## Success Metrics

- [ ] 100% of model types have E2E tests
- [ ] All tests pass consistently
- [ ] Test suite runs in < 30 minutes
- [ ] Clear documentation for adding new model tests

---

## Test Coverage Matrix

| Model Type | Deployment | Inference | Streaming | UI | Cleanup | Status |
|------------|-----------|-----------|-----------|-------|---------|--------|
| LLM        | ☐         | ☐         | ☐         | ☐     | ☐       | Not Started |
| VLLM       | ☐         | ☐         | ☐         | ☐     | ☐       | Not Started |
| Image      | ☐         | ☐         | N/A       | ☐     | ☐       | Not Started |
| Video      | ☐         | ☐         | N/A       | ☐     | ☐       | Not Started |
| TTS        | ☐         | ☐         | ☐         | ☐     | ☐       | Not Started |
| STT        | ☐         | ☐         | N/A       | ☐     | ☐       | Not Started |
| Embeddings | ☐         | ☐         | N/A       | ☐     | ☐       | Not Started |
| CNN        | ☐         | ☐         | N/A       | ☐     | ☐       | Not Started |

---

## Dependencies

- EPIC 1 (Model Synchronization) should be complete for comprehensive testing
- Test infrastructure and CI/CD pipeline

---

## Related Documentation

- [Main EPIC Roadmap](../ROADMAP_EPICS.md)
- [Development Guide](../development.md)

---

## Timeline

- **Week 1:** Issue 2.1 - Test Protocol Template
- **Week 2-3:** Issues 2.2, 2.3 - LLM and VLLM tests
- **Week 4-5:** Issues 2.4, 2.5 - Image and Video tests
- **Week 6:** Issues 2.6, 2.7, 2.8 - Audio, Embeddings, CNN tests

**Total Estimated Duration:** 6-7 weeks
