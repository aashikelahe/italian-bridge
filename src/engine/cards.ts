import type { Card, Rank, Suit } from './types';

export const SUITS: Suit[] = ['S', 'H', 'D', 'C'];
/** Highest to lowest. */
export const RANKS: Rank[] = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];

export const RANK_STRENGTH: Record<Rank, number> = {
  A: 14, K: 13, Q: 12, J: 11, '10': 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2,
};

export const SUIT_SYMBOL: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const SUIT_NAME: Record<Suit, string> = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
export const isRed = (s: Suit) => s === 'H' || s === 'D';

export function makeCard(suit: Suit, rank: Rank): Card {
  return { id: `${rank}${suit}`, suit, rank, strength: RANK_STRENGTH[rank] };
}

/** Rebuild a Card from its id ("10H" -> 10 of Hearts). */
export function cardFromId(id: string): Card {
  const suit = id.slice(-1) as Suit;
  const rank = id.slice(0, -1) as Rank;
  if (!SUITS.includes(suit) || !(rank in RANK_STRENGTH)) throw new Error(`Invalid card id: ${id}`);
  return makeCard(suit, rank);
}

/** All 52 unique cards in a fixed order. */
export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const s of SUITS) for (const r of RANKS) deck.push(makeCard(s, r));
  return deck;
}

export function cardLabel(c: Card): string {
  return `${c.rank}${SUIT_SYMBOL[c.suit]}`;
}

export type SortPref = 'suitThenRank' | 'rankThenSuit';

/** Sort a hand for display, alternating colours by default (♠ ♥ ♣ ♦). */
export function sortHand(cards: Card[], pref: SortPref = 'suitThenRank', suitOrder: Suit[] = ['S', 'H', 'C', 'D']): Card[] {
  const so = (s: Suit) => suitOrder.indexOf(s);
  return [...cards].sort((a, b) =>
    pref === 'suitThenRank'
      ? so(a.suit) - so(b.suit) || b.strength - a.strength
      : b.strength - a.strength || so(a.suit) - so(b.suit),
  );
}
