// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import bash from "@shikijs/langs/bash";
import javascript from "@shikijs/langs/javascript";
import python from "@shikijs/langs/python";
import typescript from "@shikijs/langs/typescript";
import { Admonition } from "@tenstorrent/vesper/admonition";
import { Badge, type BadgeVariant } from "@tenstorrent/vesper/badge";
import { CodeBlock, type CodeBlockProps } from "@tenstorrent/vesper/code-block";
import { Select } from "@tenstorrent/vesper/select";
import { Skeleton } from "@tenstorrent/vesper/skeleton";
import { StatusIndicator } from "@tenstorrent/vesper/status-indicator";
import { Tabs } from "@tenstorrent/vesper/tabs";
import { Typography } from "@tenstorrent/vesper/typography";
import type { APIInfo } from "@/src/components/ModelAPIInfo/useModelAPIInfo";
import { DEPLOYMENTS_PATH } from "@/src/routes/route-config";
import { BackButton } from "@/src/vesper/components/back-button";
import { CopyField } from "@/src/vesper/components/copy-field";
import { ModelLogo } from "@/src/vesper/components/model-logo";
import { useModelHealth } from "@/src/vesper/hooks/use-model-health";
import {
  getCodeExamples,
  getEndpointRows,
  type EndpointRow,
  type ExampleLanguage,
} from "./utils";

type Lang = CodeBlockProps["lang"];
// the app's hoisted shiki grammars are structurally what vesper expects
const GRAMMARS: Record<ExampleLanguage, Lang> = {
  bash: bash as unknown as Lang,
  python: python as unknown as Lang,
  typescript: typescript as unknown as Lang,
  javascript: javascript as unknown as Lang,
};

const METHOD_VARIANT: Record<string, BadgeVariant> = {
  POST: "info",
  GET: "success",
  Bearer: "purple",
  ID: "contrast",
};

async function fetchApiInfo(): Promise<Record<string, APIInfo>> {
  const response = await fetch("/models-api/api-info/");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function getHfModelId(api: APIInfo) {
  return (
    api.hf_model_id ||
    api.deploy_info?.model_impl?.hf_model_id ||
    api.deploy_info?.model_impl?.hf_model_repo ||
    api.deploy_info?.model_impl?.model_name ||
    ""
  );
}

function EndpointsTab({ rows }: { rows: EndpointRow[] }) {
  return (
    <ul className="flex flex-col gap-vesper-4 pt-vesper-6">
      {rows.map((row) => (
        <li
          key={row.label}
          className="flex flex-col gap-vesper-3 p-vesper-4 rounded-vesper-2 border border-vesper-border-secondary bg-vesper-background-primary"
        >
          <div className="flex items-center gap-vesper-3">
            <Typography
              as="h3"
              variant="label-md-bold"
              className="text-vesper-text-primary"
            >
              {row.label}
            </Typography>
            <Badge
              size="sm"
              variant={METHOD_VARIANT[row.method] ?? "contrast"}
              subtle
            >
              {row.method}
            </Badge>
          </div>
          <CopyField label={row.label} value={row.value} />
          <Typography variant="copy-xs" className="text-vesper-text-tertiary">
            {row.description}
          </Typography>
        </li>
      ))}
    </ul>
  );
}

function ExamplesTab({
  examples,
}: {
  examples: ReturnType<typeof getCodeExamples>;
}) {
  const [name, setName] = useState(examples[0]?.name ?? "");
  const example = examples.find((e) => e.name === name) ?? examples[0];
  if (!example) return null;
  return (
    <div className="flex flex-col gap-vesper-4 pt-vesper-6">
      {examples.length > 1 && (
        <Select
          className="w-64"
          aria-label="Example"
          options={examples.map((e) => e.name)}
          value={example.name}
          onValueChange={(value) => value && setName(value)}
        />
      )}
      <CodeBlock key={example.name} lang={GRAMMARS[example.language]}>
        {example.code}
      </CodeBlock>
    </div>
  );
}

export default function ApiPage() {
  const navigate = useNavigate();
  const { modelId: encodedModelId } = useParams<{ modelId: string }>();
  const modelId = encodedModelId ? decodeURIComponent(encodedModelId) : "";
  const [tab, setTab] = useState("endpoints");

  const apiInfo = useQuery({
    queryKey: ["api-info"],
    queryFn: fetchApiInfo,
    refetchOnWindowFocus: false,
  });
  const api = apiInfo.data?.[modelId];
  const health = useModelHealth(modelId ? [modelId] : [])[modelId];
  const hfModelId = api ? getHfModelId(api) : "";

  const rows = useMemo(
    () => (api ? getEndpointRows(api, hfModelId) : []),
    [api, hfModelId]
  );
  const examples = useMemo(
    () => (api ? getCodeExamples(api, modelId, hfModelId) : []),
    [api, modelId, hfModelId]
  );

  const goBack = () =>
    navigate(`${DEPLOYMENTS_PATH}?deployment=${encodeURIComponent(modelId)}`);

  return (
    <div className="min-h-full flex flex-col p-vesper-4 text-left">
      <BackButton onClick={goBack} className="self-start" />
      <div className="w-full max-w-3xl mx-auto flex flex-col gap-vesper-6 px-vesper-6 py-vesper-10">
        {apiInfo.isPending ? (
          <div className="flex flex-col gap-vesper-4">
            <Skeleton height={32} width={280} />
            <Skeleton height={240} />
          </div>
        ) : !api ? (
          <Admonition variant="danger">
            {apiInfo.isError
              ? "Couldn't load API information. Check that the backend is running."
              : "There's no API information for this deployment. It may have been stopped."}
          </Admonition>
        ) : (
          <>
            <div className="flex flex-col gap-vesper-3">
              <div className="flex items-center gap-vesper-3">
                <ModelLogo
                  hfModelId={hfModelId}
                  modelName={api.model_name}
                  className="w-7 h-7"
                />
                <Typography
                  as="h2"
                  variant="heading-md"
                  className="text-vesper-text-primary break-all"
                >
                  {api.model_name}
                </Typography>
              </div>
              {health?.status === "healthy" ? (
                <StatusIndicator state="ready" label="Ready for API requests" />
              ) : (
                <StatusIndicator
                  state="progress"
                  label="Not ready yet"
                  animated
                />
              )}
            </div>
            <Tabs
              value={tab}
              onValueChange={setTab}
              items={[
                {
                  value: "endpoints",
                  label: "Endpoints",
                  content: <EndpointsTab rows={rows} />,
                },
                {
                  value: "examples",
                  label: "Examples",
                  content: <ExamplesTab examples={examples} />,
                },
              ]}
            />
          </>
        )}
      </div>
    </div>
  );
}
