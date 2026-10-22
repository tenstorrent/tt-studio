// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect } from "react";
import { Modal, useModal, type ModalProps } from "@tenstorrent/vesper/modal";
import { Sheet, useSheet, type SheetProps } from "@tenstorrent/vesper/sheet";
import { cn } from "@/src/lib/utils";

/**
 * Vesper's `Modal` is opened imperatively. This drives it from an `open` prop
 * instead, and reports closes (escape key, close button) through `onOpenChange`.
 */
export function ControlledModal({
  open,
  onOpenChange,
  onClose,
  className,
  ...props
}: Omit<ModalProps, "ref"> & {
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const modal = useModal();

  useEffect(() => {
    if (open) modal.open();
    else modal.close();
  }, [open, modal]);

  return (
    <Modal
      ref={modal.ref}
      {...props}
      // the app root centers text, which modals would otherwise inherit
      className={cn("text-left", className)}
      onClose={(e) => {
        onClose?.(e);
        onOpenChange(false);
      }}
    />
  );
}

/** `Sheet` counterpart of `ControlledModal`. */
export function ControlledSheet({
  open,
  onOpenChange,
  onClose,
  className,
  ...props
}: Omit<SheetProps, "ref"> & {
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const sheet = useSheet();

  useEffect(() => {
    if (open) sheet.open();
    else sheet.close();
  }, [open, sheet]);

  return (
    <Sheet
      ref={sheet.ref}
      {...props}
      className={cn("text-left", className)}
      onClose={(e) => {
        onClose?.(e);
        onOpenChange(false);
      }}
    />
  );
}
