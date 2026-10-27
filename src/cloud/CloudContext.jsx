import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { getClient } from '../backend/client.js';
import { isConfigured, getConfig } from '../backend/config.js';
import { checkBackend } from '../backend/status.js';
import * as api from '../backend/api.js';

const Ctx = createContext(null);

// Holds the real (Supabase) sign-in state for connected mode.
export function CloudProvider({ children }) {
  const sb = getClient();
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const configured = isConfigured();
  const [state, setState] = useState(configured ? 'loading' : 'unconfigured'); // loading | signed-out | signed-in | unconfigured | error
  // Backend status, verified against the real services (not just "settings exist"):
  // checking | configuration-required | connection-error | setup-incomplete | connected-verified
  const [backend, setBackend] = useState({ state: configured ? 'checking' : 'configuration-required', title: configured ? 'Checking the backend…' : 'Configuration required' });
  const expectRole = useRef(null); // set by the authority sign-in: refuse the session if the role differs
  const [authError, setAuthError] = useState('');
  const recheck = useCallback(async () => {
    setBackend({ state: 'checking', title: 'Checking the backend…' });
    const c = getConfig();
    setBackend(await checkBackend({ url: c.url, key: c.key, runtimeError: c.runtimeError }));
  }, []);
  useEffect(() => { recheck(); }, [recheck]);
  const [error, setError] = useState('');
  const [recovery, setRecovery] = useState(false); // true after following a password-reset link

  const loadProfile = useCallback(async (s) => {
    if (!s?.user) { setProfile(null); setState('signed-out'); return; }
    try {
      const p = await api.getProfile(sb, s.user.id);
      if (expectRole.current && p.role !== expectRole.current) {
        expectRole.current = null;
        await sb.auth.signOut();
        setProfile(null); setSession(null); setState('signed-out');
        setAuthError('This account does not have healthcare authority access. Authority accounts are provisioned by the project owner, never self-registered.');
        return;
      }
      expectRole.current = null;
      setProfile(p); setState('signed-in'); setError(''); setAuthError('');
    }
    catch (e) { setError(e.message); setState('error'); }
  }, [sb]);

  useEffect(() => {
    if (!sb) return undefined;
    sb.auth.getSession().then(({ data }) => { setSession(data.session); loadProfile(data.session); }).catch((e) => { setError(api.friendly(e).message); setState('error'); });
    const { data: sub } = sb.auth.onAuthStateChange((evt, s) => { if (evt === 'PASSWORD_RECOVERY') setRecovery(true); setSession(s); loadProfile(s); });
    return () => sub.subscription.unsubscribe();
  }, [sb, loadProfile]);

  const value = {
    sb, session, profile, state, error, configured, backend, recheck, authError,
    signInAs: async (email, password, role) => { setAuthError(''); expectRole.current = role; try { return await api.signIn(sb, { email, password }); } catch (e) { expectRole.current = null; throw e; } },
    signIn: (email, password) => api.signIn(sb, { email, password }),
    signUp: (args) => api.signUp(sb, args),
    signOut: async () => { try { await api.signOut(sb); } finally { setSession(null); setProfile(null); setState('signed-out'); } },
    refreshProfile: () => loadProfile(session),
    recovery, finishRecovery: () => setRecovery(false),
    requestReset: (email) => api.requestPasswordReset(sb, email, typeof window !== 'undefined' ? window.location.origin : undefined),
    updatePassword: (pw) => api.updatePassword(sb, pw),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useCloud = () => useContext(Ctx);
