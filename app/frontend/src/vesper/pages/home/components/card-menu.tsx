// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Menu } from "@tenstorrent/vesper/menu";
import { Document, Ellipses, Reset } from "@tenstorrent/vesper/icons";
import { IconButton } from "@tenstorrent/vesper/icon-button";
import { useState } from "react";
import { cn } from "@/src/lib/utils";

export function CardMenu() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Menu
      open={isOpen}
      onOpenChange={setIsOpen}
      items={[
        { icon: <Document />, text: "View Logs", onSelect() {} },
        {
          icon: <Reset />,
          text: "Reset Device",
          onSelect() {},
          style: "danger",
        },
      ]}
    >
      <IconButton
        icon={<Ellipses />}
        size="xs"
        variant="ghost"
        className={cn(isOpen && "bg-vesper-tint-neutral-200")}
      />
    </Menu>
  );
}
