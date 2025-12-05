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
    <div className="flex flex-col w-full max-w-full mx-auto h-screen overflow-hidden p-2 sm:p-4 md:p-6 pb-20">
      <Card className="flex flex-row w-full h-full overflow-hidden min-w-0 relative font-normal">
        <div className="flex flex-col grow min-w-0 p-2 sm:p-4 w-full overflow-hidden">
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
