// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { JSX } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../ui/button";

export default function NoModelsRunning(): JSX.Element {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col items-center justify-center gap-6 py-20 px-4 max-w-md mx-auto text-center">
      {/* Terminal-style status line */}
      <span className="font-mono text-amber-500/60 text-xs tracking-widest uppercase select-none">
        // STATUS: NO ACTIVE DEPLOYMENTS
      </span>

      {/* Heading */}
      <div>
        <h2 className="text-2xl font-semibold text-stone-200 mb-3">
          No models currently running
        </h2>
        <p className="text-stone-400 text-sm leading-relaxed">
          Your model may have stopped unexpectedly, or the board was reset.
          Check deployment history to see what happened and access logs.
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 flex-wrap justify-center">
        <Button
          onClick={() => navigate("/deployment-history")}
          className="bg-amber-600 hover:bg-amber-500 text-white border-0"
        >
          View Deployment History
        </Button>
        <Button
          variant="outline"
          onClick={() => navigate("/")}
          className="border-stone-600 text-stone-300 hover:bg-stone-800 hover:text-stone-100"
        >
          Deploy a Model
        </Button>
      </div>
    </div>
  );
}
