// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Link } from "react-router-dom";
import type { Model } from "./types";

type ModelCardProps = Omit<Model, "id">;

export function ModelCard({
  title = "Model Name",
  image,
  path = "#",
  filter,
}: ModelCardProps) {
  return (
    <Link to={path} className="block w-full">
      <div className="group rounded-lg transition-all hover:opacity-90 duration-300 ease-in-out hover:shadow-lg hover:scale-[1.02] overflow-hidden relative">
        <div className="relative aspect-[4/3]">
          <img
            src={image || "/placeholder.svg"}
            alt={title}
            className="h-full w-full object-cover"
          />
          <div
            className="absolute inset-0"
            style={{
              backgroundColor: filter,
              mixBlendMode: "color",
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
        </div>
        <div className="absolute bottom-0 left-0 right-0 p-4">
          <h3 className="text-xl font-semibold text-white">{title}</h3>
        </div>
      </div>
    </Link>
  );
}
