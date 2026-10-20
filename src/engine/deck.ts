import type { Card, Rng } from './types';

/** Fisher–Yates shuffle. Returns a new array; never adds or removes cards. */
export function shuffle(cards: Card[], rng: Rng): Card[] {
  const a = [...cards];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Cut the deck at `position` (1..length-1): sections A = [0, position), B = [position, end)
 * are recombined as B followed by A. No randomisation.
 */
export function cut(cards: Card[], position: number): Card[] {
  if (!Number.isInteger(position) || position < 1 || position > cards.length - 1) {
    throw new Error(`Cut position must be an integer between 1 and ${cards.length - 1}`);
  }
  return [...cards.slice(position), ...cards.slice(0, position)];
}

/**
 * One riffle shuffle (Gilbert–Shannon–Reeds model): cut near the middle, then drop cards
 * from either half with probability proportional to its size. Runs of cards stay together,
 * like a real riffle.
 */
export function riffle(cards: Card[], rng: Rng): Card[] {
  let k = 0;
  for (let i = 0; i < cards.length; i++) if (rng() < 0.5) k++;
  const left = cards.slice(0, k);
  const right = cards.slice(k);
  const out: Card[] = [];
  let i = 0, j = 0;
  while (i < left.length || j < right.length) {
    const l = left.length - i, r = right.length - j;
    if (rng() * (l + r) < l) out.push(left[i++]); else out.push(right[j++]);
  }
  return out;
}

/** How many riffles a dealer gives the gathered deck: often light, sometimes thorough. */
export function pickRiffles(rng: Rng): number {
  const x = rng();
  if (x < 0.35) return 1;
  if (x < 0.65) return 2;
  if (x < 0.85) return 3;
  return 7; // 7 riffles ≈ fully random
}

export function riffleTimes(cards: Card[], times: number, rng: Rng): Card[] {
  let d = cards;
  for (let t = 0; t < times; t++) d = riffle(d, rng);
  return d;
}
