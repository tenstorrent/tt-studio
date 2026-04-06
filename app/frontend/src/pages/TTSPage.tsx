// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import TTSDemo from "../components/tts/TTSDemo";

export default function TTSPage() {
  return (
    <>
      <div className="fixed inset-0 w-full dark:bg-black bg-white dark:bg-grid-white/[0.2] bg-grid-black/[0.2]">
        <div
          className="absolute pointer-events-none inset-0 flex items-center justify-center dark:bg-black bg-white"
          style={{
            maskImage:
              "radial-gradient(ellipse at center, transparent 95%, black 100%)",
          }}
        ></div>
        <div className="w-full h-screen flex items-center justify-center pl-[4.5rem] lg:pl-32 pb-20 p-4">
          <TTSDemo />
        </div>
      </div>
    </>
  );
}
