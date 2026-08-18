// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
"use client";

import React, { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Rocket, XCircle } from "lucide-react";

interface AnimatedDeployButtonProps {
  initialText: React.ReactElement | string;
  changeText: React.ReactElement | string;
  onDeploy: () => Promise<{ success: boolean; job_id?: string }>;
  disabled?: boolean;
  // Called once the backend accepts the deploy and returns a job id
  onDeployStarted: (jobId: string) => void;
}

export const AnimatedDeployButton: React.FC<AnimatedDeployButtonProps> = ({
  initialText,
  changeText,
  onDeploy,
  disabled = false,
  onDeployStarted,
}) => {
  const [isDeploying, setIsDeploying] = useState<boolean>(false);
  const [isRocketFlying, setIsRocketFlying] = useState<boolean>(false);
  const [deploymentFailed, setDeploymentFailed] = useState<boolean>(false);

  const reset = () => {
    setIsDeploying(false);
    setIsRocketFlying(false);
  };

  const fail = () => {
    setDeploymentFailed(true);
    setIsDeploying(false);
    setIsRocketFlying(false);
  };

  const handleDeploy = async () => {
    if (disabled || isDeploying) return;

    setIsDeploying(true);
    setIsRocketFlying(true);
    setDeploymentFailed(false);

    try {
      const result = await onDeploy();
      console.log("[Deploy] Deploy result:", result);

      if (result.success && result.job_id) {
        // Hand the job off to the tracker; the tray takes over from here.
        onDeployStarted(result.job_id);
        reset();
      } else {
        if (result.success) {
          console.warn("[Deploy] Success without job_id — treating as failure");
        }
        fail();
      }
    } catch (error) {
      console.error("Deployment failed:", error);
      fail();
    }
  };

  const buttonClass = `relative flex w-[200px] items-center justify-center overflow-hidden rounded-md p-[10px] outline outline-1 ${disabled
    ? "bg-gray-400 cursor-not-allowed"
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
    <div className="w-full flex flex-col items-center">
      <AnimatePresence mode="wait">
        <motion.button
          className={`${buttonClass} ${!disabled &&
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
            {isDeploying ? (
              <div className="flex items-center gap-2">
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                {changeText}
              </div>
            ) : deploymentFailed ? (
              <span>Deployment Failed</span>
            ) : (
              // Render the live prop, not captured state, so the label always tracks
              // the current deploy availability (e.g. re-enabling after a cancel frees devices).
              initialText
            )}
            <AnimatePresence mode="wait">
              {!isDeploying && !deploymentFailed && (
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
    </div>
  );
};
