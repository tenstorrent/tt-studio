// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeSlash, Spinner } from "@tenstorrent/vesper/icons";
import { TextInput } from "@tenstorrent/vesper/text-input";
import { Typography } from "@tenstorrent/vesper/typography";
import { updateSettings } from "@/src/api/settingsApi";
import { useHfToken, useNextStep, usePrevStep, useSettings } from "../utils";
import { StepLayout } from "./step-layout";

export function AddHFToken() {
  const [hfToken, setHfToken] = useHfToken();
  const nextStep = useNextStep();
  const prevStep = usePrevStep();
  const settings = useSettings();

  const loading = !settings;

  const [showText, setShowText] = useState(false);

  const queryClient = useQueryClient();
  const saveHfToken = useMutation({
    mutationFn: () => {
      // Only send fields the user actually changed; an untouched pre-filled
      // value is not an update (re-sending the HF token would spuriously
      // flag a redeploy). Blank still means "keep the existing value".
      const val = hfToken.trim();
      if (val !== "" && val !== (settings?.hf_token.value ?? "")) {
        return updateSettings({ hf_token: val });
      }

      return Promise.resolve({
        ok: true,
        requires_redeploy: false,
        updated: [],
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      nextStep();
    },
    onError: (err: any) => {
      // customToast.error(
      //   err?.response?.data?.error || err?.message || "Failed to save settings."
      // );
    },
  });

  let placeholder = "hf_...";
  if (loading) placeholder = "Loading...";
  if (settings?.hf_token.set && settings.hf_token.masked) {
    placeholder = `Set (${settings.hf_token.masked}) – leave blank to keep`;
  }

  return (
    <StepLayout
      title="Set your Hugging Face token"
      subtitle="All values persist on the server. Leave a field blank to skip it for now or keep the existing value."
      buttons={[
        {
          children: "Back",
          onClick: prevStep,
          disabled: saveHfToken.isPending,
        },
        {
          children: saveHfToken.isPending
            ? "Saving token..."
            : "Save and Continue",
          iconRight: saveHfToken.isPending && <Spinner />,
          onClick: () => saveHfToken.mutate(),
          disabled: saveHfToken.isPending,
        },
      ]}
    >
      <div className="flex flex-col gap-10 w-full">
        <div className="flex flex-col gap-vesper-2">
          <TextInput
            placeholder={placeholder}
            iconRight={showText ? <EyeSlash /> : <Eye />}
            iconRightAction={{
              handler: () => setShowText(!showText),
              ariaLabel: showText ? "Hide token" : "Show token",
            }}
            type={showText ? "text" : "password"}
            value={hfToken}
            onChange={(e) => setHfToken(e.target.value)}
            disabled={saveHfToken.isPending}
          />
          <Typography
            variant="label-xs"
            className="text-vesper-text-primary mr-auto"
          >
            Required to download gated models.{" "}
            <a
              className="text-vesper-text-accent underline"
              href="https://huggingface.co/settings/tokens"
              target="_blank"
              rel="noreferrer"
            >
              Generate a token
            </a>
          </Typography>
        </div>
      </div>
    </StepLayout>
  );
}
