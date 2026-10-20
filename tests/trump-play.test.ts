import {
  applyAction, mustApply, legalCardIds, cardLocations, getPlayerView, resolveTrickWinner, cardFromId, legalCards, cardLabel,
  type GameState, type PlayedCard, type Seat,
} from '../src/engine';
import { toBidding, bidAndWin, toPlaying, setHands } from './helpers';

/** Play first legal cards (never revealing) until `tricks` tricks are complete. */
function playTo(s0: GameState, tricks: number): GameState {
  let s = s0;
  while (s.completedTricks.length < tricks) {
    if (s.currentTrick && s.currentTrick.plays.length === 4) { s = mustApply(s, { type: 'COLLECT_TRICK' }); continue; }
    const seat = s.currentPlayer!;
    s = mustApply(s, { type: 'PLAY_CARD', seat, cardId: legalCardIds(s, seat)[0] });
  }
  return s;
}

const pc = (seat: Seat, id: string, trumpLive = true): PlayedCard => ({ seat, card: cardFromId(id), trumpLive });

describe('reserved trump card', () => {
  it('must come from the bidder’s five cards, is removed from the hand and sets the trump suit', () => {
    let s = bidAndWin(toBidding(), 'C');
    expect(s.phase).toBe('TRUMP_RESERVATION');
    expect(applyAction(s, { type: 'RESERVE', seat: 'A', cardId: s.players.A.hand[0].id }).ok).toBe(false);
    const notMine = s.players.A.hand[0].id;
    expect(applyAction(s, { type: 'RESERVE', seat: 'C', cardId: notMine }).ok).toBe(false);
    const card = s.players.C.hand[3];
    s = mustApply(s, { type: 'RESERVE', seat: 'C', cardId: card.id });
    expect(s.players.C.hand.find((c) => c.id === card.id)).toBeUndefined();
    expect(s.players.C.reserved).toEqual(card);
    expect(s.trump.suit).toBe(card.suit);
    expect(cardLocations(s).ids.filter((id) => id === card.id)).toHaveLength(1);
  });

  it('stays private: other players’ views never contain it or the trump suit', () => {
    const { s, reserved } = toPlaying(2, 'A');
    for (const seat of ['B', 'C', 'D'] as Seat[]) {
      const v = getPlayerView(s, seat);
      const json = JSON.stringify(v);
      expect(v.trump.suit).toBeNull();
      expect(v.trump.revealedCard).toBeNull();
      expect(v.myReserved).toBeNull();
      expect(json).not.toContain(`"id":"${reserved.id}"`);
      expect(v.players.A.hasReservedCard).toBe(true);
      expect(v.log.some((l) => l.text.includes(cardLabel(reserved)))).toBe(false);
    }
    const own = getPlayerView(s, 'A');
    expect(own.myReserved?.id).toBe(reserved.id);
    expect(own.trump.suit).toBe(reserved.suit);
  });

  it('cannot be played while reserved', () => {
    const { s, reserved } = toPlaying(2, 'A');
    let st = s;
    // Advance until it is A's turn.
    while (st.currentPlayer !== 'A') st = mustApply(st, { type: 'PLAY_CARD', seat: st.currentPlayer!, cardId: legalCardIds(st, st.currentPlayer!)[0] });
    const r = applyAction(st, { type: 'PLAY_CARD', seat: 'A', cardId: reserved.id });
    expect(r.ok).toBe(false);
  });

  it('the owner’s example: an unrevealed trump has no power — B wins with 3♥', () => {
    // A won the bidding and reserved 5♠ (spades are trump, still hidden). B leads.
    const { s } = toPlaying(2, 'A');
    let st = setHands(s, { B: ['3H', '2C'], C: ['7S', '4D'], D: ['9C', '5D'], A: ['KS', '6D'] }, { seat: 'A', id: '5S' });
    st = mustApply(st, { type: 'PLAY_CARD', seat: 'B', cardId: '3H' });
    st = mustApply(st, { type: 'PLAY_CARD', seat: 'C', cardId: '7S' }); // no hearts, doesn't ask
    st = mustApply(st, { type: 'PLAY_CARD', seat: 'D', cardId: '9C' }); // no hearts
    st = mustApply(st, { type: 'PLAY_CARD', seat: 'A', cardId: 'KS' }); // no hearts, doesn't reveal
    expect(st.trump.revealed).toBe(false);
    expect(st.currentTrick!.winner).toBe('B');
    st = mustApply(st, { type: 'COLLECT_TRICK' });
    expect(st.players.B.tricksWon).toBe(1);
    expect(st.players.B.captured.map((c) => c.id).sort()).toEqual(['3H', '7S', '9C', 'KS'].sort());
  });

  it('the bidder may reveal only when unable to follow suit, then must play the revealed card', () => {
    const { s, } = toPlaying(2, 'A');
    let st = setHands(s, { B: ['9S', '2C'], C: ['3S'], D: ['4S'], A: ['5D', '6C'] }, { seat: 'A', id: '2H' });
    expect(applyAction(st, { type: 'REVEAL_VOLUNTARY', seat: 'A' }).ok).toBe(false); // not A's turn
    st = mustApply(st, { type: 'PLAY_CARD', seat: 'B', cardId: '9S' });
    st = mustApply(st, { type: 'PLAY_CARD', seat: 'C', cardId: '3S' });
    st = mustApply(st, { type: 'PLAY_CARD', seat: 'D', cardId: '4S' });
    expect(applyAction(st, { type: 'REVEAL_VOLUNTARY', seat: 'B' }).ok).toBe(false);
    expect(getPlayerView(st, 'A').canRevealVoluntarily).toBe(true);
    st = mustApply(st, { type: 'REVEAL_VOLUNTARY', seat: 'A' });
    expect(st.trump.revealedHow).toBe('voluntary');
    expect(st.players.A.reserved).toBeNull();
    expect(st.players.A.hand.filter((c) => c.id === '2H')).toHaveLength(1);
    expect(getPlayerView(st, 'C').trump.revealedCard?.id).toBe('2H');
    expect(legalCardIds(st, 'A')).toEqual(['2H']);
    expect(applyAction(st, { type: 'PLAY_CARD', seat: 'A', cardId: '5D' }).ok).toBe(false); // must play a trump
    expect(applyAction(st, { type: 'REVEAL_VOLUNTARY', seat: 'A' }).ok).toBe(false); // only once
    st = mustApply(st, { type: 'PLAY_CARD', seat: 'A', cardId: '2H' });
    expect(st.currentTrick!.winner).toBe('A'); // live trump wins
    expect(st.trump.mustPlayTrump).toBeNull();
  });

  it('after revealing, the bidder may play any trump-suit card, not only the reserved one', () => {
    const { s } = toPlaying(2, 'A');
    let st = setHands(s, { B: ['9S'], C: ['3S'], D: ['4S'], A: ['5D', '9H'] }, { seat: 'A', id: '2H' });
    for (const [seat, id] of [['B', '9S'], ['C', '3S'], ['D', '4S']] as [Seat, string][]) st = mustApply(st, { type: 'PLAY_CARD', seat, cardId: id });
    st = mustApply(st, { type: 'REVEAL_VOLUNTARY', seat: 'A' });
    expect(legalCardIds(st, 'A').sort()).toEqual(['2H', '9H']);
    expect(applyAction(st, { type: 'PLAY_CARD', seat: 'A', cardId: '5D' }).ok).toBe(false);
    st = mustApply(st, { type: 'PLAY_CARD', seat: 'A', cardId: '9H' });
    expect(st.currentTrick!.winner).toBe('A');
    expect(st.players.A.hand.map((c) => c.id).sort()).toEqual(['2H', '5D']);
  });

  it('the bidder may reveal when trump is led and the reserved card is their only trump', () => {
    const { s } = toPlaying(2, 'A');
    let st = setHands(s, { B: ['9H'], C: ['3H'], D: ['4H'], A: ['5D'] }, { seat: 'A', id: 'KH' });
    for (const [seat, id] of [['B', '9H'], ['C', '3H'], ['D', '4H']] as [Seat, string][]) st = mustApply(st, { type: 'PLAY_CARD', seat, cardId: id });
    st = mustApply(st, { type: 'REVEAL_VOLUNTARY', seat: 'A' });
    st = mustApply(st, { type: 'PLAY_CARD', seat: 'A', cardId: 'KH' });
    expect(st.currentTrick!.winner).toBe('A');
  });

  it('the bidder may not reveal while able to follow suit, or when leading', () => {
    const { s } = toPlaying(2, 'A');
    let st = setHands(s, { B: ['9S'], C: ['3S'], D: ['4S'], A: ['5S', '6C'] }, { seat: 'A', id: '2H' });
    for (const [seat, id] of [['B', '9S'], ['C', '3S'], ['D', '4S']] as [Seat, string][]) st = mustApply(st, { type: 'PLAY_CARD', seat, cardId: id });
    expect(applyAction(st, { type: 'REVEAL_VOLUNTARY', seat: 'A' }).ok).toBe(false);
    const lead = toPlaying(2, 'A', { firstLeader: 'bidder' }).s;
    expect(lead.currentPlayer).toBe('A');
    expect(applyAction(lead, { type: 'REVEAL_VOLUNTARY', seat: 'A' }).ok).toBe(false);
    const anyTurn = toPlaying(2, 'A', { firstLeader: 'bidder', voluntaryReveal: 'anyTurn' }).s;
    expect(applyAction(anyTurn, { type: 'REVEAL_VOLUNTARY', seat: 'A' }).ok).toBe(true);
  });

  it('an opponent who cannot follow suit may request the reveal; it does not win the trick for them', () => {
    const { s } = toPlaying(2, 'A');
    // B leads. Give B a spade, C no spades, reserved card a heart.
    let st = setHands(s, { B: ['9S', '2C'], C: ['3D', '4H'], D: ['KS'], A: ['5S'] }, { seat: 'A', id: '2H' });
    expect(st.currentPlayer).toBe('B');
    st = mustApply(st, { type: 'PLAY_CARD', seat: 'B', cardId: '9S' });
    // D can't request (not their turn); C can (void in spades).
    expect(applyAction(st, { type: 'REQUEST_REVEAL', seat: 'D' }).ok).toBe(false);
    st = mustApply(st, { type: 'REQUEST_REVEAL', seat: 'C' });
    expect(st.trump.revealed).toBe(true);
    expect(st.trump.revealedBy).toBe('C');
    expect(st.players.A.hand.map((c) => c.id)).toContain('2H');
    expect(st.currentPlayer).toBe('C');
    expect(st.currentTrick!.plays).toHaveLength(1);
    // C asked, so C must play a heart (trump) because C holds one.
    expect(applyAction(st, { type: 'PLAY_CARD', seat: 'C', cardId: '3D' }).ok).toBe(false);
    st = mustApply(st, { type: 'PLAY_CARD', seat: 'C', cardId: '4H' });
    st = mustApply(st, { type: 'PLAY_CARD', seat: 'D', cardId: 'KS' });
    st = mustApply(st, { type: 'PLAY_CARD', seat: 'A', cardId: '5S' });
    expect(st.currentTrick!.winner).toBe('C'); // the live trump wins; asking alone doesn't
  });

  it('a requester with no trump-suit card may play any card', () => {
    const { s } = toPlaying(2, 'A');
    let st = setHands(s, { B: ['9S'], C: ['3D', '4C'], D: ['KS'], A: ['5S'] }, { seat: 'A', id: '2H' });
    st = mustApply(st, { type: 'PLAY_CARD', seat: 'B', cardId: '9S' });
    st = mustApply(st, { type: 'REQUEST_REVEAL', seat: 'C' });
    expect(legalCardIds(st, 'C').sort()).toEqual(['3D', '4C']);
    st = mustApply(st, { type: 'PLAY_CARD', seat: 'C', cardId: '4C' });
    st = mustApply(st, { type: 'PLAY_CARD', seat: 'D', cardId: 'KS' });
    st = mustApply(st, { type: 'PLAY_CARD', seat: 'A', cardId: '5S' });
    expect(st.currentTrick!.winner).toBe('D');
  });

  it('a player who can follow suit may not request the reveal; the bidder may not request either', () => {
    const { s } = toPlaying(2, 'A');
    let st = setHands(s, { B: ['9S'], C: ['3S', '4H'], D: ['KD'], A: ['5D'] }, { seat: 'A', id: '2H' });
    st = mustApply(st, { type: 'PLAY_CARD', seat: 'B', cardId: '9S' });
    expect(applyAction(st, { type: 'REQUEST_REVEAL', seat: 'C' }).ok).toBe(false);
    st = mustApply(st, { type: 'PLAY_CARD', seat: 'C', cardId: '3S' });
    st = mustApply(st, { type: 'PLAY_CARD', seat: 'D', cardId: 'KD' });
    expect(applyAction(st, { type: 'REQUEST_REVEAL', seat: 'A' }).ok).toBe(false);
  });

  it('team mode: the bidder’s partner may not request the reveal by default', () => {
    const { s } = toPlaying(2, 'A', undefined, 'team');
    let st = setHands(s, { B: ['9S'], C: ['3D'], D: ['KS'], A: ['5S'] }, { seat: 'A', id: '2H' });
    st = mustApply(st, { type: 'PLAY_CARD', seat: 'B', cardId: '9S' });
    expect(applyAction(st, { type: 'REQUEST_REVEAL', seat: 'C' }).ok).toBe(false); // C is A's partner
    const s2 = setHands(toPlaying(2, 'A', { partnerMayRequestReveal: true }, 'team').s, { B: ['9S'], C: ['3D'], D: ['KS'], A: ['5S'] }, { seat: 'A', id: '2H' });
    const s3 = mustApply(s2, { type: 'PLAY_CARD', seat: 'B', cardId: '9S' });
    expect(applyAction(s3, { type: 'REQUEST_REVEAL', seat: 'C' }).ok).toBe(true);
  });

  it('mandatory reveal happens after trick 12 and before any card of trick 13', () => {
    const { s, reserved } = toPlaying(5, 'A');
    let st = playTo(s, 11);
    expect(st.trump.revealed).toBe(false);
    st = playTo(st, 12);
    expect(st.phase).toBe('MANDATORY_REVEAL');
    expect(st.players.A.hand).toHaveLength(0);
    expect(st.players.A.reserved?.id).toBe(reserved.id);
    for (const seat of ['A', 'B', 'C', 'D'] as Seat[]) {
      const anyCard = st.players[seat].hand[0]?.id ?? reserved.id;
      expect(applyAction(st, { type: 'PLAY_CARD', seat, cardId: anyCard }).ok).toBe(false);
    }
    st = mustApply(st, { type: 'MANDATORY_REVEAL' });
    expect(st.phase).toBe('PLAYING');
    expect(st.trump.revealedHow).toBe('mandatory');
    expect(st.players.A.hand.map((c) => c.id)).toEqual([reserved.id]);
    for (const seat of ['A', 'B', 'C', 'D'] as Seat[]) expect(st.players[seat].hand).toHaveLength(1);
    expect(st.currentTrick?.index).toBe(13);
    expect(applyAction(st, { type: 'MANDATORY_REVEAL' }).ok).toBe(false);
  });

  it('an earlier reveal prevents a second (mandatory) reveal', () => {
    const { s } = toPlaying(5, 'A', { voluntaryReveal: 'anyTurn' });
    let st = s;
    while (st.currentPlayer !== 'A') st = mustApply(st, { type: 'PLAY_CARD', seat: st.currentPlayer!, cardId: legalCardIds(st, st.currentPlayer!)[0] });
    st = mustApply(st, { type: 'REVEAL_VOLUNTARY', seat: 'A' });
    st = playTo(st, 12);
    expect(st.phase).toBe('PLAYING');
    expect(st.currentTrick?.index).toBe(13);
    expect(st.trump.revealedHow).toBe('voluntary');
  });
});

describe('legal plays', () => {
  it('must follow suit when possible; may play anything when void', () => {
    const hand = ['9S', 'KH', '2S', '4D'].map(cardFromId);
    expect(legalCards(hand, 'S').map((c) => c.id).sort()).toEqual(['2S', '9S']);
    expect(legalCards(hand, 'C')).toHaveLength(4);
    expect(legalCards(hand, null)).toHaveLength(4);
  });

  it('engine rejects off-suit, out-of-turn, not-owned and duplicate plays, and plays in the wrong phase', () => {
    const { s } = toPlaying(2, 'A');
    let st = setHands(s, { B: ['9S', '3C'], C: ['3S', '4H'], D: ['KD'], A: ['5D', '6S'] }, { seat: 'A', id: '2H' });
    expect(applyAction(st, { type: 'PLAY_CARD', seat: 'C', cardId: '3S' }).ok).toBe(false); // out of turn
    expect(applyAction(st, { type: 'PLAY_CARD', seat: 'B', cardId: 'AS' }).ok).toBe(false); // not owned
    st = mustApply(st, { type: 'PLAY_CARD', seat: 'B', cardId: '9S' });
    expect(applyAction(st, { type: 'PLAY_CARD', seat: 'B', cardId: '9S' }).ok).toBe(false); // duplicate / out of turn
    expect(applyAction(st, { type: 'PLAY_CARD', seat: 'C', cardId: '4H' }).ok).toBe(false); // must follow
    st = mustApply(st, { type: 'PLAY_CARD', seat: 'C', cardId: '3S' });
    expect(applyAction(st, { type: 'PLAY_CARD', seat: 'D', cardId: 'KD' }).ok).toBe(true); // void → any card
    const bidding = toBidding();
    expect(applyAction(bidding, { type: 'PLAY_CARD', seat: 'A', cardId: bidding.players.A.hand[0].id }).ok).toBe(false);
  });
});

describe('trick resolution', () => {
  it('example A: highest led-suit card wins with no trump', () => {
    expect(resolveTrickWinner([pc('A', '9S'), pc('B', 'KS'), pc('C', 'AS'), pc('D', '4D')], 'S', null)).toBe('C');
    expect(resolveTrickWinner([pc('A', '9S'), pc('B', 'KS'), pc('C', 'AS'), pc('D', '4D')], 'S', 'H')).toBe('C');
  });
  it('example B: trump beats an ace', () => {
    expect(resolveTrickWinner([pc('A', 'AS'), pc('B', '2H'), pc('C', 'KS'), pc('D', '10S')], 'S', 'H')).toBe('B');
  });
  it('example C: higher trump beats lower trump', () => {
    expect(resolveTrickWinner([pc('A', 'AS'), pc('B', '2H'), pc('C', '5H'), pc('D', 'KS')], 'S', 'H')).toBe('C');
  });
  it('off-suit non-trump cards cannot win', () => {
    expect(resolveTrickWinner([pc('A', '2S'), pc('B', 'AD'), pc('C', 'AC'), pc('D', 'KH')], 'S', null)).toBe('A');
  });
  it('trump led: highest trump wins as led suit', () => {
    expect(resolveTrickWinner([pc('A', '3H', false), pc('B', 'QH'), pc('C', 'AS'), pc('D', '9H')], 'H', 'H')).toBe('B');
  });
  it('default rule: a trump-suit card played before the reveal has no trump power', () => {
    expect(resolveTrickWinner([pc('A', '9S'), pc('B', '2H', false), pc('C', 'KS'), pc('D', '3S')], 'S', 'H')).toBe('C');
    expect(resolveTrickWinner([pc('A', '9S'), pc('B', '2H', false), pc('C', '3H', true), pc('D', '3S')], 'S', 'H')).toBe('C');
  });
  it('the winner collects four cards, gains one trick and leads the next trick', () => {
    const { s } = toPlaying(2, 'A');
    let st = setHands(s, { B: ['9S', '3C'], C: ['AS', '4H'], D: ['KD', '5C'], A: ['5S', '6D'] }, { seat: 'A', id: '2H' });
    for (const [seat, id] of [['B', '9S'], ['C', 'AS'], ['D', 'KD'], ['A', '5S']] as [Seat, string][]) st = mustApply(st, { type: 'PLAY_CARD', seat, cardId: id });
    expect(st.currentTrick!.winner).toBe('C');
    expect(applyAction(st, { type: 'PLAY_CARD', seat: 'C', cardId: '4H' }).ok).toBe(false); // must collect first
    st = mustApply(st, { type: 'COLLECT_TRICK' });
    expect(applyAction(st, { type: 'COLLECT_TRICK' }).ok).toBe(false); // cannot resolve twice
    expect(st.players.C.tricksWon).toBe(1);
    expect(st.players.C.captured).toHaveLength(4);
    expect(st.currentPlayer).toBe('C'); // the winner leads
    expect(st.currentTrick!.leader).toBe('C');
    expect(st.currentTrick!.index).toBe(2);
  });

  it('option: the player after the winner leads the next trick', () => {
    const { s } = toPlaying(2, 'A', { nextTrickLeader: 'afterWinner' });
    let st = setHands(s, { B: ['9S', '3C'], C: ['AS', '4H'], D: ['KD', '5C'], A: ['5S', '6D'] }, { seat: 'A', id: '2H' });
    for (const [seat, id] of [['B', '9S'], ['C', 'AS'], ['D', 'KD'], ['A', '5S']] as [Seat, string][]) st = mustApply(st, { type: 'PLAY_CARD', seat, cardId: id });
    st = mustApply(st, { type: 'COLLECT_TRICK' });
    expect(st.currentPlayer).toBe('D');
  });
});
