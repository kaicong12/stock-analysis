// Concurrency primitives: a counting semaphore and a bounded parallel map.

/** Counting semaphore capping how many holders may run at once. */
export class Semaphore {
  private active = 0;
  private waiters: (() => void)[] = [];
  constructor(private readonly max: number) {}
  /** Waits for a slot and resolves with the function that releases it. */
  acquire(): Promise<() => void> {
    return new Promise<() => void>((resolve) => {
      const tryAcquire = () => {
        if (this.active < this.max) {
          this.active++;
          resolve(() => this.release());
        } else {
          this.waiters.push(tryAcquire);
        }
      };
      tryAcquire();
    });
  }
  // Frees a slot and wakes the next waiter.
  private release(): void {
    this.active--;
    const next = this.waiters.shift();
    if (next) next();
  }
}

/** Maps fn over items with at most n running at once, preserving input order. */
export async function runWithConcurrency<I, O>(
  items: I[],
  n: number,
  fn: (item: I, idx: number) => Promise<O>,
): Promise<O[]> {
  const out: O[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(n, Math.max(1, items.length)) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
