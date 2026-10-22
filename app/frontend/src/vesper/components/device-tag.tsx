// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Chip as ChipComponent } from "@tenstorrent/vesper/chip";
import { Chip as ChipIcon } from "@tenstorrent/vesper/icons";
import { Tag } from "@tenstorrent/vesper/tag";
import { formatDeviceLabel } from "@/src/vesper/utils/models";

/** A device (`D.01`) shown as a read-only tag. */
export function DeviceTag({
  deviceId,
  selected = false,
}: {
  deviceId: number;
  selected?: boolean;
}) {
  return (
    <Tag
      size="lg"
      variant={selected ? "contrast" : "default"}
      icon={<ChipIcon />}
    >
      {formatDeviceLabel(deviceId)}
    </Tag>
  );
}

/** A device (`D.01`) that can be picked when configuring a deployment. */
export function DeviceChip({
  deviceId,
  selected,
  disabled,
  onSelect,
}: {
  deviceId: number;
  selected: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}) {
  return (
    <ChipComponent
      type="button"
      size="md"
      variant={selected ? "contrast" : "default"}
      selected={selected}
      disabled={disabled}
      iconLeft={<ChipIcon />}
      onChange={() => onSelect?.()}
    >
      {formatDeviceLabel(deviceId)}
    </ChipComponent>
  );
}
