// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
import LogsViewer from "../components/log_viewer/LogViewer";

const HomePage = () => {
  return (
    <>
      <div className="h-screen w-full relative flex items-center justify-center">
        <div className="flex grow justify-center items-center w-full h-screen">
          <LogsViewer />
        </div>
      </div>
    </>
  );
};

export default HomePage;
