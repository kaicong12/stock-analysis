export class Semaphore {
  private active = 0;
  private waiters: (() => void)[] = [];
  constructor(private readonly max: number) {}
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
  private release(): void {
    this.active--;
    const next = this.waiters.shift();
    if (next) next();
  }
}

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
