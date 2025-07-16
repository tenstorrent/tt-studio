// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
"use client";

import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { CircuitBoard, Home, ArrowLeft } from "lucide-react";

export default function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div className="relative min-h-screen w-full bg-TT-black overflow-hidden">
      {/* Circuit board background pattern */}
      <div className="absolute inset-0 bg-grid-small-TT-blue-shade/20" />

      {/* Animated circuit paths */}
      <div className="absolute inset-0">
        <motion.div
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 2, ease: "easeInOut", repeat: Infinity }}
          className="absolute left-0 right-0 top-1/4 h-[2px] bg-gradient-to-r from-transparent via-TT-blue-accent to-transparent"
        />
        <motion.div
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{
            duration: 2,
            ease: "easeInOut",
            delay: 0.5,
            repeat: Infinity,
          }}
          className="absolute left-1/4 right-1/4 top-2/3 h-[2px] bg-gradient-to-r from-transparent via-TT-purple-accent to-transparent"
        />
      </div>

      {/* Content container */}
      <div className="relative z-10 flex flex-col items-center justify-center min-h-screen px-4">
        {/* Glowing background effect */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px]">
          <div className="absolute inset-0 bg-TT-blue-accent/20 rounded-full blur-[100px]" />
          <div className="absolute inset-0 bg-TT-purple-accent/20 rounded-full blur-[100px] animate-pulse" />
        </div>

        {/* Main content */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="relative flex flex-col items-center text-center"
        >
          {/* Circuit board icon */}
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 20 }}
            className="mb-8"
          >
            <CircuitBoard className="w-24 h-24 text-TT-purple-accent" />
          </motion.div>

          {/* 404 text */}
          <motion.h1
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="text-8xl md:text-9xl font-bold font-sans"
          >
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-TT-purple-DEFAULT via-TT-blue-DEFAULT to-TT-teal-DEFAULT">
              404
            </span>
          </motion.h1>

          {/* Error messages */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="mt-6 space-y-2 max-w-lg"
          >
            <p className="text-TT-purple-tint2 text-xl">Process Interrupted: Path Not Found</p>
            <p className="text-TT-slate-DEFAULT">
              The requested route could not be processed. Please verify the path or return to a
              valid endpoint.
            </p>
          </motion.div>

          {/* Action buttons */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className="mt-12 flex flex-col sm:flex-row gap-4"
          >
            <button
              onClick={() => navigate(-1)}
              className="group flex items-center gap-2 px-6 py-2 text-TT-purple-tint1 hover:text-TT-purple-DEFAULT transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Return to Previous Path</span>
            </button>
            <button
              onClick={() => navigate("/")}
              className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-TT-purple-accent to-TT-blue-accent text-white rounded-md hover:opacity-90 transition-opacity"
            >
              <Home className="w-4 h-4" />
              <span>Return to Main Process</span>
            </button>
          </motion.div>
        </motion.div>

        {/* Animated data flow lines */}
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-TT-blue-accent to-transparent opacity-75">
          <motion.div
            initial={{ x: "-100%" }}
            animate={{ x: "100%" }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: "linear",
            }}
            className="h-full w-1/3 bg-gradient-to-r from-transparent via-TT-purple-accent to-transparent"
          />
        </div>
      </div>
    </div>
  );
}
