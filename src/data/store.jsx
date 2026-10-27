import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { createSeed } from './seed.js';
import { repairState } from './repair.js';
import { JUDGE_STEPS } from '../sim/judgeDemo.js';

// localStorage persistence. This is a single-browser demo database:
// - data is visible to anyone using this browser profile
// - passwords are stored in plain text
// - permission checks in actions.js can be bypassed by editing storage
// See README for the minimum backend needed to make this real.
const KEY = 'breatheguard.db.v1';
const SESSION = 'breatheguard.session.v1';

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return repairState(JSON.parse(raw)).state;
  } catch { /* unreadable: fall through to seed */ }
  return createSeed();
}

const Ctx = createContext(null);

export function StoreProvider({ children }) {
  const [state, setState] = useState(load);
  const [userId, setUserId] = useState(() => { try { return localStorage.getItem(SESSION); } catch { return null; } });
  const [toasts, setToasts] = useState([]);
  // Judge Demo lives here so it can move between portals and accounts
  const [judge, setJudge] = useState(null); // { i, nonce }
  const [simRunning, setSimRunning] = useState(false);

  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full or blocked */ } }, [state]);
  useEffect(() => { try { userId ? localStorage.setItem(SESSION, userId) : localStorage.removeItem(SESSION); } catch { /* ignore */ } }, [userId]);

  const user = state.users.find((u) => u.id === userId) || null;

  const toast = useCallback((text, kind = 'ok') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  // Run a pure action; show its error message instead of crashing. Returns result or undefined.
  const act = (fn, payload, okMsg) => {
    try {
      const { state: next, result } = fn(state, user, payload);
      setState(next);
      if (okMsg) toast(okMsg);
      return result ?? true;
    } catch (e) {
      toast(e.message, 'error');
      return undefined;
    }
  };

  // expected: 'patient' | 'hospital' | 'authority' (the tile the user chose); omitted = any account type
  const login = (email, password, expected) => {
    const u = state.users.find((x) => x.email.toLowerCase() === email.trim().toLowerCase() && x.password === password);
    if (!u) { toast('Email or password is incorrect.', 'error'); return false; }
    const TILE = { patient: 'Patient', hospital: 'Hospital', authority: 'Healthcare authority' };
    if (expected && u.role !== expected) { toast(`This is a ${TILE[u.role].toLowerCase()} account. Choose the “${TILE[u.role]}” tile to sign in.`, 'error'); return false; }
    setUserId(u.id);
    return true;
  };
  const loginAs = (id) => setUserId(id);
  const logout = () => { setJudge(null); setUserId(null); };

  const judgeGo = (i) => {
    const step = JUDGE_STEPS[i];
    const target = step.portal || { user: 'u_pat1', page: 'monitor' };
    if (!state.users.some((u) => u.id === target.user)) { toast('This demo step needs the original demo accounts. Reset demo data and try again.', 'error'); return; }
    setJudge((j) => ({ i, nonce: (j?.nonce || 0) + 1 }));
    window.location.hash = `/${target.page}`;
    if (userId !== target.user) setUserId(target.user);
  };
  const judgeExit = () => setJudge(null);
  const resetDemo = () => { setState(createSeed()); setJudge(null); setUserId(null); toast('Demo data reset to its starting state.'); };

  return <Ctx.Provider value={{ state, user, act, login, loginAs, logout, resetDemo, toast, toasts, judge, judgeGo, judgeExit, simRunning, setSimRunning }}>{children}</Ctx.Provider>;
}

export const useStore = () => useContext(Ctx);

// Lookups shared by pages
export const nameOf = (state, id) => state.users.find((u) => u.id === id)?.name || state.hospitals.find((h) => h.id === id)?.name || state.doctors.find((d) => d.id === id)?.name || (id === 'system' ? 'Automated check' : id);
export const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
export const fmtDateTime = (iso) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
