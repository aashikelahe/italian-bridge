import { useCallback, useEffect, useRef } from 'react';
import type { Difficulty, GameState, Seat } from '../../engine/types';
import { useGameDriver, HUMAN } from '../useGameDriver';
import { devHands } from '../components/Table';
import { storage, type Settings } from '../storage';
import { teamOf, areOpponents } from '../../engine/seating';
import { TableScreen } from './TableScreen';
import { I18nProvider } from '../i18n';
import { KIND, MEAN, useReactions } from '../reactions';

interface Props {
  initial: GameState;
  difficulty: Difficulty;
  friends: boolean;
  settings: Settings;
  onExit: () => void;
  onNewGame: () => void;
  onToggleLang: () => void;
}

function recordStats(s: GameState, prev: GameState) {
  if (prev.phase === s.phase) return;
  const st = storage.loadStats();
  if (s.phase === 'ROUND_RESULT') {
    const me = s.players[HUMAN];
    st.roundsPlayed++;
    const tc = s.teams && s.config.teamScoring === 'teamContract';
    const mine = tc ? s.teams!.find((t) => t.id === teamOf(HUMAN))!.roundScore : me.roundScore;
    const bidding = tc ? teamOf(s.trump.bidder!) === teamOf(HUMAN) : me.bid.kind === 'bid';
    if (bidding) { st.contractsBid++; if (mine > 0) st.contractsMade++; }
    else { st.passesTotal++; if (mine > 0) st.passesMade++; }
  } else if (s.phase === 'MATCH_OVER') {
    st.matchesPlayed++;
    const w = s.matchWinner!;
    if ((w.kind === 'team' && teamOf(HUMAN) === w.id) || (w.kind === 'player' && w.seat === HUMAN)) st.matchesWon++;
    const mine = s.teams ? s.teams.find((t) => t.id === teamOf(HUMAN))!.cumulativeScore : s.players[HUMAN].cumulativeScore;
    st.bestTotal = st.bestTotal == null ? mine : Math.max(st.bestTotal, mine);
  } else return;
  storage.saveStats(st);
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

export function GameScreen({ initial, difficulty, friends, settings, onExit, onNewGame, onToggleLang }: Props) {
  const onChange = useCallback((s: GameState, prev: GameState) => {
    recordStats(s, prev);
    storage.saveGame(s.phase === 'MATCH_OVER' ? null : { state: s, difficulty, friends, savedAt: Date.now() });
  }, [difficulty, friends]);
  const d = useGameDriver(initial, difficulty, settings.anim, onChange);
  const { reactions, hits, add } = useReactions();
  const isAI = useCallback((s: Seat) => d.state.players[s].type === 'ai', [d.state.players]);
  const answer = useAIThrows(d.state, friends, isAI, add);

  return (
    <I18nProvider lang={settings.lang} friends={friends}>
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
      />
    </I18nProvider>
  );
}
