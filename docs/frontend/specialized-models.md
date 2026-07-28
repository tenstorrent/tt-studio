# Specialized Model Interfaces

<details>
<summary>Relevant source files</summary>
<ul>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/.gitignore">.gitignore</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/api/modelsDeployedApis.ts">app/frontend/src/api/modelsDeployedApis.ts</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/Footer.tsx">app/frontend/src/components/Footer.tsx</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/imageGen/Header.tsx">app/frontend/src/components/imageGen/Header.tsx</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/imageGen/ImageGenParentComponent.tsx">app/frontend/src/components/imageGen/ImageGenParentComponent.tsx</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/imageGen/ShowcaseGallery.tsx">app/frontend/src/components/imageGen/ShowcaseGallery.tsx</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/imageGen/StableDiffusionChat.tsx">app/frontend/src/components/imageGen/StableDiffusionChat.tsx</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/imageGen/types/chat.ts">app/frontend/src/components/imageGen/types/chat.ts</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/object_detection/ObjectDetectionComponent.tsx">app/frontend/src/components/object_detection/ObjectDetectionComponent.tsx</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/speechToText/mainContent.tsx">app/frontend/src/components/speechToText/mainContent.tsx</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/ui/dialog.tsx">app/frontend/src/components/ui/dialog.tsx</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/ui/focus-cards.tsx">app/frontend/src/components/ui/focus-cards.tsx</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/videoGen/VideoGenChat.tsx">app/frontend/src/components/videoGen/VideoGenChat.tsx</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/videoGen/VideoGenParentComponent.tsx">app/frontend/src/components/videoGen/VideoGenParentComponent.tsx</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/videoGen/VideoInputArea.tsx">app/frontend/src/components/videoGen/VideoInputArea.tsx</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/videoGen/api/videoGeneration.ts">app/frontend/src/components/videoGen/api/videoGeneration.ts</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/videoGen/hooks/useVideoChat.ts">app/frontend/src/components/videoGen/hooks/useVideoChat.ts</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/videoGen/types/chat.ts">app/frontend/src/components/videoGen/types/chat.ts</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/pages/CodingAgentsPage.tsx">app/frontend/src/pages/CodingAgentsPage.tsx</a></li>
<li><a href="https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/pages/VideoGenPage.tsx">app/frontend/src/pages/VideoGenPage.tsx</a></li>
</ul>
</details>



Specialized Model Interfaces provide tailored user experiences for non-chat model types, such as Object Detection, Image Generation, Video Generation, and Speech-to-Text. These components handle specific data modalities (video, audio, images) and visualize model-specific outputs like bounding boxes, generated media, or transcriptions.

## Object Detection Interface

The `ObjectDetectionComponent` is a comprehensive UI for models that identify and locate objects in images or video streams. It supports both static file uploads and live webcam feeds.

### Implementation Details
The component uses a dual-tab system (`webcam` vs `file`) to manage different input sources [app/frontend/src/components/object_detection/ObjectDetectionComponent.tsx:67-68](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/object_detection/ObjectDetectionComponent.tsx#L67-L68). It tracks detections and metadata (such as FPS and inference time) separately for each mode [app/frontend/src/components/object_detection/ObjectDetectionComponent.tsx:72-91](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/object_detection/ObjectDetectionComponent.tsx#L72-L91).

**Key Features:**
- **Bounding Box Scaling:** Detections are normalized and then scaled to fit the display container using `updateBoxPositions` [app/frontend/src/components/object_detection/ObjectDetectionComponent.tsx:17-18](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/object_detection/ObjectDetectionComponent.tsx#L17-L18).
- **Live Mode:** In webcam mode, it supports a "Live Mode" toggle which continuously polls the inference server for new frames [app/frontend/src/components/object_detection/ObjectDetectionComponent.tsx:94-98](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/object_detection/ObjectDetectionComponent.tsx#L94-L98).
- **Performance Metrics:** Displays real-time stats including Inference Time (ms), FPS, and total object counts [app/frontend/src/components/object_detection/ObjectDetectionComponent.tsx:25-31](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/object_detection/ObjectDetectionComponent.tsx#L25-L31).

### Data Flow: Object Detection
The following diagram illustrates how video frames or files are processed and rendered as bounding boxes.

**Object Detection Data Flow**
```mermaid
graph TD
    subgraph "Frontend (ObjectDetectionComponent)"
        A["SourcePicker / WebcamPicker"] -->|"File/Stream"| B["Inference Request"]
        B -->|"Response (JSON)"| C["Detection Metadata"]
        C -->|"Raw Boxes"| D["updateBoxPositions()"]
        D -->|"Scaled Boxes"| E["Canvas/SVG Overlay"]
    end
    
    subgraph "Backend (Inference Server)"
        B --- F["Model Execution"]
        F --- G["Bounding Box Extraction"]
    end
    
    E -->|"Render"| H["User Interface"]
```

Sources: [app/frontend/src/components/object_detection/ObjectDetectionComponent.tsx:182-228](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/object_detection/ObjectDetectionComponent.tsx#L182-L228), [app/frontend/src/components/object_detection/ObjectDetectionComponent.tsx:17-18](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/object_detection/ObjectDetectionComponent.tsx#L17-L18), [app/frontend/src/components/object_detection/ObjectDetectionComponent.tsx:64-98](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/object_detection/ObjectDetectionComponent.tsx#L64-L98)

## Image Generation Interface

The `ImageGenParentComponent` manages the lifecycle of image generation tasks, primarily using Stable Diffusion models. It transitions between a "Showcase" mode and an "Active Generation" mode [app/frontend/src/components/imageGen/ImageGenParentComponent.tsx:11-13](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/imageGen/ImageGenParentComponent.tsx#L11-L13).

### Showcase and Generation
- **ShowcaseGallery:** Displays pre-defined prompts and example images to guide users. Clicking an image populates the prompt for the active session [app/frontend/src/components/imageGen/ImageGenParentComponent.tsx:33-36](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/imageGen/ImageGenParentComponent.tsx#L33-L36).
- **StableDiffusionChat:** A chat-like interface where users send text prompts and receive generated images [app/frontend/src/components/imageGen/StableDiffusionChat.tsx:15-19](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/imageGen/StableDiffusionChat.tsx#L15-L19). It includes a `Download` action for generated artifacts [app/frontend/src/components/imageGen/StableDiffusionChat.tsx:103-111](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/imageGen/StableDiffusionChat.tsx#L103-L111).

### Components
| Component | Role |
| :--- | :--- |
| `StableDiffusionChat` | Main interaction loop using `useChat` hook [app/frontend/src/components/imageGen/StableDiffusionChat.tsx:13-15](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/imageGen/StableDiffusionChat.tsx#L13-L15). |
| `Header` | Provides navigation and history panel toggles [app/frontend/src/components/imageGen/Header.tsx:28-33](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/imageGen/Header.tsx#L28-L33). |
| `ImageInputArea` | Text area for prompt entry and generation trigger [app/frontend/src/components/imageGen/StableDiffusionChat.tsx:161-165](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/imageGen/StableDiffusionChat.tsx#L161-L165). |

Sources: [app/frontend/src/components/imageGen/StableDiffusionChat.tsx:95-113](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/imageGen/StableDiffusionChat.tsx#L95-L113), [app/frontend/src/components/imageGen/types/chat.ts:10-15](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/imageGen/types/chat.ts#L10-L15), [app/frontend/src/components/imageGen/ImageGenParentComponent.tsx:45-60](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/imageGen/ImageGenParentComponent.tsx#L45-L60)

## Video Generation Interface

The `VideoGenChat` component provides a specialized interface for Text-to-Video (T2V) models like Wan2.2. Due to the high latency of video generation (1–5 minutes), the interface includes comprehensive progress tracking [app/frontend/src/components/videoGen/VideoGenParentComponent.tsx:53-55](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/videoGen/VideoGenParentComponent.tsx#L53-L55).

### Implementation Details
- **Progress Tracking:** Displays a progress bar with phases like `queued`, `in_progress`, and `finishing up`, along with elapsed vs estimated time [app/frontend/src/components/videoGen/VideoGenChat.tsx:150-170](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/videoGen/VideoGenChat.tsx#L150-L170).
- **Video Player:** Renders the generated video using a standard `<video>` tag with download capabilities [app/frontend/src/components/videoGen/VideoGenChat.tsx:112-129](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/videoGen/VideoGenChat.tsx#L112-L129).
- **Parent Wrapper:** `VideoGenParentComponent` handles model ID extraction from navigation state and manages the transition from the landing view to the chat view [app/frontend/src/components/videoGen/VideoGenParentComponent.tsx:12-42](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/videoGen/VideoGenParentComponent.tsx#L12-L42).

Sources: [app/frontend/src/components/videoGen/VideoGenChat.tsx:21-39](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/videoGen/VideoGenChat.tsx#L21-L39), [app/frontend/src/components/videoGen/VideoGenParentComponent.tsx:49-64](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/videoGen/VideoGenParentComponent.tsx#L49-L64)

## Speech-to-Text (STT) Interface

The STT interface provides a robust environment for recording audio and viewing transcriptions. It is primarily implemented in `MainContent` and `AudioRecorderWithVisualizer`.

### Audio Pipeline
1.  **Recording:** Uses the `MediaRecorder` API to capture audio chunks.
2.  **Visualization:** An `AnalyserNode` maps frequency data to UI bars to provide visual feedback during recording.
3.  **Transcription:** The recorded `Blob` is sent to the inference backend via `sendAudioRecording` [app/frontend/src/components/speechToText/mainContent.tsx:136-140](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/speechToText/mainContent.tsx#L136-L140).

### Transcription Management
Transcriptions are grouped by date and associated with specific "Conversations" [app/frontend/src/components/speechToText/mainContent.tsx:29-41](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/speechToText/mainContent.tsx#L29-L41). Users can edit transcribed text, copy it to the clipboard, or replay the original audio [app/frontend/src/components/speechToText/mainContent.tsx:167-185](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/speechToText/mainContent.tsx#L167-L185).

Sources: [app/frontend/src/components/speechToText/mainContent.tsx:112-164](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/speechToText/mainContent.tsx#L112-L164), [app/frontend/src/components/speechToText/mainContent.tsx:223-225](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/speechToText/mainContent.tsx#L223-L225)

## Voice Agent & Wake Word Pipeline

The Voice Agent is a multi-model pipeline UI that orchestrates three distinct models: **Whisper** (STT), **LLM** (Chat), and **SpeechT5/TTS** (Text-to-Speech).

### Deployment Logic
Model types are normalized from backend strings to frontend constants to ensure correct interface routing [app/frontend/src/api/modelsDeployedApis.ts:73-99](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/api/modelsDeployedApis.ts#L73-L99). The `ModelType` object defines the supported categories, including `SpeechRecognitionModel`, `FaceRecognitionModel`, and `TTS` [app/frontend/src/api/modelsDeployedApis.ts:55-66](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/api/modelsDeployedApis.ts#L55-L66).

**Voice Agent Component Entity Mapping**
```mermaid
graph LR
    subgraph "Frontend UI Entities"
        VAA["VoiceAgentApp.tsx"]
        ARV["AudioRecorderWithVisualizer.tsx"]
        MP["MetricsPanel.tsx"]
    end

    subgraph "Logic & API Space"
        SAR["sendAudioRecording()"]
        RI["runInference()"]
        RTI["runTTSInference()"]
    end

    subgraph "Hardware/Model Space"
        WH["Whisper (STT)"]
        LL["LLM (Llama/Mistral)"]
        TT["SpeechT5 (TTS)"]
    end

    VAA --> ARV
    VAA --> MP
    ARV --> SAR
    SAR --> WH
    VAA --> RI
    RI --> LL
    VAA --> RTI
    RTI --> TT
```

Sources: [app/frontend/src/api/modelsDeployedApis.ts:55-99](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/api/modelsDeployedApis.ts#L55-L99), [app/frontend/src/components/speechToText/mainContent.tsx:136-140](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/components/speechToText/mainContent.tsx#L136-L140)

### Wake Word Control
The application integrates wake-word detection using the `wakeword_control` Django app.
- **Technology:** Utilizes `openWakeWord` ONNX models.
- **Bundled Model:** Includes the `hey_quiet_box` model for local, offline detection.
- **Data Flow:** The frontend establishes a WebSocket connection to the backend; when the wake word is detected, the backend sends a trigger to start the STT recording process.

## Coding Agents Page

The `CodingAgentsPage` provides a specialized interface for LLMs that are eligible for autonomous coding tasks.

- **Eligibility:** The backend identifies `coding_agent_eligible` models in the `CanonicalDeployment` payload [app/frontend/src/api/modelsDeployedApis.ts:118](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/api/modelsDeployedApis.ts#L118).
- **Integration:** These models are exposed via a dedicated gateway that allows the agent to execute code in a sandboxed environment (e.g., E2B) and interact with the local filesystem.

Sources: [app/frontend/src/api/modelsDeployedApis.ts:106-134](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/api/modelsDeployedApis.ts#L106-L134), [app/frontend/src/pages/CodingAgentsPage.tsx:1-20](https://github.com/tenstorrent/tt-studio/blob/c837b829/app/frontend/src/pages/CodingAgentsPage.tsx#L1-L20)
