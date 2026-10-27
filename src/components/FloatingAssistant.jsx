import { useEffect, useRef, useState } from 'react';
import { Sparkles, X, Send, RefreshCcw, AlertTriangle } from 'lucide-react';
import * as api from '../backend/api.js';
import { useCloud } from '../cloud/CloudContext.jsx';

const MAX = 800;

// One shared floating assistant for the patient layouts. Mounted once in the layout, so the
// conversation survives navigation between pages. Real answers come only from the server-side
// AI function; when that is not possible the panel says exactly why and never makes one up.
export default function FloatingAssistant({ mode = 'cloud' }) {
  const cloud = useCloud();
  const live = mode === 'cloud' && cloud?.state === 'signed-in' && cloud.profile?.role === 'patient';
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [sessionId, setSessionId] = useState('');
  const [sessions, setSessions] = useState(null);
  const btnRef = useRef(null), inputRef = useRef(null), endRef = useRef(null);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 30); }, [open]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [msgs, busy, err]);
  useEffect(() => {
    if (!open || !live || sessions) return;
    api.listSessions(cloud.sb, 20).then(setSessions).catch(() => setSessions([]));
  }, [open, live]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => { setOpen(false); setTimeout(() => btnRef.current?.focus(), 0); };
  const ask = async (question, isRetry = false) => {
    const text = String(question || '').trim();
    if (!text || busy) return;
    if (text.length > MAX) { setErr({ text: `Keep the question under ${MAX} characters.` }); return; }
    if (!isRetry) setMsgs((m) => [...m, { id: `u${Date.now()}`, role: 'user', content: text }]);
    setQ(''); setErr(null); setBusy(true);
    try {
      const out = await api.askAssistant(cloud.sb, { question: text, sessionId: sessionId || undefined });
      if (out?.configured === false) setMsgs((m) => [...m, { id: `s${Date.now()}`, role: 'system', content: `AI is not set up on the server: ${out.message} No answer was generated.` }]);
      else setMsgs((m) => [...m, { id: `a${Date.now()}`, role: 'assistant', content: out.answer, model: out.model, rules: out.generatedBy === 'rules' }]);
    } catch (e) { setErr({ text: e.message, question: text }); }
    finally { setBusy(false); }
  };
  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(q); } };

  let reason = null;
  if (!live) {
    if (mode === 'demo') reason = cloud?.backend?.state === 'connected-verified'
      ? 'You are using a local demo account. BreatheGuard AI only works with a real patient account: sign out and use “Connected mode” on the login screen. Demo accounts never send data to an AI.'
      : `BreatheGuard AI needs connected mode, and this app’s backend is not ready (${cloud?.backend?.title || 'configuration required'}). Demo accounts never send data to an AI. See docs/BACKEND_SETUP.md.`;
    else reason = 'BreatheGuard AI is available to signed-in patients.';
  }

  return (
    <>
      <button ref={btnRef} className="fab" onClick={() => (open ? close() : setOpen(true))} aria-expanded={open} aria-controls="bg-ai-panel" data-testid="ai-fab">
        <Sparkles size={18} aria-hidden /><span>BreatheGuard AI</span>
      </button>
      {open && (
        <section id="bg-ai-panel" className="fab-panel" role="dialog" aria-label="BreatheGuard AI assistant" onKeyDown={(e) => e.key === 'Escape' && close()} data-testid="ai-panel">
          <header className="fab-head">
            <strong className="row" style={{ gap: 6 }}><Sparkles size={16} />BreatheGuard AI</strong>
            <button className="btn ghost sm" onClick={close} aria-label="Close assistant"><X size={16} /></button>
          </header>
          <p className="fab-emergency"><AlertTriangle size={13} aria-hidden /> Severe breathing difficulty? Call emergency services now. This assistant cannot help in an emergency.</p>
          {reason ? <div className="fab-body"><div className="notice warn small" role="status" data-testid="ai-unavailable">{reason}</div></div> : (
            <>
              <div className="fab-ctx">
                <label className="tiny" htmlFor="bg-ai-ctx">About</label>
                <select id="bg-ai-ctx" className="select" value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
                  <option value="">General question (no personal data sent)</option>
                  {(sessions || []).map((s) => <option key={s.id} value={s.id}>Saved session: {new Date(s.started_at).toLocaleString()} · {s.patch === 'care' ? 'Care' : 'Quick'} · {s.scenario_id}</option>)}
                </select>
              </div>
              <div className="fab-body" aria-live="polite" data-testid="ai-messages">
                {msgs.length === 0 && <p className="small muted">Ask how BreatheGuard works, what a result means, why a session was classified as it was, or how to use a page. Answers come from an AI model on the server and are not medical advice.</p>}
                {msgs.map((m) => (
                  <div key={m.id} className={`fab-msg ${m.role}`}>
                    <span className="tiny muted">{m.role === 'user' ? 'You' : m.role === 'assistant' ? 'BreatheGuard AI' : 'Notice'}</span>
                    <p style={{ whiteSpace: 'pre-wrap' }}>{m.content}</p>
                    {m.role === 'assistant' && <span className="tiny muted">{m.rules ? 'Instant reply (not AI).' : `AI-generated by ${m.model}. Explains simulated data; not medical advice.`}</span>}
                  </div>
                ))}
                {busy && <p className="small muted" role="status">Thinking…</p>}
                {err && <div className="notice bad small" role="alert">{err.text}{err.question && <button className="btn sm" style={{ marginLeft: 8 }} onClick={() => ask(err.question, true)}><RefreshCcw size={13} />Retry</button>}</div>}
                <div ref={endRef} />
              </div>
              <div className="fab-input">
                <textarea ref={inputRef} className="textarea" rows={2} maxLength={MAX} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Ask a question…" aria-label="Your question" />
                <button className="btn primary" onClick={() => ask(q)} disabled={busy || !q.trim()} aria-label="Send"><Send size={16} /></button>
              </div>
            </>
          )}
        </section>
      )}
    </>
  );
}
