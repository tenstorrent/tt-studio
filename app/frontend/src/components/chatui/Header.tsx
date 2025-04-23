// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React from "react";
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  SelectSeparator,
} from "../ui/select";
import { Button } from "../ui/button";
import {
  PanelRight,
  X,
  Home,
  Menu,
  Eye,
  Mic,
  Database,
  Search,
  FolderOpen,
} from "lucide-react";
import logo from "../../assets/logo/tt_logo.svg";
import { ImageWithFallback } from "../ui/ImageWithFallback";

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
  isMobileView?: boolean;
  setIsRagExplicitlyDeselected?: (value: boolean) => void;
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
  React.ComponentPropsWithoutRef<typeof Select> & {
    ragDataSources?: any[];
  }
>((props, ref) => (
  <Select {...props}>
    <SelectTrigger
      ref={ref}
      className="w-full md:w-[220px] bg-white dark:bg-[#2A2A2A] border-gray-200 dark:border-[#7C68FA]/20 text-gray-800 dark:text-white text-xs md:text-sm flex items-center gap-2"
    >
      {props.value === "special-all" ? (
        <Search className="h-4 w-4 text-[#7C68FA]" />
      ) : (
        <Database className="h-4 w-4 text-gray-500 dark:text-gray-400" />
      )}
      <SelectValue placeholder="Select knowledge base">
        {props.value
          ? props.value === "special-all"
            ? "Search All Collections"
            : props.value
          : null}
      </SelectValue>
    </SelectTrigger>
    <SelectContent
      className="bg-[#1E1E1E] border-[#7C68FA]/20 max-h-[300px] w-[300px]"
      align="start"
      position="popper"
      side="bottom"
    >
      {/* Special All Collections Card */}
      <div className="px-2 py-2">
        <SelectItem
          value="special-all"
          className="relative rounded-lg bg-[#2A2A2A] hover:bg-[#3A3A3A] transition-all duration-200"
        >
          <div className="p-3 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Search className="h-5 w-5 text-[#7C68FA]" />
              <span className="font-medium text-white">
                Search All Collections
              </span>
            </div>
            <div className="flex items-center gap-1 text-[#7C68FA] bg-[#7C68FA]/10 px-2 py-1 rounded-full text-sm">
              <Database className="h-4 w-4" />
              <span>{props.ragDataSources?.length || 0} Collections</span>
            </div>
          </div>
        </SelectItem>
      </div>

      <SelectSeparator className="my-2 bg-gray-800" />

      <div className="px-2 py-1">
        <div className="flex items-center gap-2 px-2 py-1.5 text-gray-400">
          <FolderOpen className="h-4 w-4" />
          <span>Your Collections</span>
        </div>

        {props.ragDataSources?.map((c) => (
          <SelectItem
            key={c.id}
            value={c.name}
            className={`rounded-lg my-1 ${
              props.value === c.name ? "bg-[#2A2A2A]" : "hover:bg-[#2A2A2A]"
            }`}
          >
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-gray-400" />
              <span className="text-white">{c.name}</span>
            </div>
          </SelectItem>
        ))}
      </div>

      {props.value && (
        <>
          <SelectSeparator className="my-2 bg-gray-800" />
          <div className="px-2 pb-2">
            <SelectItem
              value="remove"
              className="text-red-400 hover:bg-red-500/10 rounded-lg"
            >
              <div className="flex items-center gap-2">
                <X className="h-4 w-4 text-red-400" />
                <span>Remove Context</span>
              </div>
            </SelectItem>
          </div>
        </>
      )}
    </SelectContent>
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
      className="w-full md:w-[180px] bg-white dark:bg-[#2A2A2A] border-gray-200 dark:border-[#7C68FA]/20 text-gray-800 dark:text-white text-xs md:text-sm"
    >
      <SelectValue placeholder="Select AI Agent" />
    </SelectTrigger>
    {props.children}
  </Select>
));

ForwardedAISelect.displayName = "ForwardedAISelect";

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
  setIsAgentSelected,
  isMobileView = false,
  setIsRagExplicitlyDeselected,
}: HeaderProps) {
  // Log ragDataSources to console to inspect its structure
  // console.log("RAG Data Sources:", ragDataSources);

  const [selectedAIAgent, setSelectedAIAgent] = useState<string | null>(null);
  const [showMobileMenu, setShowMobileMenu] = useState<boolean>(false);
  // const navigate = useNavigate();

  // Add the special "All Collections" option to handle querying across all collections
  const allCollectionsOption: RagDataSource = {
    id: "special-all",
    name: "special-all",
    metadata: {
      embedding_func_name: "All Collections",
    },
  };

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

  // Handle RAG context selection/deselection
  const handleRagSelection = (value: string) => {
    if (value === "remove") {
      setRagDatasource(undefined);
      setIsRagExplicitlyDeselected?.(true);
    } else {
      const dataSource = ragDataSources.find((rds) => rds.name === value);
      if (dataSource) {
        setRagDatasource(dataSource);
        setIsRagExplicitlyDeselected?.(false);
      }
    }
  };

  // Toggle mobile dropdown menu
  const toggleMobileMenu = () => {
    setShowMobileMenu(!showMobileMenu);
  };

  return (
    <div className="bg-white dark:bg-[#2A2A2A] rounded-lg p-2 md:p-4 shadow-lg dark:shadow-2xl sticky top-2 z-10 flex flex-col md:flex-row justify-between items-start md:items-center border border-gray-200 dark:border-[#7C68FA]/20 transition-all duration-300 ease-in-out">
      <div className="flex items-center w-full md:w-auto justify-between md:justify-start">
        <div className="flex items-center">
          {/* Logo - Mobile Only */}
          <ImageWithFallback
            src={logo}
            alt="TT Logo"
            className="h-6 w-auto mr-2 md:hidden"
          />

          {/* Only show panel toggle and breadcrumb on desktop */}
          <div className="hidden md:flex items-center">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setIsHistoryPanelOpen(!isHistoryPanelOpen)}
                    className="mr-2"
                  >
                    <PanelRight className="h-4 w-4" />
                    <span className="sr-only">
                      {isHistoryPanelOpen ? "Close sidebar" : "Open sidebar"}
                    </span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="bg-white dark:bg-[#2A2A2A] border-gray-200 dark:border-[#7C68FA]/20 text-gray-800 dark:text-white">
                  <p>{isHistoryPanelOpen ? "Close sidebar" : "Open sidebar"}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Breadcrumb className="flex items-center">
              <BreadcrumbList className="flex gap-2 text-xs md:text-sm">
                <BreadcrumbItem>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Link
                          to="/"
                          className="text-gray-600 dark:text-white/70 hover:text-gray-800 dark:hover:text-white transition-colors duration-300 flex items-center"
                        >
                          <Home className="w-4 h-4 mr-1 md:mr-2" />
                          <span className="hidden sm:inline">Home</span>
                        </Link>
                      </TooltipTrigger>
                      <TooltipContent className="bg-white dark:bg-[#2A2A2A] border-gray-200 dark:border-[#7C68FA]/20 text-gray-800 dark:text-white">
                        <p>Go to home</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </BreadcrumbItem>
                {modelsDeployed.length > 0 && (
                  <>
                    <BreadcrumbSeparator className="mx-1 md:mx-2 text-white/40 dark:text-white/40">
                      /
                    </BreadcrumbSeparator>
                    <BreadcrumbItem className="hidden sm:block">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Link
                              to="/models-deployed"
                              className="text-gray-600 dark:text-white/70 hover:text-gray-800 dark:hover:text-white transition-colors duration-300 flex items-center"
                            >
                              Models
                            </Link>
                          </TooltipTrigger>
                          <TooltipContent className="bg-white dark:bg-[#2A2A2A] border-gray-200 dark:border-[#7C68FA]/20 text-gray-800 dark:text-white">
                            <p>View all deployed models</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator className="mx-1 md:mx-2 text-white/40 dark:text-white/40 hidden sm:block">
                      /
                    </BreadcrumbSeparator>
                    <BreadcrumbItem className="hidden sm:block">
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
                    <BreadcrumbSeparator className="mx-1 md:mx-2 text-white/40 dark:text-white/40 hidden sm:block">
                      /
                    </BreadcrumbSeparator>
                    <BreadcrumbItem>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <BreadcrumbPage className="text-[#7C68FA] dark:text-[#7C68FA] font-bold hover:text-[#7C68FA]/80 dark:hover:text-[#7C68FA]/80 transition-colors duration-300 truncate max-w-[80px] sm:max-w-full">
                              {modelName}
                            </BreadcrumbPage>
                          </TooltipTrigger>
                          <TooltipContent className="bg-white dark:bg-[#2A2A2A] border-gray-200 dark:border-[#7C68FA]/20 text-gray-800 dark:text-white">
                            <p>Current selected model</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </BreadcrumbItem>
                  </>
                )}
              </BreadcrumbList>
            </Breadcrumb>
          </div>

          {/* Show only model name on mobile next to logo */}
          {modelsDeployed.length > 0 && isMobileView && (
            <span className="text-[#7C68FA] dark:text-[#7C68FA] font-bold truncate max-w-[120px] ml-2 text-sm">
              {modelName}
            </span>
          )}
        </div>

        {/* Mobile hamburger menu button */}
        {isMobileView && (
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleMobileMenu}
            className="md:hidden"
          >
            <Menu className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Mobile dropdown menu - redesigned to match the screenshot */}
      {isMobileView && showMobileMenu && (
        <div className="mt-2 w-full space-y-2 md:hidden bg-[#1E1E1E] p-3 rounded-md border border-[#7C68FA]/20">
          {/* App Title */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center">
              <ImageWithFallback
                src={logo}
                alt="TT Logo"
                className="h-6 w-auto mr-2"
              />
              <span className="text-white text-base font-bold">
                AI Playground
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleMobileMenu}
              className="text-white"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Navigation Menu */}
          <div className="space-y-2">
            {/* Home */}
            <Link
              to="/"
              className={`flex items-center p-2 rounded-md ${isHistoryPanelOpen ? "bg-[#7C68FA]/20 border-l-4 border-[#7C68FA]" : "hover:bg-[#2A2A2A]"}`}
              onClick={() => setShowMobileMenu(false)}
            >
              <Home className="h-4 w-4 mr-2 text-white" />
              <span className="text-white text-sm">Home</span>
            </Link>

            {/* RAG Management */}
            <Link
              to="/rag-management"
              className="flex items-center p-2 rounded-md hover:bg-[#2A2A2A]"
              onClick={() => setShowMobileMenu(false)}
            >
              <Database className="h-4 w-4 mr-2 text-white" />
              <span className="text-white text-sm">RAG Management</span>
            </Link>

            {/* Chat UI */}
            <Link
              to="/chat-ui"
              className="flex items-center p-2 rounded-md bg-[#7C68FA]/50 border-l-4 border-[#7C68FA]"
              onClick={() => setShowMobileMenu(false)}
            >
              <svg
                className="h-4 w-4 mr-2 text-white"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M21 12C21 16.9706 16.9706 21 12 21C10.2289 21 8.57736 20.4884 7.17317 19.605L3 21L4.39499 16.8268C3.51156 15.4226 3 13.7711 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="12" cy="12" r="1" fill="currentColor" />
                <circle cx="16" cy="12" r="1" fill="currentColor" />
                <circle cx="8" cy="12" r="1" fill="currentColor" />
              </svg>
              <span className="text-white text-sm">Chat</span>
            </Link>

            {/* Object Detection */}
            <Link
              to="/object-detection"
              className="flex items-center p-2 rounded-md hover:bg-[#2A2A2A]"
              onClick={() => setShowMobileMenu(false)}
            >
              <Eye className="h-4 w-4 mr-2 text-white" />
              <span className="text-white text-sm">Object Detection</span>
            </Link>

            {/* Logs */}
            <Link
              to="/logs"
              className="flex items-center p-2 rounded-md hover:bg-[#2A2A2A]"
              onClick={() => setShowMobileMenu(false)}
            >
              <Mic className="h-4 w-4 mr-2 text-white" />
              <span className="text-white text-sm">Logs</span>
            </Link>
          </div>

          {/* Panel Status */}
          <div className="mt-4 border-t border-[#7C68FA]/20 pt-3">
            <div className="flex items-center justify-between">
              <span className="text-white text-xs font-medium">
                History Panel
              </span>
              <div className="flex items-center">
                <span className="text-white text-xs mr-2">
                  {isHistoryPanelOpen ? "Open" : "Closed"}
                </span>
                <Button
                  variant={isHistoryPanelOpen ? "default" : "outline"}
                  size="sm"
                  onClick={() => setIsHistoryPanelOpen(!isHistoryPanelOpen)}
                  className={
                    isHistoryPanelOpen
                      ? "bg-[#7C68FA] hover:bg-[#7C68FA]/80 text-xs h-7"
                      : "border-[#7C68FA]/50 text-white text-xs h-7"
                  }
                >
                  <PanelRight className="h-3 w-3 mr-1" />
                  {isHistoryPanelOpen ? "Close" : "Open"}
                </Button>
              </div>
            </div>
          </div>

          {/* Model and RAG Selection */}
          <div className="mt-3 space-y-2">
            {modelsDeployed.length > 0 && (
              <div>
                <span className="text-white text-xs font-medium block mb-1">
                  Current Model
                </span>
                <Select
                  value={modelName || ""}
                  onValueChange={(v) => {
                    const model = modelsDeployed.find((m) => m.name === v);
                    if (model) {
                      setModelID(model.id);
                      setModelName(model.name);
                    }
                  }}
                >
                  <SelectTrigger className="w-full bg-[#2A2A2A] border-[#7C68FA]/20 text-white text-xs h-8">
                    <SelectValue placeholder="Select model" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#2A2A2A] border-[#7C68FA]/20">
                    {modelsDeployed.map((model) => (
                      <SelectItem
                        key={model.id}
                        value={model.name}
                        className="text-white hover:bg-[#7C68FA]/20 text-xs"
                      >
                        {model.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <span className="text-white text-xs font-medium block mb-1">
                RAG Context
              </span>
              <ForwardedSelect
                value={
                  ragDatasource
                    ? ragDatasource.id === "special-all"
                      ? "special-all"
                      : ragDatasource.name
                    : ""
                }
                onValueChange={(v) => {
                  if (v === "remove") {
                    setRagDatasource(undefined);
                  } else if (v === "special-all") {
                    setRagDatasource(allCollectionsOption);
                  } else {
                    const dataSource = ragDataSources.find(
                      (rds) => rds.name === v
                    );
                    if (dataSource) {
                      setRagDatasource(dataSource);
                    }
                  }
                }}
                ragDataSources={ragDataSources}
              >
                <SelectContent className="bg-[#2A2A2A] border-[#7C68FA]/20 text-xs">
                  {ragDataSources.map((c) => (
                    <SelectItem
                      key={c.id}
                      value={c.name}
                      className={`text-gray-800 dark:text-white hover:bg-gray-100 dark:hover:bg-[#7C68FA]/20 ${
                        ragDatasource?.name === c.name &&
                        ragDatasource.id !== "special-all"
                          ? "bg-[#7C68FA]/10"
                          : ""
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Database className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                        <div className="flex flex-col">
                          <span className="font-medium">{c.name}</span>
                          {c.metadata?.last_uploaded_document && (
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              Last updated: {c.metadata.last_uploaded_document}
                            </span>
                          )}
                          {c.metadata?.embedding_func_name && (
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              Model: {c.metadata.embedding_func_name}
                            </span>
                          )}
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </ForwardedSelect>
            </div>

            {modelsDeployed.length > 0 && (
              <div>
                <span className="text-white text-xs font-medium block mb-1">
                  AI Agent
                </span>
                <ForwardedAISelect
                  value={selectedAIAgent || ""}
                  onValueChange={handleAgentSelection}
                >
                  <SelectContent className="bg-[#2A2A2A] border-[#7C68FA]/20 text-xs">
                    <SelectItem
                      value="search-agent"
                      className="text-white hover:bg-[#7C68FA]/20 text-xs"
                    >
                      Search Agent
                    </SelectItem>

                    {selectedAIAgent && (
                      <SelectItem
                        value="remove"
                        className="text-red-500 hover:bg-red-900/20 text-xs"
                      >
                        <span className="flex items-center">
                          <X className="mr-2 h-3 w-3" />
                          Remove AI Agent
                        </span>
                      </SelectItem>
                    )}
                  </SelectContent>
                </ForwardedAISelect>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Desktop control elements */}
      <div className="hidden md:flex items-center space-x-4">
        <div className="flex items-center">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <ForwardedSelect
                  value={
                    ragDatasource
                      ? ragDatasource.id === "special-all"
                        ? "special-all"
                        : ragDatasource.name
                      : ""
                  }
                  onValueChange={(v) => {
                    if (v === "remove") {
                      setRagDatasource(undefined);
                    } else if (v === "special-all") {
                      setRagDatasource(allCollectionsOption);
                    } else {
                      const dataSource = ragDataSources.find(
                        (rds) => rds.name === v
                      );
                      if (dataSource) {
                        setRagDatasource(dataSource);
                      }
                    }
                  }}
                  ragDataSources={ragDataSources}
                >
                  <SelectContent className="bg-white dark:bg-[#2A2A2A] border-gray-200 dark:border-[#7C68FA]/20">
                    <SelectGroup>
                      <SelectLabel className="text-gray-500 dark:text-white/70">
                        Special Options
                      </SelectLabel>
                      <SelectItem
                        value="special-all"
                        className="text-gray-800 dark:text-white hover:bg-gray-100 dark:hover:bg-[#7C68FA]/20 flex items-center"
                      >
                        <Search className="h-4 w-4 mr-2 inline-block" />
                        <span>All Collections</span>
                      </SelectItem>
                    </SelectGroup>

                    <SelectGroup>
                      <SelectLabel className="text-gray-500 dark:text-white/70 mt-2">
                        Your Collections
                      </SelectLabel>
                      {ragDataSources.map((c) => (
                        <SelectItem
                          key={c.id}
                          value={c.name}
                          className={`text-gray-800 dark:text-white hover:bg-gray-100 dark:hover:bg-[#7C68FA]/20 ${
                            ragDatasource?.name === c.name &&
                            ragDatasource.id !== "special-all"
                              ? "bg-[#7C68FA]/10"
                              : ""
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <Database className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                            <div className="flex flex-col">
                              <span className="font-medium">{c.name}</span>
                              {c.metadata?.last_uploaded_document && (
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                  Last updated:{" "}
                                  {c.metadata.last_uploaded_document}
                                </span>
                              )}
                              {c.metadata?.embedding_func_name && (
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                  Model: {c.metadata.embedding_func_name}
                                </span>
                              )}
                            </div>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectGroup>

                    {ragDatasource && (
                      <SelectItem
                        value="remove"
                        className="text-red-500 hover:bg-red-100 dark:hover:bg-red-900/20 mt-2"
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
                  {!ragDatasource
                    ? "Select RAG context"
                    : ragDatasource.id === "special-all"
                      ? "Currently querying all collections"
                      : "Change or remove RAG context"}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {modelsDeployed.length > 0 && (
          <div className="flex items-center">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <ForwardedAISelect
                    value={selectedAIAgent || ""}
                    onValueChange={handleAgentSelection}
                  >
                    <SelectContent className="bg-white dark:bg-[#2A2A2A] border-gray-200 dark:border-[#7C68FA]/20">
                      <SelectItem
                        value="search-agent"
                        className="text-gray-800 dark:text-white hover:bg-gray-100 dark:hover:bg-[#7C68FA]/20"
                      >
                        Search Agent
                      </SelectItem>

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
        )}
      </div>
    </div>
  );
}
