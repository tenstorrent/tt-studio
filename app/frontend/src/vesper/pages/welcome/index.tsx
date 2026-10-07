// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSettings, SettingsResponse } from "@/src/api/settingsApi";
import { OnboardingContext } from "./context";
import { Step1, Step2, Step3, Step4 } from "./components";

const steps = [Step1, Step2, Step3, Step4];

export default function WelcomePage() {
  const numSteps = steps.length;
  const [step, setStep] = useState(0);
  const [hfToken, setHfToken] = useState("");

  const { data: settings } = useQuery<SettingsResponse>({
    queryKey: ["settings"],
    queryFn: getSettings,
  });

  // Pre-fill the secrets form once with the values already stored on the
  // server (user_config.env or the .env fallback) so they are visible and
  // editable in place rather than hidden behind a masked placeholder.
  const prefilled = useRef(false);
  useEffect(() => {
    if (!settings || prefilled.current) return;
    prefilled.current = true;
    setHfToken(settings.hf_token.value ?? "");
  }, [settings]);

  const nextStep = useCallback(
    () => setStep((curr) => Math.min(curr + 1, numSteps - 1)),
    [numSteps]
  );

  const prevStep = useCallback(
    () => setStep((curr) => Math.max(curr - 1, 0)),
    []
  );

  const Component = steps[step];

  return (
    <OnboardingContext.Provider
      value={{
        hfToken,
        setHfToken,
        numSteps,
        nextStep,
        prevStep,
        step,
        settings,
      }}
    >
      <div className="w-full min-h-full flex items-center justify-center p-vesper-6">
        <div className="w-full max-w-md rounded-vesper-3 bg-vesper-background-primary border border-vesper-border-secondary">
          <Component />
        </div>
      </div>
    </OnboardingContext.Provider>
  );
}
