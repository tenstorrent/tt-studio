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
import { Button } from "../ui/button";
import { Menu } from "lucide-react";

interface HeaderProps {
  modelName: string | null;
  modelsDeployed: { id: string; name: string }[];
  setModelID: (id: string) => void;
  setModelName: (name: string) => void;
  ragDataSources: RagDataSource[];
  ragDatasource: RagDataSource | undefined;
  setRagDatasource: (datasource: RagDataSource) => void;
  isHistoryPanelOpen: boolean;
  setIsHistoryPanelOpen: (isOpen: boolean) => void;
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
  isHistoryPanelOpen,
  setIsHistoryPanelOpen,
}: HeaderProps) {
  return (
    <div className="bg-white dark:bg-[#2A2A2A] rounded-lg p-4 shadow-lg dark:shadow-2xl sticky top-2 z-10 flex justify-between items-center border border-gray-200 dark:border-[#7C68FA]/20">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setIsHistoryPanelOpen(!isHistoryPanelOpen)}
        className="mr-2"
      >
        <Menu className="h-4 w-4" />
      </Button>
      <Breadcrumb className="flex items-center">
        <BreadcrumbList className="flex gap-2 text-sm">
          <BreadcrumbItem>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <BreadcrumbLink
                    href="/models-deployed"
                    className="text-gray-600 dark:text-white/70 hover:text-gray-800 dark:hover:text-white transition-colors duration-300 flex items-center"
                  >
                    Models Deployed
                  </BreadcrumbLink>
                </TooltipTrigger>
                <TooltipContent className="bg-white dark:bg-[#2A2A2A] border-gray-200 dark:border-[#7C68FA]/20 text-gray-800 dark:text-white">
                  <p>View all deployed models</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </BreadcrumbItem>
          <BreadcrumbSeparator className="mx-2 text-white/40 dark:text-white/40">
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
                <TooltipContent className="bg-white dark:bg-[#2A2A2A] border-gray-200 dark:border-[#7C68FA]/20 text-gray-800 dark:text-white">
                  <p>Select a different model</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </BreadcrumbItem>
          <BreadcrumbSeparator className="mx-2 text-white/40 dark:text-white/40">
            /
          </BreadcrumbSeparator>
          <BreadcrumbItem>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <BreadcrumbPage className="text-[#7C68FA] dark:text-[#7C68FA] font-bold hover:text-[#7C68FA]/80 dark:hover:text-[#7C68FA]/80 transition-colors duration-300">
                    {modelName}
                  </BreadcrumbPage>
                </TooltipTrigger>
                <TooltipContent className="bg-white dark:bg-[#2A2A2A] border-gray-200 dark:border-[#7C68FA]/20 text-gray-800 dark:text-white">
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
          <SelectTrigger className="w-[180px] bg-white dark:bg-[#2A2A2A] border-gray-200 dark:border-[#7C68FA]/20 text-gray-800 dark:text-white">
            <SelectValue
              placeholder={ragDatasource?.name ?? "Select RAG Datasource"}
            />
          </SelectTrigger>
          <SelectContent className="bg-white dark:bg-[#2A2A2A] border-gray-200 dark:border-[#7C68FA]/20">
            {ragDataSources.map((c) => (
              <SelectItem
                key={c.id}
                value={c.name}
                className="text-gray-800 dark:text-white hover:bg-gray-100 dark:hover:bg-[#7C68FA]/20"
              >
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
