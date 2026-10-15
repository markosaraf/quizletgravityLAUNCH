/** Best-effort instance-local protection. Provider account quotas remain the
 * cross-instance cap; this is not a distributed rate limiter. */
export class ImportGuard {
  private callers = new Map<string, { count: number; until: number }>();
  private pending = new Map<string, Promise<unknown>>();

  allow(caller: string, now = Date.now()): boolean {
    for (const [key, value] of this.callers) {
      if (value.until <= now) this.callers.delete(key);
    }
    const bucket = this.callers.get(caller);
    if (bucket) return ++bucket.count <= 10;
    if (this.callers.size >= 10_000) return false;
    this.callers.set(caller, { count: 1, until: now + 60_000 });
    return true;
  }

  run<T>(key: string, action: () => Promise<T>): Promise<T> | null {
    const existing = this.pending.get(key);
    if (existing) return existing as Promise<T>;
    if (this.pending.size >= 2) return null;
    const task = Promise.resolve().then(action).finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    return task;
  }
}
