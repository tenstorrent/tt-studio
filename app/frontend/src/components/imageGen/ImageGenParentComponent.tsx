// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import React, { useState } from "react";
import { customToast } from "../CustomToaster";
import { Card } from "../ui/card";
import ShowcaseGallery from "./ShowcaseGallery";
import StableDiffusionChat from "./StableDiffusionChat";
import { imageChatStore, useImageChatState } from "./imageChatStore";

const setShowChat = (showChat: boolean) =>
  imageChatStore.update(() => ({ showChat }));

// Deployed mode routes to the cloud endpoint and needs no local model.
const useCloud = import.meta.env.VITE_ENABLE_DEPLOYED === "true";

interface ImageGenParentComponentProps {
  /** Deploy id of the image generation model picked on the page */
  modelID: string | null;
  modelName: string | null;
}

const ImageGenParentComponent: React.FC<ImageGenParentComponentProps> = ({
  modelID,
  modelName,
}) => {
  const { showChat } = useImageChatState();
  const [initialPrompt, setInitialPrompt] = useState<string>("");

  const handleImageClick = (prompt: string) => {
    setInitialPrompt(prompt);
    customToast.success("Prompt loaded into input area!");
  };

  return (
    <div
      className="w-full h-screen p-2 pl-[4.5rem] lg:pl-32"
      style={{ paddingBottom: "var(--footer-height, 0px)" }}
    >
      <Card className="flex flex-col w-full h-full overflow-hidden shadow-xl bg-white dark:bg-black border-gray-200 dark:border-[#7C68FA]/20 backdrop-blur-sm">
        <div className="flex-1 overflow-hidden flex flex-col relative">
          {showChat ? (
            <StableDiffusionChat
              onBack={() => setShowChat(false)}
              modelID={modelID ?? ""}
              modelName={modelName}
              modelReady={useCloud || !!modelID}
              initialPrompt={initialPrompt}
            />
          ) : (
            <div className="flex-1 overflow-auto">
              <ShowcaseGallery
                onStartGenerating={() => setShowChat(true)}
                onImageClick={handleImageClick}
              />
            </div>
          )}
        </div>
      </Card>
    </div>
  );
};

export default ImageGenParentComponent;
