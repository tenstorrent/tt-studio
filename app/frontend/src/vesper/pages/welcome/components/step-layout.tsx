// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { type ReactNode } from "react";
import { Button, type ButtonProps } from "@tenstorrent/vesper/button";
import { Typography } from "@tenstorrent/vesper/typography";
import { cn } from "@/src/lib/utils";
import { useCurrentStep, useNumSteps } from "../utils";

export function StepLayout({
  children,
  buttons,
  title,
  icon,
  subtitle,
}: {
  children?: ReactNode;
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  buttons: ButtonProps[];
}) {
  const currentStep = useCurrentStep();
  const numSteps = useNumSteps();

  return (
    <div>
      <div className="p-vesper-6 flex flex-col gap-vesper-6 items-center">
        {icon}
        <div className="flex flex-col gap gap-vesper-2">
          <Typography
            as="h1"
            variant="heading-md"
            className="text-vesper-text-primary"
          >
            {title}
          </Typography>
          {subtitle && (
            <Typography className="text-vesper-text-secondary text-center">
              {subtitle}
            </Typography>
          )}
        </div>
      </div>
      <div className="flex flex-col px-vesper-6 py-vesper-4 gap-vesper-6 items-center">
        <div className="flex gap-vesper-2">
          {Array.from({ length: numSteps }).map((_, index) => {
            const active = currentStep === index;

            return (
              <div
                key={index}
                className={cn(
                  "w-5 h-1.5 rounded-full",
                  active
                    ? "bg-vesper-alpha-stone-700"
                    : "bg-vesper-alpha-stone-300"
                )}
              />
            );
          })}
        </div>
        {children}
      </div>
      <div
        className={cn(
          "p-vesper-6 w-full flex gap-vesper-6",
          buttons.length > 1 && "justify-between"
        )}
      >
        {buttons.map((button, index) => (
          <Button
            key={index}
            variant={index < buttons.length - 1 ? "tertiary" : "primary"}
            className={cn(buttons.length === 1 && "w-full")}
            {...button}
          />
        ))}
      </div>
    </div>
  );
}
