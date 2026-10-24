/**
 * Player accounts (player ID or email + password), kept on aashik.xyz. Signing in on another phone
 * or computer brings back the same player: name, picture, level/XP and the online identity.
 */
import { useSyncExternalStore } from 'react';
import { myToken, setMyToken } from './net';
import { storage, type Stats } from '../ui/storage';
import { onXp } from '../ui/progress';

export interface Account { login: string; email: string | null; name: string; avatar: string | null; stats: Partial<Stats>; token: string }
interface Saved { session: string; login: string; email: string | null }

const KEY = 'ib.account';
const listeners = new Set<() => void>();
let current: Saved | null = load();

function load(): Saved | null {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? 'null'); return v && typeof v.session === 'string' ? v : null; } catch { return null; }
}
function store(v: Saved | null) {
  current = v;
  try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); } catch { /* ignore */ }
  for (const l of listeners) l();
}
export function useAccount(): Saved | null {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => current);
}
export const signedIn = () => current;

function apiUrl(): string {
  const meta = document.querySelector('meta[name="ib-account-url"]')?.getAttribute('content')?.trim();
  if (meta) return meta;
  if (/(^|\.)aashik\.xyz$/.test(location.hostname)) return '/api/ib-account.php';
  return 'https://aashik.xyz/api/ib-account.php';
}

type Res = { ok: true; session?: string; account?: Account; sent?: boolean } | { ok: false; error: string };
async function call(op: string, body: Record<string, unknown>): Promise<Res> {
  try {
    const r = await fetch(apiUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, ...body }) });
    const j = await r.json() as Res;
    if (!j.ok && j.error === 'Please sign in again.' && current) store(null);
    return j;
  } catch {
    return { ok: false, error: 'Could not reach the account server. Check your internet and try again.' };
  }
}

/** Higher numbers win, so progress is never lost when two devices meet. */
export function mergeStats(local: Stats, remote: Partial<Stats> | undefined): Stats {
  const out: Stats = { ...local };
  if (!remote) return out;
  for (const k of Object.keys(remote) as (keyof Stats)[]) {
    const v = remote[k];
    if (typeof v !== 'number') continue;
    const cur = out[k];
    (out as unknown as Record<string, number>)[k] = typeof cur === 'number' ? Math.max(cur, v) : v;
  }
  return out;
}

/** Put the account's player on this device. Returns the account for the caller (name, picture). */
function adopt(res: Res): Account | string {
  if (!res.ok) return res.error;
  const a = res.account!;
  if (res.session) store({ session: res.session, login: a.login, email: a.email });
  else if (current) store({ ...current, login: a.login, email: a.email });
  setMyToken(a.token);
  storage.saveStats(mergeStats(storage.loadStats(), a.stats));
  return a;
}

export interface LocalProfile { name: string; avatar: string | null }

export async function register(login: string, email: string, password: string, p: LocalProfile): Promise<Account | string> {
  const r = await call('register', { login, email, password, token: myToken(), name: p.name, avatar: p.avatar, stats: storage.loadStats() });
  return adopt(r);
}
export async function signIn(id: string, password: string): Promise<Account | string> {
  return adopt(await call('login', { id, password }));
}
export async function forgot(id: string): Promise<true | string> {
  const r = await call('forgot', { id });
  return r.ok ? true : r.error;
}
export async function resetPassword(id: string, code: string, password: string): Promise<Account | string> {
  return adopt(await call('reset', { id, code, password }));
}
export async function setEmail(email: string): Promise<Account | string> {
  if (!current) return 'Please sign in again.';
  return adopt(await call('email', { session: current.session, email }));
}
export async function signOut() {
  const s = current?.session;
  store(null);
  if (s) await call('logout', { session: s });
}

/** Save name, picture and progress to the account (when signed in). */
export async function syncAccount(p?: Partial<LocalProfile>): Promise<Account | string | null> {
  if (!current) return null;
  const body: Record<string, unknown> = { session: current.session, stats: storage.loadStats() };
  if (p && 'name' in p) body.name = p.name;
  if (p && 'avatar' in p) body.avatar = p.avatar;
  return adopt(await call('sync', body));
}

// Progress is saved to the account a little after each round.
let timer: number | null = null;
onXp(() => {
  if (!current) return;
  if (timer) window.clearTimeout(timer);
  timer = window.setTimeout(() => { timer = null; void syncAccount(); }, 4000);
});
