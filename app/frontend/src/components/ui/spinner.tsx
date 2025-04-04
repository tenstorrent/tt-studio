// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
// SPDX-License-Identifier: Apache-2.0
// This file incorporates work covered by the following copyright and permission notice:
//  SPDX-FileCopyrightText: Copyright (c) 2023 shadcn
//  SPDX-License-Identifier: MIT

import type React from "react";
import { cn } from "@/src/lib/utils";

interface SpinnerProps extends React.HTMLAttributes<HTMLSpanElement> {
  size?: "xs" | "sm" | "md" | "lg";
}

export const Spinner: React.FC<SpinnerProps> = ({
  className,
  size = "md",
  ...props
}) => {
  return (
    <span
      className={cn("loading loading-spinner", `loading-${size}`, className)}
      {...props}
    />
  );
};
