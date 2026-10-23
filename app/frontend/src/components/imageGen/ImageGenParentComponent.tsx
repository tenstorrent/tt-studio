// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import React, { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { customToast } from "../CustomToaster";
import { fetchHealthyModelsByType } from "../../api/modelsDeployedApis";
import { Card } from "../ui/card";
import ShowcaseGallery from "./ShowcaseGallery";
import StableDiffusionChat from "./StableDiffusionChat";
import { imageChatStore, useImageChatState } from "./imageChatStore";

const setShowChat = (showChat: boolean) =>
  imageChatStore.update(() => ({ showChat }));

// How often to look again for a healthy image model when none is ready yet,
// e.g. while one is still warming up.
const MODEL_RETRY_MS = 10_000;

const useCloud = import.meta.env.VITE_ENABLE_DEPLOYED === "true";

const ImageGenParentComponent: React.FC = () => {
  const { showChat } = useImageChatState();
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
    if (useCloud) return;
    // Opened directly (typed URL, bookmark) rather than from the navbar or
    // Models Deployed: there is no navigation state, so drop any model picked
    // earlier and use the first healthy image model, looking again until one
    // is ready. Results arriving after this effect is superseded are ignored.
    setModelID("");
    setModelName(null);
    let cancelled = false;
    let warned = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const lookup = () => {
      fetchHealthyModelsByType("image_generation").then((models) => {
        if (cancelled) return;
        if (models.length > 0) {
          setModelID(models[0].id);
          setModelName(models[0].modelName);
          return;
        }
        if (!warned) {
          warned = true;
          customToast.error(
            "No image generation model is ready yet. Deploy one or wait for it to finish warming up."
          );
        }
        retry = setTimeout(lookup, MODEL_RETRY_MS);
      });
    };
    lookup();
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
    };
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
