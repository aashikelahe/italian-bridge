/**
 * Small synthesized sound effects (no audio files): a "sweep" when a trick slides to its
 * winner, and a soft tap when a card hits the table. Browsers only allow sound after the
 * player has clicked something, which always happens before the first trick.
 */
let ctx: AudioContext | null = null;
let enabled = true;

export function setSoundEnabled(on: boolean) {
  enabled = on;
}

function audio(): AudioContext | null {
  if (!enabled) return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function noiseBuffer(ac: AudioContext, seconds: number): AudioBuffer {
  const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * seconds), ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

/** A soft "shhhwip": filtered noise whose pitch sweeps up then fades. */
export function playSweep() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  const dur = 0.55;
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac, dur);
  const band = ac.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = 1.4;
  band.frequency.setValueAtTime(700, t);
  band.frequency.exponentialRampToValueAtTime(4200, t + dur * 0.7);
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.32, t + 0.08);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(band).connect(gain).connect(ac.destination);
  src.start(t);
  src.stop(t + dur);
}

/** A short papery tap for a card being played. */
export function playCardTap() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac, 0.08);
  const hp = ac.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1800;
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.18, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
  src.connect(hp).connect(gain).connect(ac.destination);
  src.start(t);
  src.stop(t + 0.08);
}

/** A wet "splat" for an emoji landing on someone's face. */
export function playSplat() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(320, t);
  osc.frequency.exponentialRampToValueAtTime(70, t + 0.18);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.35, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  osc.connect(g).connect(ac.destination);
  osc.start(t);
  osc.stop(t + 0.24);
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac, 0.12);
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900;
  const g2 = ac.createGain();
  g2.gain.setValueAtTime(0.25, t);
  g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  src.connect(lp).connect(g2).connect(ac.destination);
  src.start(t);
  src.stop(t + 0.12);
}
