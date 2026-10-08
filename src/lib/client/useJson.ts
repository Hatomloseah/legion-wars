"use client";

import { useEffect, useState } from "react";

/** GET a JSON endpoint (optionally re-polling). `data` stays while refreshing; 404s surface as `notFound`. */
export function useJson<T>(url: string | null, pollMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (!url) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const t0 = Date.now();
        const res = await fetch(url, { cache: "no-store" });
        const j = (await res.json().catch(() => null)) as (T & { now?: number; error?: string }) | null;
        if (!alive) return;
        if (res.status === 404) {
          setNotFound(true);
          setError(j?.error ?? "Not found");
          return;
        }
        if (!res.ok || !j) throw new Error(j?.error ?? `HTTP ${res.status}`);
        if (typeof j.now === "number") setOffset(j.now - (t0 + Date.now()) / 2);
        setData(j);
        setError(null);
        setNotFound(false);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Network error");
      }
      if (alive && pollMs > 0) timer = setTimeout(load, pollMs);
    };
    void load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [url, pollMs]);

  return { data, error, notFound, offset };
}
