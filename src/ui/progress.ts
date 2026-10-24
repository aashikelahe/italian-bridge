/**
 * Points (XP), levels and unlocks. Works the same offline and online: progress is recorded from
 * what the player sees at the table, once per round and once per match.
 */
import { useEffect, useRef } from 'react';
import type { PlayerView } from '../engine/view';
import { teamOf } from '../engine/seating';
import { CARD_FACES, THEME_LEVEL, storage, type Stats, type TableTheme } from './storage';

export const XP = { roundWon: 10, roundLost: 3, bonusMade: 25, matchPlayed: 30, matchWon: 100 } as const;

/** Level from XP: level n starts at 40·(n−1)² XP. */
export function levelFromXp(xp: number) {
  const level = Math.min(99, Math.floor(Math.sqrt(Math.max(0, xp) / 40)) + 1);
  return { level, xp, from: 40 * (level - 1) ** 2, to: 40 * level ** 2 };
}

/** XP for players from before points existed: worked out from their statistics. */
export function legacyXp(st: Stats): number {
  return st.matchesPlayed * 30 + st.matchesWon * 70 + st.contractsMade * 10 + st.passesMade * 4 + st.roundsPlayed * 3;
}

export const xpOf = (st: Stats) => st.xp ?? legacyXp(st);

/** What unlocks at a level (card faces and tables). */
export function unlocksAt(level: number): { faces: string[]; tables: TableTheme[] } {
  return {
    faces: CARD_FACES.filter((f) => f.level === level).map((f) => f.name),
    tables: (Object.keys(THEME_LEVEL) as TableTheme[]).filter((t) => THEME_LEVEL[t] === level),
  };
}

/** The next level that unlocks something, if any. */
export function nextUnlock(level: number): { level: number; faces: string[]; tables: TableTheme[] } | null {
  for (let l = level + 1; l <= 99; l++) {
    const u = unlocksAt(l);
    if (u.faces.length || u.tables.length) return { level: l, ...u };
  }
  return null;
}

export interface XpEvent { gained: number; reasons: string[]; levelBefore: number; levelAfter: number }
type Listener = (e: XpEvent) => void;
const listeners = new Set<Listener>();
export function onXp(fn: Listener) { listeners.add(fn); return () => { listeners.delete(fn); }; }

/** Add XP (and save statistics changes made in `edit`). */
export function award(gained: number, reasons: string[], edit?: (st: Stats) => void) {
  const st = storage.loadStats();
  const before = xpOf(st);
  edit?.(st);
  st.xp = before + gained;
  storage.saveStats(st);
  const e: XpEvent = { gained, reasons, levelBefore: levelFromXp(before).level, levelAfter: levelFromXp(st.xp).level };
  for (const l of listeners) l(e);
}

const SEEN_KEY = 'ib.progress.seen';
function seen(key: string): boolean {
  try {
    const list: string[] = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]');
    if (list.includes(key)) return true;
    localStorage.setItem(SEEN_KEY, JSON.stringify([key, ...list].slice(0, 60)));
    return false;
  } catch { return false; }
}

/** Record rounds and matches as they finish at the table (each only once, even after a reload). */
export function useProgress(view: PlayerView | null) {
  const prev = useRef<PlayerView | null>(null);
  useEffect(() => {
    const p = prev.current;
    prev.current = view;
    if (!view || !p || p.gameId !== view.gameId) return;
    const me = view.seat;
    // A round finished.
    if (view.roundHistory.length > p.roundHistory.length) {
      const r = view.roundHistory[view.roundHistory.length - 1];
      if (!seen(`${view.gameId}:r${r.round}`)) {
        const teamRes = r.teams?.find((t) => t.id === teamOf(me));
        const tc = !!r.teams && view.config.teamScoring === 'teamContract';
        const mine = tc ? teamRes?.roundScore ?? 0 : r.players.find((x) => x.seat === me)?.roundScore ?? 0;
        const myRes = r.players.find((x) => x.seat === me);
        const bidding = tc ? teamOf(r.highestBidder) === teamOf(me) : myRes?.bid.kind === 'bid';
        const bonus = bidding && mine > 0 && r.highestBid >= (view.config.bonusBid ?? 99) && (tc ? teamOf(r.highestBidder) === teamOf(me) : r.highestBidder === me);
        const reasons = [mine > 0 ? 'Round won' : 'Round played'];
        let gained = mine > 0 ? XP.roundWon : XP.roundLost;
        if (bonus) { gained += XP.bonusMade; reasons.push('Bonus made'); }
        award(gained, reasons, (st) => {
          st.roundsPlayed++;
          if (bidding) { st.contractsBid++; if (mine > 0) st.contractsMade++; } else { st.passesTotal++; if (mine > 0) st.passesMade++; }
          if (bonus) st.bonusesMade = (st.bonusesMade ?? 0) + 1;
        });
      }
    }
    // The match finished.
    if (view.phase === 'MATCH_OVER' && p.phase !== 'MATCH_OVER' && !seen(`${view.gameId}:m`)) {
      const w = view.matchWinner;
      const won = !!w && ((w.kind === 'team' && w.id === teamOf(me)) || (w.kind === 'player' && w.seat === me));
      const total = view.teams ? view.teams.find((t) => t.id === teamOf(me))?.cumulativeScore ?? 0 : view.players[me].cumulativeScore;
      award(XP.matchPlayed + (won ? XP.matchWon : 0), won ? ['Match won'] : ['Match played'], (st) => {
        st.matchesPlayed++;
        if (won) st.matchesWon++;
        st.bestTotal = st.bestTotal == null ? total : Math.max(st.bestTotal, total);
      });
    }
  }, [view]);
}
