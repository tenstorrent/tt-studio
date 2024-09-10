// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
"use client";

import React, { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Rocket } from "lucide-react";

interface AnimatedDeployButtonProps {
  initialText: React.ReactElement | string;
  changeText: React.ReactElement | string;
  onDeploy: () => void;
}

export const AnimatedDeployButton: React.FC<AnimatedDeployButtonProps> = ({
  initialText,
  changeText,
  onDeploy,
}) => {
  const [isDeployed, setIsDeployed] = useState<boolean>(false);
  const [displayText, setDisplayText] = useState<React.ReactElement | string>(
    initialText,
  );

  const handleDeploy = async () => {
    setIsDeployed(true);
    setDisplayText(changeText); // Change the text after clicking deploy
    await onDeploy();
  };

  return (
    <AnimatePresence mode="wait">
      {isDeployed ? (
        <motion.button
          className="relative flex w-[200px] items-center justify-center overflow-hidden rounded-md p-[10px] outline outline-1 bg-gray-600 text-white dark:bg-gray-700 dark:text-gray-200"
          onClick={() => setIsDeployed(false)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
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
          className="relative flex w-[200px] cursor-pointer items-center justify-center rounded-md border-none p-[10px] transition-transform duration-700 ease-in-out transform hover:scale-105 bg-gray-600 text-white dark:bg-gray-700 dark:text-gray-200"
          onClick={handleDeploy}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.span
            key="reaction"
            className="relative flex items-center font-semibold"
            initial={{ x: 0 }}
            exit={{ x: 50, transition: { duration: 0.6, ease: "easeIn" } }}
          >
            {displayText}
            <Rocket className="ml-2 h-5 w-5 transition-transform duration-700 ease-in-out group-hover:-translate-y-3" />
          </motion.span>
        </motion.button>
      )}
    </AnimatePresence>
  );
};
