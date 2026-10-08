import { X_HANDLE, X_URL } from "@/lib/social";
import { cn } from "@/lib/utils";

export function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("h-3.5 w-3.5 fill-current", className)}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

/** Square X button for the header, styled like the round timer next to it. */
export function XHeaderButton({ className }: { className?: string }) {
  if (!X_URL) return null;
  return (
    <a
      href={X_URL}
      target="_blank"
      rel="noreferrer"
      aria-label={`LEGION on X (@${X_HANDLE})`}
      title={`@${X_HANDLE} on X`}
      className={cn(
        "grid h-[30px] w-[30px] shrink-0 place-items-center border border-white/10 text-muted-foreground transition-colors hover:border-lime/50 hover:text-lime",
        className,
      )}
    >
      <XIcon />
    </a>
  );
}

/** Text link for footers and copy. */
export function XTextLink({ className, label }: { className?: string; label?: string }) {
  if (!X_URL) return null;
  return (
    <a href={X_URL} target="_blank" rel="noreferrer" className={cn("inline-flex items-center gap-1.5 hover:text-lime", className)}>
      <XIcon className="h-3 w-3" />
      {label ?? `@${X_HANDLE}`}
    </a>
  );
}
