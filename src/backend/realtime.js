// Ordering and de-duplication for live observations, plus the Supabase subscription.
// Realtime events can arrive out of order, twice, or not at all during a reconnect.
// OrderedStream releases items strictly in seq order, drops duplicates, and reports the
// last seq it delivered so a reconnect can backfill exactly what was missed.
export class OrderedStream {
  constructor(onItems, { maxBuffer = 600 } = {}) { this.onItems = onItems; this.lastSeq = -1; this.buffer = new Map(); this.maxBuffer = maxBuffer; this.duplicates = 0; }
  push(items) {
    for (const it of [].concat(items)) {
      if (it.seq <= this.lastSeq || this.buffer.has(it.seq)) { this.duplicates++; continue; }
      this.buffer.set(it.seq, it);
    }
    const out = [];
    while (this.buffer.has(this.lastSeq + 1)) { const it = this.buffer.get(this.lastSeq + 1); this.buffer.delete(this.lastSeq + 1); this.lastSeq++; out.push(it); }
    if (out.length) this.onItems(out); // deliver what is ready BEFORE any skip-ahead
    if (this.buffer.size > this.maxBuffer) { // a gap that never fills: skip ahead rather than stall forever
      this.skipped = (this.skipped || 0) + (Math.min(...this.buffer.keys()) - this.lastSeq - 1);
      this.lastSeq = Math.min(...this.buffer.keys()) - 1;
      return out.concat(this.push([]));
    }
    return out;
  }
  hasGap() { return this.buffer.size > 0; }
}

// Subscribe to one session's new rows. Delivery is filtered by the database's row-level
// security for the signed-in user, so revoked consent stops further events.
export function subscribeSession(sb, sessionId, { onObservation, onAnalysis, onAlert, onSession, onStatus }) {
  const f = `session_id=eq.${sessionId}`;
  const ch = sb.channel(`bg-session-${sessionId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'observations', filter: f }, (p) => onObservation?.(p.new))
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'analysis_results', filter: f }, (p) => onAnalysis?.(p.new))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'alerts', filter: f }, (p) => onAlert?.(p.new))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'monitoring_sessions', filter: `id=eq.${sessionId}` }, (p) => onSession?.(p.new))
    .subscribe((status, err) => onStatus?.(status, err));
  return () => { sb.removeChannel(ch); };
}

// Live list of sessions visible to this user (new sessions appear without refresh).
export function subscribeSessionList(sb, { onChange, onStatus }) {
  const ch = sb.channel('bg-session-list')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'monitoring_sessions' }, (p) => onChange?.(p))
    .subscribe((status) => onStatus?.(status));
  return () => { sb.removeChannel(ch); };
}

// Generic change feed for one table (RLS-filtered). Used for notifications and appointments.
export function subscribeTable(sb, table, { filter, onChange, onStatus } = {}) {
  const ch = sb.channel(`bg-${table}-${filter || 'all'}-${Math.random().toString(36).slice(2, 7)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) }, (p) => onChange?.(p))
    .subscribe((status) => onStatus?.(status));
  return () => { sb.removeChannel(ch); };
}
