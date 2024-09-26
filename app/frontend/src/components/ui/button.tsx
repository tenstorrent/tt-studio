import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-white transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-950 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 dark:ring-offset-stone-950 dark:focus-visible:ring-stone-300",
  {
    variants: {
      variant: {
        default:
          "bg-stone-900 text-stone-100 hover:bg-stone-800 dark:bg-stone-200 dark:text-stone-900 dark:hover:bg-stone-300 hover:shadow-[0_4px_8px_rgba(0,0,0,0.1)] dark:hover:shadow-[0_4px_8px_rgba(0,0,0,0.1)] hover:-translate-y-0.5 active:translate-y-0 active:shadow-none",
        destructive:
          "bg-red-600 text-white hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-700 hover:shadow-[0_4px_8px_rgba(239,68,68,0.2)] dark:hover:shadow-[0_4px_8px_rgba(239,68,68,0.2)] hover:-translate-y-0.5 active:translate-y-0 active:shadow-none",
        outline:
          "border border-stone-200 bg-white text-stone-900 hover:bg-stone-100 hover:text-stone-900 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-100 dark:hover:bg-stone-800 dark:hover:text-white hover:shadow-[0_4px_8px_rgba(0,0,0,0.1)] dark:hover:shadow-[0_4px_8px_rgba(255,255,255,0.1)] hover:-translate-y-0.5 active:translate-y-0 active:shadow-none",
        navbar:
          "border border-stone-200 bg-white text-stone-700 hover:text-white hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:text-white dark:hover:bg-stone-700 hover:shadow-[0px_3px] hover:shadow-gray-400 dark:hover:shadow-black active:bg-stone-100 dark:active:bg-stone-700",
        secondary:
          "bg-stone-100 text-stone-900 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-100 dark:hover:bg-stone-700 hover:shadow-[0_4px_8px_rgba(0,0,0,0.1)] dark:hover:shadow-[0_4px_8px_rgba(255,255,255,0.1)] hover:-translate-y-0.5 active:translate-y-0 active:shadow-none",
        ghost:
          "text-stone-900 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-100 dark:hover:bg-stone-800 dark:hover:text-white hover:shadow-[0_4px_8px_rgba(0,0,0,0.1)] dark:hover:shadow-[0_4px_8px_rgba(255,255,255,0.1)] hover:-translate-y-0.5 active:translate-y-0 active:shadow-none",
        link: "text-stone-900 underline-offset-4 hover:underline dark:text-stone-100 hover:text-stone-700 dark:hover:text-stone-300",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };