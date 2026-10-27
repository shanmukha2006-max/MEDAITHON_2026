// Reliable writer for live monitoring data.
// - Queues observations and analysis results in order.
// - Sends in batches; on failure retries with exponential backoff, keeping everything queued.
// - De-duplicates by key, and the database upsert ignores duplicates, so a retry after a
//   write that actually succeeded (e.g. a lost response) never creates a second row.
// The queue is in memory: data not yet confirmed is lost only if the tab is closed while offline,
// and the status shown to the user says how much is still waiting.
export class SessionRecorder {
  constructor({ writeObservations, writeAnalysis, onStatus = () => {}, baseDelay = 500, maxDelay = 8000, batchSize = 20, sleep }) {
    Object.assign(this, { writeObservations, writeAnalysis, onStatus, baseDelay, maxDelay, batchSize });
    this.sleep = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.obs = new Map(); this.ana = new Map(); this.sentObs = new Set(); this.sentAna = new Set();
    this.attempt = 0; this.busy = false; this.stopped = false; this.saved = 0; this.lastError = null;
    this.status = 'idle';
  }
  setStatus(s) { this.status = s; this.onStatus({ status: s, pending: this.pending(), saved: this.saved, error: this.lastError }); }
  pending() { return this.obs.size + this.ana.size; }
  addObservation(row) { if (!this.sentObs.has(row.seq) && !this.obs.has(row.seq)) this.obs.set(row.seq, row); this.kick(); }
  addAnalysis(row) { if (!this.sentAna.has(row.window_end) && !this.ana.has(row.window_end)) this.ana.set(row.window_end, row); this.kick(); }
  kick() { if (!this.busy && !this.stopped) this.flush(); }
  async flush() {
    if (this.busy) return;
    this.busy = true;
    try {
      while (!this.stopped && this.pending() > 0) {
        const obs = [...this.obs.values()].sort((a, b) => a.seq - b.seq).slice(0, this.batchSize);
        const ana = obs.length ? [] : [...this.ana.values()].sort((a, b) => a.window_end - b.window_end).slice(0, this.batchSize);
        this.setStatus('saving');
        try {
          if (obs.length) await this.writeObservations(obs);
          else await this.writeAnalysis(ana);
          for (const r of obs) { this.obs.delete(r.seq); this.sentObs.add(r.seq); }
          for (const r of ana) { this.ana.delete(r.window_end); this.sentAna.add(r.window_end); }
          this.saved += obs.length + ana.length; this.attempt = 0; this.lastError = null;
        } catch (e) {
          this.attempt += 1; this.lastError = e.message || String(e);
          this.setStatus('retrying');
          await this.sleep(Math.min(this.maxDelay, this.baseDelay * 2 ** (this.attempt - 1)));
        }
      }
      if (!this.stopped) this.setStatus(this.pending() ? 'retrying' : 'saved');
    } finally { this.busy = false; }
  }
  // Wait until everything queued is confirmed (or give up after timeoutMs).
  async drain(timeoutMs = 15000) {
    const t0 = Date.now();
    this.kick();
    while (this.pending() > 0 && Date.now() - t0 < timeoutMs) { await this.sleep(100); this.kick(); }
    return this.pending() === 0;
  }
  stop() { this.stopped = true; this.setStatus('stopped'); }
}
