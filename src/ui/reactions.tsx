/**
 * Friends tables: emojis thrown at each other's faces. Purely cosmetic — never part of the
 * game state. Offline the computer players throw back; online they travel over the room.
 */
import { useState, type CSSProperties } from 'react';
import type { Seat } from '../engine/types';
import type { PlayerView } from '../engine/view';
import { SEATS } from '../engine/seating';
import { relPos, type Pos } from './layout';
import { useI18n, useSeatName } from './i18n';
import { playSplat } from './sound';

import { EMOJIS } from '../online/emojis';
export { EMOJIS, KIND, MEAN, isEmoji } from '../online/emojis';

export interface Reaction {
  id: string;
  from: Seat;
  to: Seat;
  e: string;
}

const AT: Record<Pos, [number, number]> = { bottom: [50, 80], top: [50, 12], left: [9, 46], right: [91, 46] };
export const FLIGHT_MS = 2600;
export const HIT_AT_MS = 1200;


/** Flying emojis over the table. */
export function ReactionLayer({ me, reactions }: { me: Seat; reactions: Reaction[] }) {
  return (
    <div className="reaction-layer" aria-hidden>
      {reactions.map((r) => {
        const [fx, fy] = AT[relPos(me, r.from)];
        const [tx, ty] = AT[relPos(me, r.to)];
        return (
          <span key={r.id} className="reaction" style={{ ['--fx' as string]: `${fx}%`, ['--fy' as string]: `${fy}%`, ['--tx' as string]: `${tx}%`, ['--ty' as string]: `${ty}%` } as CSSProperties}>
            <span className="reaction-inner">{r.e}</span>
          </span>
        );
      })}
    </div>
  );
}

/** The throw tray: pick a target, then an emoji. */
export function ThrowTray({ view, target, setTarget, onThrow, onClose }: {
  view: PlayerView; target: Seat | null; setTarget: (s: Seat) => void; onThrow: (to: Seat, e: string) => void; onClose: () => void;
}) {
  const i = useI18n();
  const seatName = useSeatName(view.players);
  const others = SEATS.filter((s) => s !== view.seat);
  const to = target ?? others[0];
  return (
    <div className="throw-tray" role="dialog" aria-label={i.t('Throw an emoji')}>
      <div className="throw-head">
        <strong>{i.t('Throw at')}</strong>
        <button className="btn ghost small" onClick={onClose} aria-label={i.t('Close')}>✕</button>
      </div>
      <div className="throw-targets">
        {others.map((s) => (
          <button key={s} className={`chip-btn ${to === s ? 'on' : ''}`} aria-pressed={to === s} onClick={() => setTarget(s)}>{seatName(s)}</button>
        ))}
      </div>
      <div className="throw-grid">
        {EMOJIS.map((e) => (
          <button key={e} className="emoji-btn" onClick={() => onThrow(to, e)} aria-label={e}>{e}</button>
        ))}
      </div>
    </div>
  );
}

/** Local reaction list with timed removal and "hit" marks. */
export function useReactions() {
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [hits, setHits] = useState<Partial<Record<Seat, number>>>({});
  const add = (r: Omit<Reaction, 'id'>) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setReactions((xs) => [...xs.slice(-12), { ...r, id }]);
    window.setTimeout(() => { setHits((h) => ({ ...h, [r.to]: Date.now() })); playSplat(); }, HIT_AT_MS);
    window.setTimeout(() => setHits((h) => ({ ...h, [r.to]: undefined })), HIT_AT_MS + 700);
    window.setTimeout(() => setReactions((xs) => xs.filter((x) => x.id !== id)), FLIGHT_MS);
  };
  return { reactions, hits, add };
}
