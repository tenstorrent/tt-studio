// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
import ModelsDeployedTable from "../components/ModelsDeployedTable";

const ModelsDeployed = () => {
  return (
    <div className="w-full h-full dark:bg-black bg-white p-4">
      <ModelsDeployedTable />
    </div>
  );
};

export default ModelsDeployed;
