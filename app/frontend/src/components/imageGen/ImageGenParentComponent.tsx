// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { useEffect, useState } from 'react';
import { useLocation } from "react-router-dom";
import { customToast } from "../CustomToaster";
import { Card } from '../ui/card';
import ShowcaseGallery from './ShowcaseGallery';
import StableDiffusionChat from './StableDiffusionChat';

const ImageGenParentComponent: React.FC = () => {
  const [showChat, setShowChat] = useState(false);

  // model handling state
  const location = useLocation();
  const [modelID, setModelID] = useState<string>("");
  const [modelName, setModelName] = useState<string | null>(null);

  useEffect(() => {
    if (location.state) {
      if (!location.state.containerID) {
        customToast.error(
          "modelID is unavailable. Try navigating here from the Models Deployed tab",
        );
        return;
      }
      setModelID(location.state.containerID);
      setModelName(location.state.modelName);
    }
  }, [location.state, modelID, modelName]);

  return (
    <div className="w-full h-screen p-4 pb-8 pl-32">
      <Card className="flex flex-col w-full h-full overflow-hidden shadow-xl bg-zinc-900/80 border-zinc-800 backdrop-blur-sm">
        <div className="flex-1 overflow-hidden flex flex-col relative">
          {showChat ? (
            <StableDiffusionChat onBack={() => setShowChat(false)} modelID={modelID}/>
          ) : (
            <div className="flex-1 overflow-auto">
              <ShowcaseGallery onStartGenerating={() => setShowChat(true)} />
            </div>
          )}
        </div>
      </Card>
    </div>
  );
};

export default ImageGenParentComponent;
