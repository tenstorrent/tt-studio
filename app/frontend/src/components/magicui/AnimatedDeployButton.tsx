// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
"use client";

import React, { useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Rocket, CheckCircle, XCircle } from "lucide-react";
import { useDeploymentProgress } from "../../hooks/useDeploymentProgress";
import { DeploymentProgress } from "../ui/DeploymentProgress";
import { SimpleDeploymentProgress } from "../ui/SimpleDeploymentProgress";

interface AnimatedDeployButtonProps {
  initialText: React.ReactElement | string;
  changeText: React.ReactElement | string;
  onDeploy: () => Promise<{ success: boolean; job_id?: string }>;
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
    initialText
  );

  // Use the deployment progress hook
  const { progress, isPolling, startPolling, stopPolling } = useDeploymentProgress();

  // Handle progress updates
  useEffect(() => {
    if (progress) {
      if (progress.status === 'completed') {
        setIsDeployed(true);
        setIsDeploying(false);
        setIsRocketFlying(false);
        setDisplayText(<span>Model Deployed!</span>);
        stopPolling();
      } else if (progress.status === 'error' || progress.status === 'failed') {
        setDeploymentFailed(true);
        setIsDeploying(false);
        setIsRocketFlying(false);
        setDisplayText(<span>Deployment Failed</span>);
        stopPolling();
      }
    }
  }, [progress, stopPolling]);

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
      const result = await onDeploy();
      console.log('[Deploy] Deploy result:', result);

      if (result.success) {
        if (result.job_id) {
          console.log('[Deploy] Starting progress polling for job:', result.job_id);
          // Start polling for progress updates
          startPolling(result.job_id);
        } else {
          console.log('[Deploy] No job_id received - deployment succeeded but progress tracking unavailable');
          // Deployment succeeded - mark as complete immediately
          setIsDeployed(true);
          setDisplayText(<span>Model Deployed!</span>);
          setIsDeploying(false);
          setIsRocketFlying(false);
        }
        // Keep the rocket animation going while we wait
      } else {
        console.log('[Deploy] Deployment failed:', result);
        // Handle immediate failure
        setDeploymentFailed(true);
        setDisplayText(<span>Deployment Failed</span>);
        setIsDeploying(false);
        setIsRocketFlying(false);
      }
    } catch (error) {
      console.error("Deployment failed:", error);
      setDeploymentFailed(true);
      setDisplayText(<span>Deployment Failed</span>);
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
    <div className="w-full flex flex-col items-center">
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
            {isDeploying ? (
              <div className="flex items-center gap-2">
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                <span>Deploying...</span>
              </div>
            ) : (
              displayText
            )}
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
      
      {/* Show progress - use API-based progress if available, otherwise show time-based progress */}
      {isDeploying && !isDeployed && (
        <motion.div
          className="w-full max-w-md"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.3 }}
        >
          {(isPolling || progress) && progress ? (
            <DeploymentProgress 
              progress={progress} 
              className=""
            />
          ) : (
            <SimpleDeploymentProgress 
              isDeploying={isDeploying}
              className=""
            />
          )}
        </motion.div>
      )}
    </div>
  );
};
