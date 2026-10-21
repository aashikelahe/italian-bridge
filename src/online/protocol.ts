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
  /** Team game: the two team names. */
  teamNames?: { X: string; Y: string };
}

export interface MemberInfo {
  id: string; name: string; online: boolean;
  /** Player ID chosen in the profile (unique on the server), without the @. */
  handle?: string | null;
  /** Picture: 'e:<emoji>' for a ready-made avatar, 'u:<version>' for an uploaded photo (GET /avatar/<id>), or null. */
  pic?: string | null;
  level?: number;
  /** In the voice chat, and whether their microphone is muted. */
  voice?: boolean;
  muted?: boolean;
  /** Voice session id: changes each time they (re)join the voice chat. */
  vs?: string;
}
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
  | { t: 'smack' }
  | { t: 'profile'; handle: string; avatar: string | null; level: number }
  | { t: 'voice'; on: boolean; muted: boolean; vs?: string }
  | { t: 'rtc'; to: string; data: unknown }
  | { t: 'lobby' }
  | { t: 'close' }
  | { t: 'ping' };

export type ServerMsg =
  | { t: 'welcome'; id: string; ice?: { urls: string | string[]; username?: string; credential?: string }[] }
  | { t: 'room'; room: RoomInfo }
  | { t: 'view'; view: PlayerView }
  | { t: 'throw'; from: Seat; to: Seat; e: string }
  | { t: 'smack'; seat: Seat }
  | { t: 'profile'; ok: boolean; handle: string; error?: string }
  | { t: 'rtc'; from: string; data: unknown }
  | { t: 'error'; msg: string }
  | { t: 'left'; reason: 'left' | 'closed' | 'missing' }
  | { t: 'pong' };

/** Milliseconds between automatic steps, at normal pace. Clients use the same numbers for animation. */
export const PACE_MS = {
  SHUFFLE: 1700, CUT: 1200, INITIAL_DEAL: 1100, BIDDING: 1500, TRUMP_RESERVATION: 1500,
  SECOND_DEAL: 1700, BONUS_CALL: 1600, THIRD_DEAL: 1700, PLAYING: 1150, MANDATORY_REVEAL: 2500,
  TRICK_SHOW: 1500, TRICK_GATHER: 380, TRICK_SLIDE: 800,
} as const;
export const PACE_FACTOR: Record<Pace, number> = { normal: 1, fast: 0.55 };

/** A player who is away this long on their turn is played by the computer until they return. */
export const AWAY_MS = 45_000;

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const normalizeCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
export const cleanName = (s: string) => s.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);

/** Player IDs: 3–16 characters, lowercase letters, digits and _. */
export const HANDLE_RE = /^[a-z0-9_]{3,16}$/;
export const normalizeHandle = (s: string) => s.toLowerCase().replace(/^@/, '').replace(/[^a-z0-9_]/g, '').slice(0, 16);
/** Ready-made avatars a player can choose instead of a photo. */
export const PRESET_AVATARS = ['🦁', '🐯', '🦊', '🐼', '🐸', '🐵', '🦄', '🐲', '🦉', '🐙', '🐺', '🐻', '🐨', '🦅', '🐬', '🦋', '👑', '🎩', '😎', '🤠', '🥷', '🧙', '🤖', '👻'] as const;
/** Largest uploaded photo accepted (as a data: URL). Photos are resized to 160×160 JPEG in the browser first. */
export const MAX_PHOTO_CHARS = 48_000;
