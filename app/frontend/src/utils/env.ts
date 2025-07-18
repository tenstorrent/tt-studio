// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

export const isDeployedEnabled = () => import.meta.env.VITE_ENABLE_DEPLOYED === "true";
