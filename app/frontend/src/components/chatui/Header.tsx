// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import React from "react";
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../ui/breadcrumb";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

interface HeaderProps {
  modelName: string | null;
  modelsDeployed: { id: string; name: string }[];
  setModelID: (id: string) => void;
  setModelName: (name: string) => void;
  ragDataSources: RagDataSource[];
  ragDatasource: RagDataSource | undefined;
  setRagDatasource: (datasource: RagDataSource) => void;
}

interface RagDataSource {
  id: string;
  name: string;
  metadata: Record<string, string>;
}

const ModelSelector = React.forwardRef<
  HTMLButtonElement,
  {
    modelsDeployed: HeaderProps["modelsDeployed"];
    setModelID: HeaderProps["setModelID"];
    setModelName: HeaderProps["setModelName"];
  }
>(({ modelsDeployed, setModelID, setModelName }, ref) => (
  <DropdownMenu>
    <DropdownMenuTrigger
      ref={ref}
      className="flex items-center gap-1 focus:outline-none"
    >
      <BreadcrumbEllipsis className="h-4 w-4 text-gray-600" />
      <span className="sr-only">Toggle menu</span>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start">
      {modelsDeployed.map((model) => (
        <DropdownMenuItem
          key={model.id}
          onClick={() => {
            setModelID(model.id);
            setModelName(model.name);
          }}
        >
          {model.name}
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
));

ModelSelector.displayName = "ModelSelector";

export default function Header({
  modelName,
  modelsDeployed,
  setModelID,
  setModelName,
  ragDataSources,
  ragDatasource,
  setRagDatasource,
}: HeaderProps) {
  return (
    <div className="bg-gray-200 dark:bg-gray-800 rounded-lg p-4 shadow-lg dark:shadow-2xl sticky top-2 z-10 flex justify-between items-center">
      <Breadcrumb className="flex items-center">
        <BreadcrumbList className="flex gap-2 text-sm">
          <BreadcrumbItem>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <BreadcrumbLink
                    href="/models-deployed"
                    className="text-gray-600 dark:text-gray-200 hover:text-gray-800 dark:hover:text-white transition-colors duration-300 flex items-center"
                  >
                    Models Deployed
                  </BreadcrumbLink>
                </TooltipTrigger>
                <TooltipContent>
                  <p>View all deployed models</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </BreadcrumbItem>
          <BreadcrumbSeparator className="mx-2 text-gray-400">
            /
          </BreadcrumbSeparator>
          <BreadcrumbItem>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <ModelSelector
                    modelsDeployed={modelsDeployed}
                    setModelID={setModelID}
                    setModelName={setModelName}
                  />
                </TooltipTrigger>
                <TooltipContent>
                  <p>Select a different model</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </BreadcrumbItem>
          <BreadcrumbSeparator className="mx-2 text-gray-400">
            /
          </BreadcrumbSeparator>
          <BreadcrumbItem>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <BreadcrumbPage className="text-gray-800 dark:text-blue-400 font-bold hover:text-gray-900 dark:hover:text-white transition-colors duration-300">
                    {modelName}
                  </BreadcrumbPage>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Current selected model</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="flex items-center">
        <Select
          onValueChange={(v) => {
            const dataSource = ragDataSources.find((rds) => rds.name === v);
            if (dataSource) {
              setRagDatasource(dataSource);
            }
          }}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue
              placeholder={ragDatasource?.name ?? "Select RAG Datasource"}
            />
          </SelectTrigger>
          <SelectContent>
            {ragDataSources.map((c) => (
              <SelectItem key={c.id} value={c.name}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
