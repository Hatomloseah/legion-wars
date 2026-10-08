import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/btn relative inline-flex items-center justify-center gap-2 whitespace-nowrap font-display text-[12px] font-semibold uppercase tracking-[0.14em] transition-[background-color,color,box-shadow,transform] duration-150 active:translate-y-px focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-lime focus-visible:ring-offset-1 focus-visible:ring-offset-carbon disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "chamfer-sm bg-lime text-carbon hover:bg-[#d8ff73] hover:shadow-[0_0_24px_rgba(198,255,61,0.45)]",
        destructive:
          "chamfer-sm bg-signal text-white hover:bg-[#ff5a50] hover:shadow-[0_0_24px_rgba(255,59,48,0.45)]",
        outline:
          "brackets border border-white/10 bg-white/[0.02] text-foreground hover:border-lime/50 hover:bg-lime/[0.06] hover:text-lime",
        secondary:
          "chamfer-sm bg-white/[0.07] text-foreground hover:bg-white/[0.12]",
        ghost: "text-muted-foreground hover:bg-white/[0.05] hover:text-foreground",
        link: "text-lime underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-5",
        sm: "h-8 px-3 text-[11px]",
        lg: "h-12 px-7 text-[13px]",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
