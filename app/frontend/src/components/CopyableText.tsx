import React, { useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";
import { ClipboardCopy } from "lucide-react";
import CustomToaster, { customToast } from "./CustomToaster";

const CopyableText = ({ text }: { text: string }) => {
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setIsCopied(true);
      customToast.success("Text has been copied to clipboard.");
      setTimeout(() => setIsCopied(false), 3000); // Reset the copied state after 3 seconds
    });
  };

  return (
    <TooltipProvider>
      <div className="relative group">
        <span className="text-gray-700 dark:text-gray-300">{text}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleCopy}
              className="absolute right-0 top-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 ml-2 text-blue-500 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
            >
              <ClipboardCopy className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{isCopied ? "Copied!" : "Copy to clipboard"}</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
};

export default CopyableText;
