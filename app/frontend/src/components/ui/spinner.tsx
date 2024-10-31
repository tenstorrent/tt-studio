//  SPDX-FileCopyrightText: Copyright (c) 2023 shadcn
//  SPDX-License-Identifier: MIT

import React from "react";

export const Spinner: React.FC = () => {
  return (
    // <div className="spinner border-4 border-t-4 border-gray-200 border-t-blue-500 rounded-full w-6 h-6 animate-spin"></div>

    <span className="loading loading-spinner loading-md"></span>
  );
};
