// Supabase Edge Function: ai-assistant (Deno).
// Deploy:  supabase functions deploy ai-assistant
// Secrets (server-side only):  supabase secrets set AI_PROVIDER=groq GROQ_API_KEY=...  [AI_MODEL=...]
//                          or supabase secrets set AI_PROVIDER=anthropic ANTHROPIC_API_KEY=... [AI_MODEL=...]
// The provider key never reaches the browser. Every database read and write uses the CALLER's
// token, so row-level security limits the assistant to data the caller may already see.
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import { buildAssistantRequest, summarizeReport } from './prompt.js';
import { validateAndNormalize, findRuleResponse } from './chatbot.js';
import { MAX_QUESTION } from './prompt.js';
import { resolveProvider, toProviderRequest, headersFor, fromProviderResponse, classifyProviderError } from './providers.js';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);
  let body: { question?: string; sessionId?: string; prescriptionId?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid request body' }, 400); }
  // From the Java chatbot: normalise/validate input, then answer exact small-talk instantly.
  // Instant replies are fixed text with no user data, need no AI, and are labelled as not AI.
  let question: string;
  try { question = validateAndNormalize(body.question, MAX_QUESTION); } catch (e) { return json({ error: (e as Error).message }, 400); }
  body.question = question;


  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') || '' } }, auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await sb.auth.getUser();
  if (userErr || !userData?.user) return json({ error: 'Sign in to use the assistant.' }, 401);
  const userId = userData.user.id;
  const provider = resolveProvider(Deno.env.toObject());
  if (!provider.ok) return json({ configured: false, message: provider.message }, 503);
  // Instant replies (ported rules) only for signed-in users and only when the AI is configured:
  // a missing key must be reported, not masked by canned replies.
  const instant = !body.sessionId && !body.prescriptionId ? findRuleResponse(question) : null;
  if (instant) return json({ configured: true, answer: instant, model: null, provider: 'BreatheGuard', generatedBy: 'rules', historySaved: false, label: 'Instant reply (not AI).' });

  // Rate limit BEFORE anything is sent to the provider (per user, rolling hour; AI_RATE_LIMIT, default 20).
  const { error: rateErr } = await sb.rpc('ai_rate_check', { p_limit: Number(Deno.env.get('AI_RATE_LIMIT') || 20) });
  if (rateErr) return json({ error: /limit reached/i.test(rateErr.message) ? rateErr.message : 'Could not check the assistant limit. Try again.', retryable: !/limit reached/i.test(rateErr.message) }, 429);

  // Session context: read with the caller's permissions. Another patient's session is refused here.
  let summary = null;
  if (body.sessionId) {
    const { data, error } = await sb.rpc('session_report', { p_session: body.sessionId });
    if (error) return json({ error: 'You do not have access to that session.' }, 403);
    summary = summarizeReport(data);
  }
  // Prescription context only when the patient explicitly selects one, read with the caller's permissions.
  let rxText = null;
  if (body.prescriptionId) {
    const { data, error } = await sb.from('prescriptions').select('medicine, dose_text, instructions, status, start_date, end_date').eq('id', body.prescriptionId).maybeSingle();
    if (error || !data) return json({ error: 'You do not have access to that prescription.' }, 403);
    rxText = `Prescription entered by the patient's doctor (demo record): ${data.medicine}; dose as written: ${data.dose_text}; instructions: ${data.instructions || 'none'}; status: ${data.status}.`;
  }
  const { data: prof } = await sb.from('profiles').select('ai_history_opt_in').eq('id', userId).maybeSingle();
  const saveHistory = !!prof?.ai_history_opt_in;
  const { data: history } = saveHistory ? await sb.from('ai_messages').select('role, content').eq('user_id', userId).order('created_at', { ascending: false }).limit(provider.maxHistory) : { data: [] };

  let request;
  try { request = buildAssistantRequest({ question: body.question, summary, prescription: rxText, history: (history || []).reverse(), model: provider.model, maxTokens: provider.maxTokens, maxHistory: provider.maxHistory }); }
  catch (e) { return json({ error: (e as Error).message }, 400); }

  let out;
  try {
    const r = await fetch(provider.url, { method: 'POST', headers: headersFor(provider), body: JSON.stringify(toProviderRequest(provider, request)), signal: AbortSignal.timeout(provider.timeoutMs) });
    if (!r.ok) { const e = classifyProviderError(r.status, await r.text().catch(() => ''), provider); return json({ error: e.message, retryable: e.retryable }, 502); }
    out = await r.json();
  } catch (e) { const timedOut = (e as Error)?.name === 'TimeoutError'; return json({ error: timedOut ? `The AI provider (${provider.label}) did not answer within ${provider.timeoutMs / 1000} seconds. Try again.` : `Could not reach the AI provider (${provider.label}). Check the server's internet access and try again.`, retryable: true }, 502); }

  const { answer, model: answeredBy } = fromProviderResponse(provider, out);
  if (!answer) return json({ error: 'The AI provider returned an empty answer. Try again.', retryable: true }, 502);
  // Save the exchange ONLY if the user opted in (profiles.ai_history_opt_in); own rows only under RLS.
  // Explicit, ordered timestamps: question first, answer 1 ms later (one insert would give both the same time).
  const asked = new Date();
  if (saveHistory) await sb.from('ai_messages').insert([
    { user_id: userId, session_id: body.sessionId || null, role: 'user', content: String(body.question).slice(0, 8000), created_at: asked.toISOString() },
    { user_id: userId, session_id: body.sessionId || null, role: 'assistant', content: answer.slice(0, 8000), model: answeredBy, created_at: new Date(asked.getTime() + 1).toISOString() },
  ]);
  return json({ configured: true, answer, model: answeredBy, provider: provider.label, generatedBy: 'model', historySaved: saveHistory, label: 'AI-generated explanation of SYNTHETIC data. Not medical advice.' });
}

if (import.meta.main) Deno.serve(handler);
