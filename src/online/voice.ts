/**
 * Live voice chat for a room: everyone who joins the voice chat is connected directly to every
 * other voice member (WebRTC, audio only). The game server only passes the set-up messages along.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientMsg, RoomInfo } from './protocol';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

interface Peer {
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  pending: RTCIceCandidateInit[];
  initiator: boolean;
}

type Signal = { sdp?: RTCSessionDescriptionInit; ice?: RTCIceCandidateInit };

export interface Voice {
  supported: boolean;
  joined: boolean;
  joining: boolean;
  muted: boolean;
  /** Member ids currently talking (including you). */
  speaking: Set<string>;
  error: string | null;
  join: () => void;
  leave: () => void;
  toggleMute: () => void;
}

export function voiceSupported(): boolean {
  return typeof window !== 'undefined' && typeof RTCPeerConnection !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

export function useVoice(room: RoomInfo | null, me: string | null, send: (m: ClientMsg) => void, rtcRef: { current: ((from: string, data: unknown) => void) | null }): Voice {
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState<Set<string>>(new Set());
  const local = useRef<MediaStream | null>(null);
  const peers = useRef(new Map<string, Peer>());
  const ctx = useRef<AudioContext | null>(null);
  const meters = useRef(new Map<string, { an: AnalyserNode; src: MediaStreamAudioSourceNode; last: number }>());
  const meRef = useRef(me);
  meRef.current = me;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

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
        if (Math.sqrt(sum / buf.length) > 0.035) m.last = now;
        if (now - m.last < 450) on.add(id);
      }
      setSpeaking((prev) => (prev.size === on.size && [...on].every((x) => prev.has(x)) ? prev : on));
    }, 120);
    return () => window.clearInterval(iv);
  }, [joined]);

  // ---- peers
  const closePeer = useCallback((id: string) => {
    const p = peers.current.get(id);
    if (!p) return;
    p.pc.onicecandidate = null; p.pc.ontrack = null; p.pc.onconnectionstatechange = null;
    p.pc.close();
    p.audio.srcObject = null;
    p.audio.remove();
    peers.current.delete(id);
    meters.current.get(id)?.src.disconnect();
    meters.current.delete(id);
  }, []);

  const signal = useCallback((to: string, data: Signal) => send({ t: 'rtc', to, data }), [send]);

  const offer = useCallback(async (id: string, p: Peer, iceRestart = false) => {
    try {
      const o = await p.pc.createOffer({ iceRestart });
      await p.pc.setLocalDescription(o);
      signal(id, { sdp: p.pc.localDescription!.toJSON() });
    } catch { /* the next room update retries */ }
  }, [signal]);

  const makePeer = useCallback((id: string, initiator: boolean): Peer => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.setAttribute('playsinline', '');
    audio.style.display = 'none';
    document.body.appendChild(audio);
    const p: Peer = { pc, audio, pending: [], initiator };
    for (const tr of local.current?.getTracks() ?? []) pc.addTrack(tr, local.current!);
    pc.onicecandidate = (e) => { if (e.candidate) signal(id, { ice: e.candidate.toJSON() }); };
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      audio.srcObject = stream;
      void audio.play().catch(() => undefined);
      meter(id, stream);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' && p.initiator) void offer(id, p, true);
    };
    peers.current.set(id, p);
    return p;
  }, [signal, meter, offer]);

  const onSignal = useCallback(async (from: string, raw: unknown) => {
    if (!local.current || !raw || typeof raw !== 'object') return;
    const data = raw as Signal;
    let p = peers.current.get(from);
    try {
      if (data.sdp?.type === 'offer') {
        if (!p) p = makePeer(from, false);
        await p.pc.setRemoteDescription(data.sdp);
        for (const c of p.pending.splice(0)) await p.pc.addIceCandidate(c).catch(() => undefined);
        const a = await p.pc.createAnswer();
        await p.pc.setLocalDescription(a);
        signal(from, { sdp: p.pc.localDescription!.toJSON() });
      } else if (data.sdp?.type === 'answer' && p) {
        if (p.pc.signalingState === 'have-local-offer') await p.pc.setRemoteDescription(data.sdp);
        for (const c of p.pending.splice(0)) await p.pc.addIceCandidate(c).catch(() => undefined);
      } else if (data.ice && p) {
        if (p.pc.remoteDescription) await p.pc.addIceCandidate(data.ice).catch(() => undefined);
        else p.pending.push(data.ice);
      }
    } catch { /* a broken negotiation is retried on the next room update */ }
  }, [makePeer, signal]);
  rtcRef.current = (from, data) => { void onSignal(from, data); };

  // Connect to every other voice member; the member with the smaller id makes the call.
  const others = joined && room && me
    ? room.members.filter((m) => m.voice && m.online && m.id !== me).map((m) => m.id).sort().join(',')
    : '';
  useEffect(() => {
    if (!joined || !me) return;
    const want = new Set(others ? others.split(',') : []);
    for (const id of [...peers.current.keys()]) if (!want.has(id)) closePeer(id);
    for (const id of want) {
      if (peers.current.has(id)) continue;
      if (me < id) { const p = makePeer(id, true); void offer(id, p); }
    }
  }, [others, joined, me, closePeer, makePeer, offer]);

  const leave = useCallback(() => {
    for (const id of [...peers.current.keys()]) closePeer(id);
    local.current?.getTracks().forEach((t) => t.stop());
    local.current = null;
    meters.current.forEach((m) => m.src.disconnect());
    meters.current.clear();
    setJoined(false);
    setMuted(false);
    setSpeaking(new Set());
    send({ t: 'voice', on: false, muted: false });
  }, [closePeer, send]);

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
        if (meRef.current) meter(meRef.current, stream);
        setJoined(true);
        setMuted(false);
        send({ t: 'voice', on: true, muted: false });
      })
      .catch(() => setError('The microphone is blocked. Allow it in the browser to use voice chat.'))
      .finally(() => setJoining(false));
  }, [joined, joining, send, meter]);

  const toggleMute = useCallback(() => {
    const next = !mutedRef.current;
    local.current?.getAudioTracks().forEach((t) => { t.enabled = !next; });
    setMuted(next);
    send({ t: 'voice', on: true, muted: next });
  }, [send]);

  // After a reconnect the server has forgotten that we are in the call: tell it again.
  const meVoice = room?.members.find((m) => m.id === me)?.voice;
  useEffect(() => {
    if (joined && meVoice === false) send({ t: 'voice', on: true, muted: mutedRef.current });
  }, [joined, meVoice, send]);

  // Leaving the room ends the call.
  const inRoom = !!room;
  useEffect(() => { if (!inRoom && local.current) leave(); }, [inRoom, leave]);
  useEffect(() => () => {
    for (const id of [...peers.current.keys()]) closePeer(id);
    local.current?.getTracks().forEach((t) => t.stop());
    void ctx.current?.close().catch(() => undefined);
  }, [closePeer]);

  return { supported: voiceSupported(), joined, joining, muted, speaking, error, join, leave, toggleMute };
}
