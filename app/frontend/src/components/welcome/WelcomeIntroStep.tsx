// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { motion } from "framer-motion";
import { Settings } from "lucide-react";
import { Button } from "../ui/button";

interface Props {
  onNext: () => void;
}

export default function WelcomeIntroStep({ onNext }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="space-y-6 text-left"
    >
      <div>
        <h2 className="text-2xl font-semibold">Welcome to TT Studio</h2>
        <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
          A quick setup to get your AI models running on Tenstorrent hardware.
          All you need is a Hugging Face token, and even that can wait until
          later.
        </p>
      </div>

      <ul className="space-y-2 text-sm">
        <li className="flex items-start gap-2">
          <span className="text-TT-purple">•</span>
          <span>
            A <span className="font-medium">Hugging Face token</span> gives you
            faster model weight downloads, and unlocks gated models like
            the Llama family and FLUX.1-dev.
          </span>
        </li>
        <li className="flex items-start gap-2">
          <span className="text-TT-purple">•</span>
          <span>
            You can add or change it any time from{" "}
            <span className="inline-flex items-center gap-1 font-medium">
              <Settings className="w-3.5 h-3.5" /> Settings
            </span>
            .
          </span>
        </li>
      </ul>

      <div className="flex justify-end">
        <Button onClick={onNext}>Get started</Button>
      </div>
    </motion.div>
  );
}
