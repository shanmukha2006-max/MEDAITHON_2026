import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProvider, toProviderRequest, headersFor, fromProviderResponse, classifyProviderError } from '../supabase/functions/ai-assistant/providers.js';

const GROQ = 'gsk_unit_test_value_not_real';
test('no key → honest “not configured”, naming the secrets to set', () => {
  const r = resolveProvider({});
  assert.equal(r.ok, false); assert.match(r.message, /GROQ_API_KEY or ANTHROPIC_API_KEY/);
});
test('a Groq key is detected; the model defaults to a Groq model unless AI_MODEL is set', () => {
  const r = resolveProvider({ GROQ_API_KEY: GROQ });
  assert.equal(r.name, 'groq'); assert.equal(r.url, 'https://api.groq.com/openai/v1/chat/completions'); assert.equal(r.model, 'llama-3.3-70b-versatile');
  assert.equal(resolveProvider({ GROQ_API_KEY: GROQ, AI_MODEL: 'my-chatbot-model' }).model, 'my-chatbot-model');
});
test('a key that does not match the chosen provider is caught, without revealing it', () => {
  const r = resolveProvider({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: GROQ });
  assert.equal(r.ok, false); assert.match(r.message, /does not look like a Anthropic key/); assert.ok(!r.message.includes(GROQ));
  assert.match(resolveProvider({ AI_PROVIDER: 'groq' }).message, /no GROQ_API_KEY/);
  assert.match(resolveProvider({ AI_PROVIDER: 'openai-ish' }).message, /unknown AI_PROVIDER/);
});
test('Groq requests use the chat-completions format with the safety prompt first and a Bearer key', () => {
  const p = resolveProvider({ GROQ_API_KEY: GROQ });
  const body = toProviderRequest(p, { model: p.model, max_tokens: 600, system: 'SAFETY RULES', messages: [{ role: 'user', content: 'hi' }] });
  assert.deepEqual(body.messages[0], { role: 'system', content: 'SAFETY RULES' }); assert.equal(body.messages[1].content, 'hi');
  assert.equal(headersFor(p).Authorization, `Bearer ${GROQ}`);
  assert.deepEqual(fromProviderResponse(p, { model: 'm', choices: [{ message: { content: ' answer ' } }] }), { answer: 'answer', model: 'm' });
});
test('provider errors become clear, safe messages; retry only when it can help', () => {
  const p = { label: 'Groq', model: 'llama-x' };
  const cases = [[401, /rejected the server’s API key/, false], [429, /rate limit/, true], [404, /model “llama-x” is not available/, false], [400, /model “llama-x” is not available/, false, '{"error":{"message":"The model `llama-x` has been decommissioned"}}'], [503, /unavailable or overloaded/, true], [418, /Try again/, true]];
  for (const [status, re, retry, body] of cases) {
    const e = classifyProviderError(status, body || '{"error":{"message":"secret account text gsk_abc"}}', p);
    assert.match(e.message, re, String(status)); assert.equal(e.retryable, retry, String(status));
    assert.ok(!e.message.includes('gsk_') && !e.message.includes('secret account text'), 'provider body never echoed');
  }
});
