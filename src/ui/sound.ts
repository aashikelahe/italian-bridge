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

// ---------------------------------------------------------------- more table sounds

/** Short noise burst through a filter: the building block for card-like sounds. */
function noiseHit(ac: AudioContext, at: number, dur: number, type: BiquadFilterType, freq: number, gain: number, q = 1) {
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac, dur);
  const f = ac.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(f).connect(g).connect(ac.destination);
  src.start(at);
  src.stop(at + dur);
}

function tone(ac: AudioContext, at: number, freq: number, dur: number, gain: number, type: OscillatorType = 'sine', endFreq?: number) {
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, at + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(ac.destination);
  o.start(at);
  o.stop(at + dur + 0.02);
}

/** A riffle shuffle: a quick run of soft card flutters. */
export function playShuffle() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  for (let i = 0; i < 26; i++) noiseHit(ac, t + i * 0.022 + Math.random() * 0.008, 0.03, 'highpass', 2500 + Math.random() * 1500, 0.09);
  noiseHit(ac, t + 0.62, 0.09, 'bandpass', 900, 0.18, 0.8);
}

/** Cards being dealt: a few flicks. */
export function playDeal(count = 4) {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  for (let i = 0; i < count; i++) {
    noiseHit(ac, t + i * 0.11, 0.05, 'bandpass', 3200, 0.16, 1.2);
    noiseHit(ac, t + i * 0.11 + 0.035, 0.04, 'lowpass', 700, 0.08);
  }
}

/** A bid: a clicky poker chip. */
export function playBid() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  tone(ac, t, 2400, 0.06, 0.12, 'triangle');
  tone(ac, t + 0.05, 3100, 0.07, 0.09, 'triangle');
  noiseHit(ac, t, 0.04, 'highpass', 5000, 0.08);
}

/** A pass: a soft knock on the table. */
export function playPass() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  tone(ac, t, 180, 0.12, 0.22, 'sine', 90);
  noiseHit(ac, t, 0.05, 'lowpass', 600, 0.12);
}

/** The trump card is revealed: a rising shimmer. */
export function playReveal() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  [523, 659, 784, 1047].forEach((f, i) => tone(ac, t + i * 0.07, f, 0.5 - i * 0.05, 0.12, 'triangle'));
  noiseHit(ac, t, 0.4, 'highpass', 6000, 0.05);
}

/** It is your turn: a gentle two-note ding. */
export function playYourTurn() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  tone(ac, t, 880, 0.25, 0.12);
  tone(ac, t + 0.12, 1320, 0.35, 0.1);
}

/** A chat message arrives: a bubble pop. */
export function playChat() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  tone(ac, t, 600, 0.09, 0.14, 'sine', 1400);
}

/** Round won: a bright arpeggio. Round lost: a falling "wah-wah". */
export function playRoundEnd(won: boolean) {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  if (won) [523, 659, 784, 1047, 1319].forEach((f, i) => tone(ac, t + i * 0.09, f, 0.45, 0.13, 'triangle'));
  else [392, 370, 349, 294].forEach((f, i) => tone(ac, t + i * 0.22, f, i === 3 ? 0.7 : 0.25, 0.13, 'sawtooth', i === 3 ? 260 : undefined));
}

/** SMACK / বাড়ি: a card slammed on the table — a loud slap, a wooden thump and a snap. */
export function playSmack() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.18; // lands when the slam animation hits the board
  noiseHit(ac, t, 0.16, 'bandpass', 1800, 0.95, 0.7);   // slap
  noiseHit(ac, t, 0.05, 'highpass', 4500, 0.7);           // crack
  tone(ac, t, 140, 0.28, 0.85, 'sine', 45);               // thump
  tone(ac, t, 260, 0.12, 0.35, 'square', 120);            // body
  noiseHit(ac, t + 0.11, 0.04, 'highpass', 3500, 0.45);   // snap echo
}
