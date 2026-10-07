// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CaretDown,
  CaretUp,
  Eye,
  EyeSlash,
  Lock,
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
} from "@/src/api/settingsApi";
import { cn } from "@/src/lib/utils";

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

  const saveApiKey = useMutation({
    mutationFn: (ctx: {
      name: "hf_token" | "tavily_api_key";
      value: string;
    }) => {
      // Only send fields the user actually changed; an untouched pre-filled
      // value is not an update (re-sending the HF token would spuriously
      // flag a redeploy). Blank still means "keep the existing value".
      const val = ctx.value.trim();
      if (val !== "" && val !== (settings.data?.[ctx.name].value ?? "")) {
        return updateSettings({ hf_token: val });
      }

      return Promise.resolve({
        ok: true,
        requires_redeploy: false,
        updated: [],
      });
    },
    onSuccess: () => {
      addToast({
        variant: "success",
        content: "Settings saved",
        timeout: 5000,
      });
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (err: any) => {
      const message =
        err?.response?.data?.error ||
        err?.message ||
        "Failed to save settings.";
      addToast({ variant: "danger", content: message });
    },
  });

  // debounce `saveApiKey.mutate` so we don't ping the api on every keystroke
  const updateSecret = useDebouncedCallback<typeof saveApiKey.mutate>(
    saveApiKey.mutate,
    300
  );

  return (
    <div className="flex flex-col text-left pt-vesper-8">
      <div className="flex flex-col gap-vesper-8">
        <HFToken
          loading={settings.isPending}
          value={hfToken}
          onChange={(value) => {
            setHfToken(value);
            updateSecret({ name: "hf_token", value });
          }}
        />
        <Divider />
        <TTSApiKey loading={settings.isPending} />
        <Divider />
        <TavilyApiKey
          loading={settings.isPending}
          value={tavilyApiKey}
          onChange={(value) => {
            setTavilyApiKey(value);
            updateSecret({ name: "tavily_api_key", value });
          }}
        />
      </div>
    </div>
  );
}

function Divider() {
  return <div className="w-full border-t border-vesper-border-tertiary" />;
}

function HFToken({
  loading,
  value,
  onChange,
}: {
  loading: boolean;
  value: string;
  onChange(value: string): void;
}) {
  const [showText, setShowText] = useState(false);
  const [showHfAccess, setShowHfAccess] = useState(false);
  const hfAccessCheck = useHFAccessCheck(value);

  useEffect(() => {
    if (!loading && !hfAccessCheck.hasChecked) hfAccessCheck.runCheck();
  }, [loading, hfAccessCheck]);

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
        disabled={loading}
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
  value,
  onChange,
}: {
  loading: boolean;
  value: string;
  onChange(value: string): void;
}) {
  const [showText, setShowText] = useState(false);

  let placeholder = "tvly-...";
  if (loading) placeholder = "Loading...";

  const timeout = useRef(-1);
  useEffect(() => () => clearTimeout(timeout.current), []);

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
        disabled={loading}
      />
    </div>
  );
}

function useDebouncedCallback<F extends (...args: any[]) => any>(
  fn: F,
  ms: number
) {
  const timeout = useRef<number>(undefined);

  return useCallback(
    (...args: Parameters<F>) => {
      clearTimeout(timeout.current);
      timeout.current = setTimeout(() => fn(...args), ms);
    },
    [fn, ms]
  );
}
