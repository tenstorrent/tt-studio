import { useState } from "react";

interface ImageWithFallbackProps {
  src: string | undefined;
  fallbackSrc?: string;
  alt?: string;
  className?: string;
  onError?: () => void;
}

export function ImageWithFallback({
  src,
  fallbackSrc = "/placeholder.svg", // Use placeholder as default fallback
  alt = "",
  className = "",
  onError,
}: ImageWithFallbackProps) {
  const [imgSrc, setImgSrc] = useState<string | undefined>(src);

  const handleError = () => {
    setImgSrc(fallbackSrc);
    onError?.();
  };

  return (
    <img
      src={imgSrc || fallbackSrc}
      alt={alt}
      className={className}
      onError={handleError}
    />
  );
}
