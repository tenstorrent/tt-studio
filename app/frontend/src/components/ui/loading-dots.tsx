// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React from "react";

interface LoadingDotsProps {
  size?: number;
  children?: React.ReactNode;
}

const dots = [
  { animationDelay: "0s" },
  { animationDelay: "0.2s", marginLeft: 4 },
  { animationDelay: "0.4s", marginLeft: 4 },
];

export const LoadingDots = ({ size = 2, children }: LoadingDotsProps) => {
  return (
    <span className="inline-flex items-center">
      {children && <div className="mr-2">{children}</div>}
      {dots.map((dot, index) => (
        <span
          key={index}
          className="bg-gray-900 dark:bg-gray-400 inline-block rounded-full animate-loading"
          style={{ height: size, width: size, ...dot }}
        />
      ))}
    </span>
  );
};
