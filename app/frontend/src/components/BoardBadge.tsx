import React from "react";
import { Cpu } from "lucide-react";

interface BoardBadgeProps {
  boardName: string;
  className?: string; // for extra styling if needed
}

const BoardBadge: React.FC<BoardBadgeProps> = ({ boardName, className = "" }) => (
  <div className={`flex items-center gap-2 px-3 py-1.5 bg-TT-purple-accent/10 dark:bg-TT-purple-accent/30 rounded-full ${className}`}>
    <Cpu className="w-4 h-4 text-TT-purple-accent" />
    <span className="text-sm font-medium text-TT-purple-accent">
      {boardName} Board
    </span>
  </div>
);

export default BoardBadge; 