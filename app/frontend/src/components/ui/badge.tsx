//  SPDX-FileCopyrightText: Copyright (c) 2023 shadcn
//  SPDX-License-Identifier: MIT

/* this shadcnn badge component has been updated to be more specific to a status badge component and
should not be used for the other badges in the application
*/

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-TT-green-accent bg-[#4CAF50] text-white hover:bg-[#45A049]/80 dark:bg-[#388E3C] dark:text-white dark:hover:bg-[#2E7D32]/80", // Updated green shades
        destructive:
          "border-TT-red-accent bg-TT-red-tint2 text-white hover:bg-TT-red-tint2/80 dark:bg-TT-red-shade dark:text-white dark:hover:bg-TT-red-shade/80",
        outline:
          "text-TT-slate-shade dark:text-TT-slate-tint1 border-TT-slate-accent dark:border-TT-slate-tint2",
        warning:
          "border-TT-yellow-accent bg-TT-yellow-tint2 text-TT-yellow-shade hover:bg-TT-yellow-tint2/80 dark:bg-TT-yellow-accent dark:text-white dark:hover:bg-TT-yellow-accent/80",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  statusColor?: string;
}

function Badge({ className, variant, statusColor, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props}>
      <span className={`w-2 h-2 ${statusColor} rounded-full mr-2`}></span>
      {props.children}
    </div>
  );
}

export { Badge, badgeVariants };
