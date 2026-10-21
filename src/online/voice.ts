/**
 * Live voice chat for a room: everyone who joins the voice chat is connected directly to every
 * other voice member (WebRTC, audio only). The game server only passes the set-up messages along,
 * and hands out relay (TURN) details for networks where a direct link is impossible.
 *
 * Robustness rules:
 * - Every join gets a fresh voice session id (vs). A member whose vs changes is reconnected from scratch.
 * - Each link has a connection id (cid) chosen by the caller; messages for an old cid are ignored,
 *   and an offer with a new cid replaces the old link. So a link can always be rebuilt cleanly.
 * - Links that fail, or don't connect within a few seconds, are restarted automatically.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientMsg, RoomInfo } from './protocol';

const STUN: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

interface Peer {
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  pending: RTCIceCandidateInit[];
  initiator: boolean;
  cid: string;
  vs: string;
  createdAt: number;
  badSince: number | null;
  restarts: number;
}

type Signal = { sdp?: RTCSessionDescriptionInit; ice?: RTCIceCandidateInit; cid: string; vs: string; toVs: string };
export type LinkState = 'connecting' | 'connected' | 'trouble';

export interface Voice {
  supported: boolean;
  joined: boolean;
  joining: boolean;
  muted: boolean;
  /** Member ids currently talking (including you). */
  speaking: Set<string>;
  /** State of your link to each other voice member. */
  links: Record<string, LinkState>;
  error: string | null;
  join: () => void;
  leave: () => void;
  toggleMute: () => void;
}

export function voiceSupported(): boolean {
  return typeof window !== 'undefined' && typeof RTCPeerConnection !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

const rid = () => Math.random().toString(36).slice(2, 10);

export function useVoice(
  room: RoomInfo | null, me: string | null, send: (m: ClientMsg) => void,
  rtcRef: { current: ((from: string, data: unknown) => void) | null },
  iceServers: RTCIceServer[] | null,
): Voice {
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState<Set<string>>(new Set());
  const [links, setLinks] = useState<Record<string, LinkState>>({});
  const local = useRef<MediaStream | null>(null);
  const peers = useRef(new Map<string, Peer>());
  const ctx = useRef<AudioContext | null>(null);
  const meters = useRef(new Map<string, { an: AnalyserNode; src: MediaStreamAudioSourceNode; last: number }>());
  const vsRef = useRef('');
  const meRef = useRef(me);
  meRef.current = me;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const iceRef = useRef<RTCIceServer[]>(STUN);
  iceRef.current = [...STUN, ...(iceServers ?? [])];
  const roomRef = useRef(room);
  roomRef.current = room;

  const refreshLinks = useCallback(() => {
    const next: Record<string, LinkState> = {};
    for (const [id, p] of peers.current) {
      const st = p.pc.connectionState;
      next[id] = st === 'connected' ? 'connected' : st === 'failed' || p.badSince ? 'trouble' : 'connecting';
    }
    setLinks((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, []);

  // ---- talking indicators
  const meter = useCallback((id: string, stream: MediaStream) => {
    try {
      if (!ctx.current) ctx.current = new AudioContext();
      void ctx.current.resume();
      meters.current.get(id)?.src.disconnect();
      const src = ctx.current.createMediaStreamSource(stream);
      const an = ctx.current.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      meters.current.set(id, { an, src, last: 0 });
    } catch { /* no meter: voice still works */ }
  }, []);
  useEffect(() => {
    if (!joined) return;
    const buf = new Float32Array(512);
    const iv = window.setInterval(() => {
      const now = Date.now();
      const on = new Set<string>();
      for (const [id, m] of meters.current) {
        if (id === meRef.current && mutedRef.current) continue;
        m.an.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let k = 0; k < buf.length; k++) sum += buf[k] * buf[k];
        if (Math.sqrt(sum / buf.length) > 0.03) m.last = now;
        if (now - m.last < 450) on.add(id);
      }
      setSpeaking((prev) => (prev.size === on.size && [...on].every((x) => prev.has(x)) ? prev : on));
    }, 120);
    return () => window.clearInterval(iv);
  }, [joined]);

  // Phones may block sound that starts without a tap: every tap restarts any paused voice.
  useEffect(() => {
    if (!joined) return;
    const unlock = () => {
      void ctx.current?.resume();
      for (const p of peers.current.values()) if (p.audio.srcObject && p.audio.paused) void p.audio.play().catch(() => undefined);
    };
    document.addEventListener('pointerdown', unlock, { passive: true });
    return () => document.removeEventListener('pointerdown', unlock);
  }, [joined]);

  // ---- links
  const closePeer = useCallback((id: string) => {
    const p = peers.current.get(id);
    if (!p) return;
    p.pc.onicecandidate = null; p.pc.ontrack = null; p.pc.onconnectionstatechange = null; p.pc.oniceconnectionstatechange = null;
    try { p.pc.close(); } catch { /* already closed */ }
    p.audio.srcObject = null;
    p.audio.remove();
    peers.current.delete(id);
    meters.current.get(id)?.src.disconnect();
    meters.current.delete(id);
  }, []);

  const signal = useCallback((to: string, p: Peer, data: Omit<Signal, 'cid' | 'vs' | 'toVs'>) => {
    send({ t: 'rtc', to, data: { ...data, cid: p.cid, vs: vsRef.current, toVs: p.vs } satisfies Signal });
  }, [send]);

  const offer = useCallback(async (id: string, p: Peer, iceRestart = false) => {
    try {
      const o = await p.pc.createOffer({ iceRestart });
      if (peers.current.get(id) !== p) return;
      await p.pc.setLocalDescription(o);
      signal(id, p, { sdp: p.pc.localDescription!.toJSON() });
    } catch { /* the watchdog retries */ }
  }, [signal]);

  const makePeer = useCallback((id: string, vs: string, initiator: boolean, cid: string): Peer => {
    closePeer(id);
    const pc = new RTCPeerConnection({ iceServers: iceRef.current });
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.setAttribute('playsinline', '');
    audio.style.display = 'none';
    document.body.appendChild(audio);
    const p: Peer = { pc, audio, pending: [], initiator, cid, vs, createdAt: Date.now(), badSince: null, restarts: 0 };
    for (const tr of local.current?.getTracks() ?? []) pc.addTrack(tr, local.current!);
    pc.onicecandidate = (e) => { if (e.candidate) signal(id, p, { ice: e.candidate.toJSON() }); };
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      audio.srcObject = stream;
      void audio.play().catch(() => undefined);
      meter(id, stream);
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === 'connected') { p.badSince = null; p.restarts = 0; }
      else if ((st === 'failed' || st === 'disconnected') && !p.badSince) p.badSince = Date.now();
      if (st === 'failed' && p.initiator) { p.restarts++; void offer(id, p, true); }
      refreshLinks();
    };
    peers.current.set(id, p);
    refreshLinks();
    return p;
  }, [closePeer, signal, meter, offer, refreshLinks]);

  const call = useCallback((id: string, vs: string) => {
    const p = makePeer(id, vs, true, rid());
    void offer(id, p);
  }, [makePeer, offer]);

  const onSignal = useCallback(async (from: string, raw: unknown) => {
    if (!local.current || !raw || typeof raw !== 'object') return;
    const data = raw as Signal;
    if (data.toVs && data.toVs !== vsRef.current) return; // meant for an earlier session of mine
    let p = peers.current.get(from);
    try {
      if (data.sdp?.type === 'offer') {
        // A new caller link (or a new session of theirs) replaces whatever we had.
        if (!p || p.cid !== data.cid || p.vs !== data.vs || p.initiator) p = makePeer(from, data.vs, false, data.cid);
        await p.pc.setRemoteDescription(data.sdp);
        for (const c of p.pending.splice(0)) await p.pc.addIceCandidate(c).catch(() => undefined);
        const a = await p.pc.createAnswer();
        await p.pc.setLocalDescription(a);
        signal(from, p, { sdp: p.pc.localDescription!.toJSON() });
      } else if (data.sdp?.type === 'answer') {
        if (!p || p.cid !== data.cid) return;
        if (p.pc.signalingState === 'have-local-offer') await p.pc.setRemoteDescription(data.sdp);
        for (const c of p.pending.splice(0)) await p.pc.addIceCandidate(c).catch(() => undefined);
      } else if (data.ice) {
        if (!p || p.cid !== data.cid) return;
        if (p.pc.remoteDescription) await p.pc.addIceCandidate(data.ice).catch(() => undefined);
        else p.pending.push(data.ice);
      }
    } catch { /* the watchdog rebuilds a broken link */ }
    refreshLinks();
  }, [makePeer, signal, refreshLinks]);
  rtcRef.current = (from, data) => { void onSignal(from, data); };

  // Connect to every other voice member; the member with the smaller id makes the call.
  const others = joined && room && me
    ? room.members.filter((m) => m.voice && m.online && m.id !== me).map((m) => `${m.id}:${m.vs ?? ''}`).sort().join(',')
    : '';
  useEffect(() => {
    if (!joined || !me) return;
    const want = new Map((others ? others.split(',') : []).map((x) => { const [id, vs] = x.split(':'); return [id, vs] as const; }));
    for (const [id, p] of [...peers.current]) if (!want.has(id) || (p.vs && want.get(id) !== p.vs)) closePeer(id);
    for (const [id, vs] of want) {
      if (peers.current.has(id)) continue;
      if (me < id) call(id, vs);
    }
    refreshLinks();
  }, [others, joined, me, closePeer, call, refreshLinks]);

  // Watchdog: restart links that are stuck or broken.
  useEffect(() => {
    if (!joined) return;
    const iv = window.setInterval(() => {
      const now = Date.now();
      for (const [id, p] of [...peers.current]) {
        const st = p.pc.connectionState;
        if (st === 'connected') continue;
        const stuck = now - p.createdAt > 12_000 && st !== 'connecting';
        const longBad = p.badSince && now - p.badSince > 6_000;
        const tooSlow = now - p.createdAt > 20_000;
        if (!(stuck || longBad || tooSlow)) continue;
        if (p.initiator) call(id, p.vs);       // fresh link with a new connection id
        else if (now - p.createdAt > 30_000) closePeer(id); // the caller will ring again
      }
      refreshLinks();
    }, 3000);
    return () => window.clearInterval(iv);
  }, [joined, call, closePeer, refreshLinks]);

  const announce = useCallback((on: boolean, m: boolean) => send({ t: 'voice', on, muted: m, vs: on ? vsRef.current : '' }), [send]);

  const leave = useCallback(() => {
    for (const id of [...peers.current.keys()]) closePeer(id);
    local.current?.getTracks().forEach((t) => t.stop());
    local.current = null;
    meters.current.forEach((m) => m.src.disconnect());
    meters.current.clear();
    setJoined(false);
    setMuted(false);
    setSpeaking(new Set());
    setLinks({});
    announce(false, false);
  }, [closePeer, announce]);

  const join = useCallback(() => {
    if (joined || joining) return;
    if (!voiceSupported()) { setError('Voice chat does not work in this browser.'); return; }
    setJoining(true);
    setError(null);
    // Create the audio context inside the tap so phones allow sound.
    try { if (!ctx.current) ctx.current = new AudioContext(); void ctx.current.resume(); } catch { /* ignore */ }
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false })
      .then((stream) => {
        local.current = stream;
        vsRef.current = rid();
        if (meRef.current) meter(meRef.current, stream);
        setJoined(true);
        setMuted(false);
        announce(true, false);
      })
      .catch(() => setError('The microphone is blocked. Allow it in the browser to use voice chat.'))
      .finally(() => setJoining(false));
  }, [joined, joining, meter, announce]);

  const toggleMute = useCallback(() => {
    const next = !mutedRef.current;
    local.current?.getAudioTracks().forEach((t) => { t.enabled = !next; });
    setMuted(next);
    announce(true, next);
  }, [announce]);

  // After a reconnect the server has forgotten that we are in the call: start a fresh session.
  // (Only when the server's record goes from "in voice" to "not in voice" while we are still in.)
  const meVoice = room?.members.find((m) => m.id === me)?.voice;
  const wasIn = useRef(false);
  useEffect(() => {
    if (!joined) { wasIn.current = false; return; }
    if (meVoice) { wasIn.current = true; return; }
    if (meVoice === false && wasIn.current) {
      wasIn.current = false;
      for (const id of [...peers.current.keys()]) closePeer(id);
      vsRef.current = rid();
      announce(true, mutedRef.current);
    }
  }, [joined, meVoice, closePeer, announce]);

  // Leaving the room ends the call.
  const inRoom = !!room;
  useEffect(() => { if (!inRoom && local.current) leave(); }, [inRoom, leave]);
  useEffect(() => () => {
    for (const id of [...peers.current.keys()]) closePeer(id);
    local.current?.getTracks().forEach((t) => t.stop());
    void ctx.current?.close().catch(() => undefined);
  }, [closePeer]);

  return { supported: voiceSupported(), joined, joining, muted, speaking, links, error, join, leave, toggleMute };
}
