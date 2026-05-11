// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useState } from "react";
import { motion } from "framer-motion";

import { Button } from "../ui/button";
import HfAccessCheck from "../HfAccessCheck";

interface Props {
  onBack: () => void;
  onNext: () => void;
}

export default function WelcomeHfCheckStep({ onBack, onNext }: Props) {
  const [hasChecked, setHasChecked] = useState(false);
  const [allGranted, setAllGranted] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="space-y-5"
    >
      <div>
        <h2 className="text-2xl font-semibold">Verify model access</h2>
        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
          Confirm your Hugging Face token can reach the gated models TT Studio
          uses out of the box. You can request access in a new tab and continue
          anyway — this is a soft check.
        </p>
      </div>

      <HfAccessCheck
        onChecked={(ok) => {
          setHasChecked(true);
          setAllGranted(ok);
        }}
      />

      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <div className="flex gap-2">
          {hasChecked && !allGranted && (
            <Button variant="outline" onClick={onNext}>
              Skip for now
            </Button>
          )}
          <Button onClick={onNext} disabled={!hasChecked}>
            {hasChecked && allGranted ? "Continue" : "Continue"}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
