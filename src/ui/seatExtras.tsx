import { createContext, useContext, type ReactNode } from 'react';
import type { Seat } from '../engine/types';
import type { PicInfo } from './profile';

/** Extra things shown on a player's avatar: picture, player ID, level and voice state. */
export interface SeatExtra {
  pic?: PicInfo | null;
  handle?: string | null;
  level?: number;
  voice?: boolean;
  muted?: boolean;
  speaking?: boolean;
  /** Your voice link to them (only while you are in the voice chat). */
  link?: 'connecting' | 'connected' | 'trouble';
}

const Ctx = createContext<(seat: Seat) => SeatExtra | null>(() => null);
export function SeatExtraProvider({ resolve, children }: { resolve: (seat: Seat) => SeatExtra | null; children: ReactNode }) {
  return <Ctx.Provider value={resolve}>{children}</Ctx.Provider>;
}
export const useSeatExtra = () => useContext(Ctx);
