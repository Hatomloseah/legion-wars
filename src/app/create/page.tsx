"use client";

import { AlertTriangle, Check, ExternalLink, Loader2, RotateCcw, Sparkles, Wand2 } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { ImageDrop, type CoinImage } from "@/components/create/ImageDrop";
import { LegionPreview } from "@/components/create/LegionPreview";
import { DoctrineBars } from "@/components/hud/DoctrineBars";
import { DESIGNS, DroneGlyph } from "@/components/hud/DroneGlyph";
import { SwarmDot } from "@/components/hud/primitives";
import { PageShell, PageTitle } from "@/components/PageShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useGameState, useServerNow } from "@/lib/client/useGameState";
import { authFetch, useWallet } from "@/lib/client/wallet";
import { baseDrones, dronesForBuy } from "@/lib/game/drones";
import { ABILITIES, TACTICS_MAX, TACTICS_MIN, TACTIC_EXAMPLES, cleanTactics } from "@/lib/game/tactics";
import type { CompileResponse, LaunchDraft, LaunchPrepareResponse, PublicSwarm } from "@/lib/game/types";
import { ABILITY_INFO, type AbilityKind, type DroneDesign } from "@/lib/sim/types";
import { cn } from "@/lib/utils";

interface Draft {
  name: string;
  ticker: string;
  description: string;
  twitter: string;
  telegram: string;
  color: string;
  design: DroneDesign;
  tactics: string;
  devBuySol: number;
  ability: AbilityKind | null;
}

const EMPTY: Draft = {
  name: "",
  ticker: "",
  description: "",
  twitter: "",
  telegram: "",
  color: "#FF7A1A",
  design: "delta",
  tactics: "",
  devBuySol: 0.1,
  ability: null,
};

const RESERVED = ["LEGION", "SOL", "USDC", "USDT", "PUMP"];
const PALETTE = ["#C6FF3D", "#7CFF6B", "#22E5C0", "#FFE14D", "#FFB020", "#FF7A1A", "#FF3B30", "#FF3DA5", "#FF8FB1", "#E9E6DA", "#A9B8A0", "#FFFFFF"];
const DEV_PRESETS = [0, 0.1, 0.5, 1, 2];
const DEV_BUY_MAX = 5;
const DRAFT_KEY = "legion_create_draft";

type Compiled = CompileResponse & { text: string };
type Phase = "idle" | "preparing" | "review" | "signing" | "confirming";

function rgb(h: string): [number, number, number] {
  const n = Number.parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function colorDist(a: string, b: string): number {
  const x = rgb(a);
  const y = rgb(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}
const isHex = (c: string) => /^#[0-9a-fA-F]{6}$/.test(c);
const urlOk = (u: string) => !u.trim() || /^https:\/\/[^\s]+\.[^\s]+$/.test(u.trim());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errText = (e: unknown, d: string) => (e instanceof Error && e.message ? e.message : d);

function Step({ n, title, done, hint, children, delay = 0 }: { n: string; title: string; done: boolean; hint?: ReactNode; children: ReactNode; delay?: number }) {
  return (
    <section className="panel brackets rise-in" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-2.5">
        <div className="flex items-center gap-3">
          <span className={cn("grid h-6 w-6 place-items-center font-mono text-[11px]", done ? "bg-lime text-carbon" : "border border-white/15 text-muted-foreground")}>
            {done ? <Check className="h-3.5 w-3.5" /> : n}
          </span>
          <h2 className="font-display text-[13px] font-bold uppercase tracking-[0.16em]">{title}</h2>
        </div>
        {hint && <span className="label hidden sm:inline">{hint}</span>}
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

function Field({ label, htmlFor, children, note, error }: { label: string; htmlFor?: string; children: ReactNode; note?: ReactNode; error?: string | null }) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={htmlFor}>{label}</Label>
        {note && <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{note}</span>}
      </div>
      {children}
      {error && <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-signal">{error}</span>}
    </div>
  );
}

export default function CreatePage() {
  const { state, offset } = useGameState(15000);
  const now = useServerNow(offset, 1000);
  const { wallet, session, setPickerOpen, signAndSend, refresh } = useWallet();

  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [image, setImage] = useState<CoinImage | null>(null);
  const [compiled, setCompiled] = useState<Compiled | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [compileErr, setCompileErr] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<{ mint: string; tx: string; feeSol: number; at: number } | null>(null);
  const [sent, setSent] = useState<{ mint: string; signature: string } | null>(null);
  const [done, setDone] = useState<{ legion: PublicSwarm; mint?: string; signature?: string } | null>(null);

  // draft persistence (image + compile token are not stored)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) setDraft({ ...EMPTY, ...(JSON.parse(raw) as Partial<Draft>) });
    } catch {
      // ignore
    }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // ignore
    }
  }, [draft, loaded]);

  const set = useCallback(<K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v })), []);

  const demoMode = session?.demo ?? state?.demo ?? false;
  const swarms = useMemo(() => state?.swarms ?? [], [state]);
  const ticker = draft.ticker.replace(/^\$/, "").trim().toUpperCase();
  const name = draft.name.replace(/\s+/g, " ").trim();
  const tacticsClean = cleanTactics(draft.tactics);
  const fresh = !!compiled && compiled.text === tacticsClean;
  const ability: AbilityKind | null = draft.ability ?? (fresh ? compiled.ability : null);

  const tickerTaken = ticker.length >= 2 && (RESERVED.includes(ticker) || swarms.some((s) => s.ticker === ticker));
  const tickerFmt = /^[A-Z0-9]{2,10}$/.test(ticker);
  const clash = useMemo(() => {
    if (!isHex(draft.color)) return null;
    let best: PublicSwarm | null = null;
    let bd = Number.POSITIVE_INFINITY;
    for (const s of swarms) {
      if (!isHex(s.color)) continue;
      const d = colorDist(draft.color, s.color);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best && bd < 70 ? best : null;
  }, [draft.color, swarms]);

  const checks: [string, boolean][] = [
    ["Name (2-28 characters)", name.length >= 2 && name.length <= 28],
    ["Ticker available", tickerFmt && !tickerTaken],
    ["Color + drone design", isHex(draft.color)],
    [demoMode ? "Coin image (optional in demo)" : "Coin image", demoMode || !!image],
    ["Tactics compiled", fresh],
    ["Social links are https", urlOk(draft.twitter) && urlOk(draft.telegram)],
  ];
  const ready = checks.every(([, ok]) => ok);
  const busy = phase !== "idle" && phase !== "review";

  const compile = async () => {
    if (tacticsClean.length < TACTICS_MIN || compiling) return;
    setCompiling(true);
    setCompileErr(null);
    try {
      const res = await authFetch("/api/tactics/compile", { method: "POST", body: JSON.stringify({ tactics: tacticsClean }) });
      const j = (await res.json()) as (CompileResponse & { ok: true }) | { ok: false; error: string };
      if (!res.ok || !j.ok) throw new Error(("error" in j && j.error) || "Could not compile tactics");
      setCompiled({ ...j, text: tacticsClean });
    } catch (e) {
      setCompileErr(errText(e, "Could not compile tactics"));
    } finally {
      setCompiling(false);
    }
  };

  const finish = async (d: { legion: PublicSwarm; mint?: string; signature?: string }) => {
    await refresh();
    setDone(d);
    setPhase("idle");
    setPrepared(null);
    setSent(null);
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      // ignore
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const launch = async () => {
    if (!wallet) {
      setPickerOpen(true);
      return;
    }
    if (!ready || !compiled) return;
    setError(null);
    setPhase("preparing");
    const body: LaunchDraft = {
      name,
      ticker,
      color: draft.color.toUpperCase(),
      design: draft.design,
      description: draft.description.trim(),
      tactics: tacticsClean,
      compileToken: compiled.token,
      ability: ability ?? compiled.ability,
      devBuySol: draft.devBuySol,
      image: image?.dataUrl,
      twitter: draft.twitter.trim() || undefined,
      telegram: draft.telegram.trim() || undefined,
    };
    try {
      const res = await authFetch("/api/legions/launch", { method: "POST", body: JSON.stringify(body) });
      const j = (await res.json()) as LaunchPrepareResponse;
      if (res.status === 401) {
        setPhase("idle");
        setError("Your session expired. Connect your wallet again.");
        setPickerOpen(true);
        return;
      }
      if (!j.ok) throw new Error(j.error || "Launch failed");
      if (j.mode === "demo") {
        await finish({ legion: j.legion });
        return;
      }
      setPrepared({ mint: j.mint, tx: j.tx, feeSol: j.feeSol, at: Date.now() });
      setPhase("review");
    } catch (e) {
      setError(errText(e, "Launch failed"));
      setPhase("idle");
    }
  };

  const confirm = async (mint: string, signature: string) => {
    setPhase("confirming");
    setError(null);
    for (let i = 0; i < 48; i++) {
      try {
        const res = await authFetch("/api/legions/confirm", { method: "POST", body: JSON.stringify({ mint, signature }) });
        const j = (await res.json()) as { ok: boolean; legion?: PublicSwarm; pending?: boolean; error?: string };
        if (res.ok && j.ok && j.legion) {
          await finish({ legion: j.legion, mint, signature });
          return;
        }
        if (res.status !== 202) {
          setError(j.error || "Launch could not be confirmed");
          setPhase("review");
          return;
        }
      } catch {
        // network blip: keep polling
      }
      await sleep(2500);
    }
    setError("Still waiting for Solana. Your transaction may still land. Press 'Check again' in a moment.");
    setPhase("review");
  };

  const sign = async () => {
    if (!prepared) return;
    setError(null);
    setPhase("signing");
    let signature: string;
    try {
      signature = await signAndSend(prepared.tx);
    } catch (e) {
      const m = errText(e, "Wallet rejected the transaction");
      setError(/blockhash|expired/i.test(m) ? "The transaction expired. Prepare it again." : m);
      setPhase("review");
      return;
    }
    setSent({ mint: prepared.mint, signature });
    await confirm(prepared.mint, signature);
  };

  const closeReview = (open: boolean) => {
    if (open || phase === "signing" || phase === "confirming") return;
    if (!sent) setPrepared(null);
    setPhase("idle");
  };

  const reset = () => {
    setDraft(EMPTY);
    setImage(null);
    setCompiled(null);
    setError(null);
  };

  // ------------------------------------------------------------------ success
  if (done) {
    const l = done.legion;
    return (
      <PageShell state={state} now={now}>
        <section className="mx-auto max-w-[760px] py-14 text-center">
          <div className="rise-in">
            <div className="label text-lime">Launch confirmed</div>
            <div className="mx-auto mt-6 grid h-28 w-28 place-items-center border border-white/10 bg-carbon" style={{ boxShadow: `0 0 80px ${l.color}44` }}>
              {l.image ? <img src={l.image} alt="" className="h-full w-full object-cover" /> : <DroneGlyph design={l.design} color={l.color} className="h-20 w-20" />}
            </div>
            <h1 className="mt-6 font-display text-[40px] font-black uppercase leading-none tracking-[0.06em] sm:text-[56px]">Legion raised</h1>
            <div className="mt-3 font-display text-[22px] font-bold uppercase tracking-[0.1em]" style={{ color: l.color, textShadow: `0 0 24px ${l.color}66` }}>
              {l.name} <span className="font-mono text-[15px]">${l.ticker}</span>
            </div>
            <p className="mx-auto mt-4 max-w-[520px] text-[15px] leading-relaxed text-muted-foreground">
              Your legion holds {l.territory} sector{l.territory === 1 ? "" : "s"} and joins matchmaking from the next round. Every buy of ${l.ticker} during a battle
              drops fresh drones into the fight.
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-2">
              <Button asChild size="lg">
                <Link href={`/legion/${l.id}`}>View legion</Link>
              </Button>
              {done.mint && (
                <Button asChild size="lg" variant="outline">
                  <a href={`https://pump.fun/coin/${done.mint}`} target="_blank" rel="noreferrer">
                    Trade on pump.fun <ExternalLink />
                  </a>
                </Button>
              )}
              <Button asChild size="lg" variant="outline">
                <Link href="/battle/live">Watch battles</Link>
              </Button>
            </div>
            {done.signature && (
              <a
                href={`https://solscan.io/tx/${done.signature}`}
                target="_blank"
                rel="noreferrer"
                className="mt-5 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground hover:text-lime"
              >
                View transaction <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </section>
      </PageShell>
    );
  }

  // ------------------------------------------------------------------ form
  return (
    <PageShell state={state} now={now}>
      <PageTitle
        code="C"
        kicker="Raise a legion"
        title={
          <>
            Raise a <span className="text-lime text-glow">legion.</span>
          </>
        }
        lede="Your legion launches as its own pump.fun coin. Every buy drops drones into its live battles, every sell blows them up. Write your tactics in plain English and the AI turns them into battle doctrine."
        right={
          <div className="flex flex-col items-start gap-2 lg:items-end">
            {demoMode && <Badge variant="solid">Demo mode // launches are simulated</Badge>}
            <button type="button" onClick={reset} className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:text-signal">
              <RotateCcw className="h-3 w-3" /> Reset form
            </button>
          </div>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid gap-5">
          {/* 01 identity */}
          <Step n="01" title="Identity" done={checks[0][1] && checks[1][1]} hint="Name + ticker are permanent">
            <div className="grid gap-4 sm:grid-cols-[1fr_190px]">
              <Field label="Legion name" htmlFor="name" note={`${name.length}/28`}>
                <Input id="name" value={draft.name} maxLength={28} placeholder="Iron Hornets" onChange={(e) => set("name", e.target.value)} />
              </Field>
              <Field
                label="Ticker"
                htmlFor="ticker"
                error={ticker && !tickerFmt ? "2-10 letters or digits" : tickerTaken ? `$${ticker} is taken` : null}
                note={ticker && tickerFmt && !tickerTaken ? <span className="text-lime">Available</span> : undefined}
              >
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-muted-foreground">$</span>
                  <Input
                    id="ticker"
                    value={ticker}
                    maxLength={10}
                    placeholder="HRNT"
                    aria-invalid={!!ticker && (!tickerFmt || tickerTaken)}
                    className="pl-6 font-mono uppercase tracking-[0.12em]"
                    onChange={(e) => set("ticker", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                  />
                </div>
              </Field>
            </div>
            <div className="mt-4">
              <Field label="One-line legend" htmlFor="desc" note={`${draft.description.length}/200`}>
                <Textarea
                  id="desc"
                  value={draft.description}
                  maxLength={200}
                  className="min-h-[72px]"
                  placeholder="A swarm of brass interceptors out of the Atacama. They never stop moving."
                  onChange={(e) => set("description", e.target.value)}
                />
              </Field>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="X / Twitter" htmlFor="tw" note="optional" error={!urlOk(draft.twitter) ? "Must start with https://" : null}>
                <Input id="tw" value={draft.twitter} placeholder="https://x.com/yourlegion" onChange={(e) => set("twitter", e.target.value)} />
              </Field>
              <Field label="Telegram" htmlFor="tg" note="optional" error={!urlOk(draft.telegram) ? "Must start with https://" : null}>
                <Input id="tg" value={draft.telegram} placeholder="https://t.me/yourlegion" onChange={(e) => set("telegram", e.target.value)} />
              </Field>
            </div>
          </Step>

          {/* 02 colors + drone */}
          <Step n="02" title="Colors + drone" done={checks[2][1]} hint="How your legion looks on the map" delay={60}>
            <Label>Legion color</Label>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Color ${c}`}
                  onClick={() => set("color", c)}
                  className={cn("h-8 w-8 border transition-transform hover:scale-110", draft.color.toUpperCase() === c ? "border-white" : "border-white/10")}
                  style={{ background: c, boxShadow: draft.color.toUpperCase() === c ? `0 0 16px ${c}` : undefined }}
                />
              ))}
              <label className="relative flex h-8 items-center gap-2 border border-white/10 pl-1 pr-2">
                <input
                  type="color"
                  value={isHex(draft.color) ? draft.color : "#ff7a1a"}
                  onChange={(e) => set("color", e.target.value.toUpperCase())}
                  className="h-6 w-6 cursor-pointer border-0 bg-transparent p-0"
                  aria-label="Custom color"
                />
                <input
                  value={draft.color}
                  onChange={(e) => set("color", e.target.value.startsWith("#") ? e.target.value.slice(0, 7) : `#${e.target.value.slice(0, 6)}`)}
                  className="w-[72px] bg-transparent font-mono text-[12px] uppercase tracking-[0.08em] outline-none"
                  aria-label="Hex color"
                />
              </label>
            </div>
            {clash && (
              <div className="mt-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[#FFB020]">
                <AlertTriangle className="h-3 w-3" /> Very close to <SwarmDot color={clash.color} size={7} /> {clash.name}. Pick something more distinct to stand out on the map.
              </div>
            )}
            {!isHex(draft.color) && <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-signal">Use a 6-digit hex color like #FF7A1A</div>}

            <Label className="mt-5 block">Drone design</Label>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {DESIGNS.map((d) => {
                const on = draft.design === d.id;
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => set("design", d.id)}
                    className={cn(
                      "group flex flex-col items-center gap-2 border px-2 py-3 transition-[border-color,background-color]",
                      on ? "border-lime/70 bg-lime/[0.05]" : "border-white/[0.08] bg-white/[0.015] hover:border-white/25",
                    )}
                  >
                    <DroneGlyph design={d.id} color={isHex(draft.color) ? draft.color : "#FF7A1A"} glow={on} className="h-14 w-14" />
                    <span className={cn("font-display text-[12px] font-bold uppercase tracking-[0.14em]", on ? "text-lime" : "text-foreground/80")}>{d.name}</span>
                    <span className="text-center text-[11px] leading-tight text-muted-foreground">{d.blurb}</span>
                  </button>
                );
              })}
            </div>
          </Step>

          {/* 03 image */}
          <Step n="03" title="Coin image" done={!!image} hint={demoMode ? "Optional in demo" : "Required for pump.fun"} delay={120}>
            <ImageDrop value={image} onChange={setImage} required={!demoMode} color={isHex(draft.color) ? draft.color : "#FF7A1A"} />
          </Step>

          {/* 04 tactics */}
          <Step n="04" title="Tactics" done={fresh} hint="Plain English, AI compiled" delay={180}>
            <Field
              label="Battle doctrine"
              htmlFor="tactics"
              note={
                <span className={cn(tacticsClean.length > 0 && tacticsClean.length < TACTICS_MIN && "text-signal")}>
                  {tacticsClean.length}/{TACTICS_MAX}
                </span>
              }
            >
              <Textarea
                id="tactics"
                value={draft.tactics}
                maxLength={TACTICS_MAX + 40}
                className="min-h-[112px]"
                placeholder="How should your drones fight? Formation, who to target, when to retreat, what to do on contact..."
                onChange={(e) => set("tactics", e.target.value)}
              />
            </Field>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {TACTIC_EXAMPLES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => set("tactics", t)}
                  className="max-w-full truncate border border-white/[0.08] px-2 py-1 text-left text-[12px] text-muted-foreground transition-colors hover:border-lime/40 hover:text-foreground"
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button onClick={compile} disabled={tacticsClean.length < TACTICS_MIN || compiling} variant={fresh ? "outline" : "default"}>
                {compiling ? <Loader2 className="animate-spin" /> : <Wand2 />}
                {compiling ? "Compiling..." : fresh ? "Recompile" : "Compile tactics"}
              </Button>
              {compiled && !fresh && <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#FFB020]">Tactics changed. Recompile before launch.</span>}
              {compileErr && <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-signal">{compileErr}</span>}
            </div>

            {compiled && (
              <div className={cn("mt-5 border border-white/[0.07] bg-carbon/40 p-4 transition-opacity", !fresh && "opacity-40")}>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Badge variant={compiled.source === "llm" ? "default" : "secondary"}>
                    <Sparkles className="h-3 w-3" /> {compiled.source === "llm" ? "AI compiled" : "Keyword compiler"}
                  </Badge>
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Hash {compiled.tacticsHash.slice(0, 12)}</span>
                </div>
                <p className="mb-4 border-l-2 border-lime pl-3 text-[14px] leading-snug">{compiled.summary}</p>
                <DoctrineBars config={compiled.config} color={isHex(draft.color) ? draft.color : "#C6FF3D"} />
              </div>
            )}

            <div className="mt-5">
              <div className="flex items-center justify-between">
                <Label>Ability</Label>
                {draft.ability && (
                  <button type="button" onClick={() => set("ability", null)} className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:text-lime">
                    Use compiled pick
                  </button>
                )}
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {ABILITIES.map((a) => {
                  const info = ABILITY_INFO[a];
                  const on = ability === a;
                  return (
                    <button
                      key={a}
                      type="button"
                      onClick={() => set("ability", a)}
                      className={cn(
                        "border px-3 py-2.5 text-left transition-[border-color,background-color]",
                        on ? "border-lime/70 bg-lime/[0.05]" : "border-white/[0.08] bg-white/[0.015] hover:border-white/25",
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className={cn("font-display text-[12px] font-bold uppercase tracking-[0.14em]", on && "text-lime")}>{info.name}</span>
                        <span className="font-mono text-[10px] text-muted-foreground">{info.cooldownS}s CD</span>
                      </div>
                      <p className="mt-1 text-[12px] leading-snug text-muted-foreground">{info.desc}</p>
                      {!draft.ability && fresh && compiled.ability === a && <div className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-lime/80">Compiled pick</div>}
                    </button>
                  );
                })}
              </div>
            </div>
          </Step>

          {/* 05 launch */}
          <Step n="05" title="Launch" done={false} hint={demoMode ? "Simulated launch" : "Real pump.fun coin"} delay={240}>
            <Field label="Your first buy (dev buy)" note={`max ${DEV_BUY_MAX} SOL`}>
              <div className="flex flex-wrap items-center gap-2">
                {DEV_PRESETS.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => set("devBuySol", v)}
                    className={cn(
                      "h-9 min-w-[56px] border px-3 font-mono text-[12px] tabular transition-colors",
                      draft.devBuySol === v ? "border-lime/70 bg-lime/[0.08] text-lime" : "border-white/10 text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {v} SOL
                  </button>
                ))}
                <Input
                  type="number"
                  min={0}
                  max={DEV_BUY_MAX}
                  step={0.05}
                  value={draft.devBuySol}
                  onChange={(e) => set("devBuySol", Math.max(0, Math.min(DEV_BUY_MAX, Number(e.target.value) || 0)))}
                  className="h-9 w-[100px] font-mono"
                  aria-label="Custom dev buy in SOL"
                />
              </div>
            </Field>
            <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
              Your first buy happens in the same transaction as the launch, so you hold the first bag.
              {!demoMode && " pump.fun requires a tiny minimum buy (0.001 SOL) if you choose 0."}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-px border border-white/[0.06] bg-white/[0.06] sm:grid-cols-3">
              {[
                ["Starting base drones", baseDrones(28 + draft.devBuySol)],
                ["Drones per 1 SOL buy", `+${dronesForBuy(1)}`],
                ["Joins battles", "Next round"],
              ].map(([k, v]) => (
                <div key={String(k)} className="bg-[#0b0e0d] px-3 py-2.5">
                  <div className="label text-[9px]">{k}</div>
                  <div className="mt-1 font-mono text-[16px] tabular">{v}</div>
                </div>
              ))}
            </div>

            <ul className="mt-5 grid gap-1.5 sm:grid-cols-2">
              {checks.map(([label, ok]) => (
                <li key={label} className={cn("flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.1em]", ok ? "text-foreground/80" : "text-muted-foreground")}>
                  <span className={cn("grid h-4 w-4 place-items-center border", ok ? "border-lime bg-lime text-carbon" : "border-white/20")}>{ok && <Check className="h-3 w-3" />}</span>
                  {label}
                </li>
              ))}
            </ul>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              {!wallet ? (
                <Button size="lg" onClick={() => setPickerOpen(true)}>
                  Connect wallet to launch
                </Button>
              ) : (
                <Button size="lg" onClick={launch} disabled={!ready || busy}>
                  {phase === "preparing" ? <Loader2 className="animate-spin" /> : null}
                  {phase === "preparing" ? (demoMode ? "Raising legion..." : "Preparing launch...") : `Launch $${ticker || "TICKER"}`}
                </Button>
              )}
              {phase === "preparing" && !demoMode && (
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground blink">Uploading to IPFS + building pump.fun transaction</span>
              )}
            </div>
            {error && phase === "idle" && (
              <div className="mt-4 border border-signal/40 bg-signal/[0.07] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.1em] text-signal">{error}</div>
            )}
          </Step>
        </div>

        <aside className="lg:sticky lg:top-[72px] lg:self-start">
          <LegionPreview
            name={name}
            ticker={ticker}
            description={draft.description}
            color={isHex(draft.color) ? draft.color : "#FF7A1A"}
            design={draft.design}
            image={image?.dataUrl ?? null}
            config={fresh ? compiled.config : null}
            ability={ability}
            summary={fresh ? compiled.summary : null}
            devBuySol={draft.devBuySol}
          />
          <p className="mt-3 px-1 font-mono text-[10px] uppercase leading-relaxed tracking-[0.12em] text-muted-foreground">
            Your home sector + its neighbors are assigned on launch. House legions are AI garrisons. Real legions are backed by their holders.
          </p>
        </aside>
      </div>

      {/* live launch review */}
      <Dialog open={!!prepared && (phase === "review" || phase === "signing" || phase === "confirming")} onOpenChange={closeReview}>
        <DialogContent>
          <DialogHeader>
            <div className="label text-lime/80">Final check</div>
            <DialogTitle>Launch ${ticker} on pump.fun</DialogTitle>
            <DialogDescription>This creates a real coin on Solana mainnet. Your wallet will show the exact amounts before you approve.</DialogDescription>
          </DialogHeader>
          {prepared && (
            <div className="grid gap-px border border-white/[0.07] bg-white/[0.07] font-mono text-[12px]">
              {[
                ["Coin", `${name} ($${ticker})`],
                ["Mint", `${prepared.mint.slice(0, 6)}…${prepared.mint.slice(-6)}`],
                ["Dev buy", `${Math.max(demoMode ? 0 : 0.001, draft.devBuySol)} SOL`],
                ...(prepared.feeSol > 0 ? [["Launch fee", `${prepared.feeSol} SOL`]] : []),
                ["Network fees", "~0.02 SOL (pump.fun creation + priority)"],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-3 bg-[#0b0e0d] px-3 py-2">
                  <span className="uppercase tracking-[0.12em] text-muted-foreground">{k}</span>
                  <span className="text-right">{v}</span>
                </div>
              ))}
            </div>
          )}
          {phase === "confirming" && (
            <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-lime">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Waiting for Solana confirmation...
            </div>
          )}
          {error && <div className="border border-signal/40 bg-signal/[0.07] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.1em] text-signal">{error}</div>}
          <DialogFooter>
            {sent ? (
              <>
                <Button variant="outline" asChild>
                  <a href={`https://solscan.io/tx/${sent.signature}`} target="_blank" rel="noreferrer">
                    Solscan <ExternalLink />
                  </a>
                </Button>
                <Button onClick={() => confirm(sent.mint, sent.signature)} disabled={phase === "confirming"}>
                  {phase === "confirming" ? "Confirming..." : "Check again"}
                </Button>
              </>
            ) : error && /expired|prepare/i.test(error) ? (
              <Button
                onClick={() => {
                  setPrepared(null);
                  setPhase("idle");
                  void launch();
                }}
              >
                Prepare again
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => closeReview(false)} disabled={phase === "signing"}>
                  Cancel
                </Button>
                <Button onClick={sign} disabled={phase === "signing"}>
                  {phase === "signing" ? <Loader2 className="animate-spin" /> : null}
                  {phase === "signing" ? "Approve in wallet..." : "Sign in wallet"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
