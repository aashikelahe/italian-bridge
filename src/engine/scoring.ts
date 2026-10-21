import type { BidStatus, GameMode, MatchWinner, Player, RuleConfig, Seat, Team, TieRule, WinCondition } from './types';
import { DEFAULT_RULES } from './config';

/**
 * Round score for one player.
 * - Numeric bid N: +N if tricksWon >= N, otherwise -N. Overtricks add nothing.
 * - The bonus bid (default 10) scores bonusPoints (default 13) when made, -N when missed.
 * - Pass: +passPoints if tricksWon >= passTarget (default 5), otherwise -passPoints.
 */
export function calculateRoundScore(
  bidStatus: BidStatus,
  tricksWon: number,
  rules: Pick<RuleConfig, 'passTarget' | 'passPoints'> & Partial<Pick<RuleConfig, 'bonusBid' | 'bonusPoints'>> = DEFAULT_RULES,
): number {
  if (!Number.isInteger(tricksWon) || tricksWon < 0 || tricksWon > 13) throw new Error(`Invalid trick count: ${tricksWon}`);
  switch (bidStatus.kind) {
    case 'bid':
      if (tricksWon < bidStatus.amount) return -bidStatus.amount;
      return rules.bonusBid != null && bidStatus.amount === rules.bonusBid && rules.bonusPoints != null ? rules.bonusPoints : bidStatus.amount;
    case 'pass':
      return tricksWon >= rules.passTarget ? rules.passPoints : -rules.passPoints;
    default:
      throw new Error('Cannot score a player with no bid status');
  }
}

/** Team round score = sum of both partners' individual round scores (never raw tricks). */
export function teamRoundScore(team: Team, players: Record<Seat, Player>): number {
  return players[team.members[0]].roundScore + players[team.members[1]].roundScore;
}

function meets(total: number, target: number, cond: WinCondition): boolean {
  return cond === 'exact' ? total === target : total >= target;
}

export interface WinnerCheck {
  winner: MatchWinner;
  /** Explanation when sides tied at the top and the tie rule forced more play. */
  tieNote: string | null;
  /** Sides that share the win (tieRule = 'shared'). */
  shared: string[] | null;
}

/**
 * Evaluate the match-ending condition after a completed round.
 * Several sides may qualify at once: the highest total wins. If the top total is tied,
 * tieRule 'playOn' continues the match; 'shared' declares the first (by seat order) and records co-winners.
 */
export function checkMatchWinner(
  mode: GameMode,
  players: Record<Seat, Player>,
  teams: Team[] | null,
  target: number,
  cond: WinCondition,
  tieRule: TieRule,
): WinnerCheck {
  const sides: { key: string; total: number; winner: MatchWinner }[] =
    mode === 'team' && teams
      ? teams.map((t) => ({ key: t.id, total: t.cumulativeScore, winner: { kind: 'team', id: t.id } as MatchWinner }))
      : (Object.values(players) as Player[]).map((p) => ({ key: p.seat, total: p.cumulativeScore, winner: { kind: 'player', seat: p.seat } as MatchWinner }));
  const qualified = sides.filter((s) => meets(s.total, target, cond));
  if (qualified.length === 0) return { winner: null, tieNote: null, shared: null };
  const top = Math.max(...qualified.map((s) => s.total));
  const leaders = qualified.filter((s) => s.total === top);
  if (leaders.length === 1) return { winner: leaders[0].winner, tieNote: null, shared: null };
  if (tieRule === 'shared') return { winner: leaders[0].winner, tieNote: null, shared: leaders.map((l) => l.key) };
  return {
    winner: null,
    tieNote: `${leaders.map((l) => l.key).join(' and ')} tied on ${top} — playing another round to break the tie.`,
    shared: null,
  };
}
