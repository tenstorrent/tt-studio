// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React from "react";
import { Cpu } from "lucide-react";

interface BoardBadgeProps {
  boardName: string;
  className?: string; // for extra styling if needed
  onClick?: () => void; // Make it clickable
}

const BoardBadge: React.FC<BoardBadgeProps> = ({ boardName, className = "", onClick }) => {
  // Use the n150.svg for N300 boards
  const useCustomIcon = boardName.toLowerCase().includes("n300");

  const BadgeContent = (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 bg-TT-purple-accent/10 dark:bg-TT-purple-accent/30 rounded-full transition-all duration-200 ${
        onClick
          ? "cursor-pointer hover:bg-TT-purple-accent/20 dark:hover:bg-TT-purple-accent/40 hover:scale-105"
          : ""
      } ${className}`}
    >
      {useCustomIcon ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 600 580.599"
          className="text-TT-purple-accent"
        >
          <path
            fill="currentColor"
            d="M149.98 0 0 112.554v75.035l57.16 42.904-12.692 9.525v63.924l52.944 39.728-17.704 13.291v55.101l50.146 37.646-17.786 13.371v47l93.945 70.52h187.934l93.945-70.52v-47l-17.787-13.371 50.147-37.646v-55.101L502.55 343.67l52.939-39.728v-63.924l-12.69-9.525 57.16-42.904v-75.035h.042L449.98 0ZM49.979 150.069l100-75.035h300l100 75.035-100 75.034h.042H149.98Zm400 150.114 50.23-37.726 12.69 9.526h.046l-85.178 63.918H172.234l-85.177-63.918 12.693-9.526 50.23 37.726Zm-22.212 99.601 38.12-28.577 17.703 13.285-73.443 55.107H189.854l-73.444-55.107 17.703-13.285 38.12 28.577Zm-17.58 94.922 28.686-21.518 17.787 13.371h-.041l-62.631 47H206.055l-62.631-47 17.787-13.371 28.685 21.518Z"
          />
        </svg>
      ) : (
        <Cpu className="w-4 h-4 text-TT-purple-accent" />
      )}
      <span className="text-sm font-medium text-TT-purple-accent">{boardName} Board</span>
    </div>
  );

  if (onClick) {
    return (
      <button
        onClick={onClick}
        className="border-none bg-transparent p-0 focus:outline-none focus:ring-2 focus:ring-TT-purple-accent focus:ring-opacity-50 rounded-full"
      >
        {BadgeContent}
      </button>
    );
  }

  return BadgeContent;
};

export default BoardBadge;
