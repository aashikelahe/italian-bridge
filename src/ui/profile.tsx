/**
 * Your player profile: a unique player ID, and a photo or a ready-made avatar.
 * Kept in this browser; the game server learns it whenever you play online.
 */
import { useSyncExternalStore, type CSSProperties } from 'react';
import { MAX_PHOTO_CHARS, PRESET_AVATARS } from '../online/protocol';
import type { Stats } from './storage';

export interface Profile {
  /** Player ID without the @ (empty until chosen). */
  handle: string;
  /** 'e:<emoji>' or a data:image/jpeg URL, or null. */
  avatar: string | null;
}

const KEY = 'ib.profile.v1';
const EMPTY: Profile = { handle: '', avatar: null };
let current: Profile = load();
const listeners = new Set<() => void>();

function load(): Profile {
  try { const raw = localStorage.getItem(KEY); return raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY; } catch { return EMPTY; }
}
export function saveProfile(p: Profile) {
  current = { ...p };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* no storage */ }
  listeners.forEach((l) => l());
}
export function useProfile(): Profile {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => current);
}

/** Experience and level from your local statistics. */
export function levelOf(st: Stats): { level: number; xp: number; from: number; to: number } {
  const xp = st.matchesPlayed * 30 + st.matchesWon * 70 + st.contractsMade * 10 + st.passesMade * 4 + st.roundsPlayed * 3;
  const level = Math.min(99, Math.floor(Math.sqrt(xp / 40)) + 1);
  return { level, xp, from: 40 * (level - 1) ** 2, to: 40 * level ** 2 };
}

/** Read a photo file, crop it to a square and shrink it to a small JPEG data URL. */
export async function photoToDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error('bad image'));
      im.src = url;
    });
    for (const [size, q] of [[160, 0.82], [128, 0.7], [96, 0.6]] as const) {
      const c = document.createElement('canvas');
      c.width = size; c.height = size;
      const g = c.getContext('2d')!;
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      g.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
      const data = c.toDataURL('image/jpeg', q);
      if (data.length <= MAX_PHOTO_CHARS) return data;
    }
    throw new Error('too big');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const BOT_AVATARS = ['🤖', '🦉', '🦊', '🐼', '🐯', '🐸'];
export function botEmoji(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return BOT_AVATARS[h % BOT_AVATARS.length];
}

export interface PicInfo { emoji?: string; src?: string }

/** The picture inside an avatar circle: photo, emoji or initials. */
export function Face({ pic, name, color, className = '', style }: { pic: PicInfo | null | undefined; name: string; color: string; className?: string; style?: CSSProperties }) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = parts.length === 0 ? '?' : ((Array.from(parts[0])[0] ?? '') + (parts.length > 1 ? Array.from(parts[parts.length - 1])[0] ?? '' : '')).toUpperCase();
  return (
    <span className={`pface ${pic?.src ? 'photo' : pic?.emoji ? 'emoji' : 'initials'} ${className}`} style={{ ['--c' as string]: color, ...style } as CSSProperties} aria-hidden>
      {pic?.src ? <img src={pic.src} alt="" draggable={false} /> : pic?.emoji ? <span>{pic.emoji}</span> : initials}
    </span>
  );
}

export function picFromAvatar(avatar: string | null): PicInfo | null {
  if (!avatar) return null;
  if (avatar.startsWith('e:')) return { emoji: avatar.slice(2) };
  if (avatar.startsWith('data:image/')) return { src: avatar };
  return null;
}

export { PRESET_AVATARS };

const COLORS = ['#e0a33a', '#4fb3c9', '#d0607a', '#7bc96f', '#a98be0', '#e07b4f'];
export function colorFor(name: string, salt = ''): string {
  let h = 7;
  for (const ch of salt + name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}
