import { createClient } from '@supabase/supabase-js';
import { getConfig, isConfigured } from './config.js';

let client = null;
// One shared client. The auth session is persisted by Supabase so users stay signed in;
// all patient data itself lives in the database, never in localStorage.
export function getClient() {
  if (!isConfigured()) return null;
  if (!client) client = createClient(getConfig().url, getConfig().key, { auth: { persistSession: true, autoRefreshToken: true } });
  return client;
}
