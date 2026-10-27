// Logic ported from the team's Java chatbot (java-ai-chatbot) into the AI Edge Function.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWhitespace, normalizeForMatching, validateAndNormalize, findRuleResponse, buildContext } from '../supabase/functions/ai-assistant/chatbot.js';
import { resolveProvider } from '../supabase/functions/ai-assistant/providers.js';

test('TextPreprocessor port: whitespace and matching normalisation', () => {
  assert.equal(normalizeWhitespace('a\r\nb  \n\n\n\nc  '), 'a\nb\n\nc');
  assert.equal(normalizeForMatching("  What's   YOUR name?! "), 'whats your name');
  assert.throws(() => validateAndNormalize('   ', 800), /Please type a message/);
  assert.throws(() => validateAndNormalize('x'.repeat(801), 800), /too long \(801 characters\)/);
});
test('RuleBasedResponder port: instant replies on an exact phrase only, as BreatheGuard AI', () => {
  assert.match(findRuleResponse('Hello!'), /BreatheGuard AI/);
  assert.match(findRuleResponse("what's your name"), /can’t diagnose/);
  assert.equal(findRuleResponse('hello, why was my session insufficient?'), null, 'anything else goes to the AI');
});
test('ConversationManager.buildContext port: last N messages, starting with a user turn', () => {
  const h = [{ role: 'assistant', content: 'a0' }, { role: 'user', content: 'u1' }, { role: 'assistant', content: 'a1' }, { role: 'user', content: 'u2' }, { role: 'assistant', content: 'a2' }];
  assert.deepEqual(buildContext(h, 'new', 3).map((m) => m.content), ['u2', 'a2', 'new']);
  assert.deepEqual(buildContext(h, 'new', 4).map((m) => m.content), ['u2', 'a2', 'new'], 'leading assistant turn dropped');
  assert.deepEqual(buildContext(h, 'new', 1).map((m) => m.content), ['new']);
});
test('AIConfig port: generic AI_API_KEY, Gemini/OpenAI/custom, https-only endpoints, tuning', () => {
  const g = resolveProvider({ AI_API_KEY: 'gsk_generic_test' });
  assert.equal(g.name, 'groq'); assert.equal(g.maxHistory, 20); assert.equal(g.maxTokens, 1024); assert.equal(g.timeoutMs, 60000);
  assert.equal(resolveProvider({ AI_PROVIDER: 'gemini', AI_API_KEY: 'AIza_test' }).label, 'Google Gemini');
  assert.match(resolveProvider({ AI_PROVIDER: 'openai', AI_API_KEY: 'sk-test' }).message, /needs AI_MODEL/);
  assert.match(resolveProvider({ AI_PROVIDER: 'custom', AI_API_KEY: 'k', AI_MODEL: 'm', AI_API_URL: 'http://example.com/v1' }).message, /must use https/);
  assert.equal(resolveProvider({ AI_PROVIDER: 'custom', AI_API_KEY: 'k', AI_MODEL: 'm', AI_API_URL: 'http://localhost:9/v1' }).ok, true);
  assert.equal(resolveProvider({ AI_API_KEY: 'gsk_x', AI_MAX_HISTORY: '6', AI_MAX_TOKENS: '9999', AI_TIMEOUT_SECONDS: '10' }).maxHistory, 6);
  assert.equal(resolveProvider({ AI_API_KEY: 'gsk_x', AI_MAX_TOKENS: '9999' }).maxTokens, 1024, 'out-of-range values fall back to defaults');
});
