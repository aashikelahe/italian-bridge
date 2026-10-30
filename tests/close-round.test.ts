import { applyAction, cardLocations, getPlayerView, mustApply, roundSettled, seededRng, SEATS, type GameState } from '../src/engine';
import { stepAI } from '../src/ai/simulate';
import { newMatch } from './helpers';

/** Play AI steps until `stop` says so or the round ends. */
function playUntil(s0: GameState, rng: () => number, stop: (s: GameState) => boolean): GameState {
  let s = s0;
  for (let n = 0; n < 2000 && s.phase !== 'ROUND_RESULT' && !stop(s); n++) s = stepAI(s, 'normal', rng)!.state;
  return s;
}

function points(s: GameState) {
  return s.teams && s.config.teamScoring === 'teamContract'
    ? s.teams.map((t) => [t.roundScore, t.cumulativeScore])
    : SEATS.map((x) => [s.players[x].roundScore, s.players[x].cumulativeScore]);
}

describe('closing a settled round early', () => {
  it('is refused while the result can still change', () => {
    const rng = seededRng(3);
    const s = playUntil(newMatch({ mode: 'team', seed: 3 }), rng, (x) => x.phase === 'PLAYING');
    expect(roundSettled(s)).toBe(false);
    expect(getPlayerView(s, 'C').canCloseRound).toBe(false);
    const r = applyAction(s, { type: 'CLOSE_ROUND' });
    expect(r.ok).toBe(false);
  });

  for (const mode of ['team', 'individual'] as const) {
    it(`gives exactly the points the full round would give (${mode}, 120 rounds)`, () => {
      let closed = 0;
      for (let seed = 1; seed <= 120; seed++) {
        const rng = seededRng(seed);
        const settled = playUntil(newMatch({ mode, seed, rules: { bonusRound: seed % 2 ? 'afterSecondDeal' : 'off' } }), rng, roundSettled);
        if (settled.phase === 'ROUND_RESULT') continue; // only decided by the last trick
        expect(getPlayerView(settled, 'A').canCloseRound).toBe(true);
        const early = mustApply(settled, { type: 'CLOSE_ROUND' });
        const full = playUntil(settled, rng, () => false);
        expect(early.phase).toBe('ROUND_RESULT');
        expect(points(early)).toEqual(points(full));
        expect(early.matchWinner).toEqual(full.matchWinner);
        const summary = early.roundHistory[early.roundHistory.length - 1];
        expect(summary.closedAfter).toBe(settled.completedTricks.length + (settled.currentTrick?.plays.length === 4 ? 1 : 0));
        // Every card is still somewhere, and the next round deals normally.
        expect(cardLocations(early).counts).toEqual({ deck: 0, hands: 0, reserved: 0, table: 0, captured: 52 });
        const next = playUntil(mustApply(early, { type: 'NEXT_ROUND' }), rng, (x) => x.phase === 'PLAYING');
        expect(next.phase).toBe('PLAYING');
        expect(SEATS.every((x) => next.players[x].hand.length + (next.players[x].reserved ? 1 : 0) === 13)).toBe(true);
        closed++;
      }
      expect(closed).toBeGreaterThan(mode === 'team' ? 60 : 5);
    });
  }

  it('team example: defenders with 7 tricks against a bid of 7 settle the round', () => {
    const rng = seededRng(11);
    const s = playUntil(newMatch({ mode: 'team', seed: 11 }), rng, (x) => x.phase === 'PLAYING');
    const st: GameState = structuredClone(s);
    st.bidding.highestBid = 7;
    const bidTeam = st.teams!.find((t) => t.members.includes(st.trump.bidder!))!;
    const other = st.teams!.find((t) => t !== bidTeam)!;
    // Pretend 7 tricks were played and the defenders won all of them.
    st.completedTricks = Array.from({ length: 7 }, (_, k) => ({ index: k + 1, leader: 'A', ledSuit: 'S', plays: [], winner: other.members[0] }));
    st.players[other.members[0]].tricksWon = 7;
    expect(roundSettled(st)).toBe(true);
    st.players[other.members[0]].tricksWon = 6;
    st.players[bidTeam.members[0]].tricksWon = 1;
    expect(roundSettled(st)).toBe(false);
  });
});
