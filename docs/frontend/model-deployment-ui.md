# Model Deployment UI

<details>
<summary>Relevant source files</summary>
<ul>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/api/modelsDeployedApis.ts">app/frontend/src/api/modelsDeployedApis.ts</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/ChipConfigStep.tsx">app/frontend/src/components/ChipConfigStep.tsx</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/DeployModelStep.tsx">app/frontend/src/components/DeployModelStep.tsx</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/MultiCardResetDialog.tsx">app/frontend/src/components/MultiCardResetDialog.tsx</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/ResetStepRow.tsx">app/frontend/src/components/ResetStepRow.tsx</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/SelectionSteps.tsx">app/frontend/src/components/SelectionSteps.tsx</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/StepperFooter.tsx">app/frontend/src/components/StepperFooter.tsx</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/StepperFormActions.tsx">app/frontend/src/components/StepperFormActions.tsx</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/magicui/AnimatedDeployButton.tsx">app/frontend/src/components/magicui/AnimatedDeployButton.tsx</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/models/DeleteModelDialog.tsx">app/frontend/src/components/models/DeleteModelDialog.tsx</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/models/ModelPreparingBanner.tsx">app/frontend/src/components/models/ModelPreparingBanner.tsx</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/models/ModelsDeployedCard.tsx">app/frontend/src/components/models/ModelsDeployedCard.tsx</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/models/row-cells/ManageCell.tsx">app/frontend/src/components/models/row-cells/ManageCell.tsx</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/object_detection/ObjectDetectionComponent.tsx">app/frontend/src/components/object_detection/ObjectDetectionComponent.tsx</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/ui/stepper.tsx">app/frontend/src/components/ui/stepper.tsx</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/hooks/useDeploymentProgress.ts">app/frontend/src/hooks/useDeploymentProgress.ts</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/hooks/useIsResetting.ts">app/frontend/src/hooks/useIsResetting.ts</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/utils/deviceFit.ts">app/frontend/src/utils/deviceFit.ts</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/utils/p300x2Placement.ts">app/frontend/src/utils/p300x2Placement.ts</a></li>
</ul>
</details>



The Model Deployment UI provides a guided, multi-step workflow for configuring hardware resources and deploying AI models onto Tenstorrent hardware. It transitions from hardware detection and chip selection to model selection, and finally to real-time deployment monitoring and management.

## Deployment Wizard Architecture

The deployment process is encapsulated in the `SelectionSteps` component, which implements a stateful stepper to guide the user through the configuration lifecycle [app/frontend/src/components/SelectionSteps.tsx:52-74](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/SelectionSteps.tsx#L52-L74).

### Stepper Workflow Logic
The wizard dynamically adjusts its steps based on the detected hardware (e.g., single-chip N150 vs. multi-chip T3K or P300x2 boards). The `useStepper` hook provides context for navigation and state management [app/frontend/src/components/ui/stepper.tsx:19-45](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/ui/stepper.tsx#L19-L45).

| Step | Component | Responsibility |
| :--- | :--- | :--- |
| **Step 1 (Selection)** | `FirstStepForm` | Filtering and selecting models compatible with the detected hardware. It handles compatibility warnings and auto-deployment triggers [app/frontend/src/components/SelectionSteps.tsx:13-13](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/SelectionSteps.tsx#L13-L13). |
| **Step 2 (Hardware)** | `ChipConfigStep` | Selection between "1 Device" or "All Devices" modes and specific device ID allocation. This step is dynamically shown based on the `advancedActive` flag [app/frontend/src/components/ChipConfigStep.tsx:35-42](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/ChipConfigStep.tsx#L35-L42). |
| **Final Step (Deploy)** | `DeployModelStep` | Final confirmation, slot availability checks, and execution of the deployment job via the `AnimatedDeployButton` [app/frontend/src/components/DeployModelStep.tsx:18-43](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/DeployModelStep.tsx#L18-L43). |

### Hardware-Aware Step Injection
For multi-chip boards (like P300x2), the UI conditionally manages `ChipConfigStep`. On P300x2, hardware configuration is often hidden behind a toggle unless existing deployments necessitate manual slot selection [app/frontend/src/components/SelectionSteps.tsx:39-50](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/SelectionSteps.tsx#L39-L50). The `deviceFit.ts` utility helps determine preferred device groups and auto-placement logic [app/frontend/src/utils/deviceFit.ts:17-21](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/utils/deviceFit.ts#L17-L21).

### Natural Language to Code Entity Mapping: Deployment Wizard
This diagram maps the user-facing deployment concepts to the underlying React components and API routes.

```mermaid
graph TD
    subgraph "Natural Language Space"
        A["'Choose Model'"]
        B["'Select Hardware'"]
        C["'Deploy Now'"]
        D["'Watch Progress'"]
    end

    subgraph "Code Entity Space (Frontend)"
        A1["FirstStepForm.tsx"]
        B1["ChipConfigStep.tsx"]
        C1["DeployModelStep.tsx"]
        D1["AnimatedDeployButton.tsx"]
    end

    subgraph "Code Entity Space (Backend API)"
        R1["GET /docker-api/get_containers/"]
        R2["GET /docker-api/chip-status/"]
        R3["POST /docker-api/deploy/"]
        R4["GET /docker-api/deploy/progress/{job_id}/"]
    end

    A --> A1
    B --> B1
    C --> C1
    D --> D1

    A1 -- "lists compatible" --> R1
    B1 -- "fetches slot status" --> R2
    C1 -- "triggers job" --> R3
    D1 -- "polls status" --> R4
```
Sources: [app/frontend/src/components/SelectionSteps.tsx:23-25](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/SelectionSteps.tsx#L23-L25), [app/frontend/src/components/ChipConfigStep.tsx:48-52](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/ChipConfigStep.tsx#L48-L52), [app/frontend/src/components/DeployModelStep.tsx:110-151](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/DeployModelStep.tsx#L110-L151), [app/frontend/src/components/magicui/AnimatedDeployButton.tsx:114-160](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/magicui/AnimatedDeployButton.tsx#L114-L160).

## Real-time Deployment Tracking

Deployment is an asynchronous process involving image pulling, weight downloading, and container orchestration.

### 1. `AnimatedDeployButton` & `useDeploymentProgress`
The `AnimatedDeployButton` manages the visual state of the deployment (rocket animation, success/failure icons) and utilizes the `useDeploymentProgress` hook to track the backend job [app/frontend/src/components/magicui/AnimatedDeployButton.tsx:20-46](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/magicui/AnimatedDeployButton.tsx#L20-L46).
*   **Job Persistence:** Active job IDs are stored in `localStorage` (`tt_studio_active_deployment_job`) to allow the UI to resume tracking after a page refresh [app/frontend/src/components/magicui/AnimatedDeployButton.tsx:82-103](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/magicui/AnimatedDeployButton.tsx#L82-L103).
*   **Polling Logic:** The `useDeploymentProgress` hook polls the backend for status updates. It transitions the UI when the status reaches terminal states like `completed` or `failed` [app/frontend/src/components/magicui/AnimatedDeployButton.tsx:49-79](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/magicui/AnimatedDeployButton.tsx#L49-L79).

### 2. Deployment Logs & `WorkflowLogDialog`
The `DeployModelStep` provides an interface to view detailed logs during the deployment process [app/frontend/src/components/DeployModelStep.tsx:82-107](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/DeployModelStep.tsx#L82-L107).
*   **Log Fetching:** Logs are retrieved from `/docker-api/deploy/logs/{jobId}/` and formatted with timestamps and severity levels [app/frontend/src/components/DeployModelStep.tsx:91-101](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/DeployModelStep.tsx#L91-L101).
*   **Workflow Tracking:** The `WorkflowLogDialog` component is used to display these logs in a dedicated modal, often scanning for specific error patterns like `exception:` to surface diagnostic info [app/frontend/src/components/DeployModelStep.tsx:136-138](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/DeployModelStep.tsx#L136-L138).

Sources: [app/frontend/src/components/magicui/AnimatedDeployButton.tsx:49-79](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/magicui/AnimatedDeployButton.tsx#L49-L79), [app/frontend/src/hooks/useDeploymentProgress.ts:12-12](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/hooks/useDeploymentProgress.ts#L12-L12), [app/frontend/src/components/DeployModelStep.tsx:110-172](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/DeployModelStep.tsx#L110-L172).

## Models Deployed Management

The `ModelsDeployedCard` serves as the central management hub for all active model containers. It aggregates data from the model catalog and the live Docker state.

### Data Flow and Enrichment
The UI performs "enrichment" by merging raw Docker container data with metadata from the deployment history and model catalog. The `fetchDeployments` function in `modelsDeployedApis.ts` acts as the canonical source of truth, reconciling deployment store data with live Docker status [app/frontend/src/api/modelsDeployedApis.ts:106-147](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/api/modelsDeployedApis.ts#L106-L147).

```mermaid
sequenceDiagram
    participant UI as ModelsDeployedCard
    participant API as modelsDeployedApis.ts
    participant DOCKER as /docker-api/status/
    participant CANON as /docker-api/deployments/
    participant CHIP as /docker-api/chip-status/

    UI->>API: fetchModels()
    API->>DOCKER: GET container list
    DOCKER-->>API: Raw Container data
    UI->>API: fetchDeployments()
    API->>CANON: GET canonical list
    CANON-->>UI: Enriched CanonicalDeployment[]
    UI->>CHIP: GET /docker-api/chip-status/
    CHIP-->>UI: Slot allocation details
```
Sources: [app/frontend/src/components/models/ModelsDeployedCard.tsx:111-132](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/models/ModelsDeployedCard.tsx#L111-L132), [app/frontend/src/api/modelsDeployedApis.ts:137-147](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/api/modelsDeployedApis.ts#L137-L147), [app/frontend/src/api/modelsDeployedApis.ts:149-158](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/api/modelsDeployedApis.ts#L149-L158).

### Key Management Features
*   **Health Monitoring:** The `HealthCell` and `useHealthRefresh` hook monitor the health status of deployed containers to ensure they are ready for inference [app/frontend/src/components/models/ModelsDeployedCard.tsx:25-25](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/models/ModelsDeployedCard.tsx#L25-L25).
*   **Multi-Chip Visualization:** On multi-chip boards, the UI displays physical chip slot occupancy (e.g., Device 0, Device 1) using the `ChipStatusDisplay` component [app/frontend/src/components/models/ModelsDeployedCard.tsx:53-53](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/models/ModelsDeployedCard.tsx#L53-L53).
*   **Model Type Mapping:** The UI maps backend model types to frontend constants (e.g., `CHAT` to `ChatModel`) to drive conditional navigation to specialized interfaces like Object Detection or Image Generation [app/frontend/src/api/modelsDeployedApis.ts:73-99](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/api/modelsDeployedApis.ts#L73-L99).
*   **Destructive Actions:** The `ManageCell` component provides controls for deleting models and viewing logs, but disables these actions during board resets to prevent system instability [app/frontend/src/components/models/row-cells/ManageCell.tsx:63-72](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/models/row-cells/ManageCell.tsx#L63-L72).

Sources: [app/frontend/src/components/models/ModelsDeployedCard.tsx:76-92](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/models/ModelsDeployedCard.tsx#L76-L92), [app/frontend/src/components/models/row-cells/ManageCell.tsx:48-62](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/models/row-cells/ManageCell.tsx#L48-L62), [app/frontend/src/api/modelsDeployedApis.ts:55-66](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/api/modelsDeployedApis.ts#L55-L66).2a:T2d94,# Chat UI
