import React, { useState } from "react";
import axios from "axios";
import { Cpu, CheckCircle, AlertTriangle } from "lucide-react";
import { Spinner } from "./ui/spinner";
import { customToast } from "./CustomToaster";
import { useTheme } from "../providers/ThemeProvider";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";

const ResetIcon: React.FC = () => {
  const { theme } = useTheme();
  const [isLoading, setIsLoading] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const iconColor = theme === "dark" ? "text-zinc-200" : "text-black";
  const hoverIconColor =
    theme === "dark" ? "hover:text-zinc-300" : "hover:text-gray-700";
  const buttonBackgroundColor = theme === "dark" ? "bg-zinc-900" : "bg-white";
  const hoverButtonBackgroundColor =
    theme === "dark" ? "hover:bg-zinc-700" : "hover:bg-gray-200";

  const resetBoard = async (): Promise<void> => {
    setIsLoading(true);
    setIsCompleted(false);
    setErrorMessage(null); // Clear any previous error message
    setIsDialogOpen(false); // ensure to close the dialog when resetting starts

    try {
      const response = await axios.post<Blob>(
        "/docker-api/reset_board/",
        null,
        {
          responseType: "blob",
        }
      );

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

      if (fullOutput.includes("Command failed with return code 1")) {
        throw new Error("Command failed");
      }

      customToast.success("Board reset successfully!");
      setIsCompleted(true);
      setTimeout(() => setIsCompleted(false), 5000);
    } catch (error) {
      console.error("Error resetting board:", error);
      customToast.error("Failed to reset board.");
      setErrorMessage("Command failed");
      setIsDialogOpen(true); // Reopen the dialog to show the error
    } finally {
      setIsLoading(false);
    }
  };

  const handleDialogOpenChange = (isOpen: boolean) => {
    setIsDialogOpen(isOpen);
    if (isOpen) {
      setErrorMessage(null); // Clear any previous error message
    }
  };

  return (
    <Dialog open={isDialogOpen} onOpenChange={handleDialogOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className={`relative inline-flex items-center justify-center p-2 rounded-full transition-all duration-300 ease-in-out ${buttonBackgroundColor} ${hoverButtonBackgroundColor}`}
        >
          {isLoading ? (
            <Spinner />
          ) : isCompleted ? (
            <CheckCircle className={`w-5 h-5 ${iconColor} ${hoverIconColor}`} />
          ) : (
            <Cpu className={`w-5 h-5 ${iconColor} ${hoverIconColor}`} />
          )}
          <span className="sr-only">Reset Board</span>
          <div className="absolute bottom-0 flex flex-col items-center hidden mb-6 group-hover:flex">
            <span
              className={`relative z-10 p-2 text-xs leading-none text-white whitespace-no-wrap ${
                theme === "dark" ? "bg-zinc-800" : "bg-black"
              } shadow-lg`}
            >
              {isLoading
                ? "Resetting..."
                : isCompleted
                ? "Reset Complete"
                : "Reset Board"}
            </span>
            <div
              className={`w-3 h-3 -mt-2 rotate-45 ${
                theme === "dark" ? "bg-zinc-800" : "bg-black"
              }`}
            ></div>
          </div>
        </Button>
      </DialogTrigger>
      <DialogContent
        className={`sm:max-w-md p-6 rounded-lg shadow-lg ${
          theme === "dark" ? "bg-zinc-900 text-white" : "bg-white text-black"
        }`}
      >
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">
            Are you sure you want to reset the tenstorrent card?
          </DialogTitle>
          <DialogDescription
            className={`text-gray-500 ${
              theme === "dark" ? "text-gray-400" : "text-gray-500"
            }`}
          >
            Software resets will stop all deployed models! Do you want to
            proceed?
          </DialogDescription>
        </DialogHeader>
        {errorMessage && (
          <div className="mt-4 p-4 bg-red-100 text-red-700 rounded-md">
            <div className="flex">
              <AlertTriangle className="h-5 w-5 text-red-700 mr-2" />
              <span className="font-medium">Error:</span> {errorMessage}
            </div>
          </div>
        )}
        <div
          className={`mt-4 p-4 rounded-md ${
            theme === "dark"
              ? "bg-yellow-700 text-yellow-200"
              : "bg-yellow-100 text-yellow-700"
          }`}
        >
          <div className="flex">
            <AlertTriangle
              className={`h-5 w-5 ${
                theme === "dark" ? "text-yellow-200" : "text-yellow-700"
              } mr-2`}
            />
            <span className="font-medium">Warning:</span> Resetting will stop
            all deployed models.
          </div>
        </div>
        <DialogFooter className="mt-4 flex justify-end space-x-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setIsDialogOpen(false)}
            className={`${theme === "dark" ? "text-white" : "text-black"}`}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="outline"
            className="bg-red-600 text-white hover:bg-red-700"
            onClick={resetBoard}
          >
            Yes, Reset
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ResetIcon;
