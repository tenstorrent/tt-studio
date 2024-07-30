import React, { useState } from "react";
import axios from "axios";
import { RefreshCw, CheckCircle } from "lucide-react";
import { Spinner } from "./ui/spinner";
import CustomToaster, { customToast } from "./CustomToaster";
import { useTheme } from "../providers/ThemeProvider";
import { Button } from "./ui/button";

const ResetIcon: React.FC = () => {
  const { theme } = useTheme();
  const [isLoading, setIsLoading] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);

  const iconColor = theme === "dark" ? "text-zinc-200" : "text-black";
  const hoverIconColor =
    theme === "dark" ? "hover:text-zinc-300" : "hover:text-gray-700";
  const buttonBackgroundColor = theme === "dark" ? "bg-zinc-900" : "bg-white";
  const hoverButtonBackgroundColor =
    theme === "dark" ? "hover:bg-zinc-700" : "hover:bg-gray-200";

  const resetBoard = async (): Promise<void> => {
    setIsLoading(true);
    setIsCompleted(false);

    try {
      const response = await axios.post<Blob>("/docker-api/reset_board/", null, {
        responseType: "blob",
      });

      // Log the full output for debugging
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

      console.log("Full output:", fullOutput); // Reintroduced logging
      customToast.success("Board reset successfully!");
      setIsCompleted(true);
      setTimeout(() => setIsCompleted(false), 5000);
    } catch (error) {
      console.error("Error resetting board:", error);
      customToast.error("Failed to reset board.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="icon"
      onClick={resetBoard}
      className={`relative inline-flex items-center justify-center p-2 rounded-full transition-all duration-300 ease-in-out ${buttonBackgroundColor} ${hoverButtonBackgroundColor}`}
    >
      {isLoading ? (
        <Spinner />
      ) : isCompleted ? (
        <CheckCircle className={`w-5 h-5 ${iconColor} ${hoverIconColor}`} />
      ) : (
        <RefreshCw className={`w-5 h-5 ${iconColor} ${hoverIconColor}`} />
      )}
      <span className="sr-only">Reset Board</span>
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
    </Button>
  );
};

export default ResetIcon;
