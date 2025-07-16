// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { useState, useEffect } from "react";
import { motion, MotionProps } from "framer-motion";

// Fallback logo URL from GitHub
export const FALLBACK_LOGO_URL =
  "https://github.com/tenstorrent/tt-metal/raw/main/docs/source/common/images/favicon.png";

// Logo hook - this replaces your current logo imports
export const useLogo = () => {
  const [logoUrl, setLogoUrl] = useState<string>(FALLBACK_LOGO_URL);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadLogo = async () => {
      console.log("Starting logo load process...");

      // Try to load local logo by creating an image element to test if it exists
      const testImage = new Image();
      const localLogoPath = "/src/assets/logo/tt_logo.svg";

      testImage.onload = () => {
        console.log("Found local logo: tt_logo.svg");
        setLogoUrl(localLogoPath);
        setIsLoading(false);
      };

      testImage.onerror = () => {
        console.log("Local logo not found, using GitHub fallback");
        setLogoUrl(FALLBACK_LOGO_URL);
        setIsLoading(false);
      };

      // Start loading the test image
      testImage.src = localLogoPath;
    };

    loadLogo();
  }, []);

  return { logoUrl, isLoading };
};

// Standard logo component
interface LogoProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  size?: "small" | "medium" | "large";
}

export const Logo: React.FC<LogoProps> = ({
  className = "",
  size = "medium",
  alt = "Tenstorrent Logo",
  ...props
}) => {
  const { logoUrl, isLoading } = useLogo();

  const sizeClasses = {
    small: "w-8 h-8",
    medium: "w-12 h-12",
    large: "w-16 h-16",
  };

  const handleError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const target = e.currentTarget;
    if (target.src !== FALLBACK_LOGO_URL) {
      console.log("Image failed to load, switching to GitHub fallback");
      target.src = FALLBACK_LOGO_URL;
    } else {
      console.log("GitHub fallback also failed, hiding image");
      target.style.display = "none";
    }
  };

  if (isLoading) {
    return (
      <div className={`${sizeClasses[size]} ${className} bg-gray-200 animate-pulse rounded`} />
    );
  }

  return (
    <img
      src={logoUrl}
      alt={alt}
      className={`${sizeClasses[size]} ${className}`}
      onError={handleError}
      {...props}
    />
  );
};

// Motion logo component - for your animated usage
interface MotionLogoProps extends Omit<MotionProps, "children"> {
  size?: "small" | "medium" | "large";
  animation?: "hover-spin" | "pulse" | "bounce" | "custom";
  className?: string;
  alt?: string;
}

export const MotionLogo: React.FC<MotionLogoProps> = ({
  className = "",
  size = "medium",
  alt = "Tenstorrent Logo",
  animation = "custom",
  ...props
}) => {
  const { logoUrl, isLoading } = useLogo();

  const sizeClasses = {
    small: "w-8 h-8",
    medium: "w-12 h-12",
    large: "w-16 h-16",
  };

  const animationPresets = {
    "hover-spin": {
      whileHover: { scale: 1.1, rotate: 360 },
      transition: { type: "spring", stiffness: 300, damping: 10 },
    },
    pulse: {
      animate: { scale: [1, 1.05, 1] },
      transition: { repeat: Infinity, duration: 2 },
    },
    bounce: {
      whileHover: { y: -5 },
      transition: { type: "spring", stiffness: 400, damping: 10 },
    },
    custom: {},
  };

  const handleError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const target = e.currentTarget;
    if (target.src !== FALLBACK_LOGO_URL) {
      console.log("Image failed to load, switching to GitHub fallback");
      target.src = FALLBACK_LOGO_URL;
    } else {
      console.log("GitHub fallback also failed, hiding image");
      target.style.display = "none";
    }
  };

  if (isLoading) {
    return (
      <div className={`${sizeClasses[size]} ${className} bg-gray-200 animate-pulse rounded`} />
    );
  }

  // Merge preset animations with custom props
  const motionProps = animation === "custom" ? props : { ...animationPresets[animation], ...props };

  return (
    <motion.img
      src={logoUrl}
      alt={alt}
      className={`${sizeClasses[size]} ${className}`}
      onError={handleError}
      {...motionProps}
    />
  );
};

// Backward compatibility - direct URL export
export const ttLogo = FALLBACK_LOGO_URL;

// Logo configuration for advanced usage
export const logoConfig = {
  fallbackUrl: FALLBACK_LOGO_URL,
  localPath: "/src/assets/logo/tt_logo.svg",

  async getLogoUrl(): Promise<string> {
    return new Promise((resolve) => {
      const testImage = new Image();
      const localLogoPath = "/src/assets/logo/tt_logo.svg";

      testImage.onload = () => {
        resolve(localLogoPath);
      };

      testImage.onerror = () => {
        console.warn("Local logo not found, using GitHub fallback");
        resolve(FALLBACK_LOGO_URL);
      };

      testImage.src = localLogoPath;
    });
  },
};

/* 
USAGE EXAMPLES:

1. Simple usage with fallback:
   <Logo size="medium" />

2. Animated logo with hover effect:
   <MotionLogo size="small" animation="hover-spin" />

3. Custom usage with the hook:
   const { logoUrl, isLoading } = useLogo();
   {!isLoading && (
     <img src={logoUrl} alt="Logo" className="w-8 h-8" />
   )}

4. Direct URL (for backward compatibility):
   <img src={ttLogo} alt="Logo" />

The component will:
- First try to load tt_logo.svg from /src/assets/logo/
- If that fails, automatically fall back to the GitHub URL
- If GitHub URL also fails, hide the image gracefully
- Show a loading skeleton while determining which logo to use
*/
