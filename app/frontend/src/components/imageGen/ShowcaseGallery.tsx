// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React from "react";
import { Button } from "../ui/button";
import { FocusCards } from "../ui/focus-cards";
import castleImage from "../../assets/SD1.4/generated-image-1738773382747.jpg";
import astronautImage from "../../assets/SD1.4/generated-image-1738773243000.jpg";
import creepyMansionImage from "../../assets/SD1.4/generated-image-1738773136575.jpg";
import warriorImage from "../../assets/SD1.4/generated-image-1738773046851.jpg";
import cyberpunkImage from "../../assets/SD1.4/generated-image-1738773023543.jpg";
import swissAlpsImage from "../../assets/SD1.4/generated-image-1738772998942.jpg";

interface ShowcaseGalleryProps {
  onStartGenerating: () => void;
  onImageClick?: (prompt: string) => void;
}

//!!
// TODO replace with actual images generated by the model
const showcaseImages = [
  {
    title:
      "A majestic castle on a floating island, surrounded by mythical creatures, dragons flying in the sky, magical glowing runes, enchanted forest below, ethereal and otherworldly color palette, highly detailed concept art",
    src: castleImage,
  },
  {
    title:
      "Astronaut floating in space near a massive alien planet, glowing nebulae in the background, distant stars twinkling, sleek futuristic spaceship, surreal atmosphere, vast and infinite space, sci-fi realism",
    src: astronautImage,
  },
  {
    title:
      "A creepy abandoned mansion at midnight, thick fog, broken windows, eerie glowing lights inside, horror atmosphere",
    src: creepyMansionImage,
  },
  {
    title:
      "A warrior in shining armor standing on a battlefield, magical aura around their sword, dark storm clouds in the background, epic fantasy illustration",
    src: warriorImage,
  },
  {
    title:
      "A breathtaking view of the Swiss Alps at sunrise, crisp details, hyper-realistic lighting, dramatic clouds, ultra-HD photography",
    src: swissAlpsImage,
  },
  {
    title:
      "A neon-lit cyberpunk Tokyo street at night, reflections on wet pavement, people walking with futuristic outfits, cinematic realism",
    src: cyberpunkImage,
  },
];

const ShowcaseGallery: React.FC<ShowcaseGalleryProps> = ({
  onStartGenerating,
  onImageClick,
}) => {
  const handleImageClick = (prompt: string) => {
    if (onImageClick) {
      onImageClick(prompt);
    }
    onStartGenerating();
  };

  return (
    <div className="flex flex-col items-center w-full h-full overflow-x-hidden">
      <div className="w-full flex-grow overflow-y-auto">
        <FocusCards
          cards={showcaseImages}
          onCardClick={(card) => handleImageClick(card.title)}
        />
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
