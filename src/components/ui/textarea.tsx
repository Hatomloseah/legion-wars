import * as React from "react";
import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[96px] w-full resize-none border border-white/10 bg-white/[0.02] px-3 py-2.5 font-body text-[15px] leading-relaxed text-foreground transition-[border-color,background-color,box-shadow] duration-150 placeholder:text-white/25 hover:border-white/20 focus-visible:border-lime/60 focus-visible:bg-lime/[0.03] focus-visible:shadow-[0_0_0_1px_rgba(198,255,61,0.25),0_0_18px_rgba(198,255,61,0.08)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 aria-[invalid=true]:border-signal/60 md:text-sm",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
