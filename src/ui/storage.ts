import type { Difficulty, GameState, GameMode, RuleConfig } from '../engine/types';
import type { SortPref } from '../engine/cards';
import type { Lang } from './i18n';
import { DEFAULT_RULES } from '../engine/config';

export type AnimSpeed = 'normal' | 'fast' | 'reduced';

export interface Settings {
  playerName: string;
  mode: GameMode;
  difficulty: Difficulty;
  matchTarget: number;
  teamNames: { X: string; Y: string };
  anim: AnimSpeed;
  sort: SortPref;
  devMode: boolean;
  sound: boolean;
  lang: Lang;
  /** Team games: 'friends' adds emoji throwing and colloquial Bangla names. */
  tableType: 'regular' | 'friends';
  /** Name used when playing online. */
  onlineNick: string;
  rules: RuleConfig;
  /** Table look. */
  theme: TableTheme;
  cardBack: CardBackStyle;
  /** Vibrate on your turn and on smacks (phones). */
  haptics: boolean;
}

export type TableTheme = 'emerald' | 'royal' | 'crimson' | 'midnight';
export type CardBackStyle = 'ruby' | 'navy' | 'gold' | 'carbon';
export const TABLE_THEMES: TableTheme[] = ['emerald', 'royal', 'crimson', 'midnight'];
export const CARD_BACKS: CardBackStyle[] = ['ruby', 'navy', 'gold', 'carbon'];

export const DEFAULT_SETTINGS: Settings = {
  playerName: 'You',
  mode: 'team',
  difficulty: 'normal',
  matchTarget: 30,
  teamNames: { X: 'Your team', Y: 'Their team' },
  anim: 'normal',
  sort: 'suitThenRank',
  devMode: false,
  sound: true,
  lang: 'en',
  tableType: 'regular',
  onlineNick: '',
  rules: DEFAULT_RULES,
  theme: 'emerald',
  cardBack: 'ruby',
  haptics: true,
};

export interface Stats {
  matchesPlayed: number;
  matchesWon: number;
  roundsPlayed: number;
  contractsBid: number;
  contractsMade: number;
  passesMade: number;
  passesTotal: number;
  bestTotal: number | null;
}

export const EMPTY_STATS: Stats = {
  matchesPlayed: 0, matchesWon: 0, roundsPlayed: 0, contractsBid: 0, contractsMade: 0, passesMade: 0, passesTotal: 0, bestTotal: null,
};

export interface SavedGame {
  state: GameState;
  difficulty: Difficulty;
  friends?: boolean;
  savedAt: number;
}

const KEY = { settings: 'ib.settings.v2', save: 'ib.save.v2', stats: 'ib.stats.v1' };

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the game still works, it just won't persist */
  }
}

export const storage = {
  loadSettings(): Settings {
    const s = read<Partial<Settings>>(KEY.settings);
    return { ...DEFAULT_SETTINGS, ...(s ?? {}), rules: {
      ...DEFAULT_RULES, ...(s?.rules ?? {}),
      // The core numbers are not house rules: always the current ones.
      minBid: DEFAULT_RULES.minBid, maxBid: DEFAULT_RULES.maxBid, bonusBid: DEFAULT_RULES.bonusBid, bonusPoints: DEFAULT_RULES.bonusPoints,
      passTarget: DEFAULT_RULES.passTarget, passPoints: DEFAULT_RULES.passPoints,
    }, teamNames: { ...DEFAULT_SETTINGS.teamNames, ...(s?.teamNames ?? {}) } };
  },
  saveSettings: (s: Settings) => write(KEY.settings, s),
  loadGame: (): SavedGame | null => {
    const g = read<SavedGame>(KEY.save);
    // Games saved before the 10 (Bonus) rule switch to it.
    if (g?.state?.config && g.state.config.bonusBid === undefined) {
      g.state.config = { ...g.state.config, maxBid: 10, bonusBid: 10, bonusPoints: 13 };
    }
    return g && g.state?.version === 1 && g.state.phase !== 'MATCH_OVER' ? g : null;
  },
  saveGame: (g: SavedGame | null) => write(KEY.save, g),
  loadStats: (): Stats => ({ ...EMPTY_STATS, ...(read<Stats>(KEY.stats) ?? {}) }),
  saveStats: (s: Stats) => write(KEY.stats, s),
};
