// TEST ONLY: serve the real ai-assistant handler locally on a chosen port.
import { handler } from '../functions/ai-assistant/index.ts';
Deno.serve({ port: Number(Deno.env.get('FN_PORT') || 3020) }, handler);
