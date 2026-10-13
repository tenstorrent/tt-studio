// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import React, { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { customToast } from "../CustomToaster";
import { fetchHealthyModelsByType } from "../../api/modelsDeployedApis";
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
    if (location.state?.containerID) {
      setModelID(location.state.containerID);
      setModelName(location.state.modelName);
      return;
    }
    // Deployed mode routes to the cloud endpoint and needs no local model.
    if (import.meta.env.VITE_ENABLE_DEPLOYED === "true") return;
    // Opened directly (typed URL, bookmark) rather than from the navbar or
    // Models Deployed: there is no navigation state, so use the first healthy
    // image model instead of posting an empty deploy_id.
    fetchHealthyModelsByType("image_generation").then((models) => {
      if (models.length > 0) {
        setModelID(models[0].id);
        setModelName(models[0].modelName);
      } else {
        customToast.error(
          "No image generation model is ready yet. Deploy one or wait for it to finish warming up."
        );
      }
    });
  }, [location.state]);

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
              modelID={modelID}
              modelName={modelName}
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
