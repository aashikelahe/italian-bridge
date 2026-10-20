// Core data models for Italian Bridge. Framework-free: no React, no DOM.

export type Suit = 'S' | 'H' | 'D' | 'C';
export type Rank = 'A' | 'K' | 'Q' | 'J' | '10' | '9' | '8' | '7' | '6' | '5' | '4' | '3' | '2';

export interface Card {
  /** Unique, stable id, e.g. "AS", "10H". */
  id: string;
  suit: Suit;
  rank: Rank;
  /** Numeric strength: A=14 ... 2=2. Never compare ranks as strings. */
  strength: number;
}

/** Seats in clockwise order: A=Top, B=Right, C=Bottom, D=Left. */
export type Seat = 'A' | 'B' | 'C' | 'D';
export type PlayerType = 'human' | 'ai';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type GameMode = 'individual' | 'team';
export type TeamId = 'X' | 'Y';

export type BidStatus =
  | { kind: 'none' }
  | { kind: 'bid'; amount: number }
  | { kind: 'pass' };

export interface Player {
  id: Seat;
  seat: Seat;
  name: string;
  type: PlayerType;
  /** Playable cards only. The reserved trump card is never in here while reserved. */
  hand: Card[];
  /** The reserved trump card (highest bidder only, until revealed). */
  reserved: Card | null;
  bid: BidStatus;
  /** Highest numeric bid this player made during the auction (even if later outbid). */
  highestOwnBid: number | null;
  tricksWon: number;
  /** Cards collected from tricks this round (4 per trick won). */
  captured: Card[];
  roundScore: number;
  cumulativeScore: number;
}

export interface Team {
  id: TeamId;
  name: string;
  members: [Seat, Seat];
  roundScore: number;
  cumulativeScore: number;
}

export type Phase =
  | 'SHUFFLE'
  | 'CUT'
  | 'INITIAL_DEAL'
  | 'BIDDING'
  | 'TRUMP_RESERVATION'
  | 'SECOND_DEAL'
  | 'THIRD_DEAL'
  | 'PLAYING'
  | 'MANDATORY_REVEAL'
  | 'ROUND_RESULT'
  | 'MATCH_OVER';

export interface PlayedCard {
  seat: Seat;
  card: Card;
  /** Whether trump had power when this card was played (see RuleConfig.trumpEffect). */
  trumpLive: boolean;
}

export interface Trick {
  /** 1-based trick number within the round. */
  index: number;
  leader: Seat;
  ledSuit: Suit | null;
  plays: PlayedCard[];
  /** Set once four cards are on the table; collected by COLLECT_TRICK. */
  winner: Seat | null;
}

/** Completed-trick history stores card ids only, so a card never lives in two places. */
export interface TrickRecord {
  index: number;
  leader: Seat;
  ledSuit: Suit;
  plays: { seat: Seat; cardId: string; trumpLive: boolean }[];
  winner: Seat;
}

export type BidAction = 'bid' | 'pass' | 'forced' | 'auto-pass' | 'reshuffle';
export interface BidEvent {
  seat: Seat;
  action: BidAction;
  amount?: number;
}

export interface BiddingState {
  starter: Seat;
  history: BidEvent[];
  highestBid: number | null;
  highestBidder: Seat | null;
  passed: Seat[];
}

export type RevealHow = 'voluntary' | 'request' | 'mandatory';

export interface TrumpState {
  /** The highest bidder, who owns the reserved card. */
  bidder: Seat | null;
  /** Secret until revealed. Never expose through a PlayerView unless allowed. */
  suit: Suit | null;
  /** Id of the reserved card (secret until revealed). */
  cardId: string | null;
  revealed: boolean;
  revealedHow: RevealHow | null;
  revealedBy: Seat | null;
  /** Trick number during which the reveal happened. */
  revealedAtTrick: number | null;
  /** The player who just revealed / asked to see the trump must play a trump-suit card in this trick if they hold one. */
  mustPlayTrump: Seat | null;
}

export interface RoundPlayerResult {
  seat: Seat;
  bid: BidStatus;
  tricksWon: number;
  roundScore: number;
  cumulativeScore: number;
}

export interface RoundSummary {
  round: number;
  dealer: Seat;
  highestBidder: Seat;
  highestBid: number;
  trumpCardId: string;
  trumpSuit: Suit;
  revealedHow: RevealHow;
  players: RoundPlayerResult[];
  teams: { id: TeamId; contract: 'bid' | 'pass'; target: number; tricks: number; roundScore: number; cumulativeScore: number }[] | null;
}

export type MatchWinner =
  | { kind: 'team'; id: TeamId }
  | { kind: 'player'; seat: Seat }
  | null;

export interface LogEntry {
  round: number;
  /** English text. */
  text: string;
  /** Template + params so the UI can translate the entry ({p}/{q} names, {n} number, {card} card id, {suit} suit). */
  tpl?: string;
  params?: Record<string, string | number>;
}

export type FirstBidder = 'nextAfterDealer' | 'beforeDealer';
export type FirstLeader = 'nextAfterBidder' | 'bidder' | 'nextAfterDealer';
export type AllPassRule = 'forceDealerSeven' | 'forceFirstBidderSeven' | 'redeal';
export type BiddingStyle = 'singleRound' | 'auction';
export type ReshuffleCall = 'firstHand' | 'anyPlayer' | 'off';
export type VoluntaryReveal = 'whenVoid' | 'anyTurn';
export type DealStyle = 'packets' | 'oneAtATime';
export type ShuffleStyle = 'realistic' | 'full';
export type NextTrickLeader = 'afterWinner' | 'winner';
export type TeamScoring = 'teamContract' | 'sumOfPlayers';
export type TrumpEffect = 'afterReveal' | 'always';
export type OutbidStatus = 'pass' | 'ownHighestBid';
export type WinCondition = 'reachOrExceed' | 'exact';
export type TieRule = 'playOn' | 'shared';
export type Cutter = 'beforeDealer' | 'human';

/** Every ambiguous or house rule lives here. Defaults are in config.ts and documented in docs/ASSUMPTIONS.md. */
export interface RuleConfig {
  biddingStyle: BiddingStyle;
  reshuffleCall: ReshuffleCall;
  voluntaryReveal: VoluntaryReveal;
  dealStyle: DealStyle;
  shuffleStyle: ShuffleStyle;
  nextTrickLeader: NextTrickLeader;
  teamScoring: TeamScoring;
  firstBidder: FirstBidder;
  firstLeader: FirstLeader;
  allPass: AllPassRule;
  trumpEffect: TrumpEffect;
  outbidPlayersScoreAs: OutbidStatus;
  partnerMayRequestReveal: boolean;
  minBid: number;
  maxBid: number;
  passTarget: number;
  passPoints: number;
  winCondition: WinCondition;
  tieRule: TieRule;
  cutter: Cutter;
}

export interface GameState {
  gameId: string;
  version: 1;
  config: RuleConfig;
  mode: GameMode;
  matchTarget: number;
  phase: Phase;
  round: number;
  dealer: Seat;
  cutter: Seat;
  lastCut: number | null;
  /** How the last shuffle was done (shown on the table). */
  lastShuffle: { kind: 'full' | 'riffle'; riffles: number } | null;
  /** How the next SHUFFLE treats the gathered deck. */
  nextShuffle: 'realistic' | 'full';
  currentPlayer: Seat | null;
  /** Undealt cards (top of deck = index 0). */
  deck: Card[];
  players: Record<Seat, Player>;
  teams: Team[] | null;
  bidding: BiddingState;
  trump: TrumpState;
  currentTrick: Trick | null;
  /** Leader of the next trick when waiting for the mandatory reveal. */
  pendingLeader: Seat | null;
  completedTricks: TrickRecord[];
  roundHistory: RoundSummary[];
  /** Public log only — never contains private card information. */
  log: LogEntry[];
  matchWinner: MatchWinner;
  /** Co-winners when tieRule = 'shared' and the top total was tied. */
  sharedWinners: string[] | null;
  /** Set when a tie at the top forced another round (tieRule = playOn). */
  tieNote: string | null;
}

export type Action =
  | { type: 'SHUFFLE' }
  | { type: 'CUT'; seat: Seat; position: number }
  | { type: 'DEAL_INITIAL' }
  | { type: 'BID'; seat: Seat; amount: number }
  | { type: 'PASS'; seat: Seat }
  | { type: 'CALL_RESHUFFLE'; seat: Seat }
  | { type: 'RESERVE'; seat: Seat; cardId: string }
  | { type: 'DEAL_SECOND' }
  | { type: 'DEAL_THIRD' }
  | { type: 'REVEAL_VOLUNTARY'; seat: Seat }
  | { type: 'REQUEST_REVEAL'; seat: Seat }
  | { type: 'PLAY_CARD'; seat: Seat; cardId: string }
  | { type: 'COLLECT_TRICK' }
  | { type: 'MANDATORY_REVEAL' }
  | { type: 'NEXT_ROUND' };

export type ActionResult = { ok: true; state: GameState } | { ok: false; error: string };

export type Rng = () => number;
