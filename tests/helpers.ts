import { createMatch, mustApply, seededRng, cardFromId, type GameState, type Seat, type RuleConfig, type Card } from '../src/engine';

export const ALL_AI = {
  A: { name: 'North', type: 'ai' as const },
  B: { name: 'East', type: 'ai' as const },
  C: { name: 'You', type: 'human' as const },
  D: { name: 'West', type: 'ai' as const },
};

export function newMatch(opts: { mode?: 'individual' | 'team'; target?: number; rules?: Partial<RuleConfig>; seed?: number; dealer?: Seat } = {}) {
  return createMatch({
    mode: opts.mode ?? 'individual',
    matchTarget: opts.target ?? 30,
    players: ALL_AI,
    // Most rule tests skip the Bonus call round; tests/bonus.test.ts covers it.
    rules: { bonusRound: 'off', ...opts.rules },
    dealer: opts.dealer ?? 'D',
    rng: seededRng(opts.seed ?? 1),
  });
}

/** Shuffle, cut and deal five each. Dealer D → bidding starts with A. */
export function toBidding(seed = 1, rules?: Partial<RuleConfig>, mode: 'individual' | 'team' = 'individual') {
  const rng = seededRng(seed);
  let s = newMatch({ seed, rules, mode });
  s = mustApply(s, { type: 'SHUFFLE' }, rng);
  s = mustApply(s, { type: 'CUT', seat: s.cutter, position: 20 });
  s = mustApply(s, { type: 'DEAL_INITIAL' });
  return s;
}

/** Bidding where `winner` bids 7 and everyone else passes. */
export function bidAndWin(s: GameState, winner: Seat, amount = 7): GameState {
  let st = s;
  for (let i = 0; i < 8 && st.phase === 'BIDDING'; i++) {
    const seat = st.currentPlayer!;
    st = seat === winner ? mustApply(st, { type: 'BID', seat, amount }) : mustApply(st, { type: 'PASS', seat });
  }
  return st;
}

/** Full setup to PLAYING with `bidder` reserving their first card. */
export function toPlaying(seed = 1, bidder: Seat = 'A', rules?: Partial<RuleConfig>, mode: 'individual' | 'team' = 'individual') {
  let s = bidAndWin(toBidding(seed, rules, mode), bidder);
  const reserved = s.players[bidder].hand[0];
  s = mustApply(s, { type: 'RESERVE', seat: bidder, cardId: reserved.id });
  s = mustApply(s, { type: 'DEAL_SECOND' });
  s = mustApply(s, { type: 'DEAL_THIRD' });
  return { s, reserved };
}

/**
 * Overwrite hands for targeted rule tests (keeps all 52 cards accounted for by
 * putting every unused card into captured piles is unnecessary: integrity is only
 * checked at deal/round end, which these tests don't reach).
 */
export function setHands(s: GameState, hands: Partial<Record<Seat, string[]>>, reserved?: { seat: Seat; id: string }) {
  const st: GameState = structuredClone(s);
  for (const [seat, ids] of Object.entries(hands) as [Seat, string[]][]) st.players[seat].hand = ids.map(cardFromId);
  if (reserved) {
    const c: Card = cardFromId(reserved.id);
    st.players[reserved.seat].reserved = c;
    st.trump = { ...st.trump, bidder: reserved.seat, suit: c.suit, cardId: c.id, revealed: false, revealedHow: null, revealedBy: null, revealedAtTrick: null };
  }
  return st;
}
