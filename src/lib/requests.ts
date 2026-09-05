export const REQUEST_TIMEOUT_MS = 20_000;
export async function withTimeout<T>(request: Promise<T>, milliseconds = REQUEST_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([request, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Price request timed out. Retry when connected.')), milliseconds); })]); }
  finally { if (timer) clearTimeout(timer); }
}
/** One active request, one coalesced follow-up, and an identity for stale-result rejection. */
export class RefreshQueue {
  generation = 0;
  private running = false;
  private pending = false;
  invalidate() { this.generation++; }
  async run(work: (generation: number) => Promise<void>): Promise<void> {
    if (this.running) { this.pending = true; return; }
    this.running = true;
    try { do { this.pending = false; await work(this.generation); } while (this.pending); }
    finally { this.running = false; }
  }
}
