/**
 * The game engine: a finite-state machine driven by `applyAction`.
 * Every action is validated against the current phase, the acting seat and the rules.
 * Invalid actions are rejected with an error and leave the state untouched.
 */
import type {
  Action, ActionResult, BidStatus, Card, GameMode, Suit, GameState, Phase, Player, PlayerType, Rng, RuleConfig, Seat, Team,
} from './types';
import { createDeck, cardLabel, cardFromId, SUIT_NAME } from './cards';
import { shuffle, cut, pickRiffles, riffleTimes } from './deck';
import { SEATS, nextSeat, prevSeat, seatsFrom, partnerOf, teamOf } from './seating';
import { canCallReshuffle, canRequestReveal, canRevealVoluntarily, resolveTrickWinner, type RevealContext } from './rules';
import { calculateRoundScore, checkMatchWinner } from './scoring';
import { DEFAULT_RULES } from './config';
import { assertIntegrity } from './integrity';

export interface PlayerSetup {
  name: string;
  type: PlayerType;
}

export interface NewMatchOptions {
  mode: GameMode;
  matchTarget: number;
  players: Record<Seat, PlayerSetup>;
  rules?: Partial<RuleConfig>;
  teamNames?: { X: string; Y: string };
  /** First dealer; defaults to a random seat. */
  dealer?: Seat;
  rng?: Rng;
  gameId?: string;
}

function emptyPlayer(seat: Seat, setup: PlayerSetup): Player {
  return {
    id: seat, seat, name: setup.name, type: setup.type,
    hand: [], reserved: null, bid: { kind: 'none' }, highestOwnBid: null,
    tricksWon: 0, captured: [], roundScore: 0, cumulativeScore: 0,
  };
}

function cutterFor(state: Pick<GameState, 'config' | 'players' | 'dealer'>): Seat {
  if (state.config.cutter === 'human') {
    const human = SEATS.find((s) => state.players[s].type === 'human');
    if (human) return human;
  }
  return prevSeat(state.dealer);
}

export function createMatch(opts: NewMatchOptions): GameState {
  const rng = opts.rng ?? Math.random;
  const config = { ...DEFAULT_RULES, ...(opts.rules ?? {}) };
  const dealer = opts.dealer ?? SEATS[Math.floor(rng() * 4)];
  const players = Object.fromEntries(SEATS.map((s) => [s, emptyPlayer(s, opts.players[s])])) as Record<Seat, Player>;
  const teams: Team[] | null =
    opts.mode === 'team'
      ? [
          { id: 'X', name: opts.teamNames?.X ?? 'Team X', members: ['A', 'C'], roundScore: 0, cumulativeScore: 0 },
          { id: 'Y', name: opts.teamNames?.Y ?? 'Team Y', members: ['B', 'D'], roundScore: 0, cumulativeScore: 0 },
        ]
      : null;
  const state: GameState = {
    gameId: opts.gameId ?? `g-${Math.floor(rng() * 1e9).toString(36)}`,
    version: 1,
    config,
    mode: opts.mode,
    matchTarget: opts.matchTarget,
    phase: 'SHUFFLE',
    round: 1,
    dealer,
    cutter: dealer,
    lastCut: null,
    lastShuffle: null,
    nextShuffle: 'full',
    currentPlayer: null,
    deck: [],
    players,
    teams,
    bidding: { starter: dealer, history: [], highestBid: null, highestBidder: null, passed: [] },
    trump: emptyTrump(),
    currentTrick: null,
    pendingLeader: null,
    completedTricks: [],
    roundHistory: [],
    log: [],
    matchWinner: null,
    sharedWinners: null,
    tieNote: null,
  };
  state.cutter = cutterFor(state);
  state.bidding.starter = firstBidderFor(state);
  log(state, 'Round {n} — {p} deals.', { n: 1, p: dealer });
  return state;
}

function emptyTrump(): GameState['trump'] {
  return { bidder: null, suit: null, cardId: null, revealed: false, revealedHow: null, revealedBy: null, revealedAtTrick: null, mustPlayTrump: null };
}

function firstBidderFor(state: Pick<GameState, 'config' | 'dealer'>): Seat {
  return state.config.firstBidder === 'beforeDealer' ? prevSeat(state.dealer) : nextSeat(state.dealer);
}

function log(state: GameState, tpl: string, params: Record<string, string | number> = {}) {
  const text = tpl.replace(/\{(\w+)\}/g, (_, k) => {
    const v = params[k];
    if (k === 'card') return cardLabel(cardFromId(String(v)));
    if (k === 'suit') return SUIT_NAME[v as Suit];
    if (k === 'p' || k === 'q') return state.players[v as Seat]?.name ?? String(v);
    return String(v);
  });
  state.log.push({ round: state.round, text, tpl, params });
  if (state.log.length > 400) state.log.splice(0, state.log.length - 400);
}

const fail = (error: string): ActionResult => ({ ok: false, error });

function requirePhase(state: GameState, ...phases: Phase[]): string | null {
  return phases.includes(state.phase) ? null : `Action not allowed during ${state.phase}`;
}


/**
 * Deal `perPlayer` cards to every player, starting after the dealer: either as one packet
 * per player (default, as at a real table) or one card at a time.
 */
function dealRound(state: GameState, perPlayer: number) {
  if (state.deck.length < perPlayer * 4) throw new Error('Not enough cards in the deck');
  const order = seatsFrom(nextSeat(state.dealer));
  if (state.config.dealStyle === 'packets') {
    for (const seat of order) state.players[seat].hand.push(...state.deck.splice(0, perPlayer));
    return;
  }
  for (let k = 0; k < perPlayer; k++) {
    for (const seat of order) state.players[seat].hand.push(state.deck.shift()!);
  }
}

/** Seats that have already bid or passed this round. */
function actedSeats(state: GameState): Seat[] {
  return state.bidding.history.filter((h) => h.action !== 'reshuffle').map((h) => h.seat);
}

export function reshuffleAllowed(state: GameState, seat: Seat): boolean {
  return canCallReshuffle({
    phase: state.phase, seat, currentPlayer: state.currentPlayer, starter: state.bidding.starter,
    actedSeats: actedSeats(state), hand: state.players[seat].hand, config: state.config,
  });
}

/** Reveal the reserved card: it moves back into the bidder's playable hand (same card object). */
function performReveal(state: GameState, how: 'voluntary' | 'request' | 'mandatory', by: Seat | null) {
  const bidder = state.trump.bidder!;
  const p = state.players[bidder];
  const card = p.reserved;
  if (!card) throw new Error('No reserved card to reveal');
  p.reserved = null;
  p.hand.push(card);
  state.trump.revealed = true;
  state.trump.revealedHow = how;
  state.trump.revealedBy = by;
  state.trump.revealedAtTrick = state.currentTrick?.index ?? state.completedTricks.length + 1;
  // Whoever revealed (bidder) or asked (requester) must now play a trump-suit card if they hold one.
  if (how === 'voluntary' && state.config.voluntaryReveal === 'whenVoid') state.trump.mustPlayTrump = bidder;
  if (how === 'request') state.trump.mustPlayTrump = by;
  const tpl = how === 'mandatory' ? 'Automatic reveal before the final trick: {card} — {suit} are trumps.'
    : how === 'voluntary' ? '{p} revealed the trump: {card} — {suit} are trumps.'
    : '{p} asked to see the trump: {card} — {suit} are trumps.';
  log(state, tpl, { p: how === 'voluntary' ? bidder : by ?? '', card: card.id, suit: card.suit });
}

function startTrick(state: GameState, leader: Seat) {
  state.currentTrick = { index: state.completedTricks.length + 1, leader, ledSuit: null, plays: [], winner: null };
  state.currentPlayer = leader;
}

export function revealContext(state: GameState, seat: Seat): RevealContext {
  const t = state.currentTrick;
  return {
    phase: state.phase,
    seat,
    currentPlayer: state.currentPlayer,
    bidder: state.trump.bidder,
    revealed: state.trump.revealed,
    trickInProgress: !!t && t.plays.length < 4,
    ledSuit: t?.ledSuit ?? null,
    hand: state.players[seat].hand,
    mode: state.mode,
    config: state.config,
  };
}

function finishBidding(state: GameState) {
  const b = state.bidding;
  const winner = b.highestBidder!;
  // Final bid status for players who were outbid (configurable).
  for (const seat of SEATS) {
    const p = state.players[seat];
    if (seat === winner) continue;
    if (state.config.outbidPlayersScoreAs === 'ownHighestBid' && p.highestOwnBid != null) {
      p.bid = { kind: 'bid', amount: p.highestOwnBid };
    } else {
      p.bid = { kind: 'pass' };
    }
  }
  state.players[winner].bid = { kind: 'bid', amount: b.highestBid! };
  state.trump.bidder = winner;
  state.phase = 'TRUMP_RESERVATION';
  state.currentPlayer = winner;
  log(state, '{p} wins the bidding with {n}.', { p: winner, n: b.highestBid! });
}

function forceMinimumBid(state: GameState) {
  const b = state.bidding;
  if (state.config.allPass === 'redeal') {
    log(state, 'Nobody bid — the cards are gathered and dealt again.');
    resetRound(state, state.dealer, gatherDealtCards(state), 'full');
    return;
  }
  const forced = state.config.allPass === 'forceDealerSeven' ? state.dealer : b.starter;
  b.highestBid = state.config.minBid;
  b.highestBidder = forced;
  b.passed = b.passed.filter((s) => s !== forced);
  b.history.push({ seat: forced, action: 'forced', amount: state.config.minBid });
  state.players[forced].highestOwnBid = state.config.minBid;
  log(state, forced === state.dealer ? 'Nobody bid — {p} (the dealer) must call {n}.' : 'Nobody bid — {p} must call {n}.', { p: forced, n: state.config.minBid });
  finishBidding(state);
}

/** After each bidding action decide whether bidding is over, and who acts next. */
function advanceBidding(state: GameState, actor: Seat) {
  const b = state.bidding;
  const acted = actedSeats(state);

  if (b.highestBid === state.config.maxBid) {
    // Nobody can bid higher: players who haven't acted (or are still in the auction) pass automatically.
    for (const s of seatsFrom(nextSeat(actor))) {
      if (s === b.highestBidder || b.passed.includes(s)) continue;
      if (state.config.biddingStyle === 'singleRound' && acted.includes(s)) continue;
      b.passed.push(s);
      b.history.push({ seat: s, action: 'auto-pass' });
      state.players[s].bid = { kind: 'pass' };
    }
    finishBidding(state);
    return;
  }

  if (state.config.biddingStyle === 'singleRound') {
    // Everyone speaks exactly once, in turn.
    if (new Set(acted).size >= 4) {
      if (b.highestBidder) finishBidding(state);
      else forceMinimumBid(state);
      return;
    }
    state.currentPlayer = nextSeat(actor);
    return;
  }

  // Auction: continue until only the highest bidder has not passed.
  const active = SEATS.filter((s) => !b.passed.includes(s));
  if (b.highestBidder && active.length === 1 && active[0] === b.highestBidder) {
    finishBidding(state);
    return;
  }
  if (active.length === 0) {
    forceMinimumBid(state);
    return;
  }
  let next = nextSeat(actor);
  while (b.passed.includes(next)) next = nextSeat(next);
  state.currentPlayer = next;
}

/** Cards currently dealt out (hands, reserved card, undealt deck), for a redeal. */
function gatherDealtCards(state: GameState): Card[] {
  const cards: Card[] = [];
  for (const s of seatsFrom(nextSeat(state.dealer))) {
    const p = state.players[s];
    cards.push(...p.hand);
    if (p.reserved) cards.push(p.reserved);
  }
  cards.push(...state.deck);
  return cards;
}

/** After a round: each player's captured tricks (4 cards per trick) stacked one pile on another. */
function gatherTricks(state: GameState, newDealer: Seat): Card[] {
  const cards: Card[] = [];
  for (const s of seatsFrom(nextSeat(newDealer))) cards.push(...state.players[s].captured);
  return cards;
}

/** Reset per-round state and go back to SHUFFLE with the given dealer and the gathered cards. */
function resetRound(state: GameState, dealer: Seat, gathered: Card[], nextShuffle: 'realistic' | 'full') {
  state.dealer = dealer;
  state.phase = 'SHUFFLE';
  state.deck = gathered;
  state.nextShuffle = nextShuffle;
  state.lastCut = null;
  state.currentPlayer = null;
  for (const seat of SEATS) {
    const p = state.players[seat];
    p.hand = [];
    p.reserved = null;
    p.bid = { kind: 'none' };
    p.highestOwnBid = null;
    p.tricksWon = 0;
    p.captured = [];
    p.roundScore = 0;
  }
  if (state.teams) for (const t of state.teams) t.roundScore = 0;
  state.bidding = { starter: firstBidderFor(state), history: [], highestBid: null, highestBidder: null, passed: [] };
  state.trump = emptyTrump();
  state.currentTrick = null;
  state.pendingLeader = null;
  state.completedTricks = [];
  state.cutter = cutterFor(state);
}

function finishRound(state: GameState) {
  assertIntegrity(state);
  const teamContract = state.mode === 'team' && state.config.teamScoring === 'teamContract';
  const teamInfo: NonNullable<GameState['roundHistory'][number]['teams']> = [];
  if (teamContract && state.teams) {
    // Team-wise: the bidding team needs its bid in combined tricks, the other team needs 5.
    const bidTeam = teamOf(state.trump.bidder!);
    for (const t of state.teams) {
      const tricks = state.players[t.members[0]].tricksWon + state.players[t.members[1]].tricksWon;
      const status: BidStatus = t.id === bidTeam ? { kind: 'bid', amount: state.bidding.highestBid! } : { kind: 'pass' };
      t.roundScore = calculateRoundScore(status, tricks, state.config);
      t.cumulativeScore += t.roundScore;
      teamInfo.push({
        id: t.id, contract: status.kind === 'bid' ? 'bid' : 'pass', target: status.kind === 'bid' ? status.amount : state.config.passTarget,
        tricks, roundScore: t.roundScore, cumulativeScore: t.cumulativeScore,
      });
    }
    for (const seat of SEATS) state.players[seat].roundScore = 0; // no individual points in team play
  } else {
    for (const seat of SEATS) {
      const p = state.players[seat];
      p.roundScore = calculateRoundScore(p.bid, p.tricksWon, state.config);
      p.cumulativeScore += p.roundScore;
    }
    if (state.teams) {
      for (const t of state.teams) {
        t.roundScore = state.players[t.members[0]].roundScore + state.players[t.members[1]].roundScore;
        t.cumulativeScore += t.roundScore;
        teamInfo.push({
          id: t.id, contract: t.members.includes(state.trump.bidder!) ? 'bid' : 'pass', target: 0,
          tricks: state.players[t.members[0]].tricksWon + state.players[t.members[1]].tricksWon,
          roundScore: t.roundScore, cumulativeScore: t.cumulativeScore,
        });
      }
    }
  }
  state.roundHistory.push({
    round: state.round,
    dealer: state.dealer,
    highestBidder: state.trump.bidder!,
    highestBid: state.bidding.highestBid!,
    trumpCardId: state.trump.cardId!,
    trumpSuit: state.trump.suit!,
    revealedHow: state.trump.revealedHow!,
    players: SEATS.map((s) => ({
      seat: s, bid: state.players[s].bid, tricksWon: state.players[s].tricksWon,
      roundScore: state.players[s].roundScore, cumulativeScore: state.players[s].cumulativeScore,
    })),
    teams: state.teams ? teamInfo : null,
  });
  const check = checkMatchWinner(state.mode, state.players, state.teams, state.matchTarget, state.config.winCondition, state.config.tieRule);
  state.matchWinner = check.winner;
  state.sharedWinners = check.shared;
  state.tieNote = check.tieNote;
  state.phase = 'ROUND_RESULT';
  state.currentPlayer = null;
  state.currentTrick = null;
  log(state, 'Round {n} complete.', { n: state.round });
}

/** Apply one action. Pure: the input state is never mutated. */
export function applyAction(input: GameState, action: Action, rng: Rng = Math.random): ActionResult {
  const state: GameState = structuredClone(input);
  let err: string | null;

  switch (action.type) {
    case 'SHUFFLE': {
      if ((err = requirePhase(state, 'SHUFFLE'))) return fail(err);
      const gathered = state.deck.length === 52 ? state.deck : createDeck();
      if (state.config.shuffleStyle === 'realistic' && state.nextShuffle === 'realistic' && state.deck.length === 52) {
        // The previous round's tricks are stacked; the dealer riffles them a few times.
        const riffles = pickRiffles(rng);
        state.deck = riffleTimes(gathered, riffles, rng);
        state.lastShuffle = { kind: 'riffle', riffles };
        log(state, riffles >= 7 ? '{p} shuffles the deck thoroughly.' : riffles === 1 ? '{p} gives the stacked tricks a quick shuffle.' : '{p} riffles the stacked tricks {n} times.', { p: state.dealer, n: riffles });
      } else {
        state.deck = shuffle(gathered, rng);
        state.lastShuffle = { kind: 'full', riffles: 0 };
        log(state, '{p} shuffles the deck.', { p: state.dealer });
      }
      state.phase = 'CUT';
      state.currentPlayer = state.cutter;
      return { ok: true, state };
    }

    case 'CUT': {
      if ((err = requirePhase(state, 'CUT'))) return fail(err);
      if (action.seat !== state.cutter) return fail('Only the cutting player may cut the deck');
      if (!Number.isInteger(action.position) || action.position < 1 || action.position > 51) {
        return fail('Cut position must be between 1 and 51');
      }
      state.deck = cut(state.deck, action.position);
      state.lastCut = action.position;
      state.phase = 'INITIAL_DEAL';
      state.currentPlayer = null;
      log(state, '{p} cuts the deck at {n}.', { p: action.seat, n: action.position });
      return { ok: true, state };
    }

    case 'DEAL_INITIAL': {
      if ((err = requirePhase(state, 'INITIAL_DEAL'))) return fail(err);
      dealRound(state, 5);
      state.phase = 'BIDDING';
      state.bidding.starter = firstBidderFor(state);
      state.currentPlayer = state.bidding.starter;
      log(state, 'Five cards dealt to each player. Bidding begins.');
      return { ok: true, state };
    }

    case 'BID': {
      if ((err = requirePhase(state, 'BIDDING'))) return fail(err);
      if (action.seat !== state.currentPlayer) return fail('It is not your turn to bid');
      const b = state.bidding;
      if (b.passed.includes(action.seat)) return fail('A player who passed cannot re-enter the bidding');
      const { minBid, maxBid } = state.config;
      if (!Number.isInteger(action.amount) || action.amount < minBid || action.amount > maxBid) {
        return fail(`Bids must be whole numbers from ${minBid} to ${maxBid}`);
      }
      if (b.highestBid !== null && action.amount <= b.highestBid) {
        return fail(`A bid must be higher than the current highest bid (${b.highestBid})`);
      }
      b.highestBid = action.amount;
      b.highestBidder = action.seat;
      b.history.push({ seat: action.seat, action: 'bid', amount: action.amount });
      state.players[action.seat].bid = { kind: 'bid', amount: action.amount };
      state.players[action.seat].highestOwnBid = action.amount;
      log(state, action.amount === minBid ? '{p} bids {n} (Small).' : action.amount === state.config.bonusBid ? '{p} bids {n} (Bonus)!' : '{p} bids {n}.', { p: action.seat, n: action.amount });
      advanceBidding(state, action.seat);
      return { ok: true, state };
    }

    case 'PASS': {
      if ((err = requirePhase(state, 'BIDDING'))) return fail(err);
      if (action.seat !== state.currentPlayer) return fail('It is not your turn to bid');
      const b = state.bidding;
      if (b.passed.includes(action.seat)) return fail('You have already passed');
      b.passed.push(action.seat);
      b.history.push({ seat: action.seat, action: 'pass' });
      state.players[action.seat].bid = { kind: 'pass' };
      log(state, '{p} passes.', { p: action.seat });
      advanceBidding(state, action.seat);
      return { ok: true, state };
    }

    case 'CALL_RESHUFFLE': {
      if ((err = requirePhase(state, 'BIDDING'))) return fail(err);
      if (!reshuffleAllowed(state, action.seat)) {
        return fail(state.config.reshuffleCall === 'firstHand'
          ? 'Only the first hand, before any bid, may call for a reshuffle — and only with no A, K, Q or J'
          : 'You may call for a reshuffle on your turn only if your five cards hold no A, K, Q or J');
      }
      const cards = gatherDealtCards(state);
      log(state, '{p} has no A, K, Q or J and calls for a reshuffle — {p} deals now.', { p: action.seat });
      resetRound(state, action.seat, cards, 'full');
      return { ok: true, state };
    }

    case 'RESERVE': {
      if ((err = requirePhase(state, 'TRUMP_RESERVATION'))) return fail(err);
      if (action.seat !== state.trump.bidder) return fail('Only the highest bidder reserves the trump card');
      const p = state.players[action.seat];
      if (p.reserved) return fail('A trump card has already been reserved');
      const idx = p.hand.findIndex((c) => c.id === action.cardId);
      if (idx < 0) return fail('The reserved card must come from your initial five cards');
      const [card] = p.hand.splice(idx, 1);
      p.reserved = card;
      state.trump.suit = card.suit;
      state.trump.cardId = card.id;
      state.phase = 'SECOND_DEAL';
      state.currentPlayer = null;
      log(state, '{p} reserved a hidden trump card.', { p: action.seat });
      return { ok: true, state };
    }

    case 'DEAL_SECOND': {
      if ((err = requirePhase(state, 'SECOND_DEAL'))) return fail(err);
      dealRound(state, 4);
      state.phase = 'THIRD_DEAL';
      log(state, 'Second deal: four more cards each.');
      return { ok: true, state };
    }

    case 'DEAL_THIRD': {
      if ((err = requirePhase(state, 'THIRD_DEAL'))) return fail(err);
      dealRound(state, 4);
      if (state.deck.length !== 0) return fail('Deck should be empty after the third deal');
      state.phase = 'PLAYING';
      const bidder = state.trump.bidder!;
      const leader =
        state.config.firstLeader === 'bidder' ? bidder
        : state.config.firstLeader === 'nextAfterDealer' ? nextSeat(state.dealer)
        : nextSeat(bidder);
      startTrick(state, leader);
      assertIntegrity(state);
      log(state, 'Third deal: four more cards each. {p} leads the first trick.', { p: leader });
      return { ok: true, state };
    }

    case 'REVEAL_VOLUNTARY': {
      if ((err = requirePhase(state, 'PLAYING'))) return fail(err);
      if (!canRevealVoluntarily(revealContext(state, action.seat))) {
        return fail('Only the highest bidder may reveal the trump, on their own turn, while it is still hidden');
      }
      performReveal(state, 'voluntary', action.seat);
      return { ok: true, state };
    }

    case 'REQUEST_REVEAL': {
      if ((err = requirePhase(state, 'PLAYING'))) return fail(err);
      if (!canRequestReveal(revealContext(state, action.seat))) {
        return fail('You may ask to see the trump only on your turn, when you cannot follow the led suit and the trump is still hidden');
      }
      performReveal(state, 'request', action.seat);
      return { ok: true, state };
    }

    case 'PLAY_CARD': {
      if ((err = requirePhase(state, 'PLAYING'))) return fail(err);
      const t = state.currentTrick;
      if (!t || t.plays.length >= 4) return fail('The trick is complete and must be collected first');
      if (action.seat !== state.currentPlayer) return fail('It is not your turn');
      const p = state.players[action.seat];
      if (p.reserved?.id === action.cardId) return fail('The reserved trump card cannot be played until it is revealed');
      const idx = p.hand.findIndex((c) => c.id === action.cardId);
      if (idx < 0) return fail('That card is not in your hand');
      if (!legalCardIds(state, action.seat).includes(action.cardId)) {
        return fail(state.trump.mustPlayTrump === action.seat
          ? `The trump is shown, so you must play a ${SUIT_NAME[state.trump.suit!]} card if you have one`
          : 'You must follow the led suit');
      }
      const [card] = p.hand.splice(idx, 1);
      if (state.trump.mustPlayTrump === action.seat) state.trump.mustPlayTrump = null;
      if (!t.ledSuit) t.ledSuit = card.suit;
      t.plays.push({ seat: action.seat, card, trumpLive: state.config.trumpEffect === 'always' || state.trump.revealed });
      if (t.plays.length === 4) {
        t.winner = resolveTrickWinner(t.plays, t.ledSuit, state.trump.suit);
        state.currentPlayer = null;
      } else {
        state.currentPlayer = nextSeat(action.seat);
      }
      return { ok: true, state };
    }

    case 'COLLECT_TRICK': {
      if ((err = requirePhase(state, 'PLAYING'))) return fail(err);
      const t = state.currentTrick;
      if (!t || t.plays.length !== 4 || !t.winner) return fail('There is no completed trick to collect');
      const w = state.players[t.winner];
      w.captured.push(...t.plays.map((pl) => pl.card));
      w.tricksWon += 1;
      state.completedTricks.push({
        index: t.index, leader: t.leader, ledSuit: t.ledSuit!, winner: t.winner,
        plays: t.plays.map((pl) => ({ seat: pl.seat, cardId: pl.card.id, trumpLive: pl.trumpLive })),
      });
      log(state, 'Trick {n} won by {p}.', { n: t.index, p: t.winner });
      const winner = t.winner;
      state.currentTrick = null;
      const done = state.completedTricks.length;
      if (done === 13) {
        finishRound(state);
      } else {
        const leader = state.config.nextTrickLeader === 'afterWinner' ? nextSeat(winner) : winner;
        if (done === 12 && !state.trump.revealed) {
          state.phase = 'MANDATORY_REVEAL';
          state.pendingLeader = leader;
          state.currentPlayer = null;
        } else {
          startTrick(state, leader);
        }
      }
      return { ok: true, state };
    }

    case 'MANDATORY_REVEAL': {
      if ((err = requirePhase(state, 'MANDATORY_REVEAL'))) return fail(err);
      if (state.trump.revealed) return fail('The trump has already been revealed');
      performReveal(state, 'mandatory', null);
      state.phase = 'PLAYING';
      startTrick(state, state.pendingLeader!);
      state.pendingLeader = null;
      return { ok: true, state };
    }

    case 'NEXT_ROUND': {
      if ((err = requirePhase(state, 'ROUND_RESULT'))) return fail(err);
      if (state.matchWinner) {
        state.phase = 'MATCH_OVER';
        log(state, 'Match over.');
        return { ok: true, state };
      }
      state.round += 1;
      const newDealer = nextSeat(state.dealer);
      resetRound(state, newDealer, gatherTricks(state, newDealer), 'realistic');
      log(state, 'Round {n} — {p} deals.', { n: state.round, p: state.dealer });
      return { ok: true, state };
    }

    default:
      return fail('Unknown action');
  }
}

/** Convenience for tests and drivers: apply or throw. */
export function mustApply(state: GameState, action: Action, rng?: Rng): GameState {
  const r = applyAction(state, action, rng);
  if (!r.ok) throw new Error(`${action.type} rejected: ${r.error}`);
  return r.state;
}

/** Legal card ids for a seat right now (empty if it is not their turn to play). */
export function legalCardIds(state: GameState, seat: Seat): string[] {
  if (state.phase !== 'PLAYING' || state.currentPlayer !== seat || !state.currentTrick || state.currentTrick.plays.length >= 4) return [];
  const hand = state.players[seat].hand;
  if (state.trump.mustPlayTrump === seat) {
    const trumps = hand.filter((c) => c.suit === state.trump.suit);
    if (trumps.length) return trumps.map((c) => c.id);
  }
  const led = state.currentTrick.ledSuit;
  const follow = led ? hand.filter((c) => c.suit === led) : [];
  return (follow.length ? follow : hand).map((c: Card) => c.id);
}

export { partnerOf };
