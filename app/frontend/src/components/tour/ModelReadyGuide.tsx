// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { JSX } from "react";
import type React from "react";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Dialog, DialogContent } from "../ui/dialog";
import { Button } from "../ui/button";
import {
  CheckCircle2,
  MessageSquareText,
  Code2,
  Compass,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

export const GUIDE_KEY = "tt_studio_guide_v1";

interface Step {
  accentClass: string;
  iconBgClass: string;
  Icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  /** If set, shows an action button that navigates without closing the guide */
  actionLabel?: string;
  actionHref?: string;
}

const STEPS: Step[] = [
  {
    accentClass: "text-green-400",
    iconBgClass: "bg-green-950/40 border-green-800/40",
    Icon: CheckCircle2,
    title: "Your model is live!",
    body: "You've successfully deployed a model on Tenstorrent hardware. Here's a quick tour of what you can do next.",
  },
  {
    accentClass: "text-purple-400",
    iconBgClass: "bg-purple-950/40 border-purple-800/40",
    Icon: MessageSquareText,
    title: "Chat with your model",
    body: "Click the Chat button on any healthy model row to open the live chat interface. For image generation, speech, TTS, or object detection models, the button opens the matching specialized playground instead.",
    actionLabel: "Open Chat",
    actionHref: "/chat",
  },
  {
    accentClass: "text-blue-400",
    iconBgClass: "bg-blue-950/40 border-blue-800/40",
    Icon: Code2,
    title: "Integrate via API",
    body: "Click the API button (blue, in the Manage column) to open the REST API docs for that model — complete with endpoint URLs, request format, and copy-ready code snippets for curl, Python, and JavaScript.",
  },
  {
    accentClass: "text-stone-300",
    iconBgClass: "bg-stone-800/40 border-stone-700/40",
    Icon: Compass,
    title: "You're all set",
    body: "Use the navigation bar to access Deployment History, RAG Management, and more. The Voice Agent becomes available when STT + LLM + TTS models are all healthy. The Logs button on each row shows live container output.",
  },
];

interface ModelReadyGuideProps {
  open: boolean;
  onClose: () => void;
}

const slideVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 36 : -36, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -36 : 36, opacity: 0 }),
};

export default function ModelReadyGuide({
  open,
  onClose,
}: ModelReadyGuideProps): JSX.Element {
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const navigate = useNavigate();

  const dismiss = () => {
    localStorage.setItem(GUIDE_KEY, "1");
    onClose();
    // Reset step after dialog close animation
    setTimeout(() => setStep(0), 300);
  };

  const goTo = (next: number) => {
    setDirection(next > step ? 1 : -1);
    setStep(next);
  };

  const handleNext = () => {
    if (step === STEPS.length - 1) {
      dismiss();
    } else {
      goTo(step + 1);
    }
  };

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) dismiss(); }}>
      <DialogContent className="max-w-md p-0 overflow-hidden border border-stone-700/50 bg-stone-950 gap-0">
        {/* Header: dots + close */}
        <div className="flex items-center justify-between px-5 pt-5">
          <div className="flex items-center gap-1.5">
            {STEPS.map((_, i) => (
              <button
                key={i}
                onClick={() => goTo(i)}
                className={`rounded-full transition-all duration-200 ${
                  i === step
                    ? "w-5 h-1.5 bg-stone-300"
                    : i < step
                      ? "w-1.5 h-1.5 bg-stone-500"
                      : "w-1.5 h-1.5 bg-stone-700"
                }`}
                aria-label={`Go to step ${i + 1}`}
              />
            ))}
            <span className="ml-2 text-xs text-stone-600 tabular-nums select-none">
              {step + 1} / {STEPS.length}
            </span>
          </div>
          <button
            onClick={dismiss}
            className="text-stone-600 hover:text-stone-400 transition-colors"
            aria-label="Close guide"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Animated step body */}
        <div className="px-6 pt-8 pb-6 overflow-hidden" style={{ minHeight: 228 }}>
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="flex flex-col items-center text-center gap-4"
            >
              {/* Icon badge */}
              <div
                className={`w-14 h-14 rounded-2xl border flex items-center justify-center ${current.iconBgClass}`}
              >
                <current.Icon className={`w-7 h-7 ${current.accentClass}`} />
              </div>

              {/* Text */}
              <div className="space-y-2">
                <h2 className="text-base font-semibold text-stone-100">
                  {current.title}
                </h2>
                <p className="text-sm text-stone-400 leading-relaxed max-w-xs mx-auto">
                  {current.body}
                </p>
              </div>

              {/* Optional action — opens route without closing guide */}
              {current.actionLabel && current.actionHref && (
                <Button
                  size="sm"
                  variant="outline"
                  className="border-stone-600 text-stone-300 hover:text-white hover:border-stone-400 mt-1"
                  onClick={() => navigate(current.actionHref!)}
                >
                  {current.actionLabel}
                </Button>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer navigation */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-stone-800/60">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => goTo(step - 1)}
            disabled={step === 0}
            className="text-stone-500 hover:text-stone-300 disabled:opacity-30 gap-1"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            Back
          </Button>

          <div className="flex items-center gap-2">
            {!isLast && (
              <Button
                size="sm"
                variant="ghost"
                onClick={dismiss}
                className="text-stone-600 hover:text-stone-400"
              >
                Skip
              </Button>
            )}
            <Button
              size="sm"
              onClick={handleNext}
              className={
                isLast
                  ? "bg-stone-100 text-stone-900 hover:bg-white gap-1"
                  : "bg-stone-800 hover:bg-stone-700 text-stone-200 gap-1"
              }
            >
              {isLast ? "Done" : "Next"}
              {!isLast && <ChevronRight className="w-3.5 h-3.5" />}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
