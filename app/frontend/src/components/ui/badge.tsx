import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border border-stone-200 px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-stone-950 focus:ring-offset-2 dark:border-stone-800 dark:focus:ring-stone-300",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-green-100 text-green-900 hover:bg-green-100/80 dark:bg-green-800 dark:text-green-50 dark:hover:bg-green-800/80",
        destructive:
          "border-transparent bg-red-100 text-red-900 hover:bg-red-100/80 dark:bg-red-800 dark:text-red-50 dark:hover:bg-red-800/80",
        outline: "text-stone-950 dark:text-stone-50",
        warning:
          "border-transparent bg-yellow-100 text-yellow-900 hover:bg-yellow-100/80 dark:bg-yellow-800 dark:text-yellow-50 dark:hover:bg-yellow-800/80", // Adding the new warning variant
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
