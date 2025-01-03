import React, { useState } from "react";
import { Card } from "../ui/card";
import { Button } from "../ui/button";
import ShowcaseGallery from "./ShowcaseGallery";
import StableDiffusionChat from "./StableDiffusionChat";

const ImageGenParentComponent: React.FC = () => {
  const [showChat, setShowChat] = useState(false);

  return (
    <div className="flex items-center justify-center min-h-screen px-5 bg-black">
      <Card className="flex flex-col w-screen max-w-[calc(100vw-40px)] h-[90vh] max-h-[1000px] overflow-hidden shadow-xl bg-zinc-900 border-zinc-800">
        {/* Main Content Area */}
        <div className="flex-1 overflow-hidden flex flex-col relative">
          {showChat ? (
            <StableDiffusionChat onBack={() => setShowChat(false)} />
          ) : (
            <div className="flex-1 overflow-auto">
              <ShowcaseGallery onStartGenerating={() => setShowChat(true)} />
            </div>
          )}
          {!showChat && (
            <div className="mt-auto flex items-center justify-center p-6 border-t border-gray-200 dark:border-gray-700">
              <Button
                className="px-8 py-4 text-lg bg-TT-purple-accent text-white hover:bg-TT-purple-accent/90 transition-colors"
                onClick={() => setShowChat(true)}
              >
                Start a Chat
              </Button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
};

export default ImageGenParentComponent;

