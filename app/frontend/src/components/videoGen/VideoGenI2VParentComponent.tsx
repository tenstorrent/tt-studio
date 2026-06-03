// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import React, { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { customToast } from "../CustomToaster";
import { Card } from "../ui/card";
import { Button } from "../ui/button";
import { Video } from "lucide-react";
import VideoGenI2VChat from "./VideoGenI2VChat";

const VideoGenI2VParentComponent: React.FC = () => {
  const [showChat, setShowChat] = useState(false);
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
  }, [location.state]);

  return (
    <div
      className="w-full h-screen p-2 pl-[4.5rem] lg:pl-32"
      style={{ paddingBottom: "var(--footer-height, 0px)" }}
    >
      <Card className="flex flex-col w-full h-full overflow-hidden shadow-xl bg-white dark:bg-black border-gray-200 dark:border-[#7C68FA]/20 backdrop-blur-sm">
        <div className="flex-1 overflow-hidden flex flex-col relative">
          {showChat ? (
            <VideoGenI2VChat
              onBack={() => setShowChat(false)}
              modelID={modelID}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
              <div className="flex items-center justify-center h-16 w-16 rounded-full bg-[#7C68FA]/10">
                <Video className="h-8 w-8 text-[#7C68FA]" />
              </div>
              <div className="text-center max-w-md">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                  Image-to-Video Generation
                </h2>
                <p className="text-gray-600 dark:text-gray-400">
                  Generate videos from a reference image using{" "}
                  {modelName ?? "Wan2.2 I2V"}. Upload an image and optionally
                  add a text prompt.
                </p>
              </div>
              <Button
                onClick={() => setShowChat(true)}
                className="bg-[#7C68FA] hover:bg-[#7C68FA]/80 text-white px-8 py-3 rounded-lg text-lg font-semibold"
              >
                Start Generating
              </Button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
};

export default VideoGenI2VParentComponent;
