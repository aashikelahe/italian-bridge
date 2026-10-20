/**
 * Headless driver: advances the engine through automatic steps and AI turns.
 * Used by the automated tests and handy for balancing the AI.
 */
import type { Action, Difficulty, GameState, Rng, Seat } from '../engine/types';
import { applyAction } from '../engine/game';
import { getPlayerView } from '../engine/view';
import { decideAIAction } from './index';

/** The automatic (non-player) action for the current phase, if any. */
export function automaticAction(state: GameState): Action | null {
  switch (state.phase) {
    case 'SHUFFLE': return { type: 'SHUFFLE' };
    case 'INITIAL_DEAL': return { type: 'DEAL_INITIAL' };
    case 'SECOND_DEAL': return { type: 'DEAL_SECOND' };
    case 'THIRD_DEAL': return { type: 'DEAL_THIRD' };
    case 'MANDATORY_REVEAL': return { type: 'MANDATORY_REVEAL' };
    case 'PLAYING':
      return state.currentTrick && state.currentTrick.plays.length === 4 ? { type: 'COLLECT_TRICK' } : null;
    default: return null;
  }
}

/** One step for an all-AI table. Returns null when nothing can happen (ROUND_RESULT / MATCH_OVER). */
export function stepAI(state: GameState, difficulty: Record<Seat, Difficulty> | Difficulty, rng: Rng): { state: GameState; action: Action } | null {
  let action = automaticAction(state);
  if (!action && state.currentPlayer) {
    const seat = state.currentPlayer;
    const d = typeof difficulty === 'string' ? difficulty : difficulty[seat];
    action = decideAIAction(getPlayerView(state, seat), d, rng);
  }
  if (!action) return null;
  const r = applyAction(state, action, rng);
  if (!r.ok) throw new Error(`AI action ${JSON.stringify(action)} rejected in ${state.phase}: ${r.error}`);
  return { state: r.state, action };
}

/** Play a whole round with four AI players. */
export function playRoundAI(state: GameState, difficulty: Difficulty, rng: Rng, onStep?: (s: GameState, a: Action) => void): GameState {
  let s = state;
  for (let guard = 0; guard < 2000; guard++) {
    const r = stepAI(s, difficulty, rng);
    if (!r) return s;
    s = r.state;
    onStep?.(s, r.action);
  }
  throw new Error('Round did not finish');
}
