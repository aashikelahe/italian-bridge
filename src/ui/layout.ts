import type { Seat } from '../engine/types';
import { SEATS } from '../engine/seating';

export type Pos = 'top' | 'right' | 'bottom' | 'left';

/**
 * Where a seat sits on THIS viewer's screen. The viewer is always at the bottom; play goes
 * clockwise (bottom → left → top → right), so the next player is on the left.
 */
export function relPos(me: Seat, seat: Seat): Pos {
  const d = (SEATS.indexOf(seat) - SEATS.indexOf(me) + 4) % 4;
  return (['bottom', 'left', 'top', 'right'] as Pos[])[d];
}

/** The other three seats in the order top, left, right for rendering. */
export function otherSeats(me: Seat): Seat[] {
  return SEATS.filter((s) => s !== me);
}
