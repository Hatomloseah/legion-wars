import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "./config";

/**
 * Tiny document store with compare-and-swap writes.
 *
 * Backends (picked automatically):
 *   1. Postgres   — when DATABASE_URL is set (table `swarm_kv`, created on first use)
 *   2. Netlify Blobs — when deployed on Netlify without a database (strongly consistent store)
 *   3. Local files — ./.data/kv (dev), falling back to /tmp
 *
 * Every mutation goes through `update()` which retries on version conflicts, so concurrent
 * serverless instances never clobber each other.
 */

interface Row {
  value: unknown;
  version: string;
}

interface Backend {
  name: "postgres" | "netlify-blobs" | "file";
  get(key: string): Promise<Row | null>;
  getMany(keys: string[]): Promise<Map<string, Row>>;
  /** expect = null -> only if missing. Returns new version or null on conflict. */
  put(key: string, value: unknown, expect: string | null): Promise<string | null>;
  del(key: string): Promise<void>;
  /** delete keys with prefix last written before `before` (ms). Best effort. */
  prune(prefix: string, before: number): Promise<number>;
}

// ------------------------------------------------------------------ postgres
type Sql = import("postgres").Sql;

function postgresBackend(url: string): Backend {
  let sqlP: Promise<Sql> | null = null;
  const sql = async (): Promise<Sql> => {
    if (!sqlP) {
      sqlP = (async () => {
        const postgres = (await import("postgres")).default;
        const s = postgres(url, {
          max: 3,
          idle_timeout: 20,
          connect_timeout: 10,
          prepare: false,
          ssl: /sslmode=disable|localhost|127\.0\.0\.1/.test(url) ? false : "require",
          onnotice: () => {},
        });
        await s`create table if not exists swarm_kv (
          key text primary key,
          value jsonb not null,
          version bigint not null default 1,
          updated_at timestamptz not null default now()
        )`;
        return s;
      })().catch((e) => {
        sqlP = null;
        throw e;
      });
    }
    return sqlP;
  };
  return {
    name: "postgres",
    async get(key) {
      const s = await sql();
      const rows = await s`select value, version::text as version from swarm_kv where key = ${key}`;
      return rows.length ? { value: rows[0].value, version: rows[0].version as string } : null;
    },
    async getMany(keys) {
      const out = new Map<string, Row>();
      if (!keys.length) return out;
      const s = await sql();
      const rows = await s`select key, value, version::text as version from swarm_kv where key = any(${keys})`;
      for (const r of rows) out.set(r.key as string, { value: r.value, version: r.version as string });
      return out;
    },
    async put(key, value, expect) {
      const s = await sql();
      const json = s.json(value as Parameters<Sql["json"]>[0]);
      if (expect === null) {
        const rows = await s`insert into swarm_kv (key, value, version) values (${key}, ${json}, 1)
          on conflict (key) do nothing returning version::text as version`;
        return rows.length ? (rows[0].version as string) : null;
      }
      const rows = await s`update swarm_kv set value = ${json}, version = version + 1, updated_at = now()
        where key = ${key} and version = ${expect}::bigint returning version::text as version`;
      return rows.length ? (rows[0].version as string) : null;
    },
    async del(key) {
      const s = await sql();
      await s`delete from swarm_kv where key = ${key}`;
    },
    async prune(prefix, before) {
      const s = await sql();
      const rows = await s`delete from swarm_kv where key like ${`${prefix}%`} and updated_at < ${new Date(before)} returning key`;
      return rows.length;
    },
  };
}

// ------------------------------------------------------------------ netlify blobs
function blobsBackend(): Backend {
  type Store = import("@netlify/blobs").Store;
  let storeP: Promise<Store> | null = null;
  const store = () => {
    if (!storeP) storeP = import("@netlify/blobs").then((m) => m.getStore({ name: "swarm", consistency: "strong" }));
    return storeP;
  };
  const wrap = (data: unknown, etag: string | undefined): Row | null => (data == null ? null : { value: (data as { v: unknown }).v, version: etag ?? "0" });
  return {
    name: "netlify-blobs",
    async get(key) {
      const s = await store();
      const r = await s.getWithMetadata(key, { type: "json" });
      return r ? wrap(r.data, r.etag) : null;
    },
    async getMany(keys) {
      const out = new Map<string, Row>();
      const rows = await Promise.all(keys.map((k) => this.get(k)));
      keys.forEach((k, i) => {
        const r = rows[i];
        if (r) out.set(k, r);
      });
      return out;
    },
    async put(key, value, expect) {
      const s = await store();
      const body = { v: value, t: Date.now() };
      const res = expect === null ? await s.setJSON(key, body, { onlyIfNew: true }) : await s.setJSON(key, body, { onlyIfMatch: expect });
      return res.modified ? (res.etag ?? String(Date.now())) : null;
    },
    async del(key) {
      const s = await store();
      await s.delete(key);
    },
    async prune(prefix, before) {
      const s = await store();
      const { blobs } = await s.list({ prefix });
      let n = 0;
      for (const b of blobs.slice(0, 200)) {
        const r = await s.get(b.key, { type: "json" }).catch(() => null);
        if (r && typeof r.t === "number" && r.t < before) {
          await s.delete(b.key);
          n++;
        }
      }
      return n;
    },
  };
}

// ------------------------------------------------------------------ local files
function fileBackend(): Backend {
  const mem = new Map<string, { value: unknown; version: number; t: number }>();
  let dirP: Promise<string> | null = null;
  const dir = () => {
    if (!dirP) {
      dirP = (async () => {
        for (const d of [path.join(process.cwd(), ".data", "kv"), "/tmp/swarm-data/kv"]) {
          try {
            await fs.mkdir(d, { recursive: true });
            await fs.writeFile(path.join(d, ".probe"), "1");
            return d;
          } catch {
            // next
          }
        }
        return "";
      })();
    }
    return dirP;
  };
  const fileOf = (d: string, key: string) => path.join(d, `${encodeURIComponent(key)}.json`);
  const load = async (key: string) => {
    const hit = mem.get(key);
    if (hit) return hit;
    const d = await dir();
    if (!d) return null;
    try {
      const raw = JSON.parse(await fs.readFile(fileOf(d, key), "utf8")) as { value: unknown; version: number; t: number };
      // a concurrent load may have populated memory meanwhile
      const again = mem.get(key);
      if (again) return again;
      mem.set(key, raw);
      return raw;
    } catch {
      return null;
    }
  };
  const writes = new Map<string, Promise<void>>();
  const persist = (key: string, rec: { value: unknown; version: number; t: number }) => {
    const prev = writes.get(key) ?? Promise.resolve();
    const next = prev.then(async () => {
      const d = await dir();
      if (!d) return;
      const f = fileOf(d, key);
      const tmp = `${f}.${rec.version}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(rec));
      await fs.rename(tmp, f);
    });
    writes.set(
      key,
      next.catch(() => {}),
    );
  };
  return {
    name: "file",
    async get(key) {
      const r = await load(key);
      return r ? { value: r.value, version: String(r.version) } : null;
    },
    async getMany(keys) {
      const out = new Map<string, Row>();
      for (const k of keys) {
        const r = await load(k);
        if (r) out.set(k, { value: r.value, version: String(r.version) });
      }
      return out;
    },
    async put(key, value, expect) {
      const cur = await load(key);
      if (expect === null ? cur !== null : !cur || String(cur.version) !== expect) return null;
      const rec = { value, version: (cur?.version ?? 0) + 1, t: Date.now() };
      mem.set(key, rec);
      persist(key, rec);
      return String(rec.version);
    },
    async del(key) {
      mem.delete(key);
      const d = await dir();
      if (d) await fs.rm(fileOf(d, key), { force: true });
    },
    async prune(prefix, before) {
      const d = await dir();
      if (!d) return 0;
      let n = 0;
      const enc = encodeURIComponent(prefix);
      for (const f of await fs.readdir(d)) {
        if (!f.startsWith(enc) || !f.endsWith(".json")) continue;
        const key = decodeURIComponent(f.slice(0, -5));
        const r = await load(key);
        if (r && r.t < before) {
          await this.del(key);
          n++;
        }
      }
      return n;
    },
  };
}

// ------------------------------------------------------------------ selection + cache
const g = globalThis as unknown as {
  __swarmKv?: Backend;
  __swarmKvCache?: Map<string, { value: unknown; version: string | null; at: number }>;
};

function onNetlify(): boolean {
  return !!(process.env.NETLIFY_BLOBS_CONTEXT || (globalThis as { netlifyBlobsContext?: unknown }).netlifyBlobsContext || process.env.NETLIFY);
}

function backend(): Backend {
  if (g.__swarmKv) return g.__swarmKv;
  if (config.databaseUrl) g.__swarmKv = postgresBackend(config.databaseUrl);
  else if (onNetlify()) g.__swarmKv = blobsBackend();
  else g.__swarmKv = fileBackend();
  return g.__swarmKv;
}

const cache = () => {
  if (!g.__swarmKvCache) g.__swarmKvCache = new Map();
  return g.__swarmKvCache;
};

export function kvBackendName(): string {
  return backend().name;
}

export class KvConflictError extends Error {}

/** Read a key. `maxAgeMs` allows serving from this instance's cache (0 = always fresh, file backend is always fresh). */
export async function kvGet<T>(key: string, maxAgeMs = 0): Promise<T | null> {
  const b = backend();
  const c = cache().get(key);
  if (c && (b.name === "file" || Date.now() - c.at <= maxAgeMs)) return c.value as T | null;
  const row = await b.get(key);
  cache().set(key, { value: row?.value ?? null, version: row?.version ?? null, at: Date.now() });
  return (row?.value ?? null) as T | null;
}

export async function kvGetMany<T>(keys: string[], maxAgeMs = 0): Promise<Map<string, T>> {
  const b = backend();
  const out = new Map<string, T>();
  const missing: string[] = [];
  const now = Date.now();
  for (const k of keys) {
    const c = cache().get(k);
    if (c && (b.name === "file" || now - c.at <= maxAgeMs)) {
      if (c.value != null) out.set(k, c.value as T);
    } else missing.push(k);
  }
  if (missing.length) {
    const rows = await b.getMany(missing);
    for (const k of missing) {
      const r = rows.get(k);
      cache().set(k, { value: r?.value ?? null, version: r?.version ?? null, at: now });
      if (r) out.set(k, r.value as T);
    }
  }
  return out;
}

/**
 * Optimistic read-modify-write. `fn` receives a private copy (or the init value) and mutates it.
 * Return `false` from fn to skip the write. Retries on concurrent modification.
 */
export async function kvUpdate<T>(key: string, init: () => T, fn: (doc: T) => boolean | void | Promise<boolean | void>, retries = 8): Promise<T> {
  const b = backend();
  for (let attempt = 0; attempt < retries; attempt++) {
    const row = await b.get(key);
    const exists = row !== null;
    const doc: T = exists ? structuredClone(row.value as T) : init();
    const res = await fn(doc);
    if (res === false) {
      cache().set(key, { value: exists ? row.value : null, version: row?.version ?? null, at: Date.now() });
      return exists ? (row.value as T) : doc;
    }
    const ver = await b.put(key, doc, exists ? row.version : null);
    if (ver !== null) {
      cache().set(key, { value: doc, version: ver, at: Date.now() });
      return doc;
    }
    await new Promise((r) => setTimeout(r, 15 + Math.random() * 40 * (attempt + 1)));
  }
  throw new KvConflictError(`kv update conflict on ${key}`);
}

/** Unconditional write (immutable records such as archives). */
export async function kvSet<T>(key: string, value: T): Promise<void> {
  const b = backend();
  for (let attempt = 0; attempt < 6; attempt++) {
    const row = await b.get(key);
    const ver = await b.put(key, value, row ? row.version : null);
    if (ver !== null) {
      cache().set(key, { value, version: ver, at: Date.now() });
      return;
    }
  }
  throw new KvConflictError(`kv set conflict on ${key}`);
}

export async function kvDel(key: string): Promise<void> {
  cache().delete(key);
  await backend().del(key);
}

export async function kvPrune(prefix: string, before: number): Promise<number> {
  for (const k of [...cache().keys()]) if (k.startsWith(prefix)) cache().delete(k);
  return backend().prune(prefix, before);
}

/** Short cross-instance lease (best effort mutual exclusion). */
export async function kvLease(name: string, ttlMs: number, owner: string): Promise<boolean> {
  try {
    let got = false;
    await kvUpdate<{ owner: string; until: number }>(
      `lease:${name}`,
      () => ({ owner: "", until: 0 }),
      (doc) => {
        const now = Date.now();
        if (doc.until > now && doc.owner !== owner) {
          got = false;
          return false;
        }
        doc.owner = owner;
        doc.until = now + ttlMs;
        got = true;
      },
      2,
    );
    return got;
  } catch {
    return false;
  }
}

export async function kvRelease(name: string, owner: string): Promise<void> {
  await kvUpdate<{ owner: string; until: number }>(
    `lease:${name}`,
    () => ({ owner: "", until: 0 }),
    (doc) => {
      if (doc.owner !== owner) return false;
      doc.until = 0;
    },
    2,
  ).catch(() => {});
}
