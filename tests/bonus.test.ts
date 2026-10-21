import { applyAction, calculateRoundScore, createMatch, mustApply, seededRng, type GameState, type Seat } from '../src/engine';
import { playRoundAI } from '../src/ai/simulate';
import { ALL_AI, bidAndWin, toBidding } from './helpers';

/** Bidding won by `bidder` with `amount`, trump reserved, second deal done: the Bonus call round. */
function toBonus(bidder: Seat = 'A', amount = 8, mode: 'individual' | 'team' = 'team'): GameState {
  let s = bidAndWin(toBidding(3, { bonusRound: 'afterSecondDeal' }, mode), bidder, amount);
  s = mustApply(s, { type: 'RESERVE', seat: bidder, cardId: s.players[bidder].hand[0].id });
  s = mustApply(s, { type: 'DEAL_SECOND' });
  return s;
}

describe('Bonus call round', () => {
  it('starts after the second deal with nine cards each, first hand first', () => {
    const s = toBonus();
    expect(s.phase).toBe('BONUS_CALL');
    expect(s.currentPlayer).toBe('A');
    expect(s.bonus!.minNext).toBe(10);
    expect(s.players.B.hand).toHaveLength(9);
  });

  it('nobody calls: play goes on with the original contract', () => {
    let s = toBonus();
    for (const seat of ['A', 'B', 'C', 'D'] as const) s = mustApply(s, { type: 'BONUS_PASS', seat });
    expect(s.phase).toBe('THIRD_DEAL');
    expect(s.bidding.highestBid).toBe(8);
    expect(s.trump.bidder).toBe('A');
  });

  it('after a Bonus call the next players may only go higher; the highest caller takes over and picks a new trump', () => {
    let s = toBonus('A', 8);
    const oldReserved = s.players.A.reserved!;
    s = mustApply(s, { type: 'BONUS_PASS', seat: 'A' });
    s = mustApply(s, { type: 'BONUS_CALL', seat: 'B', amount: 10 });
    expect(applyAction(s, { type: 'BONUS_CALL', seat: 'C', amount: 10 }).ok).toBe(false);
    s = mustApply(s, { type: 'BONUS_CALL', seat: 'C', amount: 11 });
    s = mustApply(s, { type: 'BONUS_PASS', seat: 'D' });
    expect(s.phase).toBe('TRUMP_RESERVATION');
    expect(s.trump.bidder).toBe('C');
    expect(s.bidding.highestBid).toBe(11);
    expect(s.players.A.reserved).toBeNull();
    expect(s.players.A.hand.map((c) => c.id)).toContain(oldReserved.id);
    expect(s.players.A.hand).toHaveLength(9);
    s = mustApply(s, { type: 'RESERVE', seat: 'C', cardId: s.players.C.hand[4].id });
    expect(s.phase).toBe('THIRD_DEAL');
    s = mustApply(s, { type: 'DEAL_THIRD' });
    for (const seat of ['A', 'B', 'C', 'D'] as const) expect(s.players[seat].hand.length + (s.players[seat].reserved ? 1 : 0)).toBe(13);
    expect(s.currentTrick!.leader).toBe('D');
  });

  it('a call of 13 ends the round of calls at once', () => {
    let s = toBonus('A', 8);
    s = mustApply(s, { type: 'BONUS_CALL', seat: 'A', amount: 13 });
    expect(s.phase).toBe('THIRD_DEAL'); // A already holds the trump
    expect(s.bidding.highestBid).toBe(13);
  });

  it('when the bid was already 10, calls start at 11', () => {
    const s = toBonus('B', 10);
    expect(s.bonus!.minNext).toBe(11);
  });

  it('scoring: 10 → 13, 11 → 14, 12 → 15, 13 → 16 when made; the call is lost when missed', () => {
    for (const [n, made] of [[10, 13], [11, 14], [12, 15], [13, 16]] as const) {
      expect(calculateRoundScore({ kind: 'bid', amount: n }, n)).toBe(made);
      expect(calculateRoundScore({ kind: 'bid', amount: n }, n - 1)).toBe(-n);
    }
  });

  it('computer players play complete rounds with the Bonus round on', () => {
    const rng = seededRng(11);
    for (let g = 0; g < 40; g++) {
      const s = createMatch({ mode: g % 2 ? 'team' : 'individual', matchTarget: 30, players: ALL_AI, rng, dealer: 'D' });
      const end = playRoundAI(s, 'hard', rng);
      expect(end.phase === 'ROUND_RESULT' || end.phase === 'MATCH_OVER').toBe(true);
      expect(end.completedTricks).toHaveLength(13);
    }
  });
});
