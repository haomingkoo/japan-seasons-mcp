import { createHash, randomBytes } from "crypto";

/**
 * Counts distinct visitors per UTC day without keeping raw IPs.
 * Each IP is stored only as a salted hash; the salt is random per process
 * and both the salt and the set are discarded when the day changes.
 */
export class DailyUniqueVisitors {
  private day = "";
  private salt = Buffer.alloc(0);
  private seen = new Set<string>();

  add(ip: string, now: Date = new Date()): void {
    this.rotateIfNewDay(now);
    this.seen.add(createHash("sha256").update(this.salt).update(ip).digest("hex").slice(0, 32));
  }

  count(now: Date = new Date()): number {
    this.rotateIfNewDay(now);
    return this.seen.size;
  }

  /** Exposed for tests: the stored values must never contain the raw IP. */
  storedValues(): string[] {
    return [...this.seen];
  }

  private rotateIfNewDay(now: Date): void {
    const today = now.toISOString().slice(0, 10);
    if (today === this.day) return;
    this.day = today;
    this.salt = randomBytes(32);
    this.seen = new Set();
  }
}
