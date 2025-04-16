// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React from "react";
import { motion } from "framer-motion";
import logo from "../../assets/tt_logo.svg";

interface TTSkeletonLoaderProps {
  size?: number;
  className?: string;
}

const TTSkeletonLoader: React.FC<TTSkeletonLoaderProps> = ({
  size = 24,
  className = "",
}) => {
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
      >
        <motion.img
          src={logo}
          alt="Tenstorrent Logo"
          width={size}
          height={size}
          style={{
            position: "relative",
            zIndex: 1,
            filter: "brightness(0.3)",
          }}
          animate={{
            filter: ["brightness(0.3)", "brightness(0.6)", "brightness(0.3)"],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      </motion.div>
    </motion.div>
  );
};

export default TTSkeletonLoader;
