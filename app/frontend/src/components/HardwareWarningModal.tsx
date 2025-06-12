// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { AlertTriangle, RotateCcw, Power, ExternalLink } from "lucide-react";
import axios from "axios";
import { customToast } from "./CustomToaster";
import { fetchModels, deleteModel } from "../api/modelsDeployedApis";
import { Button } from "./ui/button";

interface HardwareWarningModalProps {
  isOpen: boolean;
  onClose: () => void;
  hardwareError?: string;
  boardName?: string;
}

const HardwareWarningModal: React.FC<HardwareWarningModalProps> = ({
  isOpen,
  onClose,
  hardwareError,
  boardName,
}) => {
  const [isResetting, setIsResetting] = useState(false);
  const [showRebootGuide, setShowRebootGuide] = useState(false);

  // Function to delete all deployed models (from ResetIcon.tsx)
  const deleteAllModels = async (): Promise<void> => {
    try {
      const models = await fetchModels();
      for (const model of models) {
        await customToast.promise(deleteModel(model.id), {
          loading: `Deleting Model ID: ${model.id.substring(0, 4)}...`,
          success: `Model ID: ${model.id.substring(0, 4)} deleted successfully.`,
          error: `Failed to delete Model ID: ${model.id.substring(0, 4)}.`,
        });
      }
      // Note: We don't call refreshModels here since we're outside the context
      // The models will be refreshed when the user navigates or the page reloads
    } catch (error) {
      console.error("Error deleting models:", error);
      throw new Error("Failed to delete all models.");
    }
  };

  // Board reset functionality (from ResetIcon.tsx)
  const resetBoardAsync = async (): Promise<void> => {
    const response = await axios.post<Blob>("/docker-api/reset_board/", null, {
      responseType: "blob",
    });

    const reader = response.data.stream().getReader();
    const decoder = new TextDecoder();
    let output = "";
    let success = true;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      output += chunk;

      if (
        chunk.includes("Command failed") ||
        chunk.includes("No Tenstorrent devices detected") ||
        chunk.includes("Exiting") ||
        chunk.includes("Error")
      ) {
        success = false;
      }
    }

    if (!success) {
      throw new Error(
        "Board reset failed. Please check your hardware connection and try again."
      );
    }
  };

  const handleReset = async () => {
    setIsResetting(true);
    try {
      await deleteAllModels();
      await customToast.promise(resetBoardAsync(), {
        loading: "Performing soft reset via tt-smi...",
        success:
          "Soft reset completed successfully! Hardware should be responsive now.",
        error: "Soft reset failed. You may need to try a hard reboot.",
      });
      onClose();
    } catch (error) {
      console.error("Error resetting board:", error);
      // Keep modal open to show error
    } finally {
      setIsResetting(false);
    }
  };

  const handleHardReboot = () => {
    setShowRebootGuide(true);
  };

  return (
    <>
      <AlertDialog open={isOpen} onOpenChange={onClose}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Hardware Card Issue Detected
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p className="text-sm">
                We detected that your{" "}
                <strong>{boardName || "TT hardware card"}</strong> might be in a
                bad state and is not responding properly.
              </p>

              {hardwareError && (
                <div className="bg-muted p-3 rounded-md text-sm">
                  <p className="font-medium mb-1">Technical Details:</p>
                  <p className="text-muted-foreground">{hardwareError}</p>
                </div>
              )}

              <div className="space-y-2 text-sm">
                <p className="font-medium">Recommended Actions:</p>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-2">
                  <li>Try soft reset via tt-smi first using TT Studio</li>
                  <li>If that fails, try resetting the hardware card</li>
                  <li>
                    If the problem persists, perform a hard reboot of the system
                  </li>
                  <li>Check hardware connections and power supply</li>
                  <li>Contact support if issues continue</li>
                </ul>
              </div>

              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 p-3 rounded-md">
                <p className="text-sm text-yellow-800 dark:text-yellow-200">
                  <strong>Note:</strong> Some features may not work correctly
                  until the hardware issue is resolved.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel onClick={onClose} disabled={isResetting}>
              Dismiss
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReset}
              disabled={isResetting}
              className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700"
            >
              <RotateCcw
                className={`h-4 w-4 mr-2 ${isResetting ? "animate-spin" : ""}`}
              />
              {isResetting
                ? "Soft Resetting via tt-smi..."
                : "Soft Reset (tt-smi)"}
            </AlertDialogAction>
            <AlertDialogAction
              onClick={handleHardReboot}
              disabled={isResetting}
              className="bg-orange-600 hover:bg-orange-700 dark:bg-orange-600 dark:hover:bg-orange-700"
            >
              <Power className="h-4 w-4 mr-2" />
              Hard Reboot Guide
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Hard Reboot Guide Dialog */}
      <Dialog open={showRebootGuide} onOpenChange={setShowRebootGuide}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Power className="h-5 w-5 text-orange-600" />
              Hard Reboot Instructions
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 rounded-md">
              <p className="text-red-800 dark:text-red-200 font-medium">
                ⚠️ Warning: Hard reboot will forcefully restart your system and
                may cause data loss if work is not saved.
              </p>
            </div>

            <div>
              <h4 className="font-medium mb-2">Step-by-step instructions:</h4>
              <ol className="list-decimal list-inside space-y-2 ml-2">
                <li>Save any important work on your system</li>
                <li>Close all applications if possible</li>
                <li>
                  Press and hold the power button on your machine for 10-15
                  seconds
                </li>
                <li>
                  Wait for the system to completely shut down (all lights off)
                </li>
                <li>Wait 30 seconds before turning the system back on</li>
                <li>Press the power button once to restart</li>
                <li>Allow the system to fully boot up</li>
                <li>
                  Check if the TT Studio application detects the hardware
                  properly
                </li>
              </ol>
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-3 rounded-md">
              <p className="text-blue-800 dark:text-blue-200">
                <strong>Alternative:</strong> If you have SSH access, you can
                also run{" "}
                <code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">
                  sudo reboot
                </code>{" "}
                from the command line.
              </p>
            </div>

            <div>
              <h4 className="font-medium mb-2">After reboot:</h4>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>Check if the hardware card is detected in TT Studio</li>
                <li>Verify system logs for any hardware errors</li>
                <li>Test deploying a simple model to confirm functionality</li>
                <li>Contact support if issues persist after reboot</li>
              </ul>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRebootGuide(false)}>
              Close Guide
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setShowRebootGuide(false);
                onClose();
              }}
              className="bg-orange-600 hover:bg-orange-700 text-white"
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              I'll Reboot Now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default HardwareWarningModal;
