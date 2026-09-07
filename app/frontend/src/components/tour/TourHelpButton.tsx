// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useState } from "react";
import { HelpCircle, Compass, PlayCircle } from "lucide-react";
import { Button } from "../ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { useTour } from "../../hooks/useTour";
import { getAllTours } from "./tourRegistry";

interface TourHelpButtonProps {
  /** "icon" — icon-only button for the navbar; "full" — icon + text for the footer */
  variant?: "icon" | "full";
  className?: string;
}

export function TourHelpButton({
  variant = "icon",
  className,
}: TourHelpButtonProps) {
  const { startTour } = useTour();
  const [open, setOpen] = useState(false);
  const tours = getAllTours();

  const handleLaunchTour = (tourId: string) => {
    setOpen(false);
    startTour(tourId);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <TooltipProvider>
        <Tooltip open={open ? false : undefined}>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant={variant === "icon" ? "navbar" : "ghost"}
                size={variant === "icon" ? "icon" : "sm"}
                data-tour="tour-help"
                className={
                  variant === "full"
                    ? `border border-purple-200 hover:border-purple-300 hover:bg-purple-50 dark:border-purple-800 dark:hover:border-purple-700 dark:hover:bg-purple-950/50 text-purple-600 dark:text-purple-400 ${className ?? ""}`
                    : `relative inline-flex items-center justify-center rounded-full p-2 transition-all duration-300 ease-in-out hover:text-purple-500 ${className ?? ""}`
                }
                aria-label="Guided Tours & Help"
              >
                <HelpCircle
                  className={
                    variant === "icon"
                      ? "h-5 w-5 transition-colors duration-300 ease-in-out"
                      : "mr-2 h-4 w-4"
                  }
                />
                {variant === "full" && "Guided Tours"}
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>Guided Tours & Help</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <DropdownMenuContent align="end" className="w-64 font-sans">
        <DropdownMenuLabel className="flex items-center gap-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
          <Compass className="h-4 w-4 text-purple-500" />
          Guided Walkthroughs
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {tours.map((tour) => (
          <DropdownMenuItem
            key={tour.id}
            onClick={() => handleLaunchTour(tour.id)}
            className="flex cursor-pointer flex-col items-start gap-0.5 p-2.5 hover:bg-purple-50 dark:hover:bg-purple-950/30 focus:bg-purple-50 dark:focus:bg-purple-950/30"
          >
            <div className="flex w-full items-center justify-between">
              <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {tour.title}
              </span>
              <PlayCircle className="h-3.5 w-3.5 text-purple-500" />
            </div>
            {tour.description && (
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {tour.description}
              </span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
