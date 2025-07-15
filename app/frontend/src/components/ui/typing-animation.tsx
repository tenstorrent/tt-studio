// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from "react";

import { cn } from "../../lib/utils";

interface TypingAnimationProps {
  texts: string[];
  duration?: number;
  className?: string;
  cycleDelay?: number;
}

export function TypingAnimation({
  texts,
  duration = 100,
  className,
  cycleDelay = 2000,
}: TypingAnimationProps) {
  const [displayedText, setDisplayedText] = useState<string>("");
  const [currentTextIndex, setCurrentTextIndex] = useState<number>(0);
  const [currentCharIndex, setCurrentCharIndex] = useState<number>(0);

  useEffect(() => {
    // Reset when text changes
    setCurrentCharIndex(0);
    setDisplayedText("");
  }, [currentTextIndex]);

  useEffect(() => {
    const typingEffect = setInterval(() => {
      if (currentCharIndex < texts[currentTextIndex].length) {
        setDisplayedText(
          texts[currentTextIndex].substring(0, currentCharIndex + 1)
        );
        setCurrentCharIndex(currentCharIndex + 1);
      } else {
        clearInterval(typingEffect);
        // Wait for cycleDelay before moving to next text
        setTimeout(() => {
          setCurrentTextIndex((prev) => (prev + 1) % texts.length);
        }, cycleDelay);
      }
    }, duration);

    return () => {
      clearInterval(typingEffect);
    };
  }, [duration, currentCharIndex, currentTextIndex, texts, cycleDelay]);

  return <span className={cn("inline-block", className)}>{displayedText}</span>;
}
