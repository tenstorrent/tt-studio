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
          "bg-stone-900 text-stone-300 hover:text-white hover:bg-stone-900/90 dark:bg-stone-700 dark:text-stone-300 dark:hover:text-white dark:hover:bg-stone-600 hover:shadow-[0px_3px] hover:shadow-gray-400 dark:hover:shadow-black active:bg-stone-800 dark:active:bg-stone-500",
        destructive:
          "bg-red-500 text-stone-300 hover:text-white hover:bg-red-500/90 dark:bg-red-700 dark:text-stone-300 dark:hover:text-white dark:hover:bg-red-600 hover:shadow-[0px_3px] hover:shadow-red-400 dark:hover:shadow-black active:bg-red-400 dark:active:bg-red-500",
        outline:
          "border border-stone-200 bg-white text-stone-700 hover:text-white hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:text-white dark:hover:bg-stone-700 hover:shadow-[0px_3px] hover:shadow-gray-400 dark:hover:shadow-black active:bg-stone-100 dark:active:bg-stone-700",
        secondary:
          "bg-stone-100 text-stone-700 hover:text-white hover:bg-stone-100/80 dark:bg-stone-700 dark:text-stone-300 dark:hover:text-white dark:hover:bg-stone-600 hover:shadow-[0px_3px] hover:shadow-gray-400 dark:hover:shadow-black active:bg-stone-200 dark:active:bg-stone-600",
        ghost:
          "text-stone-700 hover:text-white hover:bg-stone-100 dark:text-stone-300 dark:hover:text-white dark:hover:bg-stone-700 hover:shadow-[0px_3px] hover:shadow-gray-400 dark:hover:shadow-black active:bg-stone-200 dark:active:bg-stone-700",
        link: "text-stone-700 hover:text-white underline-offset-4 hover:underline dark:text-stone-300 dark:hover:text-white",
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
