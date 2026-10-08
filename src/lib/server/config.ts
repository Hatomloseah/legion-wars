import "server-only";
import { createHash } from "node:crypto";

function num(v: string | undefined, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== "" ? n : d;
}

function list(v: string | undefined): string[] {
  return (v ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const heliusApiKey = process.env.HELIUS_API_KEY ?? "";

/** The First Legion ($LEGION) on pump.fun. Public address; LEGION_MINT can still override it. */
const LEGION_MINT_DEFAULT = "8tLi6SUw3SCCFedNwot2zGaWd9PMUSvTdz4UFFH1pump";

/**
 * Public site address. On Netlify, the primary URL wins when it is a custom domain, so a stale
 * *.netlify.app SITE_URL never ends up in coin metadata or sign-in prompts.
 */
const siteUrl = (() => {
  const strip = (u: string | undefined) => (u ?? "").trim().replace(/\/$/, "");
  const primary = strip(process.env.LEGION_PRIMARY_URL) || strip(process.env.URL);
  if (primary && !/\.netlify\.app$/i.test(primary)) return primary;
  return strip(process.env.SITE_URL) || primary;
})();

export const config = {
  solanaRpcUrl: process.env.SOLANA_RPC_URL || (heliusApiKey ? `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}` : "https://api.mainnet-beta.solana.com"),
  heliusApiKey,
  heliusApiBase: (process.env.HELIUS_API_BASE || "https://api.helius.xyz").replace(/\/$/, ""),
  heliusWebhookSecret: process.env.HELIUS_WEBHOOK_SECRET ?? "",
  pinataJwt: process.env.PINATA_JWT ?? "",
  openrouterKey: process.env.OPENROUTER_API_KEY ?? "",
  tacticsModel: process.env.TACTICS_MODEL || "openai/gpt-4o-mini",
  databaseUrl: process.env.DATABASE_URL ?? "",
  treasuryWallet: process.env.TREASURY_WALLET ?? "",
  /** mint address of the platform coin $LEGION (The First Legion) */
  legionMint: (process.env.LEGION_MINT || LEGION_MINT_DEFAULT).trim(),
  launchFeeSol: num(process.env.LAUNCH_FEE_SOL, 0),
  pumpPriorityFee: num(process.env.PUMP_PRIORITY_FEE, 0.0005),
  hourlyPrizeSol: num(process.env.HOURLY_PRIZE_SOL, 1),
  /** share of each hourly prize paid to the winning swarm's creator; the rest goes to its reinforcers */
  prizeCreatorShare: Math.max(0, Math.min(1, num(process.env.PRIZE_CREATOR_SHARE, 0.2))),
  /** surge bonus (on top of HOURLY_PRIZE_SOL): potential added per legion launched / per unique reinforcing wallet that hour */
  prizeSurgePerLaunchSol: Math.max(0, num(process.env.PRIZE_SURGE_PER_LAUNCH_SOL, 0.1)),
  prizeSurgePerBuyerSol: Math.max(0, num(process.env.PRIZE_SURGE_PER_BUYER_SOL, 0.01)),
  /** max surge bonus per hour; 0 turns the surge off */
  prizeSurgeMaxSol: Math.max(0, num(process.env.PRIZE_SURGE_MAX_SOL, 2)),
  sessionSecretRaw: process.env.SESSION_SECRET ?? "",
  adminWallets: list(process.env.ADMIN_WALLETS),
  cronSecret: process.env.CRON_SECRET ?? "",
  siteUrl,
  devBuyMaxSol: num(process.env.DEV_BUY_MAX_SOL, 5),
  maxSwarms: num(process.env.MAX_SWARMS, 60),
};

/** DEMO MODE: simulated coins + fake trade generator whenever Pinata or Helius is missing. */
export const DEMO = !config.pinataJwt || !config.heliusApiKey;

/** True when running inside a serverless function (no long-lived background work). */
export const SERVERLESS = !!(process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT || process.env.VERCEL);

/**
 * Session signing key. Prefer SESSION_SECRET; otherwise derive a stable key from other
 * server secrets so sessions survive across serverless instances. `strong` is false when
 * nothing secret is configured (demo only) and admin features refuse to run.
 */
export const sessionKey = (() => {
  if (config.sessionSecretRaw) return { key: config.sessionSecretRaw, strong: true };
  const material = [config.heliusApiKey, config.pinataJwt, config.openrouterKey, config.databaseUrl, config.heliusWebhookSecret]
    .filter(Boolean)
    .join("|");
  if (material) return { key: createHash("sha256").update(`swarm-session:${material}`).digest("hex"), strong: true };
  return { key: "swarm-demo-session-key-not-secret", strong: false };
})();

export function isAdmin(wallet: string | null | undefined): boolean {
  return !!wallet && sessionKey.strong && config.adminWallets.includes(wallet);
}

export function envStatus() {
  return {
    demo: DEMO,
    serverless: SERVERLESS,
    keys: {
      SOLANA_RPC_URL: !!process.env.SOLANA_RPC_URL,
      HELIUS_API_KEY: !!config.heliusApiKey,
      HELIUS_WEBHOOK_SECRET: !!config.heliusWebhookSecret,
      PINATA_JWT: !!config.pinataJwt,
      OPENROUTER_API_KEY: !!config.openrouterKey,
      DATABASE_URL: !!config.databaseUrl,
      TREASURY_WALLET: !!config.treasuryWallet,
      SESSION_SECRET: !!config.sessionSecretRaw,
      ADMIN_WALLETS: config.adminWallets.length > 0,
      CRON_SECRET: !!config.cronSecret,
      SITE_URL: !!config.siteUrl,
      LEGION_MINT: !!config.legionMint,
    },
    legionMint: config.legionMint || null,
    tacticsModel: config.tacticsModel,
    launchFeeSol: config.launchFeeSol,
    hourlyPrizeSol: config.hourlyPrizeSol,
    prizeCreatorShare: config.prizeCreatorShare,
  };
}
