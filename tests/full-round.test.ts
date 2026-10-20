import { calculateRoundScore, mustApply, seededRng, SEATS, teamOf, getPlayerView, cardLocations, type GameState, type Difficulty } from '../src/engine';
import { playRoundAI, stepAI } from '../src/ai/simulate';
import { decideAIAction } from '../src/ai';
import { newMatch } from './helpers';

function checkRound(before: GameState, after: GameState) {
  expect(after.phase).toBe('ROUND_RESULT');
  expect(after.completedTricks).toHaveLength(13);
  for (const t of after.completedTricks) expect(t.plays).toHaveLength(4);
  const played = after.completedTricks.flatMap((t) => t.plays.map((p) => p.cardId));
  expect(new Set(played).size).toBe(52);
  expect(SEATS.reduce((n, s) => n + after.players[s].tricksWon, 0)).toBe(13);
  expect(SEATS.reduce((n, s) => n + after.players[s].captured.length, 0)).toBe(52);
  expect(cardLocations(after).counts).toEqual({ deck: 0, hands: 0, reserved: 0, table: 0, captured: 52 });
  expect(after.trump.revealed).toBe(true);
  const teamContract = after.mode === 'team' && after.config.teamScoring === 'teamContract';
  if (teamContract) {
    const bidTeam = teamOf(after.trump.bidder!);
    for (const t of after.teams!) {
      const tricks = after.players[t.members[0]].tricksWon + after.players[t.members[1]].tricksWon;
      const status = t.id === bidTeam ? { kind: 'bid' as const, amount: after.bidding.highestBid! } : { kind: 'pass' as const };
      expect(t.roundScore).toBe(calculateRoundScore(status, tricks));
      expect(t.cumulativeScore).toBe(before.teams!.find((x) => x.id === t.id)!.cumulativeScore + t.roundScore);
    }
    for (const s of SEATS) expect(after.players[s].roundScore).toBe(0);
    return;
  }
  for (const s of SEATS) {
    const p = after.players[s];
    expect(p.roundScore).toBe(calculateRoundScore(p.bid, p.tricksWon));
    expect(p.cumulativeScore).toBe(before.players[s].cumulativeScore + p.roundScore);
    expect(p.bid.kind === 'pass' ? Math.abs(p.roundScore) === 5 : true).toBe(true);
  }
  const bidder = after.trump.bidder!;
  expect(after.players[bidder].bid).toEqual({ kind: 'bid', amount: after.bidding.highestBid });
  if (after.teams) {
    for (const t of after.teams) {
      expect(t.roundScore).toBe(after.players[t.members[0]].roundScore + after.players[t.members[1]].roundScore);
    }
  }
}

describe('full round simulation', () => {
  it('plays a complete round with 4 AI players, every card exactly once', () => {
    const rng = seededRng(7);
    const s0 = newMatch({ seed: 7 });
    let sawThirteenEach = false;
    const end = playRoundAI(s0, 'normal', rng, (s, a) => {
      if (a.type === 'DEAL_THIRD') {
        sawThirteenEach = SEATS.every((x) => s.players[x].hand.length + (s.players[x].reserved ? 1 : 0) === 13);
      }
    });
    expect(sawThirteenEach).toBe(true);
    checkRound(s0, end);
  });

  const difficulties: Difficulty[] = ['easy', 'normal', 'hard'];
  for (const mode of ['individual', 'team'] as const) {
    for (const trumpEffect of ['afterReveal', 'always'] as const) {
      it(`200 random rounds stay consistent (${mode}, trump ${trumpEffect})`, () => {
        for (let seed = 1; seed <= 200; seed++) {
          const rng = seededRng(seed * 31 + 7);
          const s0 = newMatch({ seed, mode, rules: { trumpEffect } });
          const end = playRoundAI(s0, difficulties[seed % 3], rng);
          checkRound(s0, end);
        }
      });
    }
  }

  it('AI only ever proposes legal actions and never sees hidden cards', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rng = seededRng(seed);
      let s = newMatch({ seed, mode: seed % 2 ? 'team' : 'individual' });
      for (let i = 0; i < 400; i++) {
        if (s.currentPlayer && s.phase === 'PLAYING' && s.trump.bidder && !s.trump.revealed) {
          const seat = s.currentPlayer;
          const v = getPlayerView(s, seat);
          if (seat !== s.trump.bidder) expect(JSON.stringify(v)).not.toContain(`"id":"${s.trump.cardId}"`);
        }
        const r = stepAI(s, 'hard', rng); // throws if any AI action is rejected
        if (!r) break;
        s = r.state;
      }
      expect(s.phase).toBe('ROUND_RESULT');
    }
  });

  it('ends the match after the round in which a side reaches 30 (team) / 50 (individual)', () => {
    for (const [mode, target] of [['team', 30], ['individual', 50]] as const) {
      const rng = seededRng(99);
      let s = newMatch({ seed: 99, mode, target });
      // Round 1 with nobody near the target: match continues.
      s = playRoundAI(s, 'normal', rng);
      expect(s.matchWinner).toBeNull();
      s = mustApply(s, { type: 'NEXT_ROUND' });
      expect(s.phase).toBe('SHUFFLE');
      // Put one side far ahead; whatever happens this round it stays above the target.
      if (mode === 'team') s.teams![1].cumulativeScore = target + 20;
      else s.players.B.cumulativeScore = target + 20;
      s = playRoundAI(s, 'normal', rng);
      expect(s.phase).toBe('ROUND_RESULT');
      expect(s.matchWinner).toEqual(mode === 'team' ? { kind: 'team', id: 'Y' } : { kind: 'player', seat: 'B' });
      s = mustApply(s, { type: 'NEXT_ROUND' });
      expect(s.phase).toBe('MATCH_OVER');
      expect(s.roundHistory).toHaveLength(2);
    }
  });

  it('dealer rotates clockwise between rounds', () => {
    const rng = seededRng(3);
    let s = newMatch({ seed: 3, dealer: 'A', target: 999 });
    s = mustApply(playRoundAI(s, 'normal', rng), { type: 'NEXT_ROUND' });
    expect(s.dealer).toBe('B');
    expect(s.round).toBe(2);
    expect(s.phase).toBe('SHUFFLE');
  });

  it('decideAIAction returns nothing when it is not that seat’s turn', () => {
    const s = newMatch();
    expect(decideAIAction(getPlayerView(s, 'A'), 'normal', seededRng(1))).toBeNull();
  });
});
