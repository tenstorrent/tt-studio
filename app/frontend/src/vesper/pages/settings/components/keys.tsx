// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@tenstorrent/vesper/button";
import {
  CaretDown,
  CaretUp,
  Eye,
  EyeSlash,
  Lock,
  Spinner,
} from "@tenstorrent/vesper/icons";
import { TextInput } from "@tenstorrent/vesper/text-input";
import { Typography } from "@tenstorrent/vesper/typography";
import { addToast } from "@tenstorrent/vesper/toast";
import { HFAccessCheckResults } from "@/src/vesper/components/hf-access-check-results";
import { useHFAccessCheck } from "@/src/vesper/hooks/use-hf-access-check";
import {
  getSettings,
  SettingsResponse,
  updateSettings,
  type UpdateSettingsPayload,
} from "@/src/api/settingsApi";
import { cn } from "@/src/lib/utils";
import { getErrorMessage } from "@/src/utils/errors";

export function Keys() {
  const [hfToken, setHfToken] = useState("");
  const [tavilyApiKey, setTavilyApiKey] = useState("");

  const queryClient = useQueryClient();

  const settings = useQuery<SettingsResponse>({
    queryKey: ["settings"],
    queryFn: getSettings,
  });

  // Pre-fill the secrets form once with the values already stored on the
  // server (user_config.env or the .env fallback) so they are visible and
  // editable in place rather than hidden behind a masked placeholder.
  const prefilled = useRef(false);
  useEffect(() => {
    if (!settings.data || prefilled.current) return;
    prefilled.current = true;
    setHfToken(settings.data.hf_token.value ?? "");
    setTavilyApiKey(settings.data.tavily_api_key.value ?? "");
  }, [settings]);

  // Only send fields the user actually changed; an untouched pre-filled
  // value is not an update (re-sending the HF token would spuriously flag a
  // redeploy). Blank still means "keep the existing value".
  const changes = useMemo(() => {
    const body: UpdateSettingsPayload = {};
    const hf = hfToken.trim();
    if (hf !== "" && hf !== (settings.data?.hf_token.value ?? "")) {
      body.hf_token = hf;
    }
    const tavily = tavilyApiKey.trim();
    if (
      tavily !== "" &&
      tavily !== (settings.data?.tavily_api_key.value ?? "")
    ) {
      body.tavily_api_key = tavily;
    }
    return body;
  }, [hfToken, tavilyApiKey, settings.data]);
  const hasChanges = Object.keys(changes).length > 0;

  const save = useMutation({
    mutationFn: (payload: UpdateSettingsPayload) => updateSettings(payload),
    onSuccess: async (resp) => {
      // stay pending until the saved values are back, so the form doesn't
      // briefly read as having unsaved changes
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      if (resp.updated.length === 0) {
        addToast({ content: "No changes to save", timeout: 4000 });
      } else if (resp.requires_redeploy) {
        addToast({
          variant: "success",
          content:
            "Settings saved. Redeploy any running model to pick up the new Hugging Face token.",
          timeout: 8000,
        });
      } else {
        addToast({
          variant: "success",
          content: "Settings saved",
          timeout: 5000,
        });
      }
    },
    onError: (err) => {
      const message =
        axios.isAxiosError(err) && typeof err.response?.data?.error === "string"
          ? err.response.data.error
          : getErrorMessage(err);
      addToast({
        variant: "danger",
        content: `Couldn't save settings: ${message}`,
      });
    },
  });

  const disabled = settings.isPending || save.isPending;

  return (
    <form
      className="flex flex-col gap-vesper-8 text-left pt-vesper-8"
      autoComplete="off"
      onSubmit={(e) => {
        e.preventDefault();
        if (hasChanges && !save.isPending) save.mutate(changes);
      }}
    >
      <div className="flex flex-col gap-vesper-8">
        <HFToken
          loading={settings.isPending}
          disabled={disabled}
          value={hfToken}
          onChange={setHfToken}
        />
        <Divider />
        <TTSApiKey loading={settings.isPending} />
        <Divider />
        <TavilyApiKey
          loading={settings.isPending}
          disabled={disabled}
          value={tavilyApiKey}
          onChange={setTavilyApiKey}
        />
      </div>
      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={!hasChanges || disabled}
          iconLeft={save.isPending && <Spinner className="animate-spin" />}
        >
          {save.isPending ? "Saving" : "Save"}
        </Button>
      </div>
    </form>
  );
}

function Divider() {
  return <div className="w-full border-t border-vesper-border-tertiary" />;
}

function HFToken({
  loading,
  disabled,
  value,
  onChange,
}: {
  loading: boolean;
  disabled: boolean;
  value: string;
  onChange(value: string): void;
}) {
  const [showText, setShowText] = useState(false);
  const [showHfAccess, setShowHfAccess] = useState(false);
  const hfAccessCheck = useHFAccessCheck(value);

  // check access once the saved settings are in. The hook returns a new object
  // every render, so keying the effect on it re-ran the check while the first
  // was still in flight; a ref keeps it to a single run.
  const checkStarted = useRef(false);
  useEffect(() => {
    if (loading || checkStarted.current) return;
    checkStarted.current = true;
    void hfAccessCheck.runCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  let placeholder = "hf_...";
  if (loading) placeholder = "Loading...";

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-vesper-1">
        <Typography variant="copy-sm-bold" className="text-vesper-text-primary">
          Hugging Face token
        </Typography>
        <Typography variant="copy-xs" className="text-vesper-text-tertiary">
          If you update your token, redeploy all running models to see changes.{" "}
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
      <TextInput
        className="mt-vesper-4 mb-vesper-6"
        placeholder={placeholder}
        iconRight={showText ? <EyeSlash /> : <Eye />}
        iconRightAction={{
          handler: () => setShowText(!showText),
          ariaLabel: showText ? "Hide token" : "Show token",
        }}
        type={showText ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
      <Typography
        variant="copy-sm"
        as="button"
        type="button"
        onClick={() => setShowHfAccess(!showHfAccess)}
        className={cn(
          "flex justify-between items-center h-10 px-vesper-3 gap-vesper-2 w-full",
          "rounded-t-vesper-2 border border-vesper-border-primary bg-vesper-tint-neutral-100 text-vesper-text-primary cursor-pointer",
          !showHfAccess && "rounded-b-vesper-2"
        )}
      >
        <span>Check Hugging Face access</span>
        {showHfAccess ? <CaretUp width={20} /> : <CaretDown width={20} />}
      </Typography>
      {showHfAccess && (
        <div className="rounded-b-vesper-2 border border-t-0 border-vesper-border-primary bg-vesper-tint-neutral-100 p-vesper-6">
          <HFAccessCheckResults
            error={hfAccessCheck.error}
            results={hfAccessCheck.results}
            isChecking={hfAccessCheck.isChecking || loading}
            runCheck={hfAccessCheck.runCheck}
          />
        </div>
      )}
    </div>
  );
}

function TTSApiKey({ loading }: { loading: boolean }) {
  let placeholder = "your****-key";
  if (loading) placeholder = "Loading...";

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-vesper-1">
        <Typography variant="copy-sm-bold" className="text-vesper-text-primary">
          TTS API Key
        </Typography>
        <Typography variant="copy-xs" className="text-vesper-text-tertiary">
          Auto-managed for media / voice (TTS &amp; STT) model auth. To use a
          custom key, set TTS_API_KEY in the root.env and redeploy
        </Typography>
      </div>
      <TextInput
        className="mt-vesper-4"
        placeholder={placeholder}
        iconLeft={<Lock />}
        readOnly
        inert
      />
    </div>
  );
}

function TavilyApiKey({
  loading,
  disabled,
  value,
  onChange,
}: {
  loading: boolean;
  disabled: boolean;
  value: string;
  onChange(value: string): void;
}) {
  const [showText, setShowText] = useState(false);

  let placeholder = "tvly-...";
  if (loading) placeholder = "Loading...";

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-vesper-1">
        <Typography variant="copy-sm-bold" className="text-vesper-text-primary">
          Tavily API Key
        </Typography>
        <Typography variant="copy-xs" className="text-vesper-text-tertiary">
          Powers the web-search agent. Picked up by running agents on their next
          search.
        </Typography>
      </div>
      <TextInput
        className="mt-vesper-4"
        placeholder={placeholder}
        iconRight={showText ? <EyeSlash /> : <Eye />}
        iconRightAction={{
          handler: () => setShowText(!showText),
          ariaLabel: showText ? "Hide key" : "Show key",
        }}
        type={showText ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    </div>
  );
}
