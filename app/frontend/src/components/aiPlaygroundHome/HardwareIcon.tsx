// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useState, useEffect } from "react";

interface HardwareIconProps {
  type: string;
  className?: string;
}

// Dynamic import paths for hardware icons
const HARDWARE_ICON_PATHS = {
  loudbox: "/src/assets/aiPlayground/ttHardware/tt_brand_refresh_loud_box.svg",
  n150: "/src/assets/aiPlayground/ttHardware/n150.svg",
  n300: "/src/assets/aiPlayground/ttHardware/n150.svg", // n300 uses same icon as n150
};

export function HardwareIcon({ type, className = "" }: HardwareIconProps) {
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadIcon = async () => {
      const iconType = type.toLowerCase();
      const iconPath =
        HARDWARE_ICON_PATHS[iconType as keyof typeof HARDWARE_ICON_PATHS];

      if (!iconPath) {
        setIsLoading(false);
        return;
      }

      // Test if the icon exists using the same approach as logo.tsx
      const testImage = new Image();

      testImage.onload = () => {
        console.log(`Found hardware icon: ${iconPath}`);
        setIconUrl(iconPath);
        setIsLoading(false);
      };

      testImage.onerror = () => {
        console.log(
          `Hardware icon not found: ${iconPath}, not displaying icon`
        );
        setIconUrl(null);
        setIsLoading(false);
      };

      // Start loading the test image
      testImage.src = iconPath;
    };

    loadIcon();
  }, [type]);

  // Don't render anything while loading or if icon not found
  if (isLoading || !iconUrl) {
    return null;
  }

  return (
    <img src={iconUrl} alt={`${type} hardware icon`} className={className} />
  );
}
