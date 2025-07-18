// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

// Import SVG assets properly so Vite can handle them during build
import loudBoxSvg from "../../assets/aiPlayground/ttHardware/tt_brand_refresh_loud_box.svg";
import n150Svg from "../../assets/aiPlayground/ttHardware/n150.svg";

interface HardwareIconProps {
  type: string;
  className?: string;
}

export function HardwareIcon({ type, className = "" }: HardwareIconProps) {
  const getIconPath = () => {
    switch (type.toLowerCase()) {
      case "loudbox":
        return loudBoxSvg;
      case "n150":
      case "n300":
        return n150Svg;
      // case "quietbox":
      //   return quietBoxSvg;
      default:
        return "";
    }
  };

  const iconPath = getIconPath();
  if (!iconPath) return null;

  return <img src={iconPath} alt={`${type} hardware icon`} className={className} />;
}
