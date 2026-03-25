// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
import ModelsDeployedTable from "../components/ModelsDeployedTable";

const ModelsDeployed = () => {
  return (
    <div className="absolute inset-0 w-full h-full dark:bg-black bg-white dark:bg-dot-white/[0.15] bg-dot-black/[0.15] flex items-center justify-center">
      {/* Radial gradient for the container to give a faded look */}
      <div
        className="absolute pointer-events-none inset-0 flex items-center justify-center dark:bg-black bg-white"
        style={{
          maskImage:
            "radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.3) 85%, rgba(0,0,0,0.9) 100%)",
        }}
      ></div>
      <div className="flex flex-col h-full w-full md:px-20 pt-12 pb-28 overflow-hidden relative z-10">
        <ModelsDeployedTable />
      </div>
    </div>
  );
};

export default ModelsDeployed;
