import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 border px-1.5 py-[3px] font-mono text-[10px] uppercase leading-none tracking-[0.16em] transition-colors",
  {
    variants: {
      variant: {
        default: "border-lime/60 bg-lime/10 text-lime",
        secondary: "border-white/10 bg-white/[0.04] text-muted-foreground",
        destructive: "border-signal/60 bg-signal/10 text-signal",
        outline: "border-white/20 text-foreground",
        solid: "border-lime bg-lime text-carbon",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
