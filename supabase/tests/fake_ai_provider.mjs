// TEST ONLY: stands in for the AI provider's HTTP API so the server-side path can be tested
// without a real key. Its replies are clearly marked and name a stand-in model. It records
// each request so tests can check what was (and was not) sent to the provider.
import http from 'node:http';
import fs from 'node:fs';
const log = process.env.FAKE_AI_LOG || '/tmp/fake_ai_requests.jsonl';
http.createServer((req, res) => {
  let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => {
    const openai = req.url.includes('/chat/completions');
    const auth = req.headers.authorization || '';
    // Never record key VALUES: only which header style was used.
    fs.appendFileSync(log, JSON.stringify({ format: openai ? 'openai' : 'anthropic', bearer: auth.startsWith('Bearer gsk_'), xApiKey: Boolean(req.headers['x-api-key']), body: JSON.parse(d || '{}') }) + '\n');
    const last = JSON.parse(d || '{}').messages?.at(-1)?.content || '';
    const fail = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (last.includes('SIMULATE-SLOW')) { setTimeout(() => fail(200, { model: 'late', choices: [{ message: { content: 'too late' } }], content: [] }), 8000); return; }
    if (last.includes('SIMULATE-INVALID-KEY')) return fail(401, { error: { message: 'Invalid API Key', type: 'invalid_request_error', code: 'invalid_api_key' } });
    if (last.includes('SIMULATE-RATE-LIMIT')) return fail(429, { error: { message: 'Rate limit reached', type: 'tokens', code: 'rate_limit_exceeded' } });
    if (last.includes('SIMULATE-MODEL-MISSING')) return fail(404, { error: { message: 'The model does not exist or you do not have access to it.', code: 'model_not_found' } });
    // TEST-ONLY failure switch: lets tests check provider-error handling end to end.
    if (last.includes('SIMULATE-PROVIDER-FAILURE')) { res.writeHead(503, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { type: 'overloaded_error', message: 'stand-in provider unavailable' } })); }
    res.writeHead(200, { 'content-type': 'application/json' });
    if (openai) return res.end(JSON.stringify({ model: 'stand-in-groq-format-not-a-real-ai', choices: [{ index: 0, message: { role: 'assistant', content: `[TEST STAND-IN REPLY, Groq format] I received ${last.length} characters of context.` }, finish_reason: 'stop' }] }));
    res.end(JSON.stringify({ model: 'stand-in-model-not-a-real-ai', content: [{ type: 'text', text: `[TEST STAND-IN REPLY] I received ${last.length} characters of context.` }] }));
  });
}).listen(Number(process.env.FAKE_AI_PORT || 3030), () => console.log('fake AI provider ready'));
