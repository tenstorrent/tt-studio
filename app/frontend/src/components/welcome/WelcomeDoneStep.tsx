// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { motion } from "framer-motion";
import { Check } from "lucide-react";

import { Button } from "../ui/button";

interface Props {
  onFinish: () => void;
  isFinishing: boolean;
}

export default function WelcomeDoneStep({ onFinish, isFinishing }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="space-y-6 text-center"
    >
      <motion.div
        initial={{ scale: 0, rotate: -90 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 220, damping: 16 }}
        className="mx-auto rounded-full bg-emerald-500/15 p-3 w-fit"
      >
        <Check className="w-8 h-8 text-emerald-500" />
      </motion.div>

      <div>
        <h2 className="text-2xl font-semibold">You're all set</h2>
        <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
          Secrets are saved on the server. You won't see this welcome again on
          this machine. Edit anything later from the gear icon in the navbar.
        </p>
      </div>

      <div className="flex justify-center">
        <Button onClick={onFinish} disabled={isFinishing}>
          {isFinishing ? "Finishing…" : "Go to TT Studio"}
        </Button>
      </div>
    </motion.div>
  );
}
