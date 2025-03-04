// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
import React from "react";
import { useState } from "react";
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
import { PanelRight, X } from "lucide-react";

interface HeaderProps {
  modelName: string | null;
  modelsDeployed: { id: string; name: string }[];
  setModelID: (id: string) => void;
  setModelName: (name: string | null) => void;
  ragDataSources: RagDataSource[];
  ragDatasource: RagDataSource | undefined;
  setRagDatasource: (datasource: RagDataSource | undefined) => void;
  isHistoryPanelOpen: boolean;
  setIsHistoryPanelOpen: (isOpen: boolean) => void;
  isAgentSelected: boolean;
  setIsAgentSelected: (value: boolean) => void;
}
interface RagDataSource {
  id: string;
  name: string;
  metadata?: {
    created_at?: string;
    embedding_func_name?: string;
    last_uploaded_document?: string;
  };
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

const ForwardedSelect = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof Select>
>((props, ref) => (
  <Select {...props}>
    <SelectTrigger
      ref={ref}
      className="w-[180px] bg-white dark:bg-[#2A2A2A] border-gray-200 dark:border-[#7C68FA]/20 text-gray-800 dark:text-white"
    >
      <SelectValue placeholder="Select RAG context" />
    </SelectTrigger>
    {props.children}
  </Select>
));

ForwardedSelect.displayName = "ForwardedSelect";

const ForwardedAISelect = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof Select>
>((props, ref) => (
  <Select {...props}>
    <SelectTrigger
      ref={ref}
      className="w-[180px] bg-white dark:bg-[#2A2A2A] border-gray-200 dark:border-[#7C68FA]/20 text-gray-800 dark:text-white"
    >
      <SelectValue placeholder="Select AI Agent" />
    </SelectTrigger>
    {props.children}
  </Select>
));

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
  isAgentSelected,
  setIsAgentSelected,
}: HeaderProps) {
  const [selectedAIAgent, setSelectedAIAgent] = useState<string | null>(null);

  // Handle the AI agent selection change
  const handleAgentSelection = (value: string) => {
    if (value === "remove") {
      setSelectedAIAgent(""); // Clear the selected agent
      setIsAgentSelected(false); // Set to false if agent is removed
    } else {
      setSelectedAIAgent(value); // Set the selected agent
      setIsAgentSelected(true); // Set to true if an agent is selected
    }
  };
  return (
    <div className="bg-white dark:bg-[#2A2A2A] rounded-lg p-4 shadow-lg dark:shadow-2xl sticky top-2 z-10 flex justify-between items-center border border-gray-200 dark:border-[#7C68FA]/20 transition-all duration-300 ease-in-out">
      <div className="flex items-center">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsHistoryPanelOpen(!isHistoryPanelOpen)}
          className="mr-2"
        >
          <PanelRight className="h-4 w-4" />
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
      </div>
      <div className="flex items-center space-x-4">
        <div className="flex items-center">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <ForwardedSelect
                  value={ragDatasource ? ragDatasource.name : ""}
                  onValueChange={(v) => {
                    if (v === "remove") {
                      setRagDatasource(undefined);
                    } else {
                      const dataSource = ragDataSources.find(
                        (rds) => rds.name === v
                      );
                      if (dataSource) {
                        setRagDatasource(dataSource);
                      }
                    }
                  }}
                >
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
                    {ragDatasource && (
                      <SelectItem
                        value="remove"
                        className="text-red-500 hover:bg-red-100 dark:hover:bg-red-900/20"
                      >
                        <span className="flex items-center">
                          <X className="mr-2 h-4 w-4" />
                          Remove RAG context
                        </span>
                      </SelectItem>
                    )}
                  </SelectContent>
                </ForwardedSelect>
              </TooltipTrigger>
              <TooltipContent className="bg-white dark:bg-[#2A2A2A] border-gray-200 dark:border-[#7C68FA]/20 text-gray-800 dark:text-white">
                <p>
                  {ragDatasource
                    ? "Change or remove RAG context"
                    : "Select RAG context"}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <div className="flex items-center">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <ForwardedAISelect
                  value={selectedAIAgent || ""} // Default value is an empty string for placeholder
                  onValueChange={handleAgentSelection}
                  // onValueChange={(v) => {
                  //   if (v === "remove") {
                  //     handleAgentSelection("");  // Clear selection if "remove" is chosen
                  //   } else {
                  //     handleAgentSelection(v);  // Set selected AI Agent
                  //   }
                  // }}
                >
                  <SelectContent className="bg-white dark:bg-[#2A2A2A] border-gray-200 dark:border-[#7C68FA]/20">
                    <SelectItem
                      value="search-agent"
                      className="text-gray-800 dark:text-white hover:bg-gray-100 dark:hover:bg-[#7C68FA]/20"
                    >
                      Search Agent
                    </SelectItem>

                    {/* Add more AI agents as SelectItems here if needed */}
                    {/* <SelectItem
              value="another-agent"
              className="text-gray-800 dark:text-white hover:bg-gray-100 dark:hover:bg-[#7C68FA]/20"
            >
              Another AI Agent
            </SelectItem> */}

                    {selectedAIAgent && (
                      <SelectItem
                        value="remove"
                        className="text-red-500 hover:bg-red-100 dark:hover:bg-red-900/20"
                      >
                        <span className="flex items-center">
                          <X className="mr-2 h-4 w-4" />
                          Remove AI Agent
                        </span>
                      </SelectItem>
                    )}
                  </SelectContent>
                </ForwardedAISelect>
              </TooltipTrigger>
              <TooltipContent className="bg-white dark:bg-[#2A2A2A] border-gray-200 dark:border-[#7C68FA]/20 text-gray-800 dark:text-white">
                <p>
                  {selectedAIAgent
                    ? "Change or remove AI agent"
                    : "Select AI Agent"}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    </div>
  );
}
