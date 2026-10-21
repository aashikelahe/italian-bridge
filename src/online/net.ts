/**
 * Browser side of online play: one WebSocket to the game server, reconnecting by itself.
 * Your identity is a random secret kept in this browser, so a reload or a dropped connection
 * puts you straight back in your seat.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlayerView } from '../engine/view';
import type { Seat } from '../engine/types';
import type { ClientMsg, RoomInfo, ServerMsg } from './protocol';

export type ConnStatus = 'connecting' | 'open' | 'offline' | 'unavailable';

const TOKEN_KEY = 'ib.token';
const ROOM_KEY = 'ib.currentRoom';

function lsGet(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k: string, v: string | null) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* ignore */ } }

/** This browser's secret token (created once). */
let memToken: string | null = null;
export function myToken(): string {
  const saved = lsGet(TOKEN_KEY);
  if (saved) return saved;
  if (!memToken) {
    const bytes = crypto.getRandomValues(new Uint8Array(18));
    memToken = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    lsSet(TOKEN_KEY, memToken);
  }
  return memToken;
}

/** The login code moves your identity (player ID, seat, photo) to another device. */
export function setMyToken(code: string): boolean {
  const c = code.trim().toLowerCase().replace(/[^0-9a-f]/g, '');
  if (c.length < 16 || c.length > 64) return false;
  memToken = c;
  lsSet(TOKEN_KEY, c);
  return true;
}

/** The game server's web address (for photos), or null when online play is off. */
export function serverHttpBase(): string | null {
  const u = serverUrl();
  return u ? u.replace(/^ws/, 'http').replace(/\/ws$/, '') : null;
}

/** Picture of a room member: an emoji avatar, a photo address, or nothing. */
export function memberPic(id: string, pic: string | null | undefined): { emoji?: string; src?: string } | null {
  if (!pic) return null;
  if (pic.startsWith('e:')) return { emoji: pic.slice(2) };
  const base = serverHttpBase();
  if (pic.startsWith('u:') && base) return { src: `${base}/avatar/${id}.jpg?v=${encodeURIComponent(pic.slice(2))}` };
  return null;
}

/**
 * Where the game server is:
 * 1. a <meta name="ib-server" content="https://…"> tag in the page (used when the game is copied onto
 *    another website, e.g. aashik.xyz); an empty content means online play is not set up there yet;
 * 2. VITE_SERVER_URL at build time;
 * 3. otherwise the site the game was loaded from (the normal case on Render).
 */
export function serverUrl(): string | null {
  const toWs = (u: string) => {
    const base = u.trim().replace(/^http/, 'ws').replace(/\/+$/, '');
    return base.endsWith('/ws') ? base : `${base}/ws`;
  };
  const meta = document.querySelector('meta[name="ib-server"]');
  if (meta) {
    const v = meta.getAttribute('content')?.trim() ?? '';
    return /^(https?|wss?):\/\//.test(v) ? toWs(v) : null;
  }
  const configured = (import.meta.env.VITE_SERVER_URL as string | undefined)?.trim();
  if (configured) return toWs(configured);
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return null;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

export interface ThrowEvent { id: number; from: Seat; to: Seat; e: string }

export interface ServerState {
  status: ConnStatus;
  me: string | null;
  room: RoomInfo | null;
  view: PlayerView | null;
  error: string | null;
  /** Set when the server says we are no longer in a room. */
  left: 'left' | 'closed' | 'missing' | null;
}

/** Connects while mounted. `name` is your table name; changing it renames you. */
export interface ServerHandlers {
  onThrow?: (t: ThrowEvent) => void;
  onSmack?: (seat: Seat) => void;
  onRtc?: (from: string, data: unknown) => void;
}
export interface ProfileResult { ok: boolean; handle: string; error?: string }

export function useServer(name: string, handlers: ServerHandlers, profile: Extract<ClientMsg, { t: 'profile' }> | null) {
  const [st, setSt] = useState<ServerState>({ status: 'connecting', me: null, room: null, view: null, error: null, left: null });
  const ws = useRef<WebSocket | null>(null);
  const queue = useRef<ClientMsg[]>([]);
  const nameRef = useRef(name);
  nameRef.current = name;
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const [profileResult, setProfileResult] = useState<ProfileResult | null>(null);
  const throwSeq = useRef(0);
  const ready = useRef(false);

  useEffect(() => {
    const url = serverUrl();
    if (!url) { setSt((s) => ({ ...s, status: 'unavailable' })); return; }
    let stopped = false;
    let retry = 0;
    let timer: number | null = null;
    let ping: number | null = null;

    const connect = () => {
      if (stopped) return;
      setSt((s) => ({ ...s, status: retry === 0 ? 'connecting' : 'offline' }));
      const sock = new WebSocket(url);
      ws.current = sock;
      sock.onopen = () => {
        retry = 0;
        sock.send(JSON.stringify({ t: 'hello', token: myToken(), name: nameRef.current } satisfies ClientMsg));
        ping = window.setInterval(() => { if (sock.readyState === 1) sock.send('{"t":"ping"}'); }, 20_000);
      };
      sock.onmessage = (ev) => {
        let m: ServerMsg;
        try { m = JSON.parse(ev.data); } catch { return; }
        switch (m.t) {
          case 'welcome': {
            ready.current = true;
            setSt((s) => ({ ...s, status: 'open', me: m.id }));
            // Rejoin the room we were in, then send anything queued while offline.
            if (profileRef.current) sock.send(JSON.stringify(profileRef.current));
            const room = lsGet(ROOM_KEY);
            if (room) sock.send(JSON.stringify({ t: 'join', code: room } satisfies ClientMsg));
            for (const q of queue.current.splice(0)) sock.send(JSON.stringify(q));
            break;
          }
          case 'room':
            lsSet(ROOM_KEY, m.room.code);
            setSt((s) => ({ ...s, room: m.room, left: null, view: m.room.status === 'lobby' ? null : s.view }));
            break;
          case 'view':
            setSt((s) => ({ ...s, view: m.view }));
            break;
          case 'throw':
            handlersRef.current.onThrow?.({ id: ++throwSeq.current, from: m.from, to: m.to, e: m.e });
            break;
          case 'smack':
            handlersRef.current.onSmack?.(m.seat);
            break;
          case 'rtc':
            handlersRef.current.onRtc?.(m.from, m.data);
            break;
          case 'profile':
            setProfileResult({ ok: m.ok, handle: m.handle, error: m.error });
            break;
          case 'error':
            setSt((s) => ({ ...s, error: m.msg }));
            break;
          case 'left':
            lsSet(ROOM_KEY, null);
            setSt((s) => ({ ...s, room: null, view: null, left: m.reason }));
            break;
          default:
            break;
        }
      };
      sock.onclose = () => {
        ready.current = false;
        if (ping) window.clearInterval(ping);
        if (stopped) return;
        setSt((s) => ({ ...s, status: 'offline' }));
        retry++;
        // A sleeping free server can take about a minute to wake: keep trying, gently.
        timer = window.setTimeout(connect, Math.min(1000 * 2 ** Math.min(retry, 4), 15_000));
      };
    };
    connect();
    return () => { stopped = true; if (timer) window.clearTimeout(timer); if (ping) window.clearInterval(ping); ws.current?.close(); };
  }, []);

  // Send your profile again whenever it changes.
  const profileKey = profile ? `${profile.handle}|${profile.avatar?.length ?? 0}|${profile.avatar?.slice(-24) ?? ''}|${profile.level}` : '';
  useEffect(() => {
    if (profileRef.current && ready.current && ws.current?.readyState === 1) ws.current.send(JSON.stringify(profileRef.current));
  }, [profileKey]);

  // Keep the server's copy of your name current.
  useEffect(() => {
    if (ready.current && ws.current?.readyState === 1) ws.current.send(JSON.stringify({ t: 'rename', name } satisfies ClientMsg));
  }, [name]);

  const send = useCallback((m: ClientMsg) => {
    if (m.t === 'leave' || m.t === 'close') lsSet(ROOM_KEY, null);
    if (m.t === 'create' || m.t === 'join') setSt((s) => ({ ...s, left: null, error: null }));
    const sock = ws.current;
    if (sock && sock.readyState === 1 && ready.current) sock.send(JSON.stringify(m));
    else if (m.t !== 'throw' && m.t !== 'rtc' && m.t !== 'smack') queue.current.push(m);
  }, []);
  const clearError = useCallback(() => setSt((s) => ({ ...s, error: null })), []);
  const clearLeft = useCallback(() => setSt((s) => ({ ...s, left: null })), []);
  return { ...st, send, clearError, clearLeft, profileResult };
}

export function inviteLink(code: string): string {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set('room', code);
  return u.toString();
}
