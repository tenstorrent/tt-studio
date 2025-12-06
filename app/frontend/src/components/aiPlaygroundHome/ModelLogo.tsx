// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useState, useEffect } from "react";

interface ModelLogoProps {
  path: string;
  alt: string;
  className?: string;
}

export function ModelLogo({ path, alt, className = "" }: ModelLogoProps) {
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadIcon = async () => {
      if (!path) {
        setIsLoading(false);
        return;
      }

      const testImage = new Image();

      testImage.onload = () => {
        // console.log(`Found model logo: ${path}`);
        setIconUrl(path);
        setIsLoading(false);
      };

      testImage.onerror = () => {
        // console.log(`Model logo not found: ${path}, not displaying icon`);
        setIconUrl(null);
        setIsLoading(false);
      };

      testImage.src = path;
    };

    loadIcon();
  }, [path]);

  if (isLoading || !iconUrl) {
    return null;
  }

  return <img src={iconUrl} alt={alt} className={className} />;
}
