import { logger } from "./logger.js";

const USER_AGENT = "japan-seasons-mcp/0.3.0";
const FETCH_TIMEOUT_MS = 15_000; // 15 second timeout
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 500; // exponential backoff: 500ms → 1s → 2s

// ─── Outbound rate limiter: max N upstream requests per second ────────────────

const OUTBOUND_RATE_LIMIT = 5;
let outboundCount = 0;
let outboundResetAt = 0;

async function waitForOutboundSlot(): Promise<void> {
  const now = Date.now();
  if (now > outboundResetAt) {
    outboundCount = 0;
    outboundResetAt = now + 1000;
  }
  if (outboundCount >= OUTBOUND_RATE_LIMIT) {
    const waitMs = outboundResetAt - now;
    await new Promise((r) => setTimeout(r, waitMs));
    outboundCount = 0;
    outboundResetAt = Date.now() + 1000;
  }
  outboundCount++;
}

// ─── Circuit breaker per host ────────────────────────────────────────────────

interface CircuitState {
  failures: number;
  openUntil: number; // timestamp when circuit can half-open
}

const CIRCUIT_FAILURE_THRESHOLD = 5; // open after 5 consecutive failures
const CIRCUIT_OPEN_DURATION_MS = 30_000; // stay open for 30s before half-open probe
const circuits = new Map<string, CircuitState>();

function getHost(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

function checkCircuit(host: string): void {
  const state = circuits.get(host);
  if (!state) return;
  if (state.failures >= CIRCUIT_FAILURE_THRESHOLD && Date.now() < state.openUntil) {
    throw new Error(`Circuit open for ${host} — upstream is down. Retry after ${Math.ceil((state.openUntil - Date.now()) / 1000)}s.`);
  }
}

function recordSuccess(host: string): void {
  circuits.delete(host);
}

function recordFailure(host: string): void {
  const state = circuits.get(host) ?? { failures: 0, openUntil: 0 };
  state.failures++;
  if (state.failures >= CIRCUIT_FAILURE_THRESHOLD) {
    state.openUntil = Date.now() + CIRCUIT_OPEN_DURATION_MS;
    logger.warn(`Circuit opened for ${host} after ${state.failures} failures`);
  }
  circuits.set(host, state);
}

// ─── safeFetch: timeout + retry + backoff + jitter + circuit breaker ─────────

export async function safeFetch(url: string, options?: RequestInit): Promise<Response> {
  const host = getHost(url);
  checkCircuit(host);
  await waitForOutboundSlot();

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          "User-Agent": USER_AGENT,
          ...options?.headers,
        },
      });

      if (res.ok) {
        recordSuccess(host);
        return res;
      }

      // Don't retry client errors (4xx) except 429 (rate limited)
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        throw new Error(`API error ${res.status}: ${res.statusText} (${url})`);
      }

      lastError = new Error(`API error ${res.status}: ${res.statusText}`);
      logger.warn(`Upstream ${res.status} on attempt ${attempt + 1}/${MAX_RETRIES + 1} for ${host}`);
    } catch (e: any) {
      if (e.message?.includes("Circuit open")) throw e;
      if (e.name === "TimeoutError" || e.name === "AbortError") {
        lastError = new Error(`Upstream timeout after ${FETCH_TIMEOUT_MS}ms: ${host}`);
      } else if (e.message?.includes("API error")) {
        throw e; // Don't retry 4xx
      } else {
        lastError = e;
      }
      logger.warn(`Fetch error attempt ${attempt + 1}/${MAX_RETRIES + 1} for ${host}: ${lastError?.message}`);
    }

    // Exponential backoff with jitter before retry
    if (attempt < MAX_RETRIES) {
      const backoff = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      const jitter = Math.floor(Math.random() * backoff * 0.5);
      await new Promise((r) => setTimeout(r, backoff + jitter));
    }
  }

  recordFailure(host);
  throw lastError ?? new Error(`Failed to fetch ${url}`);
}
