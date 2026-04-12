import { logger } from "./logger.js";

interface CacheEntry<T> {
  data: T;
  expires: number;
}

const MAX_CACHE_SIZE = 10_000;

export class Cache {
  private store = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expires) {
      this.store.delete(key);
      return null;
    }
    return entry.data as T;
  }

  set<T>(key: string, data: T, ttlMs: number): void {
    if (this.store.size >= MAX_CACHE_SIZE) {
      // Evict the entry closest to expiry (true LRU-by-TTL), not just insertion order
      let evictKey: string | undefined;
      let minExpires = Infinity;
      for (const [k, v] of this.store) {
        if (v.expires < minExpires) { minExpires = v.expires; evictKey = k; }
      }
      if (evictKey !== undefined) this.store.delete(evictKey);
    }
    this.store.set(key, { data, expires: Date.now() + ttlMs });
  }

  async getOrFetch<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) return cached;
    const data = await fn();
    this.set(key, data, ttlMs);
    return data;
  }

  /** Remove all expired entries */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expires) this.store.delete(key);
    }
  }

  /** Flush entire cache */
  flush(): void {
    const count = this.store.size;
    this.store.clear();
    if (count > 0) logger.info(`Cache flushed: ${count} entries cleared`);
  }

  get size(): number {
    return this.store.size;
  }
}

export const cache = new Cache();

// Periodic cleanup every 10 minutes
setInterval(() => cache.cleanup(), 10 * 60 * 1000).unref();

// ─── Daily 9 AM JST cache flush ─────────────────────────────────────────────
// n-kishou updates bloom meters at 9 AM JST (00:00 UTC).
// Flush all cached data so users get fresh data immediately.

function msUntilNext9amJST(): number {
  const now = new Date();
  // 9 AM JST = 00:00 UTC
  const next = new Date(now);
  next.setUTCHours(0, 0, 0, 0);
  if (now.getTime() >= next.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime() - now.getTime();
}

function scheduleDailyFlush() {
  const ms = msUntilNext9amJST();
  const hours = Math.round(ms / 3600000 * 10) / 10;
  logger.info(`Next cache flush (9 AM JST) in ${hours} hours`);

  setTimeout(() => {
    logger.info("9 AM JST — flushing cache for fresh bloom data");
    cache.flush();
    // Reschedule rather than using setInterval so each flush recalculates
    // the next exact 9 AM JST, preventing drift over days.
    scheduleDailyFlush();
  }, ms).unref();
}

scheduleDailyFlush();

// TTL constants (milliseconds, used for in-process cache)
// CDN max-age values in api.ts are derived from these (divide by 1000)
export const TTL = {
  FORECAST:    1 * 60 * 60 * 1000,    // 1 hour
  SPOTS:       3 * 60 * 60 * 1000,    // 3 hours
  WEATHER:     1 * 60 * 60 * 1000,    // 1 hour
  WEATHER_CDN: 30 * 60 * 1000,        // 30 min — CDN edge cache on top of server cache
  HISTORICAL:  24 * 60 * 60 * 1000,   // 24 hours
  AREAS:       7 * 24 * 60 * 60 * 1000, // 7 days
};
