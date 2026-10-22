/** Emojis that can be thrown on a Friends table (shared by the browser and the server). */
export const EMOJIS = ['❤️', '😘', '😂', '👏', '🔥', '💩', '🖕', '🍅', '🤡', '🥚', '😭', '🐔'] as const;
export const KIND = new Set<string>(['❤️', '😘', '👏', '🔥']);
export const MEAN = ['😂', '💩', '🖕', '🍅', '🤡', '🥚', '🐔'];
export const isEmoji = (e: unknown): e is string => typeof e === 'string' && (EMOJIS as readonly string[]).includes(e);
