import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { join } from "path";

interface DurableTextCacheEntry {
  version: 1;
  ts: number;
  body: string;
}

const CACHE_DIR = process.env.JAPAN_SEASONS_CACHE_DIR?.trim();

function cacheFile(key: string): string | null {
  if (!CACHE_DIR) return null;
  const safeKey = key.replace(/[^a-z0-9._-]/gi, "-");
  return join(CACHE_DIR, `${safeKey}.json`);
}

export function durableCacheEnabled(): boolean {
  return Boolean(CACHE_DIR);
}

export async function readDurableTextCache(key: string): Promise<{ body: string; ts: number } | null> {
  const path = cacheFile(key);
  if (!path) return null;
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<DurableTextCacheEntry>;
    if (parsed.version !== 1 || typeof parsed.ts !== "number" || typeof parsed.body !== "string") return null;
    return { body: parsed.body, ts: parsed.ts };
  } catch {
    return null;
  }
}

export async function writeDurableTextCache(key: string, body: string, ts = Date.now()): Promise<void> {
  const path = cacheFile(key);
  if (!path || !CACHE_DIR) return;
  await mkdir(CACHE_DIR, { recursive: true });
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  const payload: DurableTextCacheEntry = { version: 1, ts, body };
  await writeFile(tmpPath, JSON.stringify(payload), "utf-8");
  await rename(tmpPath, path);
}
