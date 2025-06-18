// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../ui/breadcrumb";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { Button } from "../ui/button";
import { ArrowLeft, PanelRight } from "lucide-react";

interface HeaderProps {
  onBack: () => void;
  isHistoryPanelOpen: boolean;
  setIsHistoryPanelOpen: (isOpen: boolean) => void;
}

export default function Header({ onBack, isHistoryPanelOpen, setIsHistoryPanelOpen }: HeaderProps) {
  return (
    <div className="bg-white dark:bg-[#2A2A2A] border-gray-200 dark:border-[#7C68FA]/20 p-4 shadow-lg sticky top-2 z-10 flex justify-between items-center border-b  transition-all duration-300 ease-in-out rounded-lg">
      <div className="flex items-center">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          className="mr-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
        >
          <ArrowLeft className="h-6 w-6" />
        </Button>
        <Breadcrumb className="flex items-center rounded-lg">
          <BreadcrumbList className="flex gap-2 text-sm">
            <BreadcrumbItem>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <BreadcrumbLink
                      href="#"
                      className="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors duration-300 flex items-center"
                    >
                      Image Generation Chat
                    </BreadcrumbLink>
                  </TooltipTrigger>
                  <TooltipContent className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-800 dark:text-white">
                    <p>Back to Image Generation options</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="mx-2 text-gray-400 dark:text-gray-600">
              /
            </BreadcrumbSeparator>
            <BreadcrumbItem>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <BreadcrumbPage className="text-gray-900 dark:text-white font-bold">
                      Stable Diffusion
                    </BreadcrumbPage>
                  </TooltipTrigger>
                  <TooltipContent className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-800 dark:text-white">
                    <p>Generate Images using prompt text</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      <div className="flex items-center">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsHistoryPanelOpen(!isHistoryPanelOpen)}
                className="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
              >
                <PanelRight className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-800 dark:text-white">
              <p>{isHistoryPanelOpen ? "Close" : "Open"} history panel</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}
