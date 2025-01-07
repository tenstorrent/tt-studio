// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
// SPDX-License-Identifier: Apache-2.0

import React from "react";
import { Button } from "../ui/button";
import { FocusCards } from "../ui/focus-cards";

interface ShowcaseGalleryProps {
  onStartGenerating: () => void;
}

const showcaseImages = [
  {
    title: "A cyberpunk cityscape at night with neon lights and flying vehicles",
    src: "https://images.unsplash.com/photo-1518710843675-2540dd79065c?q=80&w=3387&auto=format&fit=crop&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
  },
  {
    title: "A serene Japanese garden with cherry blossoms and a traditional pagoda",
    src: "https://images.unsplash.com/photo-1600271772470-bd22a42787b3?q=80&w=3072&auto=format&fit=crop&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
  },
  {
    title: "An ethereal forest scene with bioluminescent plants and mystical creatures",
    src: "https://images.unsplash.com/photo-1505142468610-359e7d316be0?q=80&w=3070&auto=format&fit=crop&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
  },
  {
    title: "A futuristic laboratory with holographic displays and robotic assistants",
    src: "https://images.unsplash.com/photo-1486915309851-b0cc1f8a0084?q=80&w=3387&auto=format&fit=crop&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
  },
  {
    title: "An abstract representation of consciousness with flowing colors and shapes",
    src: "https://images.unsplash.com/photo-1507041957456-9c397ce39c97?q=80&w=3456&auto=format&fit=crop&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
  },
  {
    title: "A steampunk-inspired mechanical dragon with brass and copper components",
    src: "https://assets.aceternity.com/the-first-rule.png",
  },
  {
    title: "A surreal floating island with waterfalls flowing into space",
    src: "https://images.unsplash.com/photo-1534447677768-be436bb09401?w=800&auto=format&fit=crop&q=60&ixlib=rb-4.0.3",
  },
  {
    title: "An ancient temple covered in bioluminescent vines",
    src: "https://images.unsplash.com/photo-1510798831971-661eb04b3739?w=800&auto=format&fit=crop&q=60&ixlib=rb-4.0.3",
  },
  {
    title: "A crystalline city emerging from a desert landscape",
    src: "https://images.unsplash.com/photo-1579547621869-0d6d0d86b849?w=800&auto=format&fit=crop&q=60&ixlib=rb-4.0.3",
  },
];

const ShowcaseGallery: React.FC<ShowcaseGalleryProps> = ({
  onStartGenerating,
}) => {
  return (
    <div className="flex flex-col items-center w-full h-full overflow-x-hidden">
      <div className="w-full flex-grow overflow-y-auto">
        <FocusCards cards={showcaseImages} />
      </div>
      <div className="w-full py-6 px-4 bg-gradient-to-t from-background to-transparent">
        <Button
          variant="navbar"
          size="icon"
          onClick={onStartGenerating}
          className="w-full px-8 py-4 text-lg bg-TT-purple-accent text-white hover:bg-TT-purple-accent/90 transition-colors"
        >
          Start Generating
        </Button>
      </div>
    </div>
  );
};

export default ShowcaseGallery;

