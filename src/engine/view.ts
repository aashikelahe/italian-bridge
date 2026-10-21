/**
 * Private, per-seat projection of the game state. The UI and the AI only ever see a PlayerView,
 * so opponents' hands, the undealt deck and a hidden reserved card can't leak.
 * In a future online version, the server would send exactly this object to each client.
 */
import type {
  BidStatus, BiddingState, Card, GameMode, GameState, LogEntry, MatchWinner, Phase, PlayedCard, PlayerType,
  RevealHow, RoundSummary, RuleConfig, Seat, Suit, Team, TrickRecord, BonusState,
} from './types';
import { SEATS, teamOf } from './seating';
import { canRequestReveal, canRevealVoluntarily, type RevealContext } from './rules';
import { legalCardIds, reshuffleAllowed } from './game';

export interface PublicPlayer {
  seat: Seat;
  name: string;
  type: PlayerType;
  team: 'X' | 'Y' | null;
  handCount: number;
  hasReservedCard: boolean;
  bid: BidStatus;
  tricksWon: number;
  roundScore: number;
  cumulativeScore: number;
}

export interface PlayerView {
  seat: Seat;
  gameId: string;
  phase: Phase;
  round: number;
  mode: GameMode;
  matchTarget: number;
  config: RuleConfig;
  dealer: Seat;
  cutter: Seat;
  currentPlayer: Seat | null;
  deckCount: number;
  /** My playable hand. */
  hand: Card[];
  /** My own reserved card (only if I am the highest bidder and it is still hidden). */
  myReserved: Card | null;
  players: Record<Seat, PublicPlayer>;
  teams: Team[] | null;
  bidding: BiddingState;
  trump: {
    bidder: Seat | null;
    revealed: boolean;
    /** Known only if revealed, or if I am the bidder. */
    suit: Suit | null;
    /** The reserved card, visible to everyone only once revealed. */
    revealedCard: Card | null;
    revealedHow: RevealHow | null;
    revealedBy: Seat | null;
  };
  currentTrick: { index: number; leader: Seat; ledSuit: Suit | null; plays: PlayedCard[]; winner: Seat | null } | null;
  completedTricks: TrickRecord[];
  trickNumber: number;
  roundHistory: RoundSummary[];
  matchWinner: MatchWinner;
  sharedWinners: string[] | null;
  tieNote: string | null;
  log: LogEntry[];
  /** Convenience: what I may do right now. */
  legalCardIds: string[];
  canRevealVoluntarily: boolean;
  canRequestReveal: boolean;
  /** I may call for a reshuffle (no A/K/Q/J in my first five cards). */
  canCallReshuffle: boolean;
  /** I revealed / asked to see the trump: I must play a trump-suit card now if I have one. */
  mustPlayTrump: boolean;
  lastShuffle: GameState['lastShuffle'];
  /** The Bonus call round (after the second deal). */
  bonus: BonusState | null;
}

export function getPlayerView(state: GameState, seat: Seat): PlayerView {
  const me = state.players[seat];
  const t = state.currentTrick;
  const ctx: RevealContext = {
    phase: state.phase, seat, currentPlayer: state.currentPlayer, bidder: state.trump.bidder,
    revealed: state.trump.revealed, trickInProgress: !!t && t.plays.length < 4, ledSuit: t?.ledSuit ?? null,
    hand: me.hand, mode: state.mode, config: state.config,
  };
  const isBidder = state.trump.bidder === seat;
  const revealedCard = state.trump.revealed && state.trump.cardId ? findRevealedCard(state) : null;

  return {
    seat,
    gameId: state.gameId,
    phase: state.phase,
    round: state.round,
    mode: state.mode,
    matchTarget: state.matchTarget,
    config: state.config,
    dealer: state.dealer,
    cutter: state.cutter,
    currentPlayer: state.currentPlayer,
    deckCount: state.deck.length,
    hand: me.hand.map((c) => ({ ...c })),
    myReserved: me.reserved ? { ...me.reserved } : null,
    players: Object.fromEntries(
      SEATS.map((s) => {
        const p = state.players[s];
        return [s, {
          seat: s, name: p.name, type: p.type, team: state.mode === 'team' ? teamOf(s) : null,
          handCount: p.hand.length, hasReservedCard: !!p.reserved, bid: p.bid, tricksWon: p.tricksWon,
          roundScore: p.roundScore, cumulativeScore: p.cumulativeScore,
        } satisfies PublicPlayer];
      }),
    ) as Record<Seat, PublicPlayer>,
    teams: state.teams ? state.teams.map((x) => ({ ...x })) : null,
    bidding: structuredClone(state.bidding),
    trump: {
      bidder: state.trump.bidder,
      revealed: state.trump.revealed,
      suit: state.trump.revealed || isBidder ? state.trump.suit : null,
      revealedCard,
      revealedHow: state.trump.revealedHow,
      revealedBy: state.trump.revealedBy,
    },
    currentTrick: t ? structuredClone(t) : null,
    completedTricks: structuredClone(state.completedTricks),
    trickNumber: t?.index ?? Math.min(13, state.completedTricks.length + 1),
    roundHistory: structuredClone(state.roundHistory),
    matchWinner: state.matchWinner,
    sharedWinners: state.sharedWinners,
    tieNote: state.tieNote,
    log: state.log.slice(-60),
    legalCardIds: legalCardIds(state, seat),
    canRevealVoluntarily: canRevealVoluntarily(ctx),
    canRequestReveal: canRequestReveal(ctx),
    canCallReshuffle: reshuffleAllowed(state, seat),
    mustPlayTrump: state.trump.mustPlayTrump === seat,
    lastShuffle: state.lastShuffle,
    bonus: state.bonus ? structuredClone(state.bonus) : null,
  };
}

function findRevealedCard(state: GameState): Card | null {
  const id = state.trump.cardId!;
  for (const s of SEATS) {
    const p = state.players[s];
    const c = p.hand.find((x) => x.id === id) ?? p.captured.find((x) => x.id === id);
    if (c) return { ...c };
  }
  const onTable = state.currentTrick?.plays.find((pl) => pl.card.id === id);
  return onTable ? { ...onTable.card } : null;
}
