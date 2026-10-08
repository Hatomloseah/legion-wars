"use client";

import Link from "next/link";
import { Crosshair } from "@/components/hud/primitives";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <PageShell>
      <div className="grid min-h-[60vh] place-items-center text-center">
        <div className="rise-in">
          <Crosshair className="mx-auto h-10 w-10 text-lime/70" />
          <div className="mt-4 font-mono text-[96px] leading-none tracking-tight text-lime text-glow sm:text-[140px]">404</div>
          <div className="mt-2 font-display text-[20px] font-black uppercase tracking-[0.2em]">Sector not found</div>
          <p className="mx-auto mt-3 max-w-[420px] text-[14px] text-muted-foreground">This coordinate is off the map. It may have been captured, renamed, or never existed.</p>
          <div className="mt-6 flex justify-center gap-2">
            <Button asChild>
              <Link href="/">Back to theater</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/battle/live">Live battle</Link>
            </Button>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
