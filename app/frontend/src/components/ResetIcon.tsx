// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import React, { useState, useEffect } from "react";
import axios from "axios";
import { Cpu, CheckCircle, AlertTriangle } from "lucide-react";
import { Spinner } from "./ui/spinner";
import { customToast } from "./CustomToaster";
import { useTheme } from "../providers/ThemeProvider";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "./ui/dialog";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion";
import { ScrollArea } from "./ui/scroll-area";
import { fetchModels, deleteModel } from "../api/modelsDeployedApis";
import { useModels } from "../providers/ModelsContext";
import BoardBadge from "./BoardBadge";

interface ResetIconProps {
  onReset?: () => void;
}

// Board info interface
interface BoardInfo {
  type: string;
  name: string;
}

const ResetIcon: React.FC<ResetIconProps> = ({ onReset }) => {
  const { theme } = useTheme();
  const { refreshModels } = useModels();
  const [isLoading, setIsLoading] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resetHistory, setResetHistory] = useState<Date[]>([]);
  const [fullOutput, setFullOutput] = useState<string | null>(null);
  const [boardInfo, setBoardInfo] = useState<BoardInfo | null>(null);
  const [boardLoading, setBoardLoading] = useState(false);

  // Fetch board information when dialog opens
  useEffect(() => {
    if (isDialogOpen && !boardInfo) {
      fetchBoardInfo();
    }
  }, [isDialogOpen]);

  const fetchBoardInfo = async () => {
    setBoardLoading(true);
    try {
      const response = await axios.get<{ type: string; name: string }>("/docker-api/board-info/");
      setBoardInfo(response.data);
    } catch (error) {
      console.error("Error fetching board info:", error);
      // Set default values if detection fails
      setBoardInfo({ type: "unknown", name: "Unknown Board" });
    } finally {
      setBoardLoading(false);
    }
  };

  const iconColor = theme === "dark" ? "text-zinc-200" : "text-black";
  const hoverIconColor = theme === "dark" ? "hover:text-zinc-300" : "hover:text-gray-700";
  const buttonBackgroundColor = theme === "dark" ? "bg-zinc-900" : "bg-white";
  const hoverButtonBackgroundColor = theme === "dark" ? "hover:bg-zinc-700" : "hover:bg-gray-200";

  // Function to delete all deployed models
  const deleteAllModels = async (): Promise<void> => {
    try {
      const models = await fetchModels(); // Fetch all deployed models
      console.log("Models to delete:", models);
      for (const model of models) {
        await customToast.promise(deleteModel(model.id), {
          loading: `Deleting Model ID: ${model.id.substring(0, 4)}...`,
          success: `Model ID: ${model.id.substring(0, 4)} deleted successfully.`,
          error: `Failed to delete Model ID: ${model.id.substring(0, 4)}.`,
        });
      }

      // Refresh the ModelsContext to sync with backend
      await refreshModels();
    } catch (error) {
      console.error("Error deleting models:", error);
      throw new Error("Failed to delete all models.");
    }
  };

  const resetBoardAsync = async (): Promise<void> => {
    const response = await axios.post<Blob>("/docker-api/reset_board/", null, {
      responseType: "blob",
    });

    const reader = response.data.stream().getReader();
    const decoder = new TextDecoder();
    let output = "";
    let success = true;
    const statusCode = response.status;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      output += chunk;

      // Check for failure in each chunk
      if (
        chunk.includes("Command failed") ||
        chunk.includes("No Tenstorrent devices detected") ||
        chunk.includes("Exiting") ||
        chunk.includes("Error")
      ) {
        success = false;
      }
    }

    const finalChunk = decoder.decode();
    if (finalChunk) {
      output += finalChunk;
      if (
        finalChunk.includes("Command failed") ||
        finalChunk.includes("No Tenstorrent devices detected") ||
        finalChunk.includes("Exiting") ||
        finalChunk.includes("Error")
      ) {
        success = false;
      }
    }

    const styledOutput = success
      ? `
        <span style="color: green;">Board Reset Successfully</span>
        -----------------------
        <pre style="color: yellow; white-space: pre-wrap;">${output}</pre>
      `
      : `
        <span style="color: red;">Board Reset Failed</span>
        -----------------------
        <pre style="color: yellow; white-space: pre-wrap;">${output}</pre>
      `;

    setFullOutput(styledOutput);

    if (!success) {
      if (statusCode === 501) {
        throw new Error(
          "No Tenstorrent devices detected. Please check your hardware connection and try again."
        );
      } else {
        // Parse the error message from the output
        const errorLines = output
          .split("\n")
          .filter(
            (line) =>
              line.includes("tt-smi reset failed") ||
              line.includes("Please check if:") ||
              line.includes("1.") ||
              line.includes("2.") ||
              line.includes("3.") ||
              line.includes("4.")
          );
        if (errorLines.length > 0) {
          throw new Error(errorLines.join("\n"));
        } else {
          throw new Error("Board reset failed. Please check the command output for details.");
        }
      }
    }

    setIsCompleted(true);
    setResetHistory((prevHistory) => [...prevHistory, new Date()]);
    setTimeout(() => setIsCompleted(false), 5000);
  };

  const resetBoard = async (): Promise<void> => {
    setIsLoading(true);
    setIsCompleted(false);
    setErrorMessage(null);
    setIsDialogOpen(false);

    try {
      await deleteAllModels();

      await customToast.promise(resetBoardAsync(), {
        loading: "Resetting board...",
        success: "Board reset successfully!",
        error: "Failed to reset board.",
      });

      if (onReset) {
        console.log("Calling onReset prop function");
        onReset();
      }
    } catch (error) {
      console.error("Error resetting board:", error);

      if (error instanceof Error) {
        const errorOutput = `
          <span style="color: red;">Error Resetting Board</span>
          -----------------------
          <pre style="color: red; white-space: pre-wrap;">${error.message}</pre>
        `;
        setFullOutput(errorOutput);
        setErrorMessage(error.message);
      } else {
        setErrorMessage("An unknown error occurred");
      }

      setIsDialogOpen(true);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDialogOpenChange = (isOpen: boolean) => {
    setIsDialogOpen(isOpen);
    if (isOpen) {
      setErrorMessage(null);
    }
  };

  return (
    <Dialog open={isDialogOpen} onOpenChange={handleDialogOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="navbar"
          size="icon"
          className={`relative inline-flex items-center justify-center p-2 rounded-full transition-all duration-300 ease-in-out ${buttonBackgroundColor} ${hoverButtonBackgroundColor}`}
          onClick={() => setIsDialogOpen(true)}
        >
          {isLoading ? (
            <Spinner />
          ) : isCompleted ? (
            <CheckCircle className={`w-5 h-5 ${iconColor} ${hoverIconColor}`} />
          ) : (
            <Cpu className={`w-5 h-5 ${iconColor} ${hoverIconColor}`} />
          )}
        </Button>
      </DialogTrigger>
      <DialogContent
        className={`sm:max-w-md p-6 rounded-lg shadow-lg ${
          theme === "dark" ? "bg-zinc-900 text-white" : "bg-white text-black"
        }`}
      >
        <DialogHeader>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center">
              <AlertTriangle className="h-8 w-8 text-yellow-500 mr-2" />
              <DialogTitle className="text-lg font-semibold">Reset Card</DialogTitle>
            </div>
            {boardInfo && boardInfo.type !== "unknown" && <BoardBadge boardName={boardInfo.type} />}
            {boardLoading && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 dark:bg-gray-800 rounded-full">
                <Spinner />
                <span className="text-sm text-gray-600 dark:text-gray-400">Detecting...</span>
              </div>
            )}
          </div>
          <DialogDescription className="text-left">
            Are you sure you want to reset the card?
          </DialogDescription>
        </DialogHeader>
        {boardInfo && boardInfo.type === "unknown" && (
          <div className="mb-4 p-4 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-md flex items-start">
            <AlertTriangle className="h-5 w-5 text-red-700 dark:text-red-300 mr-2 mt-1 flex-shrink-0" />
            <div>
              <div className="font-bold mb-1">No Tenstorrent device detected</div>
              <div className="text-sm">
                Device <code>/dev/tenstorrent</code> not found. Please check your hardware
                connection and ensure the device is properly installed.
              </div>
            </div>
          </div>
        )}
        <div className={`mb-4 ${theme === "dark" ? "text-gray-400" : "text-gray-500"}`}>
          <div className="border-l-4 border-red-600 pl-2">
            <div className="font-bold">
              Warning! This action will stop all deployed models and might interrupt ongoing
              processes.
            </div>
            {resetHistory.length > 0 && (
              <div className="mt-2">
                Note: This card was reset in the last 5 minutes. Frequent resets may cause issues.
                Please wait before resetting again.
              </div>
            )}
          </div>
        </div>
        {errorMessage && (
          <div className="mt-4 p-4 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-md">
            <div className="flex items-start">
              <AlertTriangle className="h-5 w-5 text-red-700 dark:text-red-300 mr-2 mt-1 flex-shrink-0" />
              <div className="flex-1">
                <div className="font-medium mb-2">Error:</div>
                <pre className="whitespace-pre-wrap text-sm">{errorMessage}</pre>
              </div>
            </div>
          </div>
        )}
        <Accordion type="single" collapsible className="mt-4">
          <AccordionItem value="history">
            <AccordionTrigger className="text-md font-semibold">Reset History</AccordionTrigger>
            <AccordionContent>
              <ul className="list-disc pl-5 mt-2 text-sm">
                {resetHistory.length > 0 ? (
                  resetHistory.map((resetTime, index) => (
                    <li key={index}>{resetTime.toLocaleString()}</li>
                  ))
                ) : (
                  <li>No resets yet.</li>
                )}
              </ul>
            </AccordionContent>
          </AccordionItem>
          {fullOutput && (
            <AccordionItem value="output">
              <AccordionTrigger className="text-md font-semibold">Command Output</AccordionTrigger>
              <AccordionContent>
                <ScrollArea className="h-48 w-full overflow-auto rounded-md border">
                  <div
                    className="text-sm mt-2 px-2 py-1 whitespace-pre-wrap bg-zinc-800 text-green-500 rounded-md"
                    dangerouslySetInnerHTML={{ __html: fullOutput }}
                  />
                </ScrollArea>
              </AccordionContent>
            </AccordionItem>
          )}
        </Accordion>
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
            disabled={!!(boardInfo && boardInfo.type === "unknown")}
          >
            Yes, Reset
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ResetIcon;
