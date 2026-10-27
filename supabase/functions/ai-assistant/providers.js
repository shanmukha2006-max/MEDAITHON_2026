// AI provider adapters (pure, shared by the Edge Function and Node tests).
// Choose with AI_PROVIDER=groq|anthropic (or let the available key decide).
// Keys are read from SERVER-SIDE secrets only and are never returned, logged or put in messages.
// Mirrors the Java chatbot's AIConfig.Provider list (Groq default; Gemini, OpenAI, Anthropic, custom).
export const PROVIDERS = {
  gemini: { keyEnv: 'GEMINI_API_KEY', keyPrefix: 'AIza', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', defaultModel: 'gemini-3.8-flash', format: 'openai', label: 'Google Gemini' },
  openai: { keyEnv: 'OPENAI_API_KEY', keyPrefix: 'sk-', url: 'https://api.openai.com/v1/chat/completions', defaultModel: null, format: 'openai', label: 'OpenAI' },
  custom: { keyEnv: 'AI_API_KEY', keyPrefix: '', url: null, defaultModel: null, format: 'openai', label: 'Custom (OpenAI-compatible)' },
  groq: { keyEnv: 'GROQ_API_KEY', keyPrefix: 'gsk_', url: 'https://api.groq.com/openai/v1/chat/completions', defaultModel: 'llama-3.3-70b-versatile', format: 'openai', label: 'Groq' },
  anthropic: { keyEnv: 'ANTHROPIC_API_KEY', keyPrefix: 'sk-ant-', url: 'https://api.anthropic.com/v1/messages', defaultModel: 'claude-haiku-5-5', format: 'anthropic', label: 'Anthropic' },
};

// env: object with string values (Deno.env.toObject() or process.env)
export function resolveProvider(env) {
  const wanted = String(env.AI_PROVIDER || '').trim().toLowerCase();
  const name = wanted || (env.GROQ_API_KEY ? 'groq' : env.ANTHROPIC_API_KEY ? 'anthropic' : env.AI_API_KEY ? 'groq' : '');
  if (!name) return { ok: false, message: 'The AI assistant is not configured: the server has no AI provider key (set AI_API_KEY, GROQ_API_KEY or ANTHROPIC_API_KEY as a server secret). See docs/BACKEND_SETUP.md, section 6.' };
  const p = PROVIDERS[name];
  if (!p) return { ok: false, message: `The AI assistant is not configured: unknown AI_PROVIDER “${name}”. Use groq, gemini, openai, anthropic or custom.` };
  // Like the Java chatbot, a generic AI_API_KEY works for any provider; a provider-specific secret wins.
  const key = String(env[p.keyEnv] || env.AI_API_KEY || '').trim();
  if (!key) return { ok: false, message: `The AI assistant is not configured: AI_PROVIDER is ${name} but the server has no ${p.keyEnv} or AI_API_KEY secret.` };
  if (p.keyPrefix && !key.startsWith(p.keyPrefix)) return { ok: false, message: `The AI assistant is not configured: the key does not look like a ${p.label} key (it should start with “${p.keyPrefix}”). Check that the key and AI_PROVIDER match.` };
  const url = env.AI_API_URL || p.url;
  if (!url) return { ok: false, message: `The AI assistant is not configured: AI_PROVIDER ${name} needs AI_API_URL.` };
  if (!/^https:\/\//.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(url)) return { ok: false, message: 'The AI assistant is not configured: AI_API_URL must use https:// (http is allowed only for localhost).' };
  const model = env.AI_MODEL || p.defaultModel;
  if (!model) return { ok: false, message: `The AI assistant is not configured: AI_PROVIDER ${name} needs AI_MODEL.` };
  const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? Math.floor(n) : d; };
  return { ok: true, name, label: p.label, format: p.format, key, url, model,
    maxTokens: num(env.AI_MAX_TOKENS, 1024, 64, 4096), maxHistory: num(env.AI_MAX_HISTORY, 20, 1, 50), timeoutMs: num(env.AI_TIMEOUT_SECONDS, 60, 5, 120) * 1000 };
}

// req: { model, max_tokens, system, messages:[{role,content}] } (the provider-neutral request)
export function toProviderRequest(p, req) {
  if (p.format === 'openai') return { model: req.model, max_tokens: req.max_tokens, temperature: 0.3, messages: [{ role: 'system', content: req.system }, ...req.messages] };
  return req;
}
export function headersFor(p) {
  return p.format === 'openai'
    ? { Authorization: `Bearer ${p.key}`, 'content-type': 'application/json' }
    : { 'x-api-key': p.key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
}
export function fromProviderResponse(p, out) {
  if (p.format === 'openai') return { answer: String(out?.choices?.[0]?.message?.content || '').trim(), model: out?.model || p.model };
  return { answer: (out?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim(), model: out?.model || p.model };
}

// Turn a provider HTTP failure into a safe message. Provider bodies are not echoed (they can contain
// account details); only a recognised reason is used.
export function classifyProviderError(status, bodyText = '', p = { label: 'AI provider', model: '' }) {
  const b = String(bodyText).toLowerCase();
  const pre = `The AI provider returned an error (${status})`;
  if (status === 401 || status === 403) return { message: `${pre}: it rejected the server’s API key (invalid, revoked or for a different provider). Update the server secret.`, retryable: false };
  if (status === 429) return { message: `${pre}: rate limit or quota reached. Wait a minute and try again.`, retryable: true };
  if (status === 404 || (status === 400 && /model/.test(b) && /(not found|not exist|decommission|invalid|unknown)/.test(b))) return { message: `${pre}: the configured model “${p.model}” is not available. Set AI_MODEL to a model your account can use.`, retryable: false };
  if (status >= 500) return { message: `${pre}: the provider is unavailable or overloaded. Try again in a moment.`, retryable: true };
  return { message: `${pre}. Try again in a moment.`, retryable: true };
}
