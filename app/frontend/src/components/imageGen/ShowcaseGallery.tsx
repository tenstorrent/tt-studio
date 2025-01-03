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
];

const ShowcaseGallery: React.FC<ShowcaseGalleryProps> = ({
  onStartGenerating,
}) => {
  return (
    <div className="flex flex-col items-center gap-8 h-full w-full">
      <div className="w-full px-4">
        <FocusCards cards={showcaseImages} />
      </div>
      <Button
        onClick={onStartGenerating}
        className="px-8 py-4 text-lg bg-TT-purple-accent text-white hover:bg-TT-purple-accent/90 transition-colors"
      >
        Start Generating
      </Button>
    </div>
  );
};

export default ShowcaseGallery;
