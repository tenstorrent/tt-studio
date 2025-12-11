// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";
import { ClipboardCopy } from "lucide-react";
import { customToast } from "./CustomToaster";

const CopyableText = ({
  text,
  isInsideButton = false,
}: {
  text: string;
  isInsideButton?: boolean;
}) => {
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      customToast.success("Text has been copied to clipboard.");
    });
  };

  return (
    <TooltipProvider>
      <Tooltip delayDuration={100}>
        <TooltipTrigger asChild>
          <div
            className="relative group pr-6 min-w-0 cursor-pointer"
            onClick={handleCopy}
          >
            <span className="text-gray-700 dark:text-gray-300 block truncate">
              {text}
            </span>
            {isInsideButton ? (
              <div className="absolute right-0 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-blue-500 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 cursor-pointer flex-shrink-0">
                <ClipboardCopy className="h-4 w-4" />
              </div>
            ) : (
              <button className="absolute right-0 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-blue-500 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 flex-shrink-0">
                <ClipboardCopy className="h-4 w-4" />
              </button>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <div className="max-w-md">
            <p className="break-all">{text}</p>
            <p className="text-xs mt-1 text-gray-400">Click to copy</p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default CopyableText;
