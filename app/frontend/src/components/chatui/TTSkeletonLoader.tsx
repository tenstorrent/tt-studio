// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React from "react";
import { motion } from "framer-motion";
import { useLogo } from "../../utils/logo";
import { ImageWithFallback } from "../ui/ImageWithFallback";

interface TTSkeletonLoaderProps {
  size?: number;
  className?: string;
}

const TTSkeletonLoader: React.FC<TTSkeletonLoaderProps> = ({
  size = 24,
  className = "",
}) => {
  const { logoUrl } = useLogo();

  return (
    <motion.div
      className={`flex items-center justify-center ${className}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <motion.div
        style={{
          width: size,
          height: size,
          position: "relative",
        }}
        animate={{
          filter: ["brightness(0.3)", "brightness(0.6)", "brightness(0.3)"],
        }}
        transition={{
          duration: 2,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      >
        {logoUrl && (
          <ImageWithFallback
            src={logoUrl}
            alt="Tenstorrent Logo"
            className={`
              w-full h-full object-contain
              transition-all duration-500 ease-out
              ${className}
            `}
            onError={() => {}}
          />
        )}
      </motion.div>
    </motion.div>
  );
};

export default TTSkeletonLoader;
