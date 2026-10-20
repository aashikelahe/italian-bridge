/**
 * English / Bangla text. Components write English templates — t('Round {n}', { n: 3 }) —
 * and Bangla looks them up in BN (src/ui/bn.ts). Missing keys fall back to English.
 * Friends tables use the colloquial Bangla card and suit names.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Card, LogEntry, Rank, Seat, Suit } from '../engine/types';
import { SUIT_NAME, cardFromId } from '../engine/cards';
import { BN } from './bn';

export type Lang = 'en' | 'bn';

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
export const toBnDigits = (s: string) => s.replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);

const BN_SUIT: Record<Suit, string> = { S: 'ইস্কাপন', H: 'হরতন', D: 'রুইতন', C: 'চিড়িতন' };
const BN_SUIT_FRIENDS: Record<Suit, string> = { S: 'ইস্কাবন', H: 'ভালোবাসা', D: 'ইঁট', C: 'চিড়া' };
const BN_RANK: Partial<Record<Rank, string>> = { A: 'টেক্কা', K: 'রাজা', Q: 'রানী', J: 'গোলাম' };
const BN_RANK_FRIENDS: Partial<Record<Rank, string>> = { A: 'এক্কা', K: 'সাহেব', Q: 'বিবি', J: 'গোলাম' };
const EN_RANK: Partial<Record<Rank, string>> = { A: 'Ace', K: 'King', Q: 'Queen', J: 'Jack' };
const SYMBOL: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };

/** Default names in the app, shown in Bangla when the language is Bangla. */
const BN_NAMES: Record<string, string> = {
  You: 'আপনি', Nadia: 'নাদিয়া', Rafi: 'রাফি', Tanvir: 'তানভীর',
  'Your team': 'আপনার দল', 'Their team': 'ওদের দল', 'Team X': 'দল এক্স', 'Team Y': 'দল ওয়াই',
  'Bot 1': 'বট ১', 'Bot 2': 'বট ২', 'Bot 3': 'বট ৩',
};

export interface I18n {
  lang: Lang;
  friends: boolean;
  t: (tpl: string, vars?: Record<string, string | number>) => string;
  num: (n: number | string) => string;
  signed: (n: number) => string;
  suit: (s: Suit) => string;
  rank: (r: Rank) => string;
  cardName: (c: Card) => string;
  cardShort: (c: Card) => string;
  /** A player or team name as stored (translated if it is one of the app's defaults). */
  name: (raw: string) => string;
  logLine: (e: LogEntry, seatName: (s: Seat) => string) => string;
}

export function makeI18n(lang: Lang, friends: boolean): I18n {
  const bn = lang === 'bn';
  const num = (n: number | string) => (bn ? toBnDigits(String(n)) : String(n));
  const suit = (s: Suit) => (bn ? (friends ? BN_SUIT_FRIENDS : BN_SUIT)[s] : SUIT_NAME[s]);
  const rank = (r: Rank) => (bn ? ((friends ? BN_RANK_FRIENDS : BN_RANK)[r] ?? num(r)) : EN_RANK[r] ?? r);
  const t = (tpl: string, vars: Record<string, string | number> = {}) => {
    const src = bn ? BN[tpl] ?? tpl : tpl;
    const out = src.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
    return bn ? toBnDigits(out) : out;
  };
  // Bangla possessive: consonant ending takes "ের", a vowel ending takes "র".
  const poss = (w: string) => (/[\u09BE-\u09CC]$/.test(w) ? `${w}র` : `${w}ের`);
  const cardName = (c: Card) => (bn ? `${poss(suit(c.suit))} ${rank(c.rank)}` : `${rank(c.rank)} of ${suit(c.suit)}`);
  const cardShort = (c: Card) => `${bn ? num(c.rank) : c.rank}${SYMBOL[c.suit]}`;
  const name = (raw: string) => (bn ? BN_NAMES[raw] ?? raw : raw);
  const signed = (n: number) => num(n > 0 ? `+${n}` : String(n));
  const logLine = (e: LogEntry, seatName: (s: Seat) => string) => {
    if (!e.tpl) return e.text;
    const vars: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(e.params ?? {})) {
      if (k === 'p' || k === 'q') vars[k] = seatName(v as Seat);
      else if (k === 'card') vars[k] = cardShort(cardFromId(String(v)));
      else if (k === 'suit') vars[k] = suit(v as Suit);
      else vars[k] = v;
    }
    return t(e.tpl, vars);
  };
  return { lang, friends, t, num, signed, suit, rank, cardName, cardShort, name, logLine };
}

const Ctx = createContext<I18n>(makeI18n('en', false));

export function I18nProvider({ lang, friends, children }: { lang: Lang; friends: boolean; children: ReactNode }) {
  const value = useMemo(() => makeI18n(lang, friends), [lang, friends]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);

/** Per-viewer names for seats (online play resolves people's names; offline uses stored names). */
const NameCtx = createContext<((seat: Seat) => string | null) | null>(null);
export function SeatNameProvider({ resolve, children }: { resolve: (seat: Seat) => string | null; children: ReactNode }) {
  return <NameCtx.Provider value={resolve}>{children}</NameCtx.Provider>;
}

/** Returns a function giving the display name of a seat for this viewer. */
export function useSeatName(players: Record<Seat, { name: string }>): (seat: Seat) => string {
  const i = useI18n();
  const override = useContext(NameCtx);
  return (seat: Seat) => (players[seat] ? override?.(seat) || i.name(players[seat].name) || i.t('Player {n}', { n: ' ABCD'.indexOf(seat) }) : '');
}
