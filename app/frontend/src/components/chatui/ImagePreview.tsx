// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useState } from "react";
import { ImageIcon, ExternalLink } from "lucide-react";

interface ImagePreviewProps {
  url: string;
}

export function ImagePreview({ url }: ImagePreviewProps) {
  const [showPreview, setShowPreview] = useState(false);

  // Only show preview for image URLs
  const isImageUrl = url.match(/\.(jpg|jpeg|png|gif|webp)$/i);

  if (!isImageUrl)
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-yellow-300 hover:text-yellow-400 underline flex items-center gap-1"
      >
        <span>{url}</span>
        <ExternalLink className="h-4 w-4" />
      </a>
    );

  return (
    <span className="relative inline-block">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onMouseEnter={() => setShowPreview(true)}
        onMouseLeave={() => setShowPreview(false)}
        className="group flex items-center gap-1 text-yellow-300 hover:text-yellow-400"
      >
        <span className="underline underline-offset-2">{url}</span>
        <ImageIcon className="h-4 w-4 opacity-80 group-hover:opacity-100 transition-opacity" />
        <ExternalLink className="h-4 w-4 opacity-80 group-hover:opacity-100 transition-opacity" />
      </a>
      {showPreview && (
        <span className="absolute z-50 left-0 mt-2 p-2 bg-gray-800 rounded-lg shadow-xl border border-gray-700 inline-block">
          <img
            src={url || "/placeholder.svg"}
            alt="Preview"
            className="max-w-[300px] max-h-[200px] object-contain rounded"
          />
        </span>
      )}
    </span>
  );
}
