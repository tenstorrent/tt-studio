// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import React, { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { customToast } from "../CustomToaster";
import { Card } from "../ui/card";
import ShowcaseGallery from "./ShowcaseGallery";
import StableDiffusionChat from "./StableDiffusionChat";

const ImageGenParentComponent: React.FC = () => {
  const [showChat, setShowChat] = useState(false);
  const [initialPrompt, setInitialPrompt] = useState<string>("");

  // model handling state
  const location = useLocation();
  const [modelID, setModelID] = useState<string>("");
  const [modelName, setModelName] = useState<string | null>(null);

  useEffect(() => {
    if (location.state) {
      if (!location.state.containerID) {
        customToast.error(
          "modelID is unavailable. Try navigating here from the Models Deployed tab"
        );
        return;
      }
      setModelID(location.state.containerID);
      setModelName(location.state.modelName);
    }
  }, [location.state, modelID, modelName]);

  const handleImageClick = (prompt: string) => {
    setInitialPrompt(prompt);
    customToast.success("Prompt loaded into input area!");
  };

  return (
    <div className="w-full h-screen p-2 pb-20 pl-[4.5rem] lg:pl-32">
      <Card className="flex flex-col w-full h-full overflow-hidden shadow-xl bg-white dark:bg-black border-gray-200 dark:border-[#7C68FA]/20 backdrop-blur-sm">
        <div className="flex-1 overflow-hidden flex flex-col relative">
          {showChat ? (
            <StableDiffusionChat
              onBack={() => setShowChat(false)}
              modelID={modelID}
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
