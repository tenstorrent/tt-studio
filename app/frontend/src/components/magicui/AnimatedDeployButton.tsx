// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
"use client";

import React, { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Rocket } from "lucide-react";

interface AnimatedDeployButtonProps {
  initialText: React.ReactElement | string;
  changeText: React.ReactElement | string;
  onDeploy: () => Promise<void>;
  disabled?: boolean;
}

export const AnimatedDeployButton: React.FC<AnimatedDeployButtonProps> = ({
  initialText,
  changeText,
  onDeploy,
  disabled = false,
}) => {
  const [isDeployed, setIsDeployed] = useState<boolean>(false);
  const [isDeploying, setIsDeploying] = useState<boolean>(false);
  const [displayText, setDisplayText] = useState<React.ReactElement | string>(
    initialText,
  );

  const handleDeploy = async () => {
    if (disabled || isDeploying || isDeployed) return;

    setIsDeploying(true);
    setDisplayText(changeText); // Change the text after clicking deploy
    await onDeploy();
    setIsDeploying(false);
    setIsDeployed(true);
  };

  const buttonClass = `relative flex w-[200px] items-center justify-center overflow-hidden rounded-md p-[10px] outline outline-1 ${
    disabled
      ? "bg-gray-400 cursor-not-allowed"
      : isDeployed
        ? "bg-green-600"
        : "bg-gray-600 hover:bg-gray-700"
  } text-white dark:text-gray-200`;

  return (
    <AnimatePresence mode="wait">
      {isDeployed ? (
        <motion.button
          className={buttonClass}
          onClick={() => setIsDeployed(false)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          disabled={disabled}
        >
          <motion.span
            key="action"
            className="relative block h-full w-full font-semibold"
            initial={{ y: -50 }}
            animate={{ y: 0, transition: { duration: 0.8, ease: "easeOut" } }}
          >
            Model Deployed!
          </motion.span>
        </motion.button>
      ) : (
        <motion.button
          className={`${buttonClass} ${
            !disabled &&
            "cursor-pointer transition-transform duration-700 ease-in-out transform hover:scale-105"
          }`}
          onClick={handleDeploy}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          disabled={disabled || isDeploying}
        >
          <motion.span
            key="reaction"
            className="relative flex items-center font-semibold"
            initial={{ x: 0 }}
            exit={{ x: 50, transition: { duration: 0.6, ease: "easeIn" } }}
          >
            {isDeploying ? "Deploying..." : displayText}
            <Rocket className="ml-2 h-5 w-5 transition-transform duration-700 ease-in-out group-hover:-translate-y-3" />
          </motion.span>
        </motion.button>
      )}
    </AnimatePresence>
  );
};
