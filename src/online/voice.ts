/**
 * Live voice chat for a room, carried by the game server.
 *
 * Every player's microphone is compressed (16 kHz, 4-bit ADPCM ≈ 64 kbit/s while talking, nothing
 * while silent) and sent over the game's own connection; the server passes it to everyone else in
 * the voice chat. Unlike direct phone-to-phone calls this works on every network — if a player can
 * play online, they can hear and be heard by all the others.
 *
 * Playback goes through a local loopback call inside the page so the browser's echo canceller
 * hears it too (no echo when players use their phone speakers).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientMsg, RoomInfo } from './protocol';
import { adpcmDecode, adpcmEncode, type AdpcmState } from './adpcm';

const RATE = 16000;
const FRAME = 960; // 60 ms
const SPEAK_LEVEL = 0.014;
const HANGOVER_MS = 450;

export type LinkState = 'connecting' | 'connected' | 'trouble';

export interface Voice {
  supported: boolean;
  joined: boolean;
  joining: boolean;
  muted: boolean;
  /** Member ids currently talking (including you). */
  speaking: Set<string>;
  /** Kept for the UI: with the server relay every voice member is reachable. */
  links: Record<string, LinkState>;
  error: string | null;
  join: () => void;
  leave: () => void;
  toggleMute: () => void;
}

export function voiceSupported(): boolean {
  return typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia &&
    !!(window.AudioContext ?? (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext);
}

const WORKLET = `class IbCap extends AudioWorkletProcessor{process(i){const c=i[0]&&i[0][0];if(c)this.port.postMessage(c.slice(0));return true}}registerProcessor('ib-cap',IbCap);`;

interface Rx { next: number; last: number }

export function useVoice(
  room: RoomInfo | null, me: string | null, send: (m: ClientMsg) => void,
  sendBinary: (data: Uint8Array) => void,
  frameRef: { current: ((frame: Uint8Array) => void) | null },
): Voice {
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState<Set<string>>(new Set());

  const ctx = useRef<AudioContext | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const nodes = useRef<AudioNode[]>([]);
  const out = useRef<AudioNode | null>(null);
  const loop = useRef<{ a: RTCPeerConnection; b: RTCPeerConnection; el: HTMLAudioElement } | null>(null);
  const rx = useRef(new Map<string, Rx>());
  const enc = useRef<AdpcmState>({ pred: 0, index: 0 });
  const pending = useRef<number[]>([]);
  const seq = useRef(0);
  const lastLoud = useRef(0);
  const meRef = useRef(me); meRef.current = me;
  const mutedRef = useRef(muted); mutedRef.current = muted;
  const sendBinRef = useRef(sendBinary); sendBinRef.current = sendBinary;
  const voiceIds = useRef(new Set<string>());
  voiceIds.current = new Set((room?.members ?? []).filter((m) => m.voice).map((m) => m.id));

  // ---- outgoing: 60 ms frames, only while you are talking
  const pushSamples = useCallback((input: Float32Array, inRate: number) => {
    const buf = pending.current;
    if (inRate === RATE) for (let i = 0; i < input.length; i++) buf.push(input[i]);
    else {
      // Down-sample, averaging neighbours (a simple low-pass so it doesn't sound harsh).
      const r = inRate / RATE;
      const w = Math.max(1, Math.round(r));
      for (let t = 0; t < input.length; t += r) {
        const at = Math.floor(t);
        let sum = 0, n = 0;
        for (let k = at; k < at + w && k < input.length; k++) { sum += input[k]; n++; }
        buf.push(n ? sum / n : 0);
      }
    }
    while (buf.length >= FRAME) {
      const frame = Float32Array.from(buf.splice(0, FRAME));
      let sum = 0;
      for (let i = 0; i < FRAME; i++) sum += frame[i] * frame[i];
      const rms = Math.sqrt(sum / FRAME);
      const now = performance.now();
      if (rms > SPEAK_LEVEL) lastLoud.current = now;
      const active = !mutedRef.current && now - lastLoud.current < HANGOVER_MS;
      if (!active) { enc.current = { pred: 0, index: 0 }; continue; }
      const body = adpcmEncode(frame, enc.current);
      const pkt = new Uint8Array(3 + body.length);
      const s = (seq.current = (seq.current + 1) & 0xffff);
      pkt[0] = 1; pkt[1] = s & 0xff; pkt[2] = s >> 8; pkt.set(body, 3);
      sendBinRef.current(pkt);
    }
  }, []);

  // ---- incoming: decode and schedule with a small jitter buffer
  const onFrame = useCallback((f: Uint8Array) => {
    const ac = ctx.current;
    const dest = out.current;
    if (!ac || !dest || f[0] !== 2) return;
    const idLen = f[1];
    const id = new TextDecoder().decode(f.subarray(2, 2 + idLen));
    if (id === meRef.current || !voiceIds.current.has(id)) return;
    const body = f.subarray(2 + idLen + 2); // skip the sequence number
    const n = (body.length - 3) * 2;
    if (n <= 0 || n > 4096) return;
    const pcm = adpcmDecode(body, n);
    const ab = ac.createBuffer(1, n, RATE);
    ab.getChannelData(0).set(pcm);
    const src = ac.createBufferSource();
    src.buffer = ab;
    src.connect(dest);
    let r = rx.current.get(id);
    if (!r) { r = { next: 0, last: 0 }; rx.current.set(id, r); }
    const now = ac.currentTime;
    if (r.next < now + 0.03 || r.next > now + 0.6) r.next = now + 0.12; // (re)start the buffer
    src.start(r.next);
    r.next += n / RATE;
    r.last = performance.now();
  }, []);
  frameRef.current = onFrame;

  // ---- who is talking (others: frames arriving; you: your own level)
  useEffect(() => {
    if (!joined) return;
    const iv = window.setInterval(() => {
      const now = performance.now();
      const on = new Set<string>();
      for (const [id, r] of rx.current) if (now - r.last < 350) on.add(id);
      if (meRef.current && !mutedRef.current && now - lastLoud.current < 300) on.add(meRef.current);
      setSpeaking((prev) => (prev.size === on.size && [...on].every((x) => prev.has(x)) ? prev : on));
    }, 150);
    return () => window.clearInterval(iv);
  }, [joined]);

  // Phones may suspend sound until a tap: every tap wakes it.
  useEffect(() => {
    if (!joined) return;
    const wake = () => { void ctx.current?.resume(); void loop.current?.el.play().catch(() => undefined); };
    document.addEventListener('pointerdown', wake, { passive: true });
    return () => document.removeEventListener('pointerdown', wake);
  }, [joined]);

  /** Route playback through a local loopback call so the echo canceller can remove it from the mic. */
  const setupOutput = useCallback(async (ac: AudioContext) => {
    const gain = ac.createGain();
    gain.gain.value = 1.4;
    out.current = gain;
    try {
      if (typeof RTCPeerConnection === 'undefined') throw new Error('no rtc');
      const dest = ac.createMediaStreamDestination();
      gain.connect(dest);
      const a = new RTCPeerConnection();
      const b = new RTCPeerConnection();
      a.onicecandidate = (e) => { if (e.candidate) void b.addIceCandidate(e.candidate).catch(() => undefined); };
      b.onicecandidate = (e) => { if (e.candidate) void a.addIceCandidate(e.candidate).catch(() => undefined); };
      const el = document.createElement('audio');
      el.autoplay = true; el.setAttribute('playsinline', ''); el.style.display = 'none';
      document.body.appendChild(el);
      const got = new Promise<void>((resolve) => { b.ontrack = (e) => { el.srcObject = e.streams[0] ?? new MediaStream([e.track]); void el.play().catch(() => undefined); resolve(); }; });
      for (const t of dest.stream.getAudioTracks()) a.addTrack(t, dest.stream);
      const offer = await a.createOffer();
      await a.setLocalDescription(offer);
      await b.setRemoteDescription(offer);
      const answer = await b.createAnswer();
      await b.setLocalDescription(answer);
      await a.setRemoteDescription(answer);
      await Promise.race([got, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2500))]);
      loop.current = { a, b, el };
    } catch {
      // No loopback: play directly.
      try { gain.disconnect(); } catch { /* ignore */ }
      gain.connect(ac.destination);
    }
  }, []);

  const teardown = useCallback(() => {
    for (const n of nodes.current) { try { n.disconnect(); } catch { /* ignore */ } }
    nodes.current = [];
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (loop.current) {
      loop.current.a.close(); loop.current.b.close();
      loop.current.el.srcObject = null; loop.current.el.remove();
      loop.current = null;
    }
    out.current = null;
    rx.current.clear();
    pending.current = [];
    void ctx.current?.close().catch(() => undefined);
    ctx.current = null;
  }, []);

  const announce = useCallback((on: boolean, m: boolean) => send({ t: 'voice', on, muted: m }), [send]);

  const leave = useCallback(() => {
    teardown();
    setJoined(false);
    setMuted(false);
    setSpeaking(new Set());
    announce(false, false);
  }, [teardown, announce]);

  const join = useCallback(() => {
    if (joined || joining) return;
    if (!voiceSupported()) { setError('Voice chat does not work in this browser.'); return; }
    setJoining(true);
    setError(null);
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    let ac: AudioContext;
    // Firefox cannot connect a microphone to a context at another sample rate: use its own rate there.
    const firefox = typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent);
    try { ac = firefox ? new AC() : new AC({ sampleRate: RATE }); } catch { ac = new AC(); }
    ctx.current = ac;
    void ac.resume();
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false })
      .then(async (ms) => {
        stream.current = ms;
        await setupOutput(ac);
        const srcNode = ac.createMediaStreamSource(ms);
        const silent = ac.createGain();
        silent.gain.value = 0;
        silent.connect(ac.destination);
        let cap: AudioNode;
        if (ac.audioWorklet) {
          const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
          await ac.audioWorklet.addModule(url);
          URL.revokeObjectURL(url);
          const w = new AudioWorkletNode(ac, 'ib-cap');
          w.port.onmessage = (e) => pushSamples(e.data as Float32Array, ac.sampleRate);
          cap = w;
        } else {
          const sp = ac.createScriptProcessor(1024, 1, 1);
          sp.onaudioprocess = (e) => pushSamples(e.inputBuffer.getChannelData(0), ac.sampleRate);
          cap = sp;
        }
        srcNode.connect(cap);
        cap.connect(silent);
        nodes.current = [srcNode, cap, silent];
        setJoined(true);
        setMuted(false);
        announce(true, false);
      })
      .catch(() => { teardown(); setError('The microphone is blocked. Allow it in the browser to use voice chat.'); })
      .finally(() => setJoining(false));
  }, [joined, joining, pushSamples, setupOutput, teardown, announce]);

  const toggleMute = useCallback(() => {
    const next = !mutedRef.current;
    stream.current?.getAudioTracks().forEach((t) => { t.enabled = !next; });
    setMuted(next);
    announce(true, next);
  }, [announce]);

  // After a reconnect the server has forgotten that we are in the call: tell it again.
  const meVoice = room?.members.find((m) => m.id === me)?.voice;
  const wasIn = useRef(false);
  useEffect(() => {
    if (!joined) { wasIn.current = false; return; }
    if (meVoice) { wasIn.current = true; return; }
    if (meVoice === false && wasIn.current) { wasIn.current = false; announce(true, mutedRef.current); }
  }, [joined, meVoice, announce]);

  // Leaving the room ends the call.
  const inRoom = !!room;
  useEffect(() => { if (!inRoom && stream.current) leave(); }, [inRoom, leave]);
  useEffect(() => () => teardown(), [teardown]);

  const links: Record<string, LinkState> = {};
  if (joined && room) for (const m of room.members) if (m.voice && m.id !== me) links[m.id] = 'connected';

  return { supported: voiceSupported(), joined, joining, muted, speaking, links, error, join, leave, toggleMute };
}
