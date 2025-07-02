// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
import ChatComponent from "../components/chatui/ChatComponent";

const ChatUI = () => {
  return (
    <>
      <div className="fixed inset-0 w-full dark:bg-black bg-white dark:bg-grid-white/[0.2] bg-grid-black/[0.2]">
        <div
          className="absolute pointer-events-none inset-0 flex items-center justify-center dark:bg-black bg-white"
          style={{
            maskImage: "radial-gradient(ellipse at center, transparent 95%, black 100%)",
          }}
        ></div>
        <div className="w-full h-full lg:pl-16 overflow-hidden">
          <ChatComponent />
        </div>
      </div>
    </>
  );
};

export default ChatUI;
