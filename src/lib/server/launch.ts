import "server-only";
import { randomBytes } from "node:crypto";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import { TACTICS_MIN, cleanTactics, sanitizeAbility } from "@/lib/game/tactics";
import type { LaunchDraft, LaunchPrepareResponse, PublicSwarm } from "@/lib/game/types";
import type { DroneDesign } from "@/lib/sim/types";
import { DEMO, config } from "./config";
import { kvDel, kvGet, kvSet } from "./kv";
import { RESERVED_TICKERS, registerLegion, tickerTaken, validTicker, worldCapacity } from "./legions";
import { readCompileToken } from "./tactics";

const DESIGNS: DroneDesign[] = ["dart", "orb", "delta", "shard"];
const IMAGE_MAX = 1_200_000;
const LAMPORTS = 1_000_000_000;

export interface CleanDraft {
  name: string;
  ticker: string;
  color: string;
  design: DroneDesign;
  description: string;
  tactics: string;
  devBuySol: number;
  twitter?: string;
  telegram?: string;
  image?: { mime: string; bytes: Buffer };
  compiled: NonNullable<ReturnType<typeof readCompileToken>>;
  ability: ReturnType<typeof sanitizeAbility>;
}

function cleanUrl(u: unknown): string | undefined {
  if (typeof u !== "string" || !u.trim()) return undefined;
  try {
    const url = new URL(u.trim());
    return url.protocol === "https:" ? url.toString().slice(0, 200) : undefined;
  } catch {
    return undefined;
  }
}

function parseImage(dataUrl: unknown): { mime: string; bytes: Buffer } | null {
  if (typeof dataUrl !== "string") return null;
  const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return null;
  const bytes = Buffer.from(m[2], "base64");
  if (!bytes.length || bytes.length > IMAGE_MAX) return null;
  return { mime: m[1], bytes };
}

export async function validateDraft(raw: Partial<LaunchDraft>, now: number): Promise<{ ok: true; draft: CleanDraft } | { ok: false; error: string }> {
  const name = String(raw.name ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (name.length < 2 || name.length > 28) return { ok: false, error: "Name must be 2-28 characters" };
  const ticker = String(raw.ticker ?? "")
    .replace(/^\$/, "")
    .trim()
    .toUpperCase();
  if (!validTicker(ticker)) return { ok: false, error: "Ticker must be 2-10 letters or digits" };
  if (RESERVED_TICKERS.includes(ticker) || (await tickerTaken(ticker, now))) return { ok: false, error: `$${ticker} is already taken` };
  const color = String(raw.color ?? "");
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return { ok: false, error: "Pick a color" };
  const design = DESIGNS.includes(raw.design as DroneDesign) ? (raw.design as DroneDesign) : null;
  if (!design) return { ok: false, error: "Pick a drone design" };
  const description = String(raw.description ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  const tactics = cleanTactics(String(raw.tactics ?? ""));
  if (tactics.length < TACTICS_MIN) return { ok: false, error: "Tactics are too short" };
  const compiled = readCompileToken(String(raw.compileToken ?? ""), tactics);
  if (!compiled) return { ok: false, error: "Tactics changed since they were compiled. Compile again." };
  const devBuySol = Math.max(0, Math.min(config.devBuyMaxSol, Number(raw.devBuySol) || 0));
  const image = raw.image ? parseImage(raw.image) : null;
  if (raw.image && !image) return { ok: false, error: "Image must be PNG, JPG, WEBP or GIF under 1.2MB" };
  if (!DEMO && !image) return { ok: false, error: "Upload an image for your coin" };
  const cap = await worldCapacity(now);
  if (cap.count >= cap.max) return { ok: false, error: "The map is full. Try again next season." };
  return {
    ok: true,
    draft: {
      name,
      ticker,
      color: color.toUpperCase(),
      design,
      description,
      tactics,
      devBuySol,
      twitter: cleanUrl(raw.twitter),
      telegram: cleanUrl(raw.telegram),
      image: image ?? undefined,
      compiled,
      ability: sanitizeAbility(raw.ability, "emp"),
    },
  };
}

// ------------------------------------------------------------------ demo
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export async function launchDemo(wallet: string, d: CleanDraft, now: number): Promise<LaunchPrepareResponse> {
  const bytes = randomBytes(40);
  let mint = "DEMO";
  for (let i = 0; i < 36; i++) mint += B58[bytes[i] % B58.length];
  mint += "pump";
  let image: string | undefined;
  if (d.image && d.image.bytes.length <= 400_000) {
    await kvSet(`img:${mint}`, { mime: d.image.mime, b64: d.image.bytes.toString("base64") });
    image = `/api/img/${mint}`;
  }
  const res = await registerLegion(
    {
      name: d.name,
      ticker: d.ticker,
      color: d.color,
      design: d.design,
      description: d.description,
      tactics: d.tactics,
      tacticsHash: d.compiled.hash,
      config: d.compiled.config,
      configSource: d.compiled.source,
      ability: d.ability,
      creator: wallet,
      mint,
      image,
      demo: true,
      // demo coins start with a small market cap plus whatever the creator "bought"
      mcapSol: Math.round((28 + d.devBuySol * 6) * 10) / 10,
    },
    now,
  );
  return res.ok ? { ok: true, mode: "demo", legion: res.legion } : res;
}

// ------------------------------------------------------------------ live (pump.fun)
async function pinata(file: Blob, filename: string): Promise<string> {
  const form = new FormData();
  form.append("network", "public");
  form.append("file", file, filename);
  const res = await fetch("https://uploads.pinata.cloud/v3/files", { method: "POST", headers: { Authorization: `Bearer ${config.pinataJwt}` }, body: form });
  if (!res.ok) throw new Error(`Pinata upload failed (${res.status})`);
  const j = (await res.json()) as { data?: { cid?: string } };
  if (!j.data?.cid) throw new Error("Pinata returned no CID");
  return `https://ipfs.io/ipfs/${j.data.cid}`;
}

interface PendingLaunch {
  wallet: string;
  mint: string;
  name: string;
  ticker: string;
  color: string;
  design: DroneDesign;
  description: string;
  tactics: string;
  tacticsHash: string;
  config: CleanDraft["compiled"]["config"];
  configSource: CleanDraft["compiled"]["source"];
  ability: CleanDraft["ability"];
  image: string;
  metadataUri: string;
  feeSol: number;
  devBuySol: number;
  t: number;
}

const launchKey = (mint: string) => `launch:${mint}`;

/** Append the launch-fee transfer to the PumpPortal transaction (keeps it atomic). */
function withFee(tx: VersionedTransaction, payer: PublicKey, treasury: PublicKey, lamports: number): VersionedTransaction {
  if (tx.message.addressTableLookups.length) throw new Error("Launch transaction uses lookup tables; cannot attach fee");
  const msg = TransactionMessage.decompile(tx.message);
  msg.instructions.push(SystemProgram.transfer({ fromPubkey: payer, toPubkey: treasury, lamports }));
  return new VersionedTransaction(msg.compileToV0Message());
}

export async function prepareLiveLaunch(wallet: string, d: CleanDraft): Promise<LaunchPrepareResponse> {
  if (!config.pinataJwt) return { ok: false, error: "Launching is not configured (PINATA_JWT missing)" };
  if (!d.image) return { ok: false, error: "Upload an image for your coin" };
  const feeSol = config.launchFeeSol > 0 && config.treasuryWallet ? config.launchFeeSol : 0;
  const mintKp = Keypair.generate();
  const mint = mintKp.publicKey.toBase58();
  try {
    const ext = d.image.mime.split("/")[1] === "jpeg" ? "jpg" : d.image.mime.split("/")[1];
    const image = await pinata(new Blob([new Uint8Array(d.image.bytes)], { type: d.image.mime }), `${d.ticker}.${ext}`);
    const legionUrl = config.siteUrl ? `${config.siteUrl}/legion/${d.ticker.toLowerCase()}-${mint.slice(0, 4).toLowerCase()}` : undefined;
    const meta = {
      name: d.name,
      symbol: d.ticker,
      description: `${d.description ? `${d.description} ` : ""}A LEGION drone army. Every buy sends reinforcements into its live battles.`.trim(),
      image,
      showName: true,
      createdOn: config.siteUrl || "https://pump.fun",
      ...(legionUrl ? { website: legionUrl } : {}),
      ...(d.twitter ? { twitter: d.twitter } : {}),
      ...(d.telegram ? { telegram: d.telegram } : {}),
    };
    const metadataUri = await pinata(new Blob([JSON.stringify(meta)], { type: "application/json" }), `${d.ticker}.json`);
    const res = await fetch("https://pumpportal.fun/api/trade-local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        publicKey: wallet,
        action: "create",
        tokenMetadata: { name: d.name, symbol: d.ticker, uri: metadataUri },
        mint,
        denominatedInSol: "true",
        amount: Math.max(0.001, d.devBuySol),
        slippage: 15,
        priorityFee: config.pumpPriorityFee,
        pool: "pump",
      }),
    });
    if (!res.ok) return { ok: false, error: `pump.fun rejected the launch (${res.status}). Try again.` };
    let tx = VersionedTransaction.deserialize(new Uint8Array(await res.arrayBuffer()));
    if (feeSol > 0) tx = withFee(tx, new PublicKey(wallet), new PublicKey(config.treasuryWallet), Math.round(feeSol * LAMPORTS));
    tx.sign([mintKp]);
    const pending: PendingLaunch = {
      wallet,
      mint,
      name: d.name,
      ticker: d.ticker,
      color: d.color,
      design: d.design,
      description: d.description,
      tactics: d.tactics,
      tacticsHash: d.compiled.hash,
      config: d.compiled.config,
      configSource: d.compiled.source,
      ability: d.ability,
      image,
      metadataUri,
      feeSol,
      devBuySol: d.devBuySol,
      t: Date.now(),
    };
    await kvSet(launchKey(mint), pending);
    return { ok: true, mode: "live", mint, tx: Buffer.from(tx.serialize()).toString("base64"), feeSol, treasury: config.treasuryWallet };
  } catch (e) {
    console.error("[legion] launch prep failed", e);
    return { ok: false, error: e instanceof Error ? e.message : "Launch preparation failed" };
  }
}

function accountKeysOf(tx: VersionedTransactionResponse): string[] {
  const msg = tx.transaction.message;
  const keys = msg.staticAccountKeys.map((k) => k.toBase58());
  const loaded = tx.meta?.loadedAddresses;
  if (loaded) keys.push(...loaded.writable.map((k) => k.toBase58()), ...loaded.readonly.map((k) => k.toBase58()));
  return keys;
}

/** Verify the launch landed on-chain, then register the legion. `pending: true` means try again shortly. */
export async function confirmLiveLaunch(
  wallet: string,
  mint: string,
  signature: string,
  now: number,
): Promise<{ ok: true; legion: PublicSwarm } | { ok: false; pending?: boolean; error: string }> {
  const p = await kvGet<PendingLaunch>(launchKey(mint), 0);
  if (!p) return { ok: false, error: "Launch session expired. Start again." };
  if (p.wallet !== wallet) return { ok: false, error: "This launch belongs to another wallet" };
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(signature)) return { ok: false, error: "Invalid signature" };
  const conn = new Connection(config.solanaRpcUrl, "confirmed");
  let tx: VersionedTransactionResponse | null = null;
  try {
    tx = await conn.getTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
  } catch {
    return { ok: false, pending: true, error: "Waiting for confirmation" };
  }
  if (!tx) return { ok: false, pending: true, error: "Waiting for confirmation" };
  if (tx.meta?.err) return { ok: false, error: "The launch transaction failed on-chain" };
  const keys = accountKeysOf(tx);
  if (keys[0] !== wallet) return { ok: false, error: "Transaction was not paid by your wallet" };
  if (!keys.includes(mint)) return { ok: false, error: "Transaction did not create this coin" };
  const minted = (tx.meta?.postTokenBalances ?? []).some((b) => b.mint === mint);
  if (!minted) return { ok: false, error: "Coin was not minted in this transaction" };
  if (p.feeSol > 0) {
    const ti = keys.indexOf(config.treasuryWallet);
    const pre = tx.meta?.preBalances[ti] ?? 0;
    const post = tx.meta?.postBalances[ti] ?? 0;
    if (ti < 0 || post - pre < Math.round(p.feeSol * LAMPORTS) - 1) return { ok: false, error: "Launch fee was not paid" };
  }
  const res = await registerLegion(
    {
      name: p.name,
      ticker: p.ticker,
      color: p.color,
      design: p.design,
      description: p.description,
      tactics: p.tactics,
      tacticsHash: p.tacticsHash,
      config: p.config,
      configSource: p.configSource,
      ability: p.ability,
      creator: wallet,
      mint,
      image: p.image,
      metadataUri: p.metadataUri,
      launchSig: signature,
      demo: false,
      // fresh pump.fun coin: ~28 SOL virtual market cap plus the dev buy
      mcapSol: Math.round((28 + p.devBuySol) * 10) / 10,
    },
    now,
  );
  if (res.ok) await kvDel(launchKey(mint));
  return res;
}
