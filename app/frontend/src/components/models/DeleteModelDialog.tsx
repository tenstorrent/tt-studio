// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

// React import not needed for modern JSX transform
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { AlertTriangle } from "lucide-react";

interface Props {
  open: boolean;
  modelId: string;
  isLoading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function DeleteModelDialog({
  open,
  modelId: _modelId, // Marked as intentionally unused for now
  isLoading,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="sm:max-w-md p-6 rounded-xl shadow-2xl bg-stone-900/95 text-white border-2 border-yellow-500/50 backdrop-blur-md">
        <DialogHeader>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center">
              <AlertTriangle className="h-8 w-8 text-yellow-500 mr-2" />
              <DialogTitle className="text-lg font-semibold text-white">
                Delete Model & Reset Card
              </DialogTitle>
            </div>
          </div>
        </DialogHeader>
        <div className="mb-4 p-4 bg-yellow-900/30 text-yellow-100 rounded-lg border border-yellow-500/30 backdrop-blur-sm flex items-start">
          <AlertTriangle className="h-5 w-5 text-yellow-400 mr-2 mt-1 shrink-0" />
          <div>
            <div className="font-bold mb-1 text-yellow-100">
              Warning! This action will stop and remove the model, then reset
              the card.
            </div>
            <div className="text-sm text-yellow-200">
              Deleting a model will attempt to stop and remove the model
              container.
              <br />
              After deletion, the card will automatically be reset using{" "}
              <code>tt-smi reset</code>.
              <br />
              <span className="font-bold text-yellow-300">
                This may interrupt any ongoing processes on the card.
              </span>
            </div>
          </div>
        </div>
        <DialogFooter className="mt-4 flex justify-end space-x-2">
          <Button
            onClick={onCancel}
            disabled={isLoading}
            className="hover:shadow-lg hover:shadow-stone-200/20 transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0 rounded-lg"
          >
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            className="bg-red-600 text-white hover:bg-red-700 hover:shadow-lg hover:shadow-red-500/30 transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0 rounded-lg border border-red-500/30"
            disabled={isLoading}
          >
            {isLoading ? "Processing..." : `Yes, Delete & Reset`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
