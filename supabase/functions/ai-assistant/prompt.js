// Pure helpers for the AI assistant (shared by the Edge Function and Node tests).
export const MAX_QUESTION = 800;
const OUT = { within: 'within expected simulated range', concerning: 'potentially concerning simulated pattern', insufficient: 'insufficient reliable data' };

// Only a minimal, de-identified summary of ONE session the caller is allowed to read is sent.
export function summarizeReport(report) {
  if (!report) return null;
  const a = report.analysis || [];
  const counts = a.reduce((m, r) => ({ ...m, [r.outcome]: (m[r.outcome] || 0) + 1 }), {});
  const last = a.slice(-3).map((r) => `at ${r.window_end}s: ${OUT[r.outcome]}${r.rate != null ? `, about ${r.rate} breaths/min` : ''}; ${r.reason}`);
  return [
    `Patch: BreatheGuard ${report.session.patch === 'care' ? 'Care' : 'Quick'} (channels: ${report.session.channels.join(', ')}).`,
    `Scenario: ${report.session.scenario_id}. All data is synthetic.`,
    `Windows: ${a.length} (${Object.entries(counts).map(([k, v]) => `${v} ${OUT[k]}`).join(', ') || 'none yet'}).`,
    `Alerts: ${(report.alerts || []).length}.`,
    last.length ? `Most recent results:\n- ${last.join('\n- ')}` : '',
  ].filter(Boolean).join('\n');
}

// What the assistant may say about the app itself (navigation help).
export const APP_GUIDE = [
  'App guide (connected mode). Patient pages: Live monitor (choose BreatheGuard Care or Quick and a scenario, then Start recording),',
  'My sessions (open a session to watch it, download a PDF or CSV report), Alerts, Care providers (search approved hospitals and verified doctors, share or stop sharing),',
  'Appointments (request, change a pending request, cancel), Notifications (bell icon), AI assistant, Profile (name, baseline, password).',
  'Hospital staff and doctors: Your hospital (application status, doctors), Live patients (only patients who shared with the hospital), Appointments.',
  'Healthcare authority: Reviews (hospitals and doctors, decisions need a reason), Alert rules, Administrators, Audit log.',
  'Outcomes: within expected simulated range; potentially concerning simulated pattern; insufficient reliable data (signals missing, noisy, conflicting or distorted by movement).',
].join(' ');

export function buildAssistantRequest({ question, summary, prescription = null, model, history = [], maxTokens = 600, maxHistory = 20 }) {
  const q = String(question || '').trim();
  if (!q) throw new Error('Ask a question first.');
  if (q.length > MAX_QUESTION) throw new Error(`Keep the question under ${MAX_QUESTION} characters.`);
  const system = [
    'You are the BreatheGuard demo assistant inside a hackathon prototype.',
    'All monitoring data is SYNTHETIC, produced by a simulator. It is not from a real person and not clinically validated.',
    'Explain simulated results, signal quality, alerts and the three outcomes in plain language, and help users find their way around the app.',
    'You may give general, well-established respiratory-health education (for example what breathing rate means), clearly as general information.',
    'Never diagnose, never prescribe, never suggest starting, stopping or changing any medication or dose, never present a result as a real health assessment.',
    'If the user describes real breathing difficulty, chest pain, blue lips, confusion or worsening symptoms, tell them to contact emergency services or a clinician now.',
    'Keep answers under 150 words.',
    APP_GUIDE,
    'Medication: explain prescription wording and general purpose cautiously in plain language; never prescribe, change or confirm doses, never approve combinations, and say you cannot reliably check interactions. Advise asking the prescribing clinician or a pharmacist.',
    'Clearly separate SYNTHETIC monitoring data (simulated, not real measurements) from records a clinician entered, such as prescriptions.',
    'You do not classify readings. The BreatheGuard analysis engine produces the results; never overrule it, never invent readings, never declare the user safe.',
  ].join(' ');
  const ctx = [summary ? `Session summary (synthetic):\n${summary}` : '', prescription ? `Selected prescription (clinician-entered record, not synthetic):\n${prescription}` : ''].filter(Boolean).join('\n\n');
  const content = ctx ? `${ctx}\n\nQuestion: ${q}` : `Question: ${q}`;
  // Java chatbot's ConversationManager rule: keep the last maxHistory-1 turns, starting with a user turn.
  const past = history.slice(-(Math.max(1, maxHistory) - 1) || history.length).filter((m) => m && ['user', 'assistant'].includes(m.role) && m.content)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, 2000) }));
  while (past.length && past[0].role !== 'user') past.shift();
  while (past.length && past[0].role !== 'user') past.shift(); // the API expects to start with a user turn
  // The API needs alternating turns: merge any back-to-back messages from the same speaker.
  const merged = [];
  for (const m of [...past, { role: 'user', content }]) {
    if (merged.length && merged.at(-1).role === m.role) merged.at(-1).content += `\n\n${m.content}`;
    else merged.push({ ...m });
  }
  return { model, max_tokens: maxTokens, system, messages: merged };
}
