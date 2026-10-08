"use client";

import { ImagePlus, X } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface CoinImage {
  dataUrl: string;
  bytes: number;
  w: number;
  h: number;
}

const MAX_SIDE = 512;
const KEEP_GIF_BYTES = 1_000_000;

function dataUrlBytes(d: string): number {
  const b64 = d.slice(d.indexOf(",") + 1);
  return Math.floor((b64.length * 3) / 4);
}

function readAsDataUrl(f: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error("Could not read file"));
    r.readAsDataURL(f);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("That file is not a readable image"));
    img.src = src;
  });
}

/** Downscale to <= 512px and re-encode so the upload stays far below the 1.2MB server limit. */
export async function processImage(f: File): Promise<CoinImage> {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(f.type)) throw new Error("Use a PNG, JPG, WEBP or GIF image");
  if (f.size > 15_000_000) throw new Error("Image is too large (max 15MB before compression)");
  const src = await readAsDataUrl(f);
  const img = await loadImage(src);
  // small animated GIFs keep their animation
  if (f.type === "image/gif" && f.size <= KEEP_GIF_BYTES) return { dataUrl: src, bytes: f.size, w: img.naturalWidth, h: img.naturalHeight };
  const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * k));
  const h = Math.max(1, Math.round(img.naturalHeight * k));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Image processing is not supported in this browser");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);
  let out = c.toDataURL("image/png");
  if (dataUrlBytes(out) > 700_000) out = c.toDataURL("image/jpeg", 0.88);
  if (dataUrlBytes(out) > 1_100_000) out = c.toDataURL("image/jpeg", 0.7);
  return { dataUrl: out, bytes: dataUrlBytes(out), w, h };
}

export function ImageDrop({ value, onChange, required, color }: { value: CoinImage | null; onChange: (v: CoinImage | null) => void; required: boolean; color: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const take = async (f: File | undefined | null) => {
    if (!f) return;
    setErr(null);
    setBusy(true);
    try {
      onChange(await processImage(f));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not use that image");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-3 sm:grid-cols-[168px_1fr]">
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void take(e.dataTransfer.files?.[0]);
        }}
        className={cn(
          "group relative grid aspect-square w-full max-w-[168px] place-items-center overflow-hidden border border-dashed transition-colors",
          over ? "border-lime bg-lime/[0.06]" : "border-white/15 bg-white/[0.02] hover:border-lime/50",
        )}
        aria-label="Upload coin image"
      >
        {value ? (
          <img src={value.dataUrl} alt="Coin preview" className="h-full w-full object-cover" />
        ) : (
          <span className="flex flex-col items-center gap-2 px-3 text-center">
            <ImagePlus className="h-6 w-6 text-muted-foreground group-hover:text-lime" />
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{busy ? "Processing..." : "Drop or click"}</span>
          </span>
        )}
        {value && <span className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_2px_var(--c)]" style={{ "--c": `${color}55` } as React.CSSProperties} />}
      </button>
      <div className="flex flex-col justify-center gap-2">
        <div className="font-display text-[13px] font-semibold uppercase tracking-[0.12em]">
          Coin image {required ? <span className="text-signal">required</span> : <span className="text-muted-foreground">optional in demo</span>}
        </div>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Square works best. PNG, JPG, WEBP or GIF. We shrink it to 512px before uploading, and it becomes your coin icon on pump.fun.
        </p>
        {value && (
          <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            <span className="tabular">
              {value.w}x{value.h} // {(value.bytes / 1024).toFixed(0)} KB
            </span>
            <button type="button" onClick={() => onChange(null)} className="inline-flex items-center gap-1 text-signal/80 hover:text-signal">
              <X className="h-3 w-3" /> Remove
            </button>
          </div>
        )}
        {err && <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-signal">{err}</div>}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          void take(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
