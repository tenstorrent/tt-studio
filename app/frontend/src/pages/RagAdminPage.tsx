// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
import RagAdmin from "../components/rag/RagAdmin";

const RagAdminPage = () => {
  return (
    <>
      <div className="h-screen w-full relative flex items-center justify-center">
        <div
          className="flex grow justify-center items-center w-full h-screen pt-96"
          style={{ zIndex: 1 }}
        >
          <RagAdmin />
        </div>
      </div>
    </>
  );
};

export default RagAdminPage;
