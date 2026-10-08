"use client";

import { ExternalLink, Loader2, RefreshCw, Send, ShieldAlert, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PanelHeader, SwarmDot } from "@/components/hud/primitives";
import { PageShell, PageTitle } from "@/components/PageShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { addressColor, short } from "@/components/wallet/WalletButton";
import { authFetch, useWallet } from "@/lib/client/wallet";
import type { AdminData, Payout, PayoutStatus } from "@/lib/game/types";
import { cn } from "@/lib/utils";

type Data = AdminData & { webhook: { id: string; at: number; addresses: number } | null };
type Filter = "pending" | "paid" | "void" | "demo" | "all";
interface BatchLog {
  n: number;
  recipients: number;
  sol: number;
  sig?: string;
  status: "signing" | "verifying" | "done" | "error";
  note?: string;
}

const LAMPORTS = 1_000_000_000;
const BATCH = 10;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errText = (e: unknown, d: string) => (e instanceof Error && e.message ? e.message : d);
const hourTime = (hour: number) => new Date((hour + 1) * 3600_000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

function StatusPill({ ok, yes = "SET", no = "MISSING" }: { ok: boolean; yes?: string; no?: string }) {
  return (
    <span className={cn("border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]", ok ? "border-lime/50 text-lime" : "border-signal/50 text-signal")}>
      {ok ? yes : no}
    </span>
  );
}

export default function AdminPage() {
  const { ready, wallet, admin, setPickerOpen, signAndSend } = useWallet();
  const [data, setData] = useState<Data | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("pending");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [confirmPay, setConfirmPay] = useState(false);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [paying, setPaying] = useState(false);
  const [logs, setLogs] = useState<BatchLog[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await authFetch("/api/admin");
      const j = (await res.json()) as Data & { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setData(j);
      setLoadErr(null);
    } catch (e) {
      setLoadErr(errText(e, "Could not load admin data"));
    }
  }, []);

  useEffect(() => {
    if (!admin) return;
    void load();
    const t = setInterval(() => {
      if (!paying) void load();
    }, 30_000);
    return () => clearInterval(t);
  }, [admin, load, paying]);

  const payouts = useMemo(() => data?.payouts ?? [], [data]);
  const shown = useMemo(() => (filter === "all" ? payouts : payouts.filter((p) => p.status === (filter as PayoutStatus))), [payouts, filter]);
  const pendingShown = shown.filter((p) => p.status === "pending");
  const selected = payouts.filter((p) => sel.has(p.id) && p.status === "pending");
  const selectedSol = selected.reduce((a, p) => a + p.sol, 0);
  const recipients = useMemo(() => {
    const m = new Map<string, { wallet: string; lamports: number; ids: string[] }>();
    for (const p of selected) {
      const r = m.get(p.wallet) ?? { wallet: p.wallet, lamports: 0, ids: [] };
      r.lamports += Math.round(p.sol * LAMPORTS);
      r.ids.push(p.id);
      m.set(p.wallet, r);
    }
    return [...m.values()];
  }, [selected]);

  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const syncWebhook = async () => {
    setSyncing(true);
    setMsg(null);
    try {
      const res = await authFetch("/api/admin/webhook", { method: "POST" });
      const j = (await res.json()) as { ok: boolean; id?: string; addresses?: number; error?: string };
      setMsg(j.ok ? { ok: true, text: `Webhook synced: watching ${j.addresses} coin(s)` } : { ok: false, text: j.error || "Webhook sync failed" });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: errText(e, "Webhook sync failed") });
    } finally {
      setSyncing(false);
    }
  };

  const pay = async () => {
    if (!wallet || !recipients.length) return;
    setConfirmPay(false);
    setPaying(true);
    setMsg(null);
    const batches: (typeof recipients)[] = [];
    for (let i = 0; i < recipients.length; i += BATCH) batches.push(recipients.slice(i, i + BATCH));
    const out: BatchLog[] = batches.map((b, i) => ({ n: i + 1, recipients: b.length, sol: b.reduce((a, r) => a + r.lamports, 0) / LAMPORTS, status: "signing" }));
    setLogs(out);
    const update = (i: number, patch: Partial<BatchLog>) => {
      out[i] = { ...out[i], ...patch };
      setLogs([...out]);
    };
    try {
      const web3 = await import("@solana/web3.js");
      for (let i = 0; i < batches.length; i++) {
        const b = batches[i];
        try {
          const bh = await authFetch("/api/admin/payouts");
          const bj = (await bh.json()) as { ok: boolean; blockhash?: string; error?: string };
          if (!bh.ok || !bj.blockhash) throw new Error(bj.error || "Could not fetch blockhash");
          const payer = new web3.PublicKey(wallet);
          const ixs = b.map((r) => web3.SystemProgram.transfer({ fromPubkey: payer, toPubkey: new web3.PublicKey(r.wallet), lamports: r.lamports }));
          const msgV0 = new web3.TransactionMessage({ payerKey: payer, recentBlockhash: bj.blockhash, instructions: ixs }).compileToV0Message();
          const sig = await signAndSend(new web3.VersionedTransaction(msgV0));
          update(i, { sig, status: "verifying" });
          const ids = b.flatMap((r) => r.ids);
          let verified = false;
          for (let k = 0; k < 30 && !verified; k++) {
            const vr = await authFetch("/api/admin/payouts", { method: "POST", body: JSON.stringify({ action: "verify", ids, signature: sig }) });
            const vj = (await vr.json()) as { ok: boolean; updated?: number; missing?: number; pending?: boolean; error?: string };
            if (vr.status === 202) {
              await sleep(3000);
              continue;
            }
            if (!vr.ok || !vj.ok) throw new Error(vj.error || "Verification failed");
            update(i, { status: "done", note: `${vj.updated} marked paid${vj.missing ? `, ${vj.missing} unverified` : ""}` });
            verified = true;
          }
          if (!verified) update(i, { status: "error", note: "Not confirmed yet. Check Solscan, then run verify again later." });
        } catch (e) {
          update(i, { status: "error", note: errText(e, "Batch failed") });
          if (/cancel/i.test(errText(e, ""))) break;
        }
      }
    } finally {
      setPaying(false);
      setSel(new Set());
      await load();
    }
  };

  const voidSelected = async () => {
    setConfirmVoid(false);
    try {
      const res = await authFetch("/api/admin/payouts", { method: "POST", body: JSON.stringify({ action: "void", ids: selected.map((p) => p.id) }) });
      const j = (await res.json()) as { ok: boolean; updated?: number; error?: string };
      setMsg(j.ok ? { ok: true, text: `${j.updated} payout(s) voided` } : { ok: false, text: j.error || "Void failed" });
      setSel(new Set());
      await load();
    } catch (e) {
      setMsg({ ok: false, text: errText(e, "Void failed") });
    }
  };

  // ------------------------------------------------------------------ gates
  if (!ready || !wallet || !admin) {
    return (
      <PageShell>
        <div className="grid min-h-[55vh] place-items-center">
          <div className="panel brackets w-full max-w-md p-6 text-center">
            <ShieldAlert className="mx-auto h-8 w-8 text-lime" />
            <div className="mt-3 font-display text-[18px] font-bold uppercase tracking-[0.14em]">Admin console</div>
            {!ready ? (
              <p className="mt-2 label blink">Checking clearance</p>
            ) : !wallet ? (
              <>
                <p className="mt-2 text-sm text-muted-foreground">Connect an admin wallet to continue.</p>
                <Button className="mt-5" onClick={() => setPickerOpen(true)}>
                  Connect wallet
                </Button>
              </>
            ) : (
              <>
                <p className="mt-2 text-sm text-muted-foreground">
                  Admin only. Your wallet <span className="font-mono text-foreground">{short(wallet)}</span> is not on the ADMIN_WALLETS list.
                </p>
                <Button asChild variant="outline" className="mt-5">
                  <Link href="/">Back to theater</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </PageShell>
    );
  }

  const st = data?.status;
  return (
    <PageShell wide>
      <PageTitle
        code="A"
        kicker="Command"
        title={
          <>
            Admin <span className="text-lime text-glow">console.</span>
          </>
        }
        right={
          <Button variant="outline" onClick={() => void load()}>
            <RefreshCw /> Refresh
          </Button>
        }
      />
      {loadErr && <div className="mb-4 border border-signal/40 bg-signal/[0.07] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.1em] text-signal">{loadErr}</div>}
      {msg && (
        <div className={cn("mb-4 border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.1em]", msg.ok ? "border-lime/40 bg-lime/[0.06] text-lime" : "border-signal/40 bg-signal/[0.07] text-signal")}>
          {msg.text}
        </div>
      )}

      {!data || !st ? (
        <div className="grid min-h-[30vh] place-items-center">
          <span className="label blink text-lime">Loading command data</span>
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-12">
          {/* obligations */}
          <section className="panel brackets brackets-lime xl:col-span-12">
            <div className="grid gap-px bg-white/[0.06] sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Owed (pending)", `${data.totals.pendingSol.toFixed(4)} SOL`, `${data.totals.pendingCount} payouts`, true],
                ["Paid all-time", `${data.totals.paidSol.toFixed(4)} SOL`, "verified on-chain", false],
                ["Rollover", `${data.rollover.toFixed(4)} SOL`, "carried into next prize", false],
                ["Hourly prize", `${st.hourlySol} SOL`, `${Math.round(st.prizeCreatorShare * 100)}% to creator`, false],
              ].map(([k, v, sub, hot]) => (
                <div key={String(k)} className="bg-[#0b0e0d] px-4 py-4">
                  <div className="label">{k}</div>
                  <div className={cn("mt-1 font-mono text-[26px] leading-none tabular", hot && "text-lime text-glow")}>{v}</div>
                  <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{sub}</div>
                </div>
              ))}
            </div>
          </section>

          {/* status */}
          <section className="panel brackets xl:col-span-4">
            <PanelHeader code="S" title="System status" right={<Badge variant={st.demo ? "secondary" : "solid"}>{st.demo ? "Demo" : "Live"}</Badge>} />
            <dl className="grid gap-px bg-white/[0.05] text-[12px]">
              {[
                ["Storage", <span key="s" className="font-mono">{st.storage}</span>],
                ["Serverless", <span key="sv" className="font-mono">{st.serverless ? "yes" : "no"}</span>],
                ["Tactics model", <span key="m" className="font-mono">{st.tacticsModel}</span>],
                ["Launch fee", <span key="f" className="font-mono">{st.launchFeeSol} SOL</span>],
                ["Treasury", data.treasury ? <span key="t" className="font-mono">{short(data.treasury)}</span> : <StatusPill key="t" ok={false} />],
                ["$LEGION mint", st.legionMint ? <span key="l" className="font-mono">{short(st.legionMint)}</span> : <StatusPill key="l" ok={false} no="NOT SET" />],
              ].map(([k, v]) => (
                <div key={String(k)} className="flex items-center justify-between gap-3 bg-[#0b0e0d] px-3 py-2">
                  <dt className="label">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            <div className="label border-t border-white/[0.06] px-3 pb-1 pt-3">Environment keys</div>
            <div className="grid gap-px bg-white/[0.05]">
              {Object.entries(st.keys).map(([k, ok]) => (
                <div key={k} className="flex items-center justify-between bg-[#0b0e0d] px-3 py-1.5">
                  <span className="font-mono text-[11px] text-foreground/80">{k}</span>
                  <StatusPill ok={ok} />
                </div>
              ))}
            </div>
          </section>

          {/* webhook + prizes */}
          <div className="grid content-start gap-5 xl:col-span-8">
            <section className="panel brackets">
              <PanelHeader code="W" title="Helius webhook" />
              <div className="flex flex-wrap items-center justify-between gap-4 p-4">
                <div className="font-mono text-[12px] text-muted-foreground">
                  {data.webhook ? (
                    <>
                      <div>
                        ID <span className="text-foreground">{data.webhook.id}</span>
                      </div>
                      <div className="mt-1">
                        Watching <span className="text-foreground">{data.webhook.addresses}</span> coin(s) // synced {new Date(data.webhook.at).toLocaleString()}
                      </div>
                    </>
                  ) : (
                    "No webhook registered yet. Sync after the site is deployed and at least one real coin exists."
                  )}
                </div>
                <Button onClick={syncWebhook} disabled={syncing}>
                  {syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />} Sync webhook
                </Button>
              </div>
            </section>

            <section className="panel brackets overflow-hidden">
              <PanelHeader code="P" title="Prize history" right={<span className="label">{data.prizes.length}</span>} />
              <div className="max-h-[260px] overflow-auto">
                <table className="w-full min-w-[560px] text-left text-[12px]">
                  <tbody className="divide-y divide-white/[0.04]">
                    {data.prizes.map((p) => (
                      <tr key={p.hour}>
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-muted-foreground">{hourTime(p.hour)}</td>
                        <td className="px-3 py-2">
                          <span className="inline-flex items-center gap-1.5">
                            <SwarmDot color={p.color} size={7} />
                            {p.name}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono">{p.territory} hex</td>
                        <td className="px-3 py-2 text-right font-mono text-lime">{p.amountSol.toFixed(4)}</td>
                        <td className="px-3 py-2 text-right font-mono">{p.payouts} payouts</td>
                        <td className="px-3 py-2">{p.demo ? <Badge variant="outline">Demo</Badge> : p.rolledOver ? <Badge variant="secondary">Rolled</Badge> : <Badge>Awarded</Badge>}</td>
                      </tr>
                    ))}
                    {data.prizes.length === 0 && (
                      <tr>
                        <td className="px-3 py-4 text-muted-foreground">No prizes decided yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          {/* payouts */}
          <section className="panel brackets overflow-hidden xl:col-span-12">
            <PanelHeader
              code="$"
              title="Payouts"
              right={
                <div className="flex gap-1">
                  {(["pending", "paid", "void", "demo", "all"] as Filter[]).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFilter(f)}
                      className={cn("px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]", filter === f ? "bg-lime text-carbon" : "text-muted-foreground hover:text-foreground")}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              }
            />
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-3 py-2.5">
              <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                {selected.length} selected // <span className="text-foreground">{selectedSol.toFixed(4)} SOL</span> to {recipients.length} wallet(s)
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={!selected.length || paying} onClick={() => setConfirmVoid(true)}>
                  <Trash2 /> Void
                </Button>
                <Button size="sm" disabled={!selected.length || paying} onClick={() => setConfirmPay(true)}>
                  {paying ? <Loader2 className="animate-spin" /> : <Send />} Pay selected
                </Button>
              </div>
            </div>
            {logs.length > 0 && (
              <div className="grid gap-1 border-b border-white/[0.06] px-3 py-2">
                {logs.map((l) => (
                  <div key={l.n} className="flex flex-wrap items-center gap-3 font-mono text-[11px] uppercase tracking-[0.1em]">
                    <span className="text-muted-foreground">Batch {l.n}</span>
                    <span>
                      {l.recipients} wallets // {l.sol.toFixed(4)} SOL
                    </span>
                    <span className={cn(l.status === "done" ? "text-lime" : l.status === "error" ? "text-signal" : "text-foreground blink")}>{l.status}</span>
                    {l.note && <span className="normal-case text-muted-foreground">{l.note}</span>}
                    {l.sig && (
                      <a href={`https://solscan.io/tx/${l.sig}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:text-lime">
                        tx <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="max-h-[560px] overflow-auto">
              <table className="w-full min-w-[860px] text-left text-[12px]">
                <thead className="sticky top-0 bg-[#0b0e0d]">
                  <tr className="label border-b border-white/[0.06]">
                    <th className="w-10 px-3 py-2 font-normal">
                      <input
                        type="checkbox"
                        aria-label="Select all pending"
                        className="accent-[#C6FF3D]"
                        checked={pendingShown.length > 0 && pendingShown.every((p) => sel.has(p.id))}
                        onChange={(e) => setSel(e.target.checked ? new Set(pendingShown.map((p) => p.id)) : new Set())}
                      />
                    </th>
                    <th className="px-3 py-2 font-normal">Hour</th>
                    <th className="px-3 py-2 font-normal">Legion</th>
                    <th className="px-3 py-2 font-normal">Role</th>
                    <th className="px-3 py-2 font-normal">Wallet</th>
                    <th className="px-3 py-2 text-right font-normal">Drones</th>
                    <th className="px-3 py-2 text-right font-normal">SOL</th>
                    <th className="px-3 py-2 font-normal">Status</th>
                    <th className="px-3 py-2 font-normal">Tx</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {shown.map((p: Payout) => (
                    <tr key={p.id} className={cn("hover:bg-white/[0.015]", sel.has(p.id) && "bg-lime/[0.04]")}>
                      <td className="px-3 py-2">
                        {p.status === "pending" && <input type="checkbox" aria-label="Select payout" className="accent-[#C6FF3D]" checked={sel.has(p.id)} onChange={() => toggle(p.id)} />}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-muted-foreground">{hourTime(p.hour)}</td>
                      <td className="px-3 py-2 font-mono">{p.ticker}</td>
                      <td className="px-3 py-2 font-mono uppercase text-muted-foreground">{p.role}</td>
                      <td className="px-3 py-2">
                        <a href={`https://solscan.io/account/${p.wallet}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-mono hover:text-lime">
                          <SwarmDot color={addressColor(p.wallet)} size={7} />
                          {short(p.wallet)}
                        </a>
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular">{p.drones || "--"}</td>
                      <td className="px-3 py-2 text-right font-mono tabular text-lime">{p.sol.toFixed(6)}</td>
                      <td className="px-3 py-2">
                        <Badge variant={p.status === "pending" ? "default" : p.status === "paid" ? "solid" : p.status === "void" ? "destructive" : "secondary"}>{p.status}</Badge>
                      </td>
                      <td className="px-3 py-2">
                        {p.txSig ? (
                          <a href={`https://solscan.io/tx/${p.txSig}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-muted-foreground hover:text-lime">
                            {p.txSig.slice(0, 6)} <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          <span className="text-white/20">--</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {shown.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">
                        Nothing here.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      <Dialog open={confirmPay} onOpenChange={setConfirmPay}>
        <DialogContent>
          <DialogHeader>
            <div className="label text-signal">Real SOL</div>
            <DialogTitle>Send {selectedSol.toFixed(4)} SOL</DialogTitle>
            <DialogDescription>
              Payments are sent from the connected wallet <span className="font-mono text-foreground">{wallet && short(wallet)}</span>
              {data?.treasury && wallet !== data.treasury ? " (this is NOT the configured treasury)" : ""}. {recipients.length} recipient(s) in{" "}
              {Math.ceil(recipients.length / BATCH)} transaction(s). Each transaction is verified on-chain before payouts are marked paid.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[220px] overflow-auto border border-white/[0.07]">
            {recipients.map((r) => (
              <div key={r.wallet} className="flex items-center justify-between border-b border-white/[0.04] px-3 py-1.5 font-mono text-[12px]">
                <span>{short(r.wallet, 6)}</span>
                <span className="text-lime">{(r.lamports / LAMPORTS).toFixed(6)} SOL</span>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmPay(false)}>
              Cancel
            </Button>
            <Button onClick={pay}>
              <Send /> Approve in wallet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmVoid} onOpenChange={setConfirmVoid}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void {selected.length} payout(s)?</DialogTitle>
            <DialogDescription>Voided payouts are cancelled permanently and will not be paid. Use this for invalid wallets.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmVoid(false)}>
              Keep
            </Button>
            <Button variant="destructive" onClick={voidSelected}>
              Void payouts
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
