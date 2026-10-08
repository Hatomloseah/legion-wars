import { Connection } from "@solana/web3.js";
import { NextResponse } from "next/server";
import { config } from "@/lib/server/config";
import { fail, json, rateLimit, readBody, requireSession } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const maxDuration = 26;

/** Relay an already-signed transaction (fallback for wallets without signAndSendTransaction). */
export async function POST(req: Request) {
  const s = await requireSession();
  if (s instanceof NextResponse) return s;
  if (!(await rateLimit("tx-send", 20, 60_000))) return fail("Too many requests", 429);
  const { tx } = await readBody<{ tx: string }>(req);
  if (typeof tx !== "string" || tx.length < 100 || tx.length > 3000) return fail("Invalid transaction");
  try {
    const conn = new Connection(config.solanaRpcUrl, "confirmed");
    const signature = await conn.sendRawTransaction(Buffer.from(tx, "base64"), { skipPreflight: false, maxRetries: 3 });
    return json({ ok: true, signature });
  } catch (e) {
    return fail(e instanceof Error ? e.message.slice(0, 200) : "Send failed");
  }
}
