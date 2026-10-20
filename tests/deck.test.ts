import { createDeck, shuffle, cut, seededRng, RANKS, SUITS, RANK_STRENGTH, cardFromId } from '../src/engine';

describe('deck', () => {
  it('has exactly 52 unique cards, 13 per suit, every rank once per suit', () => {
    const d = createDeck();
    expect(d).toHaveLength(52);
    expect(new Set(d.map((c) => c.id)).size).toBe(52);
    for (const s of SUITS) {
      const suit = d.filter((c) => c.suit === s);
      expect(suit).toHaveLength(13);
      expect(new Set(suit.map((c) => c.rank))).toEqual(new Set(RANKS));
    }
  });

  it('uses numeric rank strength A > K > Q > J > 10 > ... > 2 (no jokers)', () => {
    const order = RANKS.map((r) => RANK_STRENGTH[r]);
    for (let i = 1; i < order.length; i++) expect(order[i - 1]).toBeGreaterThan(order[i]);
    expect(cardFromId('10H').strength).toBeGreaterThan(cardFromId('9H').strength);
    expect(cardFromId('JS').strength).toBeGreaterThan(cardFromId('10S').strength);
    expect(createDeck().some((c) => (c.rank as string) === 'Joker')).toBe(false);
  });

  it('shuffle preserves all cards and changes order', () => {
    const d = createDeck();
    const s = shuffle(d, seededRng(42));
    expect(s).toHaveLength(52);
    expect(new Set(s.map((c) => c.id))).toEqual(new Set(d.map((c) => c.id)));
    expect(s.map((c) => c.id).join()).not.toBe(d.map((c) => c.id).join());
  });

  it('cut recombines B then A, preserving all cards', () => {
    const d = createDeck();
    const c = cut(d, 10);
    expect(c).toHaveLength(52);
    expect(c[0].id).toBe(d[10].id);
    expect(c[42].id).toBe(d[0].id);
    expect(c.map((x) => x.id)).toEqual([...d.slice(10), ...d.slice(0, 10)].map((x) => x.id));
    expect(new Set(c.map((x) => x.id)).size).toBe(52);
  });

  it('rejects cut positions outside 1..51', () => {
    const d = createDeck();
    expect(() => cut(d, 0)).toThrow();
    expect(() => cut(d, 52)).toThrow();
    expect(() => cut(d, 2.5)).toThrow();
    expect(() => cut(d, 1)).not.toThrow();
    expect(() => cut(d, 51)).not.toThrow();
  });
});
