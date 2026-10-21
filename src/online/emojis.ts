/** Emojis that can be thrown on a Friends table (shared by the browser and the server). */
export const FUN_EMOJIS = ['❤️', '😘', '😂', '👏', '🔥', '💩', '🖕', '🍅', '🤡', '🥚', '😭', '🐔'] as const;
/** The 18+ tab: cheeky, for grown-up friends' tables. */
export const ADULT_EMOJIS = ['🍆', '🍑', '💦', '👅', '🔞', '🥵', '🍌', '💋', '🫦', '🤤', '🍒', '👙'] as const;
export const EMOJIS = [...FUN_EMOJIS, ...ADULT_EMOJIS] as const;
export const KIND = new Set<string>(['❤️', '😘', '👏', '🔥', '💋']);
export const MEAN = ['😂', '💩', '🖕', '🍅', '🤡', '🥚', '🐔'];
export const isEmoji = (e: unknown): e is string => typeof e === 'string' && (EMOJIS as readonly string[]).includes(e);
