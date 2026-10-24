import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TurnClockProvider, type TurnClock } from '../turnClock';
import { TIMED_PHASES } from '../../online/protocol';
import { getPlayerView } from '../../engine/view';
import { decideAIAction } from '../../ai';
import { botEmoji, levelOf, picFromAvatar, useProfile } from '../profile';
import { SeatExtraProvider } from '../seatExtras';
import type { Difficulty, GameState, Seat } from '../../engine/types';
import { useGameDriver, HUMAN } from '../useGameDriver';
import { devHands } from '../components/Table';
import { storage, type Settings } from '../storage';
import { teamOf, areOpponents } from '../../engine/seating';
import { TableScreen } from './TableScreen';
import { I18nProvider } from '../i18n';
import { KIND, MEAN, useReactions, useSmacks } from '../reactions';
import { currentWinningPlay } from '../../engine/rules';

interface Props {
  initial: GameState;
  difficulty: Difficulty;
  friends: boolean;
  settings: Settings;
  onExit: () => void;
  onNewGame: () => void;
  onToggleLang: () => void;
  onToggleSound: () => void;
  onChangeSettings: (s: Settings) => void;
}

const pickOne = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];

/**
 * Computer players' emoji habits on a Friends table: taunt after winning a trick, cheer a
 * partner, and answer what is thrown at them. Rate-limited so the table stays playable.
 */
export function useAIThrows(state: GameState, enabled: boolean, isAI: (s: Seat) => boolean, add: (r: { from: Seat; to: Seat; e: string }) => void) {
  const last = useRef(0);
  const prev = useRef(state);
  const fire = useCallback((from: Seat, to: Seat, e: string, delay = 500) => {
    const now = Date.now();
    if (now - last.current < 3000) return;
    last.current = now;
    window.setTimeout(() => add({ from, to, e }), delay);
  }, [add]);

  useEffect(() => {
    const p = prev.current;
    prev.current = state;
    if (!enabled) return;
    // A trick was just won.
    if (state.completedTricks.length > p.completedTricks.length) {
      const tr = state.completedTricks[state.completedTricks.length - 1];
      const w = tr.winner;
      if (Math.random() < 0.3) {
        if (isAI(w)) {
          const victims = (['A', 'B', 'C', 'D'] as Seat[]).filter((s) => areOpponents(w, s, state.mode));
          fire(w, pickOne(victims), pickOne(MEAN));
        } else {
          const losers = (['A', 'B', 'C', 'D'] as Seat[]).filter((s) => isAI(s) && areOpponents(s, w, state.mode));
          if (losers.length) fire(pickOne(losers), w, pickOne(['🍅', '🥚', '😭', '🐔']));
        }
      }
    }
    // Round result: the bidding side celebrates or gets laughed at.
    if (state.phase === 'ROUND_RESULT' && p.phase !== 'ROUND_RESULT' && state.trump.bidder) {
      const b = state.trump.bidder;
      const made = state.roundHistory[state.roundHistory.length - 1]?.teams?.find((t) => t.id === teamOf(b))?.roundScore ?? state.players[b].roundScore;
      const opp = (['A', 'B', 'C', 'D'] as Seat[]).filter((s) => isAI(s) && areOpponents(s, b, state.mode));
      if (made < 0 && opp.length) fire(pickOne(opp), b, pickOne(['😂', '🤡', '💩']), 900);
      else if (made > 0 && isAI(b)) fire(b, pickOne((['A', 'B', 'C', 'D'] as Seat[]).filter((s) => s !== b)), pickOne(['🔥', '😘', '👏']), 900);
    }
  }, [state, enabled, isAI, fire]);

  /** Called when someone throws at an AI: sometimes it answers back. */
  return useCallback((from: Seat, to: Seat, e: string) => {
    if (!enabled || !isAI(to) || Math.random() > 0.5) return;
    const reply = KIND.has(e) ? pickOne(['❤️', '😘', '👏']) : pickOne(MEAN);
    last.current = 0;
    fire(to, from, reply, 1500);
  }, [enabled, isAI, fire]);
}

/** Computer players sometimes smack a strong card that is winning the trick. */
function useAISmacks(state: GameState, add: (s: Seat) => void) {
  const last = useRef(0);
  const seen = useRef('');
  useEffect(() => {
    const t = state.currentTrick;
    const n = t?.plays.length ?? 0;
    const key = t ? `${t.index}:${n}` : '';
    if (key === seen.current) return;
    seen.current = key;
    if (!t) return;
    if (n === 0) return;
    const play = t.plays[n - 1];
    if (state.players[play.seat].type !== 'ai') return;
    const trump = state.trump.revealed ? state.trump.suit : null;
    const win = currentWinningPlay(t.plays, trump);
    if (win?.seat !== play.seat) return;
    const strong = play.card.strength >= 13 || (trump !== null && play.card.suit === trump);
    if (!strong || Math.random() > 0.3 || Date.now() - last.current < 6000) return;
    last.current = Date.now();
    window.setTimeout(() => add(play.seat), 350);
  }, [state, add]);
}

/** The move timer against the computer: when your time runs out, the computer moves for you. */
function useOfflineTurnTimer(state: GameState, secs: number, paused: boolean, dispatch: (a: import('../../engine/types').Action) => string | null, difficulty: Difficulty): TurnClock | null {
  const [clock, setClock] = useState<TurnClock | null>(null);
  useEffect(() => {
    const myMove = secs > 0 && !paused && state.currentPlayer === HUMAN && (TIMED_PHASES as readonly string[]).includes(state.phase)
      && !(state.phase === 'PLAYING' && state.currentTrick?.plays.length === 4);
    if (!myMove) { setClock(null); return; }
    const total = secs * 1000;
    setClock({ seat: HUMAN, endsAt: Date.now() + total, total });
    const t = window.setTimeout(() => {
      const a = decideAIAction(getPlayerView(state, HUMAN), difficulty, Math.random);
      if (a) dispatch(a);
    }, total + 200);
    return () => window.clearTimeout(t);
  }, [state, secs, paused, dispatch, difficulty]);
  return clock;
}

export function GameScreen({ initial, difficulty, friends, settings, onExit, onNewGame, onToggleLang, onToggleSound, onChangeSettings }: Props) {
  const onChange = useCallback((s: GameState) => {
    storage.saveGame(s.phase === 'MATCH_OVER' ? null : { state: s, difficulty, friends, savedAt: Date.now() });
  }, [difficulty, friends]);
  const d = useGameDriver(initial, difficulty, settings.anim, onChange);
  const { reactions, hits, add } = useReactions();
  const isAI = useCallback((s: Seat) => d.state.players[s].type === 'ai', [d.state.players]);
  const answer = useAIThrows(d.state, friends, isAI, add);
  const sm = useSmacks();
  useAISmacks(d.state, sm.add);
  const clock = useOfflineTurnTimer(d.state, settings.turnTimer ?? 0, d.paused, d.dispatch, difficulty);

  const profile = useProfile();
  const level = useMemo(() => levelOf(storage.loadStats()).level, []);
  const extra = useCallback((seat: Seat) => (seat === HUMAN
    ? { pic: picFromAvatar(profile.avatar), handle: profile.handle || null, level }
    : { pic: { emoji: botEmoji(d.state.players[seat].name) } }), [profile.avatar, profile.handle, level, d.state.players]);
  return (
    <I18nProvider lang={settings.lang} friends={friends}>
      <SeatExtraProvider resolve={extra}>
      <TurnClockProvider clock={clock}>
      <TableScreen
        view={d.view}
        dispatch={d.dispatch}
        sweeping={d.sweeping}
        error={d.error}
        clearError={d.clearError}
        settings={settings}
        onExit={onExit}
        onNewGame={onNewGame}
        paused={d.paused}
        onTogglePause={() => d.setPaused(!d.paused)}
        devHands={settings.devMode ? devHands(d.state, HUMAN) : undefined}
        friends={friends}
        reactions={reactions}
        hits={hits}
        onThrow={(to, e) => { add({ from: HUMAN, to, e }); answer(HUMAN, to, e); }}
        onToggleLang={onToggleLang}
        onToggleSound={onToggleSound}
        onChangeSettings={onChangeSettings}
        smacks={sm.smacks}
        onSmack={() => sm.add(HUMAN)}
      />
      </TurnClockProvider>
      </SeatExtraProvider>
    </I18nProvider>
  );
}
