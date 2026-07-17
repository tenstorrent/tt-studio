# Board Control & Hardware Monitoring

<details>
<summary>Relevant source files</summary>
<ul>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/board_control/services.py">app/backend/board_control/services.py</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/Footer.tsx">app/frontend/src/components/Footer.tsx</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/imageGen/StableDiffusionChat.tsx">app/frontend/src/components/imageGen/StableDiffusionChat.tsx</a></li>
</ul>
</details>



The `board_control` app is responsible for hardware detection, system resource monitoring, and providing real-time telemetry for Tenstorrent devices. It serves as the bridge between the physical hardware and the UI, ensuring that users are informed of chip availability, thermal status, and system-level bottlenecks (CPU/RAM).

## System Architecture & Data Flow

Hardware monitoring in TT-Studio follows a polling architecture where the frontend periodically requests system and device state. The data is aggregated from host-level utilities (for CPU/RAM) and Tenstorrent-specific drivers via `tt-smi` (for chip telemetry).

### Data Aggregation Flow

The following diagram illustrates how hardware data flows from the physical silicon to the `Footer.tsx` and `ChipStatusDisplay.tsx` components.

**Hardware Telemetry Flow**
```mermaid
graph TD
    subgraph "Hardware_Layer"
        HW_ASIC["Tenstorrent ASIC (N150/N300/T3K)"]
        HW_HOST["Host CPU & RAM"]
    end

    subgraph "Backend_Django"
        BC_SRV["SystemResourceService"]
        FOOTER_API["/board-api/footer-data/"]
        CHIP_API["/docker-api/chip-status/"]
    end

    subgraph "Frontend_React"
        DS_CTX["DeviceStateContext"]
        FOOTER_COMP["Footer.tsx"]
        CHIP_DISP["ChipStatusDisplay.tsx"]
    end

    HW_HOST -->|psutil| FOOTER_API
    HW_ASIC -->|tt-smi -s| BC_SRV
    BC_SRV -->|get_tt_smi_data| CHIP_API
    FOOTER_API -->|fetchSystemResources| FOOTER_COMP
    CHIP_API -->|axios| DS_CTX
    DS_CTX -->|deviceState| CHIP_DISP
    DS_CTX -->|deviceState| FOOTER_COMP
```
**Sources:** [app/backend/board_control/services.py:20-132](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/board_control/services.py#L20-L132), [app/frontend/src/components/Footer.tsx:74-99](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/Footer.tsx#L74-L99), [app/frontend/src/components/ChipStatusDisplay.tsx:97-103](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/ChipStatusDisplay.tsx#L97-L103)

---

## Core Components

### 1. System Resource Service (`services.py`)
The `SystemResourceService` class is the primary backend logic provider for hardware monitoring [app/backend/board_control/services.py:20](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/board_control/services.py#L20).

*   **Telemetry Acquisition:** Uses `subprocess.Popen` to execute `tt-smi -s` and parse the resulting JSON output [app/backend/board_control/services.py:65-132](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/board_control/services.py#L65-L132).
*   **Caching Strategy:** Implements Django-based caching for `tt-smi` data (`TT_SMI_CACHE_KEY`) and board type (`BOARD_TYPE_CACHE_KEY`) to minimize expensive CLI calls [app/backend/board_control/services.py:23-31](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/board_control/services.py#L23-L31).
*   **Reset Monitoring:** Detects if a hardware reset is in progress by checking for a `reset_all_status.json` file in the backend cache root via `_board_reset_job_active` or a specific cache key `DEVICE_RESETTING_KEY` [app/backend/board_control/services.py:31-62](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/board_control/services.py#L31-L62).
*   **Board Type Detection:** Identifies the hardware configuration (e.g., Galaxy, Nebula) by inspecting `board_info` in the `tt-smi` data and validating homogeneity across chips [app/backend/board_control/services.py:134-162](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/board_control/services.py#L134-L162).

### 2. Footer Telemetry (`Footer.tsx`)
The `Footer` component acts as a persistent status bar. It aggregates high-level system metrics and hardware health alerts [app/frontend/src/components/Footer.tsx:38](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/Footer.tsx#L38).

*   **System Resources:** Fetches CPU usage, memory usage, and total memory via the `fetchSystemResources` function which calls the `/board-api/footer-data/` endpoint [app/frontend/src/components/Footer.tsx:74-99](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/Footer.tsx#L74-L99).
*   **Board State:** Derives board name, state, and average temperature from the `DeviceStateContext` [app/frontend/src/components/Footer.tsx:178-188](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/Footer.tsx#L178-L188).
*   **Health Alerts:** Detects `BAD_STATE` or `NOT_PRESENT` statuses to trigger hardware error UI states [app/frontend/src/components/Footer.tsx:189-195](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/Footer.tsx#L189-L195).
*   **Manual Refresh:** Provides a `handleRefreshBoardDetection` function with a 2-minute cooldown (`REFRESH_COOLDOWN_MS`) to trigger a re-poll of the hardware state via `refreshDeviceState()` [app/frontend/src/components/Footer.tsx:101-126](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/Footer.tsx#L101-L126).

### 3. Chip Configuration & Status
The system monitors chip availability to prevent resource contention during model deployment.

*   **Chip Status Polling:** Components consume `deviceState` which provides real-time updates on chip occupancy and temperature [app/frontend/src/components/Footer.tsx:56-58](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/Footer.tsx#L56-L58).
*   **Slot Management:** The `ChipSlot` interface tracks whether a slot is `available` or `occupied`, its `slot_id`, and identifies if a chip is part of a `is_multi_chip` deployment [app/frontend/src/components/ChipStatusDisplay.tsx:7-13](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/ChipStatusDisplay.tsx#L7-L13).
*   **Board Grouping:** Certain boards like `P300x2` and `P300Cx4` group chips into physical cards. The `ChipStatusDisplay` handles this using the `CARD_GROUPINGS` constant to map chips to their respective card labels [app/frontend/src/components/ChipStatusDisplay.tsx:24-27](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/ChipStatusDisplay.tsx#L24-L27).

---

## Hardware Detection Logic

The application categorizes hardware based on the detected board type, which influences the UI layout and grouping.

| Board Type | Chips Per Card | Card Label |
| :--- | :--- | :--- |
| **P300x2** | 2 | P300 Card |
| **P300Cx4** | 2 | P300 Card |
| **Default** | Flat Layout | N/A |

**Sources:** [app/frontend/src/components/ChipStatusDisplay.tsx:24-27](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/ChipStatusDisplay.tsx#L24-L27), [app/frontend/src/components/ChipStatusDisplay.tsx:137-180](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/ChipStatusDisplay.tsx#L137-L180)

---

## Implementation Details

### Device State Context
The `DeviceStateContext` is the primary source of truth for hardware health across the frontend. It provides the `deviceState` object which includes:
*   `board_name`: The detected Tenstorrent board (e.g., "Galaxy", "Nebula").
*   `state`: Current operational status (e.g., "ACTIVE", "BAD_STATE", "RESETTING").
*   `devices`: An array of individual chip telemetry (temperature, `slot_id`).

**Code Entity Relationship**
```mermaid
classDiagram
    class SystemResourceService {
        +get_tt_smi_data()
        +get_board_type()
        +is_reset_in_progress()
    }
    class DeviceStateContext {
        +deviceState: DeviceState
        +refresh()
    }
    class DeviceState {
        +board_name: string
        +state: string
        +devices: Device[]
    }
    class Device {
        +slot_id: number
        +temperature: number
        +status: string
    }
    class Footer {
        +fetchSystemResources()
        +handleRefreshBoardDetection()
    }
    class ChipStatusDisplay {
        +slots: ChipSlot[]
        +hasConnector(index)
    }
    
    Footer ..> DeviceStateContext : "consumes via useDeviceState"
    ChipStatusDisplay ..> DeviceStateContext : "consumes via props"
    DeviceStateContext ..> SystemResourceService : "indirectly via board-api"
    DeviceStateContext *-- DeviceState
    DeviceState *-- Device
```
**Sources:** [app/backend/board_control/services.py:20-132](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/backend/board_control/services.py#L20-L132), [app/frontend/src/components/Footer.tsx:56-58](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/Footer.tsx#L56-L58), [app/frontend/src/components/Footer.tsx:178-188](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/Footer.tsx#L178-L188), [app/frontend/src/components/ChipStatusDisplay.tsx:7-13](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/ChipStatusDisplay.tsx#L7-L13)

### Manual Re-detection
When hardware is not detected correctly or a "BAD_STATE" is encountered, the `Footer` component allows users to trigger a refresh. This calls `refreshDeviceState()` from the context, which initiates a new backend scan of the PCIe bus and Tenstorrent drivers [app/frontend/src/components/Footer.tsx:109-126](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/Footer.tsx#L109-L126).

### Visualizing Occupancy
The `ChipStatusDisplay` component visualizes the physical layout of the chips. If two adjacent chips are occupied and marked as `is_multi_chip`, it renders a "connector" line using the `hasConnector` function to indicate they are logically linked for a single model deployment [app/frontend/src/components/ChipStatusDisplay.tsx:108-118](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/ChipStatusDisplay.tsx#L108-L118).

**Sources:**
- `app/backend/board_control/services.py`
- `app/frontend/src/components/Footer.tsx`
- `app/frontend/src/components/ChipStatusDisplay.tsx`20:T205a,# Logs Control & Bug Reporting
