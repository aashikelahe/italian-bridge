/**
 * Connects the pure engine to React. Holds the authoritative GameState, applies human actions,
 * and schedules automatic steps (dealing, AI turns, trick collection) with readable pacing.
 * The UI renders from `view` — the human seat's private PlayerView — never from raw state
 * (except in developer mode).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Action, Difficulty, GameState, Seat } from '../engine/types';
import { applyAction } from '../engine/game';
import { getPlayerView } from '../engine/view';
import { secureRng } from '../engine/rng';
import { decideAIAction } from '../ai';
import { automaticAction } from '../ai/simulate';
import type { AnimSpeed } from './storage';
import { playCardTap, playSweep } from './sound';

export const HUMAN: Seat = 'C';

// Milliseconds at normal speed. Tuned to a relaxed, real-table pace.
const BASE_DELAY: Record<string, number> = {
  SHUFFLE: 1700, CUT: 1200, INITIAL_DEAL: 1100, BIDDING: 1500, TRUMP_RESERVATION: 1500,
  SECOND_DEAL: 1700, THIRD_DEAL: 1700, PLAYING: 1150, MANDATORY_REVEAL: 2500,
  TRICK_SHOW: 1500, TRICK_GATHER: 380, TRICK_SLIDE: 800,
};
const SPEED: Record<AnimSpeed, number> = { normal: 1, fast: 0.55, reduced: 0.6 };

export interface Sweep {
  seat: Seat;
  stage: 'gather' | 'slide';
}

export interface Driver {
  state: GameState;
  view: ReturnType<typeof getPlayerView>;
  dispatch: (a: Action) => string | null;
  sweeping: Sweep | null;
  paused: boolean;
  setPaused: (p: boolean) => void;
  error: string | null;
  clearError: () => void;
  /** Apply an action from elsewhere (an online player). Returns an error or null. */
  applyExternal: (a: Action) => string | null;
}

export function useGameDriver(initial: GameState, difficulty: Difficulty, anim: AnimSpeed, onChange: (s: GameState, prev: GameState) => void, me: Seat = HUMAN): Driver {
  const [state, setState] = useState(initial);
  const [sweeping, setSweeping] = useState<Sweep | null>(null);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rng = useRef(secureRng()).current;
  const stateRef = useRef(state);
  stateRef.current = state;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => setState(initial), [initial]);

  const apply = useCallback((a: Action): string | null => {
    const prev = stateRef.current;
    const r = applyAction(prev, a, rng);
    if (!r.ok) return r.error;
    if (a.type === 'PLAY_CARD') playCardTap();
    stateRef.current = r.state;
    setState(r.state);
    onChangeRef.current(r.state, prev);
    return null;
  }, [rng]);

  /** Human actions: validated by the engine, errors surfaced to the UI. */
  const dispatch = useCallback((a: Action) => {
    const err = apply(a);
    setError(err);
    return err;
  }, [apply]);

  // Automatic steps and AI turns.
  useEffect(() => {
    if (paused) return;
    const s = state;
    const k = SPEED[anim];
    const trickDone = s.phase === 'PLAYING' && s.currentTrick?.plays.length === 4;
    if (trickDone) {
      // Show the finished trick, gather the four cards, then slide them to the winner.
      const seat = s.currentTrick!.winner!;
      const tShow = BASE_DELAY.TRICK_SHOW * k;
      const tGather = tShow + BASE_DELAY.TRICK_GATHER * k;
      const tDone = tGather + BASE_DELAY.TRICK_SLIDE * k;
      const t1 = window.setTimeout(() => setSweeping({ seat, stage: 'gather' }), tShow);
      const t2 = window.setTimeout(() => { setSweeping({ seat, stage: 'slide' }); playSweep(); }, tGather);
      const t3 = window.setTimeout(() => { setSweeping(null); apply({ type: 'COLLECT_TRICK' }); }, tDone);
      return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
    }
    let action: Action | null = automaticAction(s);
    if (!action && s.currentPlayer && s.players[s.currentPlayer].type === 'ai') {
      action = decideAIAction(getPlayerView(s, s.currentPlayer), difficulty, rng);
    }
    if (!action) return;
    const delay = (BASE_DELAY[s.phase] ?? 600) * k;
    const t = window.setTimeout(() => {
      const err = apply(action!);
      if (err) console.error('Automatic action rejected', action, err);
    }, delay);
    return () => clearTimeout(t);
  }, [state, paused, anim, difficulty, apply, rng]);

  const view = useMemo(() => getPlayerView(state, me), [state, me]);
  const clearError = useCallback(() => setError(null), []);
  return { state, view, dispatch, sweeping, paused, setPaused, error, clearError, applyExternal: apply };
}
