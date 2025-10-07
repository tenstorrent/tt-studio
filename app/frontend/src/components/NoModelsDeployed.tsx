// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { useNavigate } from "react-router-dom";

interface NoModelsDialogProps {
  messageKey?: "reset" | "noModels";
}

export function NoModelsDialog({
  messageKey = "noModels",
}: NoModelsDialogProps) {
  const navigate = useNavigate();

  const messages = {
    reset: "The board was reset, so all models were stopped.",
    noModels:
      "There are currently no models deployed. You can head to the homepage to deploy models.",
  };

  return (
    <Dialog open={true}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>No Models Deployed</DialogTitle>
          <DialogDescription>{messages[messageKey]}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={() => navigate("/")}>Go to Homepage</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
