// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { AlertCircle, ExternalLink } from "lucide-react";

import { Button } from "./ui/button";
import SettingsDialog from "./SettingsDialog";
import { statusLabel } from "../lib/hfStatus";
import type { HfCheckResult } from "../api/settingsApi";

/** Shown in place of a deploy action when the model's repo is behind a Hugging Face
 *  gate the saved token can't pass. The backend refuses that deploy outright, so
 *  this states the reason and the steps that clear it. */
export function HfGatePanel({ gate, heading, onRecheck }: {
  gate: HfCheckResult;
  heading: string;
  onRecheck: () => void;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);

  // A token alone doesn't clear a gate: the account holding it must also have
  // accepted the model's licence, so the token path asks for both. "denied" means
  // the token already works and only the licence is outstanding.
  const steps: { text: string; action: ReactNode }[] =
    gate.status === "denied"
      ? [
        { text: "Accept the model's licence to be granted access", action: <ExternalAction href={gate.url} label="Request access" /> },
        { text: "Approval is usually immediate", action: <Button size="sm" variant="outline" onClick={onRecheck}>Re-check</Button> },
      ]
      : [
        { text: "Create a read token on Hugging Face", action: <ExternalAction href="https://huggingface.co/settings/tokens" label="Get a token" /> },
        { text: "Accept this model's licence with that same account", action: <ExternalAction href={gate.url} label="Request access" /> },
        { text: "Save the token in Settings — this re-checks on close", action: <Button size="sm" variant="outline" onClick={() => setSettingsOpen(true)}>Open Settings</Button> },
      ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="w-full rounded-xl border border-stone-200 dark:border-stone-800 bg-white/60 dark:bg-stone-900/60 backdrop-blur-sm p-5 flex flex-col gap-4"
    >
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-red-500/15 p-1.5 shrink-0">
          <AlertCircle className="w-4 h-4 text-red-500" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-[0.14em] font-semibold text-red-500/80">
            Hugging Face access required
          </div>
          <h3 className="mt-1 text-sm font-medium">{heading}</h3>
          <p className="mt-0.5 text-xs text-stone-500 break-all">
            {statusLabel(gate)} ·{" "}
            <a
              href={gate.url}
              target="_blank"
              rel="noreferrer"
              className="font-mono hover:text-TT-purple hover:underline"
            >
              {gate.repo}
              <ExternalLink className="inline w-2.5 h-2.5 ml-1 align-baseline" />
            </a>
          </p>
        </div>
      </div>

      <ol className="flex flex-col gap-2">
        {steps.map((step, i) => (
          <FixStep key={step.text} n={i + 1} text={step.text}>
            {step.action}
          </FixStep>
        ))}
      </ol>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={(open) => {
          setSettingsOpen(open);
          if (!open) onRecheck();
        }}
      />
    </motion.div>
  );
}

function FixStep({ n, text, children }: { n: number; text: string; children: ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-md border border-stone-200 dark:border-stone-800 px-3 py-2">
      <div className="flex items-center gap-3 min-w-0">
        <span className="flex items-center justify-center w-5 h-5 shrink-0 rounded-full bg-stone-500/15 text-[11px] font-semibold text-stone-500">
          {n}
        </span>
        <span className="text-sm min-w-0">{text}</span>
      </div>
      <div className="shrink-0">{children}</div>
    </li>
  );
}

function ExternalAction({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-xs font-medium text-TT-purple hover:underline whitespace-nowrap"
    >
      {label} <ExternalLink className="w-3 h-3" />
    </a>
  );
}
