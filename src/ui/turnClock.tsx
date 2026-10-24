import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Seat } from '../engine/types';
import { buzz, playTick } from './sound';

/** The running move timer: `seat` must move before `endsAt` (local clock). */
export interface TurnClock { seat: Seat; endsAt: number; total: number }

const Ctx = createContext<TurnClock | null>(null);
export function TurnClockProvider({ clock, children }: { clock: TurnClock | null; children: ReactNode }) {
  return <Ctx.Provider value={clock}>{children}</Ctx.Provider>;
}
export const useTurnClock = () => useContext(Ctx);

/** Seconds left on the clock, updated a few times a second. */
function useLeft(clock: TurnClock | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!clock) return;
    const iv = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(iv);
  }, [clock]);
  return clock ? Math.max(0, clock.endsAt - now) : 0;
}

/** A shrinking ring and the seconds left, drawn over a player's picture while it is their move. */
export function TurnRing({ seat, mine }: { seat: Seat; mine: boolean }) {
  const clock = useTurnClock();
  const active = clock && clock.seat === seat ? clock : null;
  const left = useLeft(active);
  const secs = Math.ceil(left / 1000);
  const lastTick = useRef(0);
  useEffect(() => {
    if (!active || !mine) return;
    if (secs >= 1 && secs <= 5 && secs !== lastTick.current) {
      lastTick.current = secs;
      playTick(secs === 1);
      if (secs <= 3) buzz(25);
    }
  }, [secs, active, mine]);
  if (!active) return null;
  const frac = Math.max(0, Math.min(1, left / active.total));
  const r = 47;
  const c = 2 * Math.PI * r;
  return (
    <span className={`turn-clock ${secs <= 5 ? 'low' : ''}`} aria-label={`${secs}s`}>
      <svg viewBox="0 0 100 100" aria-hidden>
        <circle cx="50" cy="50" r={r} className="tc-bg" />
        <circle cx="50" cy="50" r={r} className="tc-fg" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} />
      </svg>
      <b>{secs}</b>
    </span>
  );
}
