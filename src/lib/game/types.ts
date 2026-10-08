import type { SideStats } from "@/lib/sim/engine";
import type { AbilityKind, BehaviorConfig, DroneDesign, SimEvent } from "@/lib/sim/types";

export type ConfigSource = "llm" | "heuristic" | "house";

export interface Swarm {
  id: string;
  name: string;
  ticker: string;
  color: string;
  design: DroneDesign;
  description: string;
  tactics: string;
  tacticsHash: string;
  config: BehaviorConfig;
  configSource: ConfigSource;
  ability: AbilityKind;
  creator: string;
  mint: string;
  image?: string;
  metadataUri?: string;
  launchSig?: string;
  homeHex: number;
  house: boolean;
  /** the platform's own $LEGION legion */
  flagship?: boolean;
  demo: boolean;
  mcapSol: number;
  /** season record */
  wins: number;
  losses: number;
  /** all-time record */
  allWins: number;
  allLosses: number;
  prizesWon: number;
  prizeSol: number;
  createdAt: number;
}

export interface BattleSide {
  swarmId: string;
  name: string;
  ticker: string;
  color: string;
  design: DroneDesign;
  config: BehaviorConfig;
  ability: AbilityKind;
  baseDrones: number;
  mcapSol: number;
  creator: string;
  mint: string;
  tacticsHash?: string;
  /** simulated coin (house legion / demo launch): no real pump.fun market */
  demo?: boolean;
}

export interface BattleResult {
  winner: 0 | 1;
  alive: [number, number];
  hp: [number, number];
  stats: [SideStats, SideStats];
  capturedHex: number;
  settledAt: number;
  eventCount: number;
  /** final sim state fingerprint (anyone can reproduce it from the published inputs) */
  checksum: number;
}

export interface BattleRecord {
  id: string;
  round: number;
  idx: number;
  seed: number;
  startsAt: number;
  endsAt: number;
  /** [attacker, defender] */
  sides: [BattleSide, BattleSide];
  /** hex each side captures on victory */
  prizeHex: [number, number];
  /** true when the demo trade generator contributes events */
  demoFeed?: boolean;
  result?: BattleResult;
}

export interface RoundRecord {
  index: number;
  battles: BattleRecord[];
  settled: boolean;
}

export type BattlePhase = "upcoming" | "live" | "ended";

export interface RoundInfo {
  index: number;
  startsAt: number;
  battleEndsAt: number;
  endsAt: number;
  phase: "battle" | "break";
}

export interface FeedEvent extends SimEvent {
  battleId: string;
  swarmId: string;
  ticker: string;
  color: string;
}

export interface BattleSummarySide {
  swarmId: string;
  name: string;
  ticker: string;
  color: string;
  baseDrones: number;
  reinforcements: number;
  sold: number;
}

export interface BattleSummary {
  id: string;
  round: number;
  phase: BattlePhase;
  startsAt: number;
  endsAt: number;
  sides: [BattleSummarySide, BattleSummarySide];
  prizeHex: [number, number];
  heat: number;
  result?: { winner: 0 | 1; alive: [number, number]; capturedHex: number };
}

export interface PublicSwarm {
  id: string;
  name: string;
  ticker: string;
  color: string;
  design: DroneDesign;
  description: string;
  ability: AbilityKind;
  config: BehaviorConfig;
  configSource: ConfigSource;
  tactics: string;
  tacticsHash: string;
  homeHex: number;
  territory: number;
  wins: number;
  losses: number;
  allWins: number;
  allLosses: number;
  prizesWon: number;
  prizeSol: number;
  mcapSol: number;
  baseDrones: number;
  house: boolean;
  flagship?: boolean;
  demo: boolean;
  creator: string;
  mint: string;
  image?: string;
  createdAt: number;
}

export interface PrizeRecord {
  hour: number;
  endsAt: number;
  swarmId: string | null;
  ticker: string;
  name: string;
  color: string;
  territory: number;
  amountSol: number;
  rolledOver: boolean;
  payouts: number;
  reinforcers: number;
  demo: boolean;
  /** surge bonus included in amountSol (if it was paid) */
  bonusSol?: number;
  launches?: number;
  buyers?: number;
}

export type PayoutStatus = "pending" | "paid" | "demo" | "void";

export interface Payout {
  id: string;
  hour: number;
  swarmId: string;
  ticker: string;
  wallet: string;
  role: "creator" | "reinforcer";
  drones: number;
  sol: number;
  status: PayoutStatus;
  txSig?: string;
  createdAt: number;
  paidAt?: number;
}

export interface WalletStat {
  wallet: string;
  drones: number;
  sold: number;
  sol: number;
  buys: number;
  sells: number;
  swarms: string[];
  lastTs: number;
}

export interface HistorySide {
  swarmId: string;
  ticker: string;
  name: string;
  color: string;
  base: number;
  reinforcements: number;
  sold: number;
  alive: number;
  kills: number;
  tacticsHash?: string;
}

/** Compact record of a settled battle (proof page, swarm history, leaderboard). */
export interface HistoryEntry {
  id: string;
  round: number;
  startsAt: number;
  seed: number;
  sides: [HistorySide, HistorySide];
  winner: 0 | 1;
  capturedHex: number;
  checksum: number;
  eventCount: number;
  settledAt: number;
}

export interface GameState {
  now: number;
  demo: boolean;
  season: number;
  seasonEndsAt: number;
  round: RoundInfo;
  swarms: PublicSwarm[];
  /** owner swarm id per hex index ("" = unclaimed) */
  owners: string[];
  battles: BattleSummary[];
  lastBattles: BattleSummary[];
  nextBattles: BattleSummary[];
  featuredId: string | null;
  /** id of The First Legion ($LEGION) */
  flagshipId: string | null;
  feed: FeedEvent[];
  prize: {
    hourlySol: number;
    poolSol: number;
    leaderId: string | null;
    hourEndsAt: number;
    rollover: number;
    last: PrizeRecord | null;
    /** live surge bonus for the current hour (exact amount is rolled at close) */
    surge: { launches: number; buyers: number; potentialSol: number; maxSol: number };
  };
}

export interface BattleDetail {
  now: number;
  demo: boolean;
  phase: BattlePhase;
  battle: BattleRecord;
  events: SimEvent[];
}

export interface SwarmDetail {
  now: number;
  demo: boolean;
  swarm: PublicSwarm;
  rank: number;
  hexes: number[];
  owners: string[];
  swarms: PublicSwarm[];
  history: HistoryEntry[];
  prizes: PrizeRecord[];
  current: BattleSummary | null;
  next: BattleSummary | null;
}

export interface LeaderboardData {
  now: number;
  demo: boolean;
  season: number;
  seasonEndsAt: number;
  swarms: PublicSwarm[];
  wallets: WalletStat[];
  prizes: PrizeRecord[];
  rollover: number;
  hourlySol: number;
  totals: { battles: number; drones: number; sol: number };
}

export interface ProofIndex {
  now: number;
  demo: boolean;
  engine: { tickMs: number; ticks: number; cap: number; fixedPoint: string; prng: string; trig: string };
  battles: HistoryEntry[];
}

export interface BattleProof {
  battle: BattleRecord;
  events: SimEvent[];
  /** tactics text per side so anyone can check the published hashes */
  tactics: [string, string];
}

export interface SessionInfo {
  wallet: string | null;
  demoWallet: boolean;
  admin: boolean;
  demo: boolean;
  swarms: { id: string; name: string; ticker: string; color: string }[];
}

/** The platform coin ($LEGION). */
export interface TokenInfo {
  symbol: string;
  name: string;
  /** null until LEGION_MINT is configured */
  mint: string | null;
  /** true when the price comes from a real market */
  live: boolean;
  priceSol: number | null;
  priceUsd: number | null;
  mcapSol: number | null;
  mcapUsd: number | null;
  change24h: number | null;
  url: string | null;
  flagshipId: string | null;
}

export interface CompileResponse {
  config: BehaviorConfig;
  ability: AbilityKind;
  summary: string;
  source: ConfigSource;
  model: string | null;
  tacticsHash: string;
  token: string;
}

export interface LaunchDraft {
  name: string;
  ticker: string;
  color: string;
  design: DroneDesign;
  description: string;
  tactics: string;
  /** compile token from /api/tactics/compile */
  compileToken: string;
  /** optional override of the compiled ability */
  ability?: AbilityKind;
  /** SOL the creator buys in the launch transaction */
  devBuySol: number;
  /** data URL (png/jpg/webp/gif, <= 1MB). Optional in demo mode. */
  image?: string;
  twitter?: string;
  telegram?: string;
}

/** Response of POST /api/legions/launch */
export type LaunchPrepareResponse =
  | { ok: true; mode: "demo"; legion: PublicSwarm }
  | {
      ok: true;
      mode: "live";
      mint: string;
      /** base64 serialized VersionedTransaction, already signed by the mint keypair */
      tx: string;
      feeSol: number;
      treasury: string;
    }
  | { ok: false; error: string };

export interface AdminData {
  now: number;
  demo: boolean;
  wallet: string;
  treasury: string;
  status: {
    demo: boolean;
    serverless: boolean;
    storage: string;
    keys: Record<string, boolean>;
    tacticsModel: string;
    launchFeeSol: number;
    hourlySol: number;
    prizeCreatorShare: number;
    legionMint: string | null;
  };
  payouts: Payout[];
  totals: { pendingSol: number; paidSol: number; pendingCount: number };
  prizes: PrizeRecord[];
  rollover: number;
}
