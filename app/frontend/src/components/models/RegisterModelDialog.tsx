// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../ui/dialog";
import RegisterModelFormContent from "./RegisterModelFormContent";

interface RegisterModelDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function RegisterModelDialog({
  open,
  onClose,
  onSuccess,
}: RegisterModelDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg dark:bg-stone-950 dark:border-stone-800">
        <DialogHeader>
          <DialogTitle>Register External Model</DialogTitle>
          <DialogDescription>
            Connect a running Docker container to TT Studio
          </DialogDescription>
        </DialogHeader>
        {/* Conditionally render so the form remounts (resets state) each time the dialog opens */}
        {open && (
          <RegisterModelFormContent onSuccess={onSuccess} onCancel={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}
