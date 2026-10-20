import type { GameMode, Seat, TeamId } from './types';

/** Clockwise turn order around the table: Top → Right → Bottom → Left. */
export const SEATS: Seat[] = ['A', 'B', 'C', 'D'];

export const SEAT_POSITION: Record<Seat, 'top' | 'right' | 'bottom' | 'left'> = {
  A: 'top', B: 'right', C: 'bottom', D: 'left',
};

export function nextSeat(seat: Seat, steps = 1): Seat {
  const i = SEATS.indexOf(seat);
  return SEATS[(((i + steps) % 4) + 4) % 4];
}

export function prevSeat(seat: Seat): Seat {
  return nextSeat(seat, -1);
}

/** Seats in turn order starting from `first`. */
export function seatsFrom(first: Seat): Seat[] {
  return [0, 1, 2, 3].map((k) => nextSeat(first, k));
}

/** Diagonal partners: A–C (Team X) and B–D (Team Y). */
export function partnerOf(seat: Seat): Seat {
  return nextSeat(seat, 2);
}

export function teamOf(seat: Seat): TeamId {
  return seat === 'A' || seat === 'C' ? 'X' : 'Y';
}

export function areOpponents(a: Seat, b: Seat, mode: GameMode): boolean {
  if (a === b) return false;
  return mode === 'individual' ? true : teamOf(a) !== teamOf(b);
}
