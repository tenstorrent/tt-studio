// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { customToast } from "../CustomToaster";
import { Card } from "../ui/card";
import VideoGenerationChat from "./VideoGenerationChat";

const VideoGenParentComponent: React.FC = () => {
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

  return (
    <div className="w-full h-screen flex items-center justify-center pl-20 pr-4 py-4">
      <Card className="flex flex-col w-full max-w-6xl h-[90vh] overflow-hidden shadow-xl bg-white dark:bg-black border-gray-200 dark:border-[#7C68FA]/20 rounded-xl">
        <div className="flex-1 overflow-hidden flex flex-col relative">
          <VideoGenerationChat
            onBack={() => window.history.back()}
            modelID={modelID}
            initialPrompt={initialPrompt}
          />
        </div>
      </Card>
    </div>
  );
};

export default VideoGenParentComponent;
