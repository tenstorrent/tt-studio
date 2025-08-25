// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
// SPDX-License-Identifier: Apache-2.0
// This file incorporates work covered by the following copyright and permission notice:
//  SPDX-FileCopyrightText: Copyright (c) 2023 shadcn
//  SPDX-License-Identifier: MIT


/* this shadcnn badge component has been updated to be more specific to a status badge component and
should not be used for the other badges in the application
*/

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 cursor-pointer hover:scale-105",
  {
    variants: {
      variant: {
        default:
          "border-TT-green-accent bg-[#4CAF50] text-white hover:bg-[#45A049]/80 hover:shadow-lg hover:shadow-green-500/25 dark:bg-[#388E3C] dark:text-white dark:hover:bg-[#2E7D32]/80 dark:hover:shadow-green-400/25", // Enhanced green shades with shadow
        destructive:
          "border-TT-red-accent bg-TT-red-tint2 text-white hover:bg-TT-red-tint2/80 hover:shadow-lg hover:shadow-red-500/25 dark:bg-TT-red-shade dark:text-white dark:hover:bg-TT-red-shade/80 dark:hover:shadow-red-400/25",
        outline:
          "text-TT-slate-shade dark:text-TT-slate-tint1 border-TT-slate-accent dark:border-TT-slate-tint2 hover:bg-gray-100 hover:shadow-md hover:shadow-gray-500/20 dark:hover:bg-gray-800 dark:hover:shadow-gray-400/20",
        warning:
          "border-TT-yellow-accent bg-TT-yellow-tint2 text-TT-yellow-shade hover:bg-TT-yellow-tint2/80 hover:shadow-lg hover:shadow-yellow-500/25 dark:bg-TT-yellow-accent dark:text-white dark:hover:bg-TT-yellow-accent/80 dark:hover:shadow-yellow-400/25",
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
