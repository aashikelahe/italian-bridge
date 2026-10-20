import { calculateRoundScore, checkMatchWinner, createMatch, seededRng, type GameState } from '../src/engine';
import { ALL_AI } from './helpers';

describe('individual scoring', () => {
  it.each([
    [7, 7, 7], [7, 8, 7], [7, 6, -7], [9, 9, 9], [9, 11, 9], [9, 8, -9], [13, 13, 13], [13, 12, -13],
  ])('bid %i, %i tricks → %i', (bid, tricks, score) => {
    expect(calculateRoundScore({ kind: 'bid', amount: bid }, tricks)).toBe(score);
  });

  it.each([[4, -5], [5, 5], [6, 5], [8, 5], [0, -5], [13, 5]])('pass, %i tricks → %i', (tricks, score) => {
    expect(calculateRoundScore({ kind: 'pass' }, tricks)).toBe(score);
  });

  it('rejects invalid input', () => {
    expect(() => calculateRoundScore({ kind: 'none' }, 3)).toThrow();
    expect(() => calculateRoundScore({ kind: 'pass' }, 14)).toThrow();
  });
});

function match(mode: 'individual' | 'team', target = 30): GameState {
  return createMatch({ mode, matchTarget: target, players: ALL_AI, dealer: 'A', rng: seededRng(1) });
}

describe('team scoring and match end', () => {
  it('team round score = sum of partners’ round scores (spec examples)', () => {
    expect(calculateRoundScore({ kind: 'bid', amount: 7 }, 7) + calculateRoundScore({ kind: 'pass' }, 6)).toBe(12);
    expect(calculateRoundScore({ kind: 'bid', amount: 7 }, 8) + calculateRoundScore({ kind: 'pass' }, 4)).toBe(2);
  });

  it('match ends when a side reaches the target, supports negative totals', () => {
    const s = match('team', 30);
    s.teams![0].cumulativeScore = 31;
    s.teams![1].cumulativeScore = -12;
    expect(checkMatchWinner('team', s.players, s.teams, 30, 'reachOrExceed', 'playOn').winner).toEqual({ kind: 'team', id: 'X' });
    s.teams![0].cumulativeScore = 29;
    expect(checkMatchWinner('team', s.players, s.teams, 30, 'reachOrExceed', 'playOn').winner).toBeNull();
  });

  it('50-point target, individual mode', () => {
    const s = match('individual', 50);
    s.players.B.cumulativeScore = 50;
    s.players.A.cumulativeScore = -20;
    expect(checkMatchWinner('individual', s.players, null, 50, 'reachOrExceed', 'playOn').winner).toEqual({ kind: 'player', seat: 'B' });
    s.players.B.cumulativeScore = 49;
    expect(checkMatchWinner('individual', s.players, null, 50, 'reachOrExceed', 'playOn').winner).toBeNull();
  });

  it('two sides over the target: the higher total wins; an exact tie plays on (or is shared)', () => {
    const s = match('individual', 30);
    s.players.A.cumulativeScore = 33;
    s.players.C.cumulativeScore = 37;
    expect(checkMatchWinner('individual', s.players, null, 30, 'reachOrExceed', 'playOn').winner).toEqual({ kind: 'player', seat: 'C' });
    s.players.A.cumulativeScore = 37;
    const tie = checkMatchWinner('individual', s.players, null, 30, 'reachOrExceed', 'playOn');
    expect(tie.winner).toBeNull();
    expect(tie.tieNote).toMatch(/tied/);
    const shared = checkMatchWinner('individual', s.players, null, 30, 'reachOrExceed', 'shared');
    expect(shared.shared).toEqual(['A', 'C']);
  });

  it('exact-target rule only ends on exactly the target', () => {
    const s = match('individual', 30);
    s.players.A.cumulativeScore = 32;
    expect(checkMatchWinner('individual', s.players, null, 30, 'exact', 'playOn').winner).toBeNull();
    s.players.A.cumulativeScore = 30;
    expect(checkMatchWinner('individual', s.players, null, 30, 'exact', 'playOn').winner).toEqual({ kind: 'player', seat: 'A' });
  });
});

describe('team contract scoring (team mode default)', () => {
  it('D bids 8 over A’s 7: B+D need 8 together, A+C need 5 together; no individual points', async () => {
    const { toBidding } = await import('./helpers');
    const { mustApply } = await import('../src/engine');
    let s = toBidding(1, undefined, 'team');
    s = mustApply(s, { type: 'BID', seat: 'A', amount: 7 });
    s = mustApply(s, { type: 'PASS', seat: 'B' });
    s = mustApply(s, { type: 'PASS', seat: 'C' });
    s = mustApply(s, { type: 'BID', seat: 'D', amount: 8 });
    expect(s.bidding.highestBidder).toBe('D');
    // Pretend the round is played: B 3 + D 5 = 8 tricks, A 2 + C 3 = 5 tricks.
    expect(calculateRoundScore({ kind: 'bid', amount: 8 }, 3 + 5)).toBe(8);
    expect(calculateRoundScore({ kind: 'pass' }, 2 + 3)).toBe(5);
    expect(calculateRoundScore({ kind: 'bid', amount: 8 }, 7)).toBe(-8);
    expect(calculateRoundScore({ kind: 'pass' }, 4)).toBe(-5);
  });
});
