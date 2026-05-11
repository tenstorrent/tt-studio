// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import WelcomeIntroStep from "../components/welcome/WelcomeIntroStep";
import WelcomeSecretsStep, {
  type WelcomeSecrets,
} from "../components/welcome/WelcomeSecretsStep";
import WelcomeHfCheckStep from "../components/welcome/WelcomeHfCheckStep";
import WelcomeDoneStep from "../components/welcome/WelcomeDoneStep";
import { customToast } from "../components/CustomToaster";
import {
  getSettings,
  updateSettings,
  type SettingsResponse,
} from "../api/settingsApi";

const STEPS = ["Welcome", "Secrets", "Access check", "Done"] as const;

export default function WelcomePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [stepIndex, setStepIndex] = useState(0);
  const [secrets, setSecrets] = useState<WelcomeSecrets>({
    hf_token: "",
    tts_api_key: "",
    tavily_api_key: "",
  });

  const { data: current } = useQuery<SettingsResponse>({
    queryKey: ["settings"],
    queryFn: getSettings,
  });

  const saveSecrets = useMutation({
    mutationFn: () => {
      const body: Record<string, string> = {};
      if (secrets.hf_token.trim()) body.hf_token = secrets.hf_token.trim();
      if (secrets.tts_api_key.trim())
        body.tts_api_key = secrets.tts_api_key.trim();
      if (secrets.tavily_api_key.trim())
        body.tavily_api_key = secrets.tavily_api_key.trim();
      if (Object.keys(body).length === 0) {
        return Promise.resolve({ ok: true, requires_redeploy: false, updated: [] });
      }
      return updateSettings(body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      setStepIndex(2);
    },
    onError: (err: any) => {
      customToast.error(
        err?.response?.data?.error || err?.message || "Failed to save settings."
      );
    },
  });

  const finishSetup = useMutation({
    mutationFn: () => updateSettings({ setup_complete: true }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      navigate("/", { replace: true });
    },
    onError: (err: any) => {
      customToast.error(
        err?.response?.data?.error || err?.message || "Failed to finish setup."
      );
    },
  });

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 bg-white dark:bg-black bg-grid-black/[0.06] dark:bg-grid-white/[0.08]">
      <Card className="w-full max-w-2xl shadow-xl border-stone-200 dark:border-stone-800">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>TT Studio setup</span>
            <span className="text-xs font-normal text-stone-500">
              Step {stepIndex + 1} of {STEPS.length}
            </span>
          </CardTitle>
          <div className="mt-3 flex gap-1">
            {STEPS.map((label, i) => (
              <div
                key={label}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  i <= stepIndex
                    ? "bg-TT-purple"
                    : "bg-stone-200 dark:bg-stone-800"
                }`}
                aria-label={label}
              />
            ))}
          </div>
        </CardHeader>

        <CardContent>
          {stepIndex === 0 && (
            <WelcomeIntroStep onNext={() => setStepIndex(1)} />
          )}
          {stepIndex === 1 && (
            <WelcomeSecretsStep
              current={current}
              values={secrets}
              onChange={setSecrets}
              onBack={() => setStepIndex(0)}
              onNext={() => saveSecrets.mutate()}
              isSaving={saveSecrets.isPending}
            />
          )}
          {stepIndex === 2 && (
            <WelcomeHfCheckStep
              onBack={() => setStepIndex(1)}
              onNext={() => setStepIndex(3)}
            />
          )}
          {stepIndex === 3 && (
            <WelcomeDoneStep
              onFinish={() => finishSetup.mutate()}
              isFinishing={finishSetup.isPending}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
