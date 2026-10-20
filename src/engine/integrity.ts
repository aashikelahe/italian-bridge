import type { GameState } from './types';
import { SEATS } from './seating';

export interface CardLocations {
  deck: number;
  hands: number;
  reserved: number;
  table: number;
  captured: number;
}

/** Count cards in every location. Each of the 52 cards must be in exactly one place. */
export function cardLocations(state: GameState): { counts: CardLocations; ids: string[] } {
  const ids: string[] = [];
  const counts: CardLocations = { deck: 0, hands: 0, reserved: 0, table: 0, captured: 0 };
  for (const c of state.deck) { ids.push(c.id); counts.deck++; }
  for (const s of SEATS) {
    const p = state.players[s];
    for (const c of p.hand) { ids.push(c.id); counts.hands++; }
    if (p.reserved) { ids.push(p.reserved.id); counts.reserved++; }
    for (const c of p.captured) { ids.push(c.id); counts.captured++; }
  }
  for (const pl of state.currentTrick?.plays ?? []) { ids.push(pl.card.id); counts.table++; }
  return { counts, ids };
}

/** Throws if any card is missing or duplicated, or round invariants are broken. */
export function assertIntegrity(state: GameState): void {
  // Before the shuffle there is no deck yet.
  if (state.phase === 'SHUFFLE') return;
  const { ids } = cardLocations(state);
  const unique = new Set(ids);
  if (ids.length !== 52 || unique.size !== 52) {
    throw new Error(`Card integrity violated: ${ids.length} cards found, ${unique.size} unique`);
  }
  const reservedHolders = SEATS.filter((s) => state.players[s].reserved);
  if (reservedHolders.length > 1) throw new Error('More than one reserved card');
  if (state.trump.revealed && reservedHolders.length) throw new Error('Revealed trump card is still marked reserved');

  if (state.completedTricks.length === 13) {
    const tricks = SEATS.reduce((n, s) => n + state.players[s].tricksWon, 0);
    if (tricks !== 13) throw new Error(`Trick counts sum to ${tricks}, expected 13`);
    const played = state.completedTricks.flatMap((t) => t.plays.map((p) => p.cardId));
    if (played.length !== 52 || new Set(played).size !== 52) throw new Error('Not every card was played exactly once');
    if (state.completedTricks.some((t) => t.plays.length !== 4)) throw new Error('A trick does not contain four cards');
  }
}
