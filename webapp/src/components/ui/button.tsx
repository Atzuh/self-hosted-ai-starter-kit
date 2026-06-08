import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-sans font-medium tracking-tight transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-ink-strong text-paper hover:bg-ink-strong/90 active:bg-ink-strong/80 shadow-card",
        primary:
          "bg-azure text-white hover:bg-azure-bright active:bg-azure-dark shadow-card",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90",
        outline:
          "border border-line-strong bg-surface/60 text-ink-strong hover:border-azure hover:bg-wash",
        secondary:
          "bg-wash text-ink-strong hover:bg-wash-strong border border-line",
        ghost:
          "text-ink hover:bg-wash hover:text-ink-strong",
        link:
          "text-azure underline-offset-4 hover:underline",
        success:
          "bg-success text-paper hover:bg-success/90 shadow-card",
        seal:
          "bg-seal text-paper hover:bg-seal/90 shadow-card",
      },
      size: {
        default: "h-10 px-4 text-sm",
        sm: "h-8 px-3 text-[13px]",
        lg: "h-11 px-6 text-[15px]",
        xl: "h-12 px-7 text-[15px]",
        icon: "h-9 w-9",
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
