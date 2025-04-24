"use client";

import { cn } from "../../lib/utils";
import { motion, useAnimation } from "framer-motion";
import { useEffect, useState } from "react";

export const TypewriterEffectSmooth = ({
  words,
  className,
  cursorClassName,
}: {
  words: {
    text: string;
    className?: string;
  }[];
  className?: string;
  cursorClassName?: string;
}) => {
  const controls = useAnimation();
  const [currentWordIndex, setCurrentWordIndex] = useState(0);

  useEffect(() => {
    const sequence = async () => {
      while (true) {
        for (let i = 0; i < words.length; i++) {
          setCurrentWordIndex(i);
          await controls.start({
            width: "100%",
            transition: { duration: 1.5, ease: "linear" },
          });
          await new Promise((resolve) => setTimeout(resolve, 2000));
          await controls.start({
            width: "0%",
            transition: { duration: 0.5, ease: "linear" },
          });
        }
      }
    };

    sequence();
  }, [controls, words.length]);

  return (
    <div
      className={cn(
        "inline-flex flex-col sm:flex-row items-center gap-2 sm:gap-4 text-center sm:text-left px-4 sm:px-0",
        className
      )}
    >
      <span className="text-gray-600 dark:text-gray-300 whitespace-nowrap text-base sm:text-lg md:text-xl lg:text-2xl">
        Demo and trial
      </span>
      <div className="relative mx-1">
        <motion.div
          className="overflow-hidden inline-flex"
          initial={{ width: "0%" }}
          animate={controls}
        >
          <span
            className={cn(
              "whitespace-nowrap text-base sm:text-lg md:text-xl lg:text-2xl",
              words[currentWordIndex]?.className
            )}
          >
            {words[currentWordIndex]?.text}
          </span>
        </motion.div>
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{
            duration: 0.8,
            repeat: Infinity,
            repeatType: "reverse",
          }}
          className={cn(
            "absolute right-[-12px] top-1 block rounded-sm w-[3px] sm:w-[4px] h-[1.2em] bg-[#7C68FA]",
            cursorClassName
          )}
        />
      </div>
      <span className="text-gray-600 dark:text-gray-300 whitespace-nowrap text-base sm:text-lg md:text-xl lg:text-2xl">
        running on Tenstorrent hardware
      </span>
    </div>
  );
};
