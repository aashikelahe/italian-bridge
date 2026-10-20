import type { Card, GameMode, PlayedCard, RuleConfig, Seat, Suit } from './types';
import { areOpponents } from './seating';

/** Cards a player may legally play from their playable hand (reserved card is never in `hand`). */
export function legalCards(hand: Card[], ledSuit: Suit | null): Card[] {
  if (!ledSuit) return [...hand];
  const follow = hand.filter((c) => c.suit === ledSuit);
  return follow.length > 0 ? follow : [...hand];
}

export function isLegalPlay(hand: Card[], ledSuit: Suit | null, cardId: string): boolean {
  return legalCards(hand, ledSuit).some((c) => c.id === cardId);
}

export function canFollowSuit(hand: Card[], ledSuit: Suit | null): boolean {
  return !!ledSuit && hand.some((c) => c.suit === ledSuit);
}

/** Inputs needed to decide reveal eligibility — available both in GameState and in a PlayerView. */
export interface RevealContext {
  phase: string;
  seat: Seat;
  currentPlayer: Seat | null;
  bidder: Seat | null;
  revealed: boolean;
  trickInProgress: boolean;
  ledSuit: Suit | null;
  hand: Card[];
  mode: GameMode;
  config: RuleConfig;
}

/**
 * Voluntary reveal by the highest bidder, on their own turn, while the trump is hidden.
 * Default ('whenVoid'): only when someone else led and the bidder holds no card of the led
 * suit in their playable hand (e.g. trump was led and the reserved card is their only one,
 * or they need to trump). The revealed card must then be played to that trick.
 */
export function canRevealVoluntarily(ctx: RevealContext): boolean {
  if (ctx.phase !== 'PLAYING' || !ctx.trickInProgress || ctx.revealed) return false;
  if (ctx.bidder !== ctx.seat || ctx.currentPlayer !== ctx.seat) return false;
  if (ctx.config.voluntaryReveal === 'anyTurn') return true;
  return !!ctx.ledSuit && !canFollowSuit(ctx.hand, ctx.ledSuit);
}

/** Reveal request: current player (not the bidder) who cannot follow the led suit. */
export function canRequestReveal(ctx: RevealContext): boolean {
  if (ctx.phase !== 'PLAYING' || !ctx.trickInProgress || ctx.revealed) return false;
  if (!ctx.bidder || ctx.seat === ctx.bidder || ctx.currentPlayer !== ctx.seat) return false;
  if (!ctx.ledSuit || canFollowSuit(ctx.hand, ctx.ledSuit)) return false;
  if (!ctx.config.partnerMayRequestReveal && !areOpponents(ctx.seat, ctx.bidder, ctx.mode)) return false;
  return true;
}

/** True if this play counts as a trump in the current trick. */
export function isEffectiveTrump(p: PlayedCard, ledSuit: Suit, trumpSuit: Suit | null): boolean {
  if (!trumpSuit || p.card.suit !== trumpSuit) return false;
  if (ledSuit === trumpSuit) return true; // following a trump lead: compared as led suit anyway
  return p.trumpLive;
}

/**
 * Determine the winner of a trick.
 * 1. If any effective trump was played, the highest trump wins.
 * 2. Otherwise the highest card of the led suit wins. Off-suit non-trumps never win.
 */
export function resolveTrickWinner(plays: PlayedCard[], ledSuit: Suit, trumpSuit: Suit | null): Seat {
  if (plays.length === 0) throw new Error('Cannot resolve an empty trick');
  const trumps = plays.filter((p) => isEffectiveTrump(p, ledSuit, trumpSuit));
  const pool = trumps.length > 0 ? trumps : plays.filter((p) => p.card.suit === ledSuit);
  let best = pool[0];
  for (const p of pool) if (p.card.strength > best.card.strength) best = p;
  return best.seat;
}

/** Which play is currently winning an incomplete trick (for UI hints and AI). */
export function currentWinningPlay(plays: PlayedCard[], trumpSuit: Suit | null): PlayedCard | null {
  if (plays.length === 0) return null;
  const led = plays[0].card.suit;
  const seat = resolveTrickWinner(plays, led, trumpSuit);
  return plays.find((p) => p.seat === seat) ?? null;
}

/** A face card for the reshuffle rule: A, K, Q or J. */
export const isFaceCard = (c: Card) => c.strength >= 11;

/**
 * Reshuffle call: during bidding, on your own turn before you have bid or passed, if your
 * five cards hold no A, K, Q or J. By default only the first hand (first bidder) may call,
 * and only before anyone has bid.
 */
export function canCallReshuffle(args: {
  phase: string; seat: Seat; currentPlayer: Seat | null; starter: Seat; actedSeats: Seat[]; hand: Card[]; config: RuleConfig;
}): boolean {
  const { phase, seat, currentPlayer, starter, actedSeats, hand, config } = args;
  if (phase !== 'BIDDING' || currentPlayer !== seat || config.reshuffleCall === 'off') return false;
  if (actedSeats.includes(seat)) return false;
  if (config.reshuffleCall === 'firstHand' && (seat !== starter || actedSeats.length > 0)) return false;
  return hand.length === 5 && !hand.some(isFaceCard);
}
