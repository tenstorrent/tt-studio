// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { motion } from "framer-motion";
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
      className="space-y-6"
    >
      <div>
        <h2 className="text-2xl font-semibold">Welcome to TT Studio</h2>
        <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
          A quick setup to get your AI models running on Tenstorrent hardware.
          You can paste API keys now or skip and configure them later from
          Settings — everything is editable any time.
        </p>
      </div>

      <ul className="space-y-2 text-sm">
        <li className="flex items-start gap-2">
          <span className="text-TT-purple">•</span>
          <span>
            <span className="font-medium">Hugging Face token</span> — used to
            download gated models like Llama 3 and Qwen.
          </span>
        </li>
        <li className="flex items-start gap-2">
          <span className="text-TT-purple">•</span>
          <span>
            <span className="font-medium">TTS API key</span> — required to call
            TTS inference endpoints.
          </span>
        </li>
        <li className="flex items-start gap-2">
          <span className="text-TT-purple">•</span>
          <span>
            <span className="font-medium">Tavily API key</span> — optional;
            powers the search-enabled agent.
          </span>
        </li>
        <li className="flex items-start gap-2">
          <span className="text-TT-purple">•</span>
          <span>
            <span className="font-medium">JWT secret</span> — auto-generated and
            persisted for you.
          </span>
        </li>
      </ul>

      <div className="flex justify-end">
        <Button onClick={onNext}>Get started</Button>
      </div>
    </motion.div>
  );
}
