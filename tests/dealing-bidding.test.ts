import { applyAction, mustApply, cardLocations, SEATS, seededRng, createDeck, riffle } from '../src/engine';
import { playRoundAI } from '../src/ai/simulate';
import { newMatch, toBidding, bidAndWin, setHands } from './helpers';

describe('cut and dealing', () => {
  it('only the cutter may cut, and only at 1..51', () => {
    let s = mustApply(newMatch(), { type: 'SHUFFLE' }, seededRng(3));
    expect(s.phase).toBe('CUT');
    expect(s.cutter).toBe('C'); // seat before dealer D
    expect(applyAction(s, { type: 'CUT', seat: 'A', position: 10 }).ok).toBe(false);
    expect(applyAction(s, { type: 'CUT', seat: 'C', position: 0 }).ok).toBe(false);
    expect(applyAction(s, { type: 'CUT', seat: 'C', position: 52 }).ok).toBe(false);
    const before = s.deck.map((c) => c.id);
    s = mustApply(s, { type: 'CUT', seat: 'C', position: 13 });
    expect(s.deck.map((c) => c.id)).toEqual([...before.slice(13), ...before.slice(0, 13)]);
  });

  it('deals in packets: the first five cards of the deck go to the first hand', () => {
    let s = mustApply(newMatch(), { type: 'SHUFFLE' }, seededRng(3));
    s = mustApply(s, { type: 'CUT', seat: 'C', position: 10 });
    const top = s.deck.slice(0, 10).map((c) => c.id);
    s = mustApply(s, { type: 'DEAL_INITIAL' });
    expect(s.players.A.hand.map((c) => c.id)).toEqual(top.slice(0, 5));
    expect(s.players.B.hand.map((c) => c.id)).toEqual(top.slice(5, 10));
  });

  it('initial deal gives five cards each and leaves 32 in the deck', () => {
    const s = toBidding();
    for (const seat of SEATS) expect(s.players[seat].hand).toHaveLength(5);
    expect(s.deck).toHaveLength(32);
    expect(s.phase).toBe('BIDDING');
    expect(cardLocations(s).ids).toHaveLength(52);
  });

  it('5 + 4 + 4: second and third deals are separate stages, reserved card counts toward 13', () => {
    let s = bidAndWin(toBidding(), 'B');
    const reserved = s.players.B.hand[2];
    s = mustApply(s, { type: 'RESERVE', seat: 'B', cardId: reserved.id });
    expect(s.players.B.hand).toHaveLength(4);
    expect(s.players.B.reserved?.id).toBe(reserved.id);
    expect(applyAction(s, { type: 'DEAL_THIRD' }).ok).toBe(false); // can't skip a stage
    s = mustApply(s, { type: 'DEAL_SECOND' });
    expect(s.phase).toBe('THIRD_DEAL');
    expect(s.deck).toHaveLength(16);
    for (const seat of SEATS) {
      const p = s.players[seat];
      expect(p.hand.length + (p.reserved ? 1 : 0)).toBe(9);
    }
    s = mustApply(s, { type: 'DEAL_THIRD' });
    expect(s.deck).toHaveLength(0);
    for (const seat of SEATS) {
      const p = s.players[seat];
      expect(p.hand.length + (p.reserved ? 1 : 0)).toBe(13);
    }
    expect(s.players.B.hand).toHaveLength(12);
    const { ids } = cardLocations(s);
    expect(ids).toHaveLength(52);
    expect(new Set(ids).size).toBe(52);
  });
});

describe('bidding', () => {
  it('starts with the player after the dealer and validates bids 7..13', () => {
    const s = toBidding();
    expect(s.currentPlayer).toBe('A');
    expect(applyAction(s, { type: 'BID', seat: 'A', amount: 6 }).ok).toBe(false);
    expect(applyAction(s, { type: 'BID', seat: 'A', amount: 14 }).ok).toBe(false);
    expect(applyAction(s, { type: 'BID', seat: 'A', amount: 7.5 }).ok).toBe(false);
    expect(applyAction(s, { type: 'BID', seat: 'B', amount: 8 }).ok).toBe(false); // out of turn
    expect(applyAction(s, { type: 'BID', seat: 'A', amount: 7 }).ok).toBe(true);
    expect(applyAction(s, { type: 'BID', seat: 'A', amount: 13 }).ok).toBe(true);
  });

  it('auction option: A 7, B pass, C 9, D pass, A pass → C wins with 9', () => {
    let s = toBidding(1, { biddingStyle: 'auction' });
    s = mustApply(s, { type: 'BID', seat: 'A', amount: 7 });
    s = mustApply(s, { type: 'PASS', seat: 'B' });
    s = mustApply(s, { type: 'BID', seat: 'C', amount: 9 });
    s = mustApply(s, { type: 'PASS', seat: 'D' });
    expect(s.currentPlayer).toBe('A'); // B is skipped, already passed
    s = mustApply(s, { type: 'PASS', seat: 'A' });
    expect(s.phase).toBe('TRUMP_RESERVATION');
    expect(s.bidding.highestBidder).toBe('C');
    expect(s.bidding.highestBid).toBe(9);
    expect(s.bidding.history.map((h) => `${h.seat}:${h.action}${h.amount ?? ''}`)).toEqual(['A:bid7', 'B:pass', 'C:bid9', 'D:pass', 'A:pass']);
    expect(s.players.A.bid).toEqual({ kind: 'pass' });
    expect(s.players.C.bid).toEqual({ kind: 'bid', amount: 9 });
  });

  it('auction option: rejects equal or lower bids, and passed players cannot re-enter', () => {
    let s = toBidding(1, { biddingStyle: 'auction' });
    s = mustApply(s, { type: 'BID', seat: 'A', amount: 8 });
    expect(applyAction(s, { type: 'BID', seat: 'B', amount: 8 }).ok).toBe(false);
    expect(applyAction(s, { type: 'BID', seat: 'B', amount: 7 }).ok).toBe(false);
    s = mustApply(s, { type: 'PASS', seat: 'B' });
    s = mustApply(s, { type: 'BID', seat: 'C', amount: 9 });
    s = mustApply(s, { type: 'BID', seat: 'D', amount: 10 });
    s = mustApply(s, { type: 'BID', seat: 'A', amount: 11 });
    expect(s.currentPlayer).toBe('C');
    expect(applyAction(s, { type: 'BID', seat: 'B', amount: 12 }).ok).toBe(false);
    s = mustApply(s, { type: 'PASS', seat: 'C' });
    s = mustApply(s, { type: 'PASS', seat: 'D' });
    expect(s.phase).toBe('TRUMP_RESERVATION');
    expect(s.bidding.highestBidder).toBe('A');
  });

  it('a bid of 13 ends the auction; remaining players are auto-passed', () => {
    let s = toBidding();
    s = mustApply(s, { type: 'BID', seat: 'A', amount: 13 });
    expect(s.phase).toBe('TRUMP_RESERVATION');
    expect(s.bidding.history.filter((h) => h.action === 'auto-pass')).toHaveLength(3);
  });

  it('all-pass default: the dealer must call 7', () => {
    let s = toBidding();
    expect(s.dealer).toBe('D');
    for (const seat of ['A', 'B', 'C', 'D'] as const) s = mustApply(s, { type: 'PASS', seat });
    expect(s.phase).toBe('TRUMP_RESERVATION');
    expect(s.bidding.highestBidder).toBe('D');
    expect(s.bidding.highestBid).toBe(7);
    expect(s.players.D.bid).toEqual({ kind: 'bid', amount: 7 });
    expect(s.players.A.bid).toEqual({ kind: 'pass' });
    expect(s.bidding.history.at(-1)).toEqual({ seat: 'D', action: 'forced', amount: 7 });
  });

  it('all-pass option: the first bidder must call 7', () => {
    let s = toBidding(1, { allPass: 'forceFirstBidderSeven' });
    for (const seat of ['A', 'B', 'C', 'D'] as const) s = mustApply(s, { type: 'PASS', seat });
    expect(s.bidding.highestBidder).toBe('A');
  });

  it('single round (default): A 7, B pass, C pass, D 9 → D wins; nobody bids twice', () => {
    let s = toBidding();
    s = mustApply(s, { type: 'BID', seat: 'A', amount: 7 });
    s = mustApply(s, { type: 'PASS', seat: 'B' });
    s = mustApply(s, { type: 'PASS', seat: 'C' });
    s = mustApply(s, { type: 'BID', seat: 'D', amount: 9 });
    expect(s.phase).toBe('TRUMP_RESERVATION');
    expect(s.bidding.highestBidder).toBe('D');
    expect(s.bidding.highestBid).toBe(9);
    expect(s.players.A.bid).toEqual({ kind: 'pass' }); // outbid → scores as a pass by default
    expect(s.bidding.history).toHaveLength(4);
  });

  it('single round: each player speaks once and must beat the current bid', () => {
    let s = toBidding();
    s = mustApply(s, { type: 'BID', seat: 'A', amount: 8 });
    expect(applyAction(s, { type: 'BID', seat: 'B', amount: 8 }).ok).toBe(false);
    s = mustApply(s, { type: 'BID', seat: 'B', amount: 10 });
    s = mustApply(s, { type: 'PASS', seat: 'C' });
    expect(s.currentPlayer).toBe('D');
    s = mustApply(s, { type: 'PASS', seat: 'D' });
    expect(s.phase).toBe('TRUMP_RESERVATION'); // A does not get a second turn
    expect(s.bidding.highestBidder).toBe('B');
  });

  it('all-pass with the redeal rule returns to SHUFFLE with the same dealer', () => {
    let s = toBidding(1, { allPass: 'redeal' });
    for (const seat of ['A', 'B', 'C', 'D'] as const) s = mustApply(s, { type: 'PASS', seat });
    expect(s.phase).toBe('SHUFFLE');
    expect(s.dealer).toBe('D');
    expect(s.round).toBe(1);
    for (const seat of SEATS) expect(s.players[seat].hand).toHaveLength(0);
  });

  it('cannot bid outside the bidding phase', () => {
    const s = bidAndWin(toBidding(), 'A');
    expect(applyAction(s, { type: 'BID', seat: 'A', amount: 9 }).ok).toBe(false);
  });

  it('optional rule: outbid players keep their own highest bid', () => {
    let s = toBidding(1, { outbidPlayersScoreAs: 'ownHighestBid', biddingStyle: 'auction' });
    s = mustApply(s, { type: 'BID', seat: 'A', amount: 7 });
    s = mustApply(s, { type: 'BID', seat: 'B', amount: 8 });
    s = mustApply(s, { type: 'PASS', seat: 'C' });
    s = mustApply(s, { type: 'PASS', seat: 'D' });
    s = mustApply(s, { type: 'PASS', seat: 'A' });
    expect(s.players.A.bid).toEqual({ kind: 'bid', amount: 7 });
    expect(s.players.B.bid).toEqual({ kind: 'bid', amount: 8 });
  });
});

describe('reshuffle call', () => {
  it('the first hand with no A, K, Q or J may call a reshuffle and becomes the dealer', () => {
    // Swap A's face cards with low cards from the undealt deck, keeping all 52 cards.
    let s = structuredClone(toBidding());
    for (let i = 0; i < 5; i++) {
      if (s.players.A.hand[i].strength >= 11) {
        const j = s.deck.findIndex((c) => c.strength < 11);
        [s.players.A.hand[i], s.deck[j]] = [s.deck[j], s.players.A.hand[i]];
      }
    }
    expect(s.bidding.starter).toBe('A');
    s = mustApply(s, { type: 'CALL_RESHUFFLE', seat: 'A' });
    expect(s.phase).toBe('SHUFFLE');
    expect(s.dealer).toBe('A');
    expect(s.round).toBe(1);
    expect(s.deck).toHaveLength(52);
    expect(new Set(s.deck.map((c) => c.id)).size).toBe(52);
    s = mustApply(s, { type: 'SHUFFLE' }, seededRng(4));
    expect(s.cutter).toBe('D');
  });

  it('is refused with a face card, for other players, or after a bid', () => {
    const base = toBidding();
    expect(applyAction(setHands(base, { A: ['2S', '5H', '9D', 'JC', '3S'] }), { type: 'CALL_RESHUFFLE', seat: 'A' }).ok).toBe(false);
    let s = setHands(base, { B: ['2S', '5H', '9D', '10C', '3S'] });
    s = mustApply(s, { type: 'PASS', seat: 'A' });
    expect(applyAction(s, { type: 'CALL_RESHUFFLE', seat: 'B' }).ok).toBe(false);
    const any = setHands(toBidding(1, { reshuffleCall: 'anyPlayer' }), { B: ['2S', '5H', '9D', '10C', '3S'] });
    const s2 = mustApply(any, { type: 'PASS', seat: 'A' });
    expect(applyAction(s2, { type: 'CALL_RESHUFFLE', seat: 'B' }).ok).toBe(true);
  });
});

describe('stacked tricks and realistic shuffle', () => {
  it('riffle preserves all 52 cards; one riffle keeps many neighbours together', () => {
    const d = createDeck();
    const r = riffle(d, seededRng(5));
    expect(new Set(r.map((c) => c.id))).toEqual(new Set(d.map((c) => c.id)));
    const pos = new Map(r.map((c, i) => [c.id, i]));
    let kept = 0;
    for (let i = 0; i < 51; i++) if (pos.get(d[i + 1].id)! - pos.get(d[i].id)! === 1) kept++;
    expect(kept).toBeGreaterThan(15);
  });

  it('next round starts from the gathered tricks and riffles them', () => {
    const rng = seededRng(12);
    let s = playRoundAI(newMatch({ seed: 12, target: 999 }), 'normal', rng);
    const piles = SEATS.flatMap((x) => s.players[x].captured.map((c) => c.id));
    s = mustApply(s, { type: 'NEXT_ROUND' });
    expect(s.phase).toBe('SHUFFLE');
    expect(s.deck).toHaveLength(52);
    expect(new Set(s.deck.map((c) => c.id))).toEqual(new Set(piles));
    s = mustApply(s, { type: 'SHUFFLE' }, rng);
    expect(s.lastShuffle?.kind).toBe('riffle');
    expect(new Set(s.deck.map((c) => c.id)).size).toBe(52);
  });
});
