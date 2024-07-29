import React, { useState } from "react";
import axios from "axios";
import { RefreshCw, CheckCircle } from "lucide-react";
import { Spinner } from "./ui/spinner";
import CustomToaster, { customToast } from "./CustomToaster";
import { useTheme } from "../providers/ThemeProvider";

const ResetIcon: React.FC = () => {
  const { theme } = useTheme();
  const [isLoading, setIsLoading] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);

  const iconColor = theme === "dark" ? "text-zinc-200" : "text-black";
  const hoverTextColor =
    theme === "dark" ? "hover:text-zinc-300" : "hover:text-gray-700";

  const resetBoard = async (): Promise<void> => {
    setIsLoading(true);
    setIsCompleted(false);

    const resetBoardAsync = async (): Promise<boolean> => {
      try {
        const response = await axios.post<Blob>("/docker-api/reset_board/", null, {
          responseType: "blob",
        });

        const reader = response.data.stream().getReader();
        const decoder = new TextDecoder();
        let fullOutput = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          fullOutput += chunk;
        }

        const finalChunk = decoder.decode();
        if (finalChunk) {
          fullOutput += finalChunk;
        }

        console.log("Full output:", fullOutput);
        return true;
      } catch (error) {
        console.error("Error resetting board:", error);
        throw error;
      }
    };

    customToast.promise(resetBoardAsync(), {
      loading: "Resetting board...",
      success: "Board reset successfully!",
      error: "Failed to reset board.",
    }).then(() => {
      setIsCompleted(true);

      // Reset to original state after 5 seconds
      setTimeout(() => {
        setIsCompleted(false);
      }, 5000);
    }).catch(() => {
      setIsCompleted(false);
    }).finally(() => {
      setIsLoading(false);
    });
  };

  return (
    <div className="relative group">
      <div
        onClick={resetBoard}
        className={`cursor-pointer ${iconColor} ${hoverTextColor} transition-all duration-300 ease-in-out`}
      >
        {isLoading ? (
          <Spinner />
        ) : isCompleted ? (
          <CheckCircle className="w-5 h-5" />
        ) : (
          <RefreshCw className="w-5 h-5" />
        )}
      </div>
      <div className="absolute bottom-0 flex flex-col items-center hidden mb-6 group-hover:flex">
        <span
          className={`relative z-10 p-2 text-xs leading-none text-white whitespace-no-wrap bg-black shadow-lg`}
        >
          {isLoading
            ? "Resetting..."
            : isCompleted
            ? "Reset Complete"
            : "Reset Board"}
        </span>
        <div className="w-3 h-3 -mt-2 rotate-45 bg-black"></div>
      </div>
    </div>
  );
};

export default ResetIcon;
