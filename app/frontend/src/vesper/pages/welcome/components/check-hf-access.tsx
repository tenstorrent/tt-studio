// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect } from "react";
import { useHFAccessCheck } from "@/src/vesper/hooks/use-hf-access-check";
import { HFAccessCheckResults } from "@/src/vesper/components/hf-access-check-results";
import { useHfToken, useNextStep, usePrevStep } from "../utils";
import { StepLayout } from "./step-layout";

export function CheckHFAccess() {
  const nextStep = useNextStep();
  const prevStep = usePrevStep();

  const [token] = useHfToken();

  const { allGranted, error, hasChecked, isChecking, results, runCheck } =
    useHFAccessCheck(token);

  useEffect(() => {
    runCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <StepLayout
      title="Verify Hugging Face access"
      subtitle="Confirm your Hugging Face token can reach the gated models TT-Studio uses out of the box."
      buttons={[
        { children: "Back", onClick: prevStep },
        {
          children: hasChecked && !allGranted ? "Skip for now" : "Continue",
          onClick: nextStep,
          disabled: !hasChecked,
        },
      ]}
    >
      <HFAccessCheckResults
        error={error}
        results={results}
        isChecking={isChecking}
        runCheck={runCheck}
      />
    </StepLayout>
  );
}
