# EPIC 3 — Multi-Device Video Demo Pipeline

**Status:** 📋 Planned  
**Priority:** High  
**Owner:** TBD

---

## 🎯 Goal

Support real multi-device inference orchestration with UI-driven chip selection.

---

## Background

To showcase TT-Studio's ability to leverage multiple Tenstorrent devices, we need a comprehensive multi-device orchestration system that allows users to deploy models across different chips and manage them through the UI.

---

## Issues

### Issue 3.1 — Device Enumeration Layer

**Status:** 📋 Not Started  
**Priority:** High

**Description**

Create a device detection and enumeration system that dynamically discovers connected Tenstorrent hardware.

**Sub-Tasks**

- [ ] Detect connected `/dev/tenstorrent/*`
- [ ] Count devices dynamically
- [ ] Expose `/api/devices`
- [ ] Handle hot-plug scenarios

**Acceptance Criteria**

- [ ] Multi-device count accurate
- [ ] API returns device metadata (model, serial, capabilities)
- [ ] Hot-plug events trigger UI updates

**Estimated Effort:** 3-4 days

**Dependencies:** None

---

### Issue 3.2 — UI Device Selection

**Status:** 📋 Not Started  
**Priority:** High

**Description**

Add UI components for device selection and visualization.

**Sub-Tasks**

- [ ] Add device selector dropdown in deployment dialog
- [ ] Store device-id in deployment config
- [ ] Persist device assignment across restarts
- [ ] Show chip allocation in deployments table

**Acceptance Criteria**

- [ ] Users can select target device for each deployment
- [ ] Device selection persists across sessions
- [ ] UI shows which device each model is running on

**Estimated Effort:** 3-5 days

**Dependencies:** Issue 3.1

---

### Issue 3.3 — Modify TT-Studio FastAPI Layer

**Status:** 📋 Not Started  
**Priority:** High

**Description**

Extend the TT-Studio API layer (not the core inference server) to support multi-device workflows.

**Sub-Tasks**

- [ ] Add workflow deployment endpoint
- [ ] Support dynamic port assignment (7000, 7001, 7002…)
- [ ] Map device-id → container mount
- [ ] Ensure no port collisions
- [ ] Add workflow configuration object

**Acceptance Criteria**

- [ ] Can deploy multiple models on different devices simultaneously
- [ ] No port conflicts
- [ ] Proper device isolation

**Estimated Effort:** 5-7 days

**Dependencies:** Issue 3.1

---

### Issue 3.4 — Parallel Execution Validation

**Status:** 📋 Not Started  
**Priority:** Medium

**Description**

Validate that multiple models can run simultaneously on different devices without conflicts.

**Sub-Tasks**

- [ ] Deploy models on separate chips
- [ ] Run simultaneous inference
- [ ] Validate no cross-device conflicts
- [ ] Measure throughput scaling

**Acceptance Criteria**

- [ ] Multiple models run simultaneously
- [ ] Linear or better throughput scaling
- [ ] No device contention issues

**Estimated Effort:** 3-4 days

**Dependencies:** Issue 3.3

---

### Issue 3.5 — Deployment Cache System

**Status:** 📋 Not Started  
**Priority:** Medium

**Description**

Create a persistent registry of deployments that survives restarts.

**Sub-Tasks**

- [ ] Create persistent deployment registry
- [ ] Store:
  - [ ] model
  - [ ] device-id
  - [ ] port
  - [ ] container id
  - [ ] timestamp
- [ ] Add recovery on restart
- [ ] Add UI visualization of deployment history

**Acceptance Criteria**

- [ ] Deployments persist across TT-Studio restarts
- [ ] UI shows deployment history
- [ ] Can restore previous deployment state

**Estimated Effort:** 3-5 days

**Dependencies:** Issue 3.3

---

## Technical Design

### Device API

```typescript
interface Device {
  id: string;
  path: string; // e.g., /dev/tenstorrent/0
  model: string; // e.g., Grayskull, Wormhole
  serial: string;
  capabilities: DeviceCapability[];
  status: DeviceStatus;
  current_deployments: Deployment[];
}

interface Deployment {
  id: string;
  model_id: string;
  device_id: string;
  port: number;
  container_id: string;
  status: DeploymentStatus;
  created_at: string;
  updated_at: string;
}
```

### API Endpoints

- `GET /api/devices` - List all devices
- `GET /api/devices/{device_id}` - Get device details
- `POST /api/deployments` - Create new deployment
- `GET /api/deployments` - List all deployments
- `DELETE /api/deployments/{deployment_id}` - Remove deployment
- `POST /api/deployments/{deployment_id}/restart` - Restart deployment

### Port Allocation Strategy

```python
PORT_RANGE_START = 7000
PORT_RANGE_END = 7999

def allocate_port(existing_deployments):
    used_ports = {d.port for d in existing_deployments}
    for port in range(PORT_RANGE_START, PORT_RANGE_END):
        if port not in used_ports:
            return port
    raise PortExhaustedError()
```

---

## Success Metrics

- [ ] Can detect and use all connected devices
- [ ] Can deploy 10+ models across devices simultaneously
- [ ] Zero port conflicts
- [ ] 100% deployment recovery after restart

---

## Risks and Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Device hot-plug instability | High | Add robust device monitoring with health checks |
| Port exhaustion | Medium | Implement port recycling and cleanup |
| Container orchestration failures | High | Add retry logic and health monitoring |
| Device contention | Medium | Implement device-level locks and queuing |

---

## Demo Scenario

### Multi-Device Video Processing Pipeline

1. **Setup:**
   - Device 0: Video object detection model
   - Device 1: Image classification model
   - Device 2: Text generation model (for descriptions)

2. **Workflow:**
   - User uploads video
   - Frame extraction on Device 0
   - Classification on Device 1
   - Description generation on Device 2
   - Results aggregated and displayed

3. **Validation:**
   - All three models process simultaneously
   - No device conflicts
   - Correct result aggregation
   - UI shows real-time progress

---

## Related Documentation

- [Main EPIC Roadmap](../ROADMAP_EPICS.md)
- [Docker Socket Migration](../DOCKER_SOCKET_MIGRATION.md)

---

## Timeline

- **Week 1:** Issue 3.1 - Device Enumeration
- **Week 2:** Issue 3.2 - UI Device Selection
- **Week 3-4:** Issue 3.3 - FastAPI Layer
- **Week 5:** Issue 3.4 - Parallel Execution
- **Week 6:** Issue 3.5 - Deployment Cache

**Total Estimated Duration:** 6-7 weeks
