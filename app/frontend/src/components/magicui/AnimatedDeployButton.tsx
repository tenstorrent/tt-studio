// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
"use client";

import React, { useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Rocket, CheckCircle, XCircle } from "lucide-react";

interface AnimatedDeployButtonProps {
  initialText: React.ReactElement | string;
  changeText: React.ReactElement | string;
  onDeploy: () => Promise<boolean>;
  disabled?: boolean;
  onDeploymentComplete: () => void;
}

export const AnimatedDeployButton: React.FC<AnimatedDeployButtonProps> = ({
  initialText,
  changeText,
  onDeploy,
  disabled = false,
  onDeploymentComplete,
}) => {
  const [isDeployed, setIsDeployed] = useState<boolean>(false);
  const [isDeploying, setIsDeploying] = useState<boolean>(false);
  const [isRocketFlying, setIsRocketFlying] = useState<boolean>(false);
  const [deploymentFailed, setDeploymentFailed] = useState<boolean>(false);
  const [displayText, setDisplayText] = useState<React.ReactElement | string>(
    initialText,
  );

  useEffect(() => {
    if (isDeployed) {
      const timer = setTimeout(() => {
        onDeploymentComplete();
      }, 550);
      return () => clearTimeout(timer);
    }
  }, [isDeployed, onDeploymentComplete]);

  const handleDeploy = async () => {
    if (disabled || isDeploying || isDeployed) return;

    setIsDeploying(true);
    setDisplayText(changeText);
    setIsRocketFlying(true);
    setDeploymentFailed(false);

    try {
      const deploySuccess = await onDeploy();

      // Wait for the rocket animation to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      if (deploySuccess) {
        setIsDeployed(true);
        setDisplayText(<span>Model Deployed!</span>);
      } else {
        setDeploymentFailed(true);
        setDisplayText(<span>Deployment Failed</span>);
      }
    } catch (error) {
      console.error("Deployment failed:", error);
      setDeploymentFailed(true);
      setDisplayText(<span>Deployment Failed</span>);
    } finally {
      setIsDeploying(false);
      setIsRocketFlying(false);
    }
  };

  const buttonClass = `relative flex w-[200px] items-center justify-center overflow-hidden rounded-md p-[10px] outline outline-1 ${
    disabled
      ? "bg-gray-400 cursor-not-allowed"
      : isDeployed
        ? "bg-green-600 hover:bg-green-700"
        : deploymentFailed
          ? "bg-red-600 hover:bg-red-700"
          : "bg-gray-600 hover:bg-gray-700"
  } text-white dark:text-gray-200`;

  const particles = Array.from({ length: 5 }, (_, i) => (
    <motion.div
      key={`particle-${i}`}
      className="absolute w-1 h-1 bg-yellow-400 rounded-full"
      initial={{ opacity: 0, y: 0, x: 0 }}
      animate={
        isRocketFlying
          ? {
              opacity: [0, 1, 0],
              y: [0, -20 - Math.random() * 30],
              x: [-5 + Math.random() * 10, -10 + Math.random() * 20],
            }
          : {}
      }
      transition={{ duration: 1, ease: "easeOut", delay: Math.random() * 0.2 }}
    />
  ));

  return (
    <AnimatePresence mode="wait">
      <motion.button
        className={`${buttonClass} ${
          !disabled &&
          "cursor-pointer transition-transform duration-700 ease-in-out hover:scale-105"
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
          <AnimatePresence mode="wait">
            {!isDeploying && !isDeployed && !deploymentFailed && (
              <motion.div
                key="rocket"
                className="ml-2 relative"
                initial={{ y: 0, opacity: 1 }}
                exit={{ y: -100, opacity: 0 }}
                transition={{ duration: 1, ease: "easeOut" }}
              >
                <Rocket className="h-5 w-5" />
                {particles}
              </motion.div>
            )}
            {isDeployed && (
              <motion.div
                key="success"
                className="ml-2"
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.5, ease: "easeOut" }}
              >
                <CheckCircle className="h-5 w-5 text-white" />
              </motion.div>
            )}
            {deploymentFailed && (
              <motion.div
                key="failure"
                className="ml-2"
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.5, ease: "easeOut" }}
              >
                <XCircle className="h-5 w-5 text-white" />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.span>
      </motion.button>
    </AnimatePresence>
  );
};
