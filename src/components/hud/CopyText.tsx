"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

export function CopyText({ value, display, className }: { value: string; display?: string; className?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      onClick={() =>
        void navigator.clipboard?.writeText(value).then(() => {
          setOk(true);
          setTimeout(() => setOk(false), 1300);
        })
      }
      className={cn("inline-flex items-center gap-1.5 font-mono text-[11px] tracking-[0.04em] text-foreground/80 transition-colors hover:text-lime", className)}
      title="Copy"
    >
      <span className="truncate">{display ?? value}</span>
      {ok ? <Check className="h-3 w-3 shrink-0 text-lime" /> : <Copy className="h-3 w-3 shrink-0 opacity-60" />}
    </button>
  );
}

export const hex8 = (n: number) => (n >>> 0).toString(16).toUpperCase().padStart(8, "0");
