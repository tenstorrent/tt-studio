// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import type { Task } from "./types";

type ActionCardProps = Omit<Task, "id">;

export function ActionCard({
  title = "Action",
  path = "#",
  className = "bg-blue-900",
}: ActionCardProps) {
  return (
    <Link
      to={path}
      className={`${className} group relative block rounded-lg p-6 transition-all duration-300 ease-in-out hover:shadow-lg hover:scale-105 overflow-hidden`}
    >
      <div className="flex items-center justify-between relative z-10">
        <h3 className="text-lg font-semibold text-white transition-transform group-hover:translate-x-1">
          {title}
        </h3>
        <ArrowUpRight className="h-5 w-5 text-white transition-all duration-300 ease-in-out group-hover:translate-x-1 group-hover:-translate-y-1 group-hover:scale-110" />
      </div>
      <div className="absolute inset-0 bg-white opacity-0 transition-opacity duration-300 ease-in-out group-hover:opacity-10"></div>
    </Link>
  );
}
