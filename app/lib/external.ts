// Shared plumbing for the external paper APIs (arXiv, Semantic Scholar):
// global request spacing, so the public route never exceeds an API's rate
// limit, and a small in-memory cache for repeated lookups.

export class BusyError extends Error {}

export class Throttle {
  private nextSlot = 0;
  constructor(
    private spacingMs: number,
    private maxWaitMs: number
  ) {}

  // Waits for the next free slot; throws BusyError rather than queueing long.
  async acquire() {
    const now = Date.now();
    const wait = Math.max(0, this.nextSlot - now);
    if (wait > this.maxWaitMs) throw new BusyError("request queue full");
    this.nextSlot = now + wait + this.spacingMs;
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

export class TtlCache<T> {
  private entries = new Map<string, { at: number; value: T }>();
  constructor(
    private ttlMs: number,
    private maxEntries: number
  ) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    return entry && Date.now() - entry.at < this.ttlMs ? entry.value : undefined;
  }

  set(key: string, value: T) {
    if (this.entries.size >= this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value!);
    }
    this.entries.set(key, { at: Date.now(), value });
  }
}

export function truncate(text: string, max: number) {
  return text.length > max ? text.slice(0, max) + "…" : text;
}
