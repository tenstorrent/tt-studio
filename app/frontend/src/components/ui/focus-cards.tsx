// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
// SPDX-License-Identifier: Apache-2.0
// This file incorporates work covered by the following copyright and permission notice:
//  SPDX-FileCopyrightText: Copyright (c) https://ui.aceternity.com/
//  SPDX-License-Identifier: MIT

import React, { useState } from "react";
import { cn } from "../../lib/utils";

type Card = {
  title: string;
  src: string;
};

const Card = React.memo(
  ({
    card,
    index,
    hovered,
    setHovered,
    onCardClick,
  }: {
    card: Card;
    index: number;
    hovered: number | null;
    setHovered: React.Dispatch<React.SetStateAction<number | null>>;
    onCardClick?: (card: Card) => void;
  }) => (
    <div
      onMouseEnter={() => setHovered(index)}
      onMouseLeave={() => setHovered(null)}
      onClick={() => onCardClick && onCardClick(card)}
      className={cn(
        "rounded-2xl relative bg-gray-100 dark:bg-neutral-900 overflow-hidden aspect-[3/4] transition-all duration-300 ease-out h-full transform cursor-pointer group",
        hovered !== null && hovered !== index && "blur-sm scale-[0.98]",
        index % 2 === 0 ? "rotate-2" : "-rotate-2"
      )}
      style={{ cursor: onCardClick ? "pointer" : "default" }}
    >
      <img src={card.src} alt={card.title} className="object-cover w-full h-full" />
      <div
        className={cn(
          "absolute inset-0 bg-black/50 flex items-end py-4 px-4 transition-opacity duration-300",
          hovered === index ? "opacity-100" : "opacity-0"
        )}
      >
        <div className="text-sm md:text-base lg:text-lg font-medium bg-clip-text text-transparent bg-gradient-to-b from-neutral-50 to-neutral-200">
          {card.title}
        </div>
      </div>
      {/* Overlay button */}
      <button
        className={cn(
          "absolute inset-0 flex items-center justify-center transition-opacity duration-300 bg-black/30 text-white font-semibold text-lg opacity-0 group-hover:opacity-100 hover:opacity-100 z-10",
          hovered === index ? "opacity-100" : ""
        )}
        style={{ pointerEvents: "auto" }}
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation();
          if (onCardClick) onCardClick(card);
        }}
      >
        Use this prompt
      </button>
    </div>
  )
);

Card.displayName = "Card";

export function FocusCards({
  cards,
  onCardClick,
}: {
  cards: Card[];
  onCardClick?: (card: Card) => void;
}) {
  const [hovered, setHovered] = useState<number | null>(null);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8 lg:gap-10 p-4 md:p-6 lg:p-8 w-full">
      {cards.map((card, index) => (
        <div key={card.title} className="h-[300px] md:h-[400px] lg:h-[500px] mx-auto">
          <Card
            card={card}
            index={index}
            hovered={hovered}
            setHovered={setHovered}
            onCardClick={onCardClick}
          />
        </div>
      ))}
    </div>
  );
}
