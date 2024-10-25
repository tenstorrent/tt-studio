// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import ChatComponent from "../components/ChatComponent";

const ChatUI = () => {
  return (
    <>
      <div className="h-screen w-full dark:bg-black bg-white dark:bg-grid-white/[0.2] bg-grid-black/[0.2] relative flex items-center justify-center">
        <div
          className="absolute pointer-events-none inset-0 flex items-center justify-center dark:bg-black bg-white"
          style={{
            maskImage:
              "radial-gradient(ellipse at center, transparent 20%, black 100%)",
          }}
        ></div>
        <div className="flex flex-grow justify-center items-center w-full h-screen ">
          <ChatComponent />
        </div>
      </div>
    </>
  );
};

export default ChatUI;
