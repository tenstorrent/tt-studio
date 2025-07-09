// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

type HardwareIconProps = {
  type: string;
  className?: string;
};

export function HardwareIcon({ type, className = "" }: HardwareIconProps) {
  const getIconPath = () => {
    switch (type.toLowerCase()) {
      case "loudbox":
        return "/src/assets/aiPlayground/ttHardware/tt_brand_refresh_loud_box.svg";
      case "n150":
      case "n300":
        return "/src/assets/aiPlayground/ttHardware/n150.svg";
      // case "quietbox":
      //   return "/src/assets/aiPlayground/ttHardware/quiet_box.svg";
      default:
        return "";
    }
  };

  const iconPath = getIconPath();
  if (!iconPath) return null;

  return (
    <img src={iconPath} alt={`${type} hardware icon`} className={className} />
  );
}
