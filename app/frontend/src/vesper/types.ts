// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { ServeProfile } from "@/src/utils/deviceFit";

/** A row from the model catalog (`/docker-api/get_containers/`). */
export interface CatalogModel {
  id: string;
  name: string;
  is_compatible: boolean | null;
  compatible_boards: string[];
  /** Backend model type, e.g. `chat`, `vlm`, `tts`, `speech_recognition` */
  model_type: string;
  /** Coarse grouping, e.g. `LLM`, `IMAGE`, `AUDIO` */
  display_model_type?: string;
  current_board: string;
  status?: "EXPERIMENTAL" | "FUNCTIONAL" | "COMPLETE" | null;
  chips_required?: number;
  hf_model_id?: string | null;
  profiles?: ServeProfile[];
  profile?: string;
  no_page_reason?: string | null;
  source?: string;
}

/**
 * Lifecycle states a deployment card can be in. These map 1:1 onto the
 * deployment card and detail designs.
 */
export type DeploymentState =
  | "downloading"
  | "deploying"
  | "active"
  | "download-failed"
  | "deploy-failed"
  | "error";

/** One deployment as shown in the deployments panel, sidebar and hardware page. */
export interface DeploymentItem {
  /** Stable key used for selection: a container id, or a deploy job id while no container exists yet */
  key: string;
  state: DeploymentState;
  modelName: string;
  /** Catalog id of the deployed model, when known (used to redeploy) */
  catalogModelId?: string;
  containerId?: string;
  jobId?: string;
  /** Device slots the deployment occupies */
  deviceIds: number[];
  /** 0-100, only set while downloading or deploying */
  progress: number | null;
  /** Human readable label for the current stage */
  stageLabel?: string;
  /** Transfer facts, e.g. ["1.2 / 5.6 GB", "120 MB/s", "~44 s left"] */
  transfer?: string[];
  /** Backend model type, e.g. `chat` */
  modelType?: string;
  hfModelId?: string | null;
  errorMessage?: string;
  /** Deployment-history record id, used to open workflow logs */
  historyId?: number;
  startedAt?: number;
  /** The container is gone; only its history record is left */
  dead?: boolean;
  /** Set on a solution's combined item: the deployments it is made of */
  members?: DeploymentItem[];
}

/** A demo page that can be opened for a deployed model. */
export interface DemoLink {
  label: string;
  href: string;
  /** Backend model type that the demo is for */
  modelType: string;
}
