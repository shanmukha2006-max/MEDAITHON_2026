// Ported from the team's Java chatbot (java-ai-chatbot): TextPreprocessor, RuleBasedResponder and
// ConversationManager.buildContext, adapted to BreatheGuard. Pure functions, used by the Edge Function.

// ---- TextPreprocessor ----
export function normalizeWhitespace(input) {
  if (input == null) return '';
  return String(input).replace(/\r\n?/g, '\n').replace(/[ \t\v\f]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}
export function normalizeForMatching(input) {
  if (input == null) return '';
  return String(input).toLowerCase().replace(/['’]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}
export function validateAndNormalize(input, maxLength) {
  const text = normalizeWhitespace(input);
  if (!text) throw new Error('Please type a message before sending.');
  if (text.length > maxLength) throw new Error(`Your message is too long (${text.length} characters). The limit is ${maxLength} characters.`);
  return text;
}

// ---- RuleBasedResponder: instant small-talk on an EXACT phrase match only (anything else goes to the AI) ----
const RULES = [
  [['hello', 'hello there', 'hi', 'hi there', 'hey', 'hey there'], 'Hello! I’m BreatheGuard AI. Ask me about your simulated sessions, the patches, appointments or how to use the app.'],
  [['how are you', 'how are you doing', 'how r u'], 'I’m working well, thanks. How can I help with BreatheGuard today?'],
  [['what is your name', 'whats your name', 'who are you'], 'I’m BreatheGuard AI, the assistant in this app. I explain simulated monitoring results and app features; I can’t diagnose or give medical advice.'],
  [['bye', 'goodbye', 'bye bye', 'see you'], 'Goodbye! If you ever have real breathing difficulty, seek medical help straight away.'],
  [['thanks', 'thank you', 'thank you very much'], 'You’re welcome!'],
];
const KB = new Map(RULES.flatMap(([phrases, reply]) => phrases.map((p) => [normalizeForMatching(p), reply])));
export function findRuleResponse(message) { return KB.get(normalizeForMatching(message)) ?? null; }

// ---- ConversationManager.buildContext: last N messages, always starting with a user message ----
export function buildContext(history, newUserText, maxContextMessages = 20) {
  const max = Math.max(1, Number(maxContextMessages) || 20);
  const past = history.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content);
  const ctx = past.slice(past.length - Math.min(past.length, max - 1)).map((m) => ({ role: m.role, content: String(m.content).slice(0, 2000) }));
  ctx.push({ role: 'user', content: newUserText });
  while (ctx.length && ctx[0].role !== 'user') ctx.shift();
  return ctx;
}
