import { kvGet } from "@/lib/server/kv";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[1-9A-HJ-NP-Za-km-z]{20,60}$/.test(id)) return new Response("Not found", { status: 404 });
  const img = await kvGet<{ mime: string; b64: string }>(`img:${id}`, 600_000);
  if (!img) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(img.b64, "base64"), { headers: { "Content-Type": img.mime, "Cache-Control": "public, max-age=86400, immutable" } });
}
