// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import React, { useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Image, Video } from "lucide-react";
import { cn } from "../../lib/utils";

const transition = {
  type: "tween",
  ease: "easeOut",
  duration: 0.15,
};

const tabs = [
  { value: "file", label: "File Upload", icon: Image },
  { value: "webcam", label: "Webcam", icon: Video },
];

interface AnimatedTabsProps {
  selectedTab: string;
  onTabChange: (tab: string) => void;
  onReset: () => void;
}

export const AnimatedTabs: React.FC<AnimatedTabsProps> = ({
  selectedTab,
  onTabChange,
  onReset,
}) => {
  const [hoveredTabIndex, setHoveredTabIndex] = useState<number | null>(null);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const navRef = useRef<HTMLDivElement>(null);

  const getHoverAnimationProps = (hoveredRect: DOMRect, navRect: DOMRect) => ({
    x: hoveredRect.left - navRect.left - 10,
    y: hoveredRect.top - navRect.top - 4,
    width: hoveredRect.width + 20,
    height: hoveredRect.height + 10,
  });

  const navRect = navRef.current?.getBoundingClientRect();
  const selectedTabIndex = tabs.findIndex((tab) => tab.value === selectedTab);
  const selectedRect = buttonRefs.current[selectedTabIndex]?.getBoundingClientRect();
  const hoveredRect = buttonRefs.current[hoveredTabIndex ?? -1]?.getBoundingClientRect();

  return (
    <nav
      ref={navRef}
      className="flex flex-shrink-0 justify-center items-center relative z-0 py-2 mb-4"
      onPointerLeave={() => setHoveredTabIndex(null)}
    >
      {tabs.map((item, i) => {
        const isActive = selectedTab === item.value;
        const Icon = item.icon;

        return (
          <button
            key={item.value}
            className="text-base sm:text-lg relative rounded-md flex items-center h-10 sm:h-12 px-6 sm:px-8 z-20 bg-transparent cursor-pointer select-none transition-colors"
            onPointerEnter={() => setHoveredTabIndex(i)}
            onFocus={() => setHoveredTabIndex(i)}
            onClick={() => {
              onTabChange(item.value);
              onReset();
            }}
          >
            <motion.span
              ref={(el) => {
                buttonRefs.current[i] = el as HTMLButtonElement;
              }}
              className={cn("flex items-center gap-3", {
                "text-zinc-500": !isActive,
                "text-black dark:text-white font-semibold": isActive,
              })}
            >
              <Icon size={20} />
              {item.label}
            </motion.span>
          </button>
        );
      })}

      <AnimatePresence>
        {hoveredRect && navRect && (
          <motion.div
            key="hover"
            className="absolute z-10 top-0 left-0 rounded-md bg-zinc-100 dark:bg-zinc-800"
            initial={{
              ...getHoverAnimationProps(hoveredRect, navRect),
              opacity: 0,
            }}
            animate={{
              ...getHoverAnimationProps(hoveredRect, navRect),
              opacity: 1,
            }}
            exit={{
              ...getHoverAnimationProps(hoveredRect, navRect),
              opacity: 0,
            }}
            transition={transition}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedRect && navRect && (
          <motion.div
            className="absolute z-10 bottom-0 left-0 h-[2px] bg-black dark:bg-white"
            initial={false}
            animate={{
              width: selectedRect.width + 18,
              x: `calc(${selectedRect.left - navRect.left - 9}px)`,
              opacity: 1,
            }}
            transition={transition}
          />
        )}
      </AnimatePresence>
    </nav>
  );
};
