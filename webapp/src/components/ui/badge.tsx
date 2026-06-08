import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] transition-colors",
  {
    variants: {
      variant: {
        default: "border-line-strong bg-surface text-ink",
        success: "border-success/30 bg-success/8 text-success",
        outline: "border-line text-ink-soft bg-transparent",
        solid: "border-transparent bg-ink-strong text-paper",
        azure: "border-azure/30 bg-azure/8 text-azure",
        seal: "border-seal/40 bg-seal/10 text-seal-deep",
        amber: "border-amber/40 bg-amber/10 text-amber",
        danger: "border-danger/40 bg-danger/8 text-danger",
        dark: "border-line-dark bg-ink-deep text-paper",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
