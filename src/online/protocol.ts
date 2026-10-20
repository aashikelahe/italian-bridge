/**
 * Messages between the browser and the game server (JSON over one WebSocket).
 * The server owns every game: it deals, keeps all hands, checks every move and sends each
 * player only their own view.
 */
import type { Action, Difficulty, GameMode, RuleConfig, Seat } from '../engine/types';
import type { PlayerView } from '../engine/view';

export type Pace = 'normal' | 'fast';

export interface RoomSettings {
  mode: GameMode;
  matchTarget: number;
  tableType: 'regular' | 'friends';
  difficulty: Difficulty;
  pace: Pace;
  rules: RuleConfig;
}

export interface MemberInfo { id: string; name: string; online: boolean }
export interface ChatMsg { id: number; from: string; name: string; text: string; at: number }

export interface RoomInfo {
  code: string;
  hostId: string;
  status: 'lobby' | 'playing' | 'over';
  settings: RoomSettings;
  /** Lobby seat choices (before start) or the fixed seating (during a game). null = empty / computer. */
  seats: Record<Seat, string | null>;
  members: MemberInfo[];
  chat: ChatMsg[];
  /** Seats whose player is away and being played by the computer for now. */
  autoplay: Seat[];
}

export type ClientMsg =
  | { t: 'hello'; token: string; name: string }
  | { t: 'rename'; name: string }
  | { t: 'create'; settings: RoomSettings }
  | { t: 'join'; code: string }
  | { t: 'leave' }
  | { t: 'sit'; seat: Seat }
  | { t: 'stand' }
  | { t: 'chat'; text: string }
  | { t: 'start' }
  | { t: 'act'; action: Action }
  | { t: 'throw'; to: Seat; e: string }
  | { t: 'lobby' }
  | { t: 'close' }
  | { t: 'ping' };

export type ServerMsg =
  | { t: 'welcome'; id: string }
  | { t: 'room'; room: RoomInfo }
  | { t: 'view'; view: PlayerView }
  | { t: 'throw'; from: Seat; to: Seat; e: string }
  | { t: 'error'; msg: string }
  | { t: 'left'; reason: 'left' | 'closed' | 'missing' }
  | { t: 'pong' };

/** Milliseconds between automatic steps, at normal pace. Clients use the same numbers for animation. */
export const PACE_MS = {
  SHUFFLE: 1700, CUT: 1200, INITIAL_DEAL: 1100, BIDDING: 1500, TRUMP_RESERVATION: 1500,
  SECOND_DEAL: 1700, THIRD_DEAL: 1700, PLAYING: 1150, MANDATORY_REVEAL: 2500,
  TRICK_SHOW: 1500, TRICK_GATHER: 380, TRICK_SLIDE: 800,
} as const;
export const PACE_FACTOR: Record<Pace, number> = { normal: 1, fast: 0.55 };

/** A player who is away this long on their turn is played by the computer until they return. */
export const AWAY_MS = 45_000;

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const normalizeCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
export const cleanName = (s: string) => s.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
