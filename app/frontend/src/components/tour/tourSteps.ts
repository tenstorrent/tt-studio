// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { onboardingSteps } from "./tours/onboarding";
import { deployModelSteps } from "./tours/deployModel";
import { fineTuneModelSteps } from "./tours/fineTuneModel";

export const homeTourSteps = onboardingSteps;
export { onboardingSteps, deployModelSteps, fineTuneModelSteps };
