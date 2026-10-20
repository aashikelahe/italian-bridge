/**
 * AI opponents. They receive only their own PlayerView (never the full GameState),
 * so they cannot see other hands, the undealt deck, or another player's hidden trump card.
 * Every decision is checked against the same legal-move helpers the engine uses.
 */
import type { Action, Card, Difficulty, PlayedCard, Rng, Seat, Suit } from '../engine/types';
import type { PlayerView } from '../engine/view';
import { SUITS, createDeck } from '../engine/cards';
import { areOpponents, partnerOf } from '../engine/seating';
import { isEffectiveTrump, resolveTrickWinner } from '../engine/rules';
import { randInt } from '../engine/rng';

const NOISE: Record<Difficulty, number> = { easy: 1.6, normal: 0.6, hard: 0.2 };

// ---------------------------------------------------------------- bidding

const HONOR: Record<number, number> = { 14: 1.0, 13: 0.75, 12: 0.35, 11: 0.15 };

/** Estimated tricks (out of 13) from the initial five cards, assuming the best trump suit. */
export function estimateTricks(hand: Card[]): { estimate: number; bestSuit: Suit } {
  let hcp = 0;
  for (const c of hand) {
    let v = HONOR[c.strength] ?? 0;
    if (c.strength === 13 && hand.some((x) => x.suit === c.suit && x.strength === 14)) v = 0.9;
    hcp += v;
  }
  let bestSuit: Suit = hand[0]?.suit ?? 'S';
  let bestTrump = -1;
  for (const s of SUITS) {
    const cards = hand.filter((c) => c.suit === s);
    const len = cards.length;
    const expectedLen = len + ((13 - len) * 8) / 47; // expected final length after 8 more cards
    const honors = cards.reduce((n, c) => n + (HONOR[c.strength] ?? 0), 0);
    const trumpTricks = Math.max(0, expectedLen - 2.5) * 0.8 + honors * 0.3;
    if (trumpTricks > bestTrump) { bestTrump = trumpTricks; bestSuit = s; }
  }
  const estimate = hcp * (13 / 5) * 0.7 + bestTrump + 1.5;
  return { estimate, bestSuit };
}

function decideBid(view: PlayerView, difficulty: Difficulty, rng: Rng): Action {
  if (view.canCallReshuffle && (difficulty !== 'easy' || rng() < 0.5)) return { type: 'CALL_RESHUFFLE', seat: view.seat };
  const { minBid, maxBid } = view.config;
  const high = view.bidding.highestBid;
  const minValid = high == null ? minBid : high + 1;
  if (minValid > maxBid) return { type: 'PASS', seat: view.seat };
  let est = estimateTricks(view.hand).estimate + (rng() * 2 - 1) * NOISE[difficulty];
  // Team contract: the partner's tricks count too.
  if (view.mode === 'team' && view.config.teamScoring === 'teamContract') est += 2;
  // Team play: don't fight your partner for the contract unless much stronger.
  if (view.mode === 'team' && view.bidding.highestBidder === partnerOf(view.seat)) est -= 2;
  if (est < minValid) return { type: 'PASS', seat: view.seat };
  const amount = Math.max(minValid, Math.min(maxBid, Math.floor(est)));
  return { type: 'BID', seat: view.seat, amount };
}

// ---------------------------------------------------------------- trump reservation

export function chooseTrumpCard(hand: Card[]): Card {
  let best: { suit: Suit; score: number } | null = null;
  for (const s of SUITS) {
    const cards = hand.filter((c) => c.suit === s);
    if (!cards.length) continue;
    const score = cards.length * 1.0 + cards.reduce((n, c) => n + (HONOR[c.strength] ?? 0), 0) * 0.8;
    if (!best || score > best.score) best = { suit: s, score };
  }
  const suitCards = hand.filter((c) => c.suit === best!.suit).sort((a, b) => a.strength - b.strength);
  // Reserve the lowest card of the chosen suit so high trumps stay playable.
  return suitCards[0];
}

// ---------------------------------------------------------------- card play

interface PlayCtx {
  view: PlayerView;
  difficulty: Difficulty;
  rng: Rng;
  trumpSuit: Suit | null; // what *I* know
  trumpLiveNow: boolean;
  unseen: Map<Suit, number[]>; // strengths not in my hand and not yet played
}

function buildCtx(view: PlayerView, difficulty: Difficulty, rng: Rng): PlayCtx {
  const seen = new Set<string>();
  for (const c of view.hand) seen.add(c.id);
  if (view.myReserved) seen.add(view.myReserved.id);
  for (const t of view.completedTricks) for (const p of t.plays) seen.add(p.cardId);
  for (const p of view.currentTrick?.plays ?? []) seen.add(p.card.id);
  const unseen = new Map<Suit, number[]>(SUITS.map((s) => [s, []]));
  for (const c of createDeck()) if (!seen.has(c.id)) unseen.get(c.suit)!.push(c.strength);
  return {
    view, difficulty, rng,
    trumpSuit: view.trump.suit,
    trumpLiveNow: view.config.trumpEffect === 'always' || view.trump.revealed,
    unseen,
  };
}

/** My card is the highest remaining card of its suit. */
function isBoss(ctx: PlayCtx, c: Card): boolean {
  return (ctx.unseen.get(c.suit) ?? []).every((s) => s < c.strength);
}

function target(view: PlayerView, seat: Seat): number {
  const b = view.players[seat].bid;
  return b.kind === 'bid' ? b.amount : view.config.passTarget;
}

function wouldWin(ctx: PlayCtx, plays: PlayedCard[], card: Card): boolean {
  const led = plays.length ? plays[0].card.suit : card.suit;
  const hypothetical: PlayedCard[] = [...plays, { seat: ctx.view.seat, card, trumpLive: ctx.trumpLiveNow }];
  return resolveTrickWinner(hypothetical, led, ctx.trumpSuit) === ctx.view.seat;
}

const lowest = (cs: Card[]) => cs.reduce((a, b) => (b.strength < a.strength ? b : a));
const highest = (cs: Card[]) => cs.reduce((a, b) => (b.strength > a.strength ? b : a));

function chooseLead(ctx: PlayCtx, legal: Card[]): Card {
  const { view } = ctx;
  const nonTrump = legal.filter((c) => !(ctx.trumpLiveNow && c.suit === ctx.trumpSuit));
  const pool = nonTrump.length ? nonTrump : legal;
  const bosses = pool.filter((c) => isBoss(ctx, c));
  if (bosses.length) return highest(bosses);
  // Bidder with revealed trump and long trumps: draw trumps (hard).
  if (ctx.difficulty === 'hard' && ctx.trumpLiveNow && view.trump.bidder === view.seat) {
    const trumps = legal.filter((c) => c.suit === ctx.trumpSuit);
    if (trumps.length >= 4) return highest(trumps);
  }
  // Lead low from the longest side suit.
  const bySuit = new Map<Suit, Card[]>();
  for (const c of pool) bySuit.set(c.suit, [...(bySuit.get(c.suit) ?? []), c]);
  const longest = [...bySuit.values()].sort((a, b) => b.length - a.length)[0];
  return lowest(longest);
}

function partnerWinning(ctx: PlayCtx, plays: PlayedCard[]): boolean {
  if (ctx.view.mode !== 'team' || plays.length === 0) return false;
  const led = plays[0].card.suit;
  const w = resolveTrickWinner(plays, led, ctx.trumpSuit);
  if (w !== partnerOf(ctx.view.seat)) return false;
  const wp = plays.find((p) => p.seat === w)!;
  // Partner is safe if last to act before me, or holds the boss / a trump.
  const myPos = plays.length;
  return myPos === 3 || isEffectiveTrump(wp, led, ctx.trumpSuit) || (ctx.unseen.get(wp.card.suit) ?? []).every((s) => s < wp.card.strength);
}

function discard(ctx: PlayCtx, legal: Card[]): Card {
  const nonTrump = legal.filter((c) => c.suit !== ctx.trumpSuit);
  const pool = nonTrump.length ? nonTrump : legal;
  // Lowest card, preferring shorter suits (to create voids).
  const count = (s: Suit) => ctx.view.hand.filter((c) => c.suit === s).length;
  return [...pool].sort((a, b) => a.strength - b.strength || count(a.suit) - count(b.suit))[0];
}

function chooseFollow(ctx: PlayCtx, legal: Card[]): Card {
  const plays = ctx.view.currentTrick!.plays;
  const led = plays[0].card.suit;
  const lastToPlay = plays.length === 3;
  if (partnerWinning(ctx, plays)) return legal.some((c) => c.suit === led) ? lowest(legal) : discard(ctx, legal);

  const winners = legal.filter((c) => wouldWin(ctx, plays, c));
  // Overtricks never cost points and deny opponents, so the AI always tries to win when it cheaply can.
  if (winners.length === 0) {
    return legal.some((c) => c.suit === led) ? lowest(legal) : discard(ctx, legal);
  }
  const following = winners.filter((c) => c.suit === led);
  if (following.length) {
    if (lastToPlay) return lowest(following);
    const boss = following.filter((c) => isBoss(ctx, c));
    if (boss.length) return lowest(boss);
    // Not a sure winner: second hand plays low, third hand plays high-ish.
    const urgent = target(ctx.view, ctx.view.seat) - ctx.view.players[ctx.view.seat].tricksWon >= 13 - ctx.view.completedTricks.length - 1;
    return plays.length >= 2 || urgent ? highest(following) : lowest(legal);
  }
  // Can only win by trumping: use the smallest winning trump.
  return lowest(winners);
}

function decidePlay(view: PlayerView, difficulty: Difficulty, rng: Rng): Action {
  const ctx = buildCtx(view, difficulty, rng);
  const t = view.currentTrick!;
  const plays = t.plays;

  // Reveal decisions (before choosing a card).
  if (plays.length > 0) {
    const led = plays[0].card.suit;
    const void_ = !view.hand.some((c) => c.suit === led);
    const opponentWinning = (() => {
      const w = resolveTrickWinner(plays, led, ctx.trumpSuit);
      return areOpponents(view.seat, w, view.mode);
    })();
    if (view.canRequestReveal && void_ && opponentWinning) {
      const p = difficulty === 'easy' ? 0.4 : 1;
      if (rng() < p) return { type: 'REQUEST_REVEAL', seat: view.seat };
    }
    // Bidder who can't follow suit: reveal (and play) the reserved trump if it takes the trick.
    if (view.canRevealVoluntarily && view.myReserved && opponentWinning) {
      const r = view.myReserved;
      const hypothetical: PlayedCard[] = [...plays, { seat: view.seat, card: r, trumpLive: true }];
      const wins = resolveTrickWinner(hypothetical, led, r.suit) === view.seat;
      if (wins && (difficulty !== 'easy' || rng() < 0.5)) return { type: 'REVEAL_VOLUNTARY', seat: view.seat };
    }
  }

  const legal = view.hand.filter((c) => view.legalCardIds.includes(c.id));
  if (legal.length === 0) throw new Error(`AI ${view.seat} has no legal card`);
  if (difficulty === 'easy' && rng() < 0.3) {
    return { type: 'PLAY_CARD', seat: view.seat, cardId: legal[randInt(rng, 0, legal.length - 1)].id };
  }
  const card = plays.length === 0 ? chooseLead(ctx, legal) : chooseFollow(ctx, legal);
  return { type: 'PLAY_CARD', seat: view.seat, cardId: card.id };
}

// ---------------------------------------------------------------- entry point

/** Decide the next action for an AI seat, or null if it has nothing to do in this phase. */
export function decideAIAction(view: PlayerView, difficulty: Difficulty, rng: Rng): Action | null {
  if (view.currentPlayer !== view.seat) return null;
  switch (view.phase) {
    case 'CUT':
      return { type: 'CUT', seat: view.seat, position: randInt(rng, 8, 44) };
    case 'BIDDING':
      return decideBid(view, difficulty, rng);
    case 'TRUMP_RESERVATION':
      return { type: 'RESERVE', seat: view.seat, cardId: chooseTrumpCard(view.hand).id };
    case 'PLAYING':
      return view.legalCardIds.length ? decidePlay(view, difficulty, rng) : null;
    default:
      return null;
  }
}
