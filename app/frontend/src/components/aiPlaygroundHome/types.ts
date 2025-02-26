// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

export interface Model {
  id: string;
  title: string;
  image: string;
  path: string;
  filter: string;
  filterSvg?: string;
  TTDevice?: string;
  poweredByText: string;
}

export interface Task {
  id: string;
  title: string;
  path: string;
  className: string;
}
