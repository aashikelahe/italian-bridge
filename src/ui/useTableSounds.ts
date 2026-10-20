import { useEffect, useRef } from 'react';
import type { PlayerView } from '../engine/view';
import { teamOf } from '../engine/seating';
import { playBid, playDeal, playPass, playReveal, playRoundEnd, playShuffle, playYourTurn } from './sound';

/** Sound effects driven by what changes in the view (works the same offline and online). */
export function useTableSounds(view: PlayerView) {
  const prev = useRef<PlayerView | null>(null);
  useEffect(() => {
    const p = prev.current;
    prev.current = view;
    if (!p || p.gameId !== view.gameId) return;
    // Shuffling and dealing.
    if (view.phase !== p.phase) {
      if (view.phase === 'CUT' && p.phase === 'SHUFFLE') playShuffle();
      if (view.phase === 'BIDDING' && p.phase === 'INITIAL_DEAL') playDeal(5);
      if (view.phase === 'THIRD_DEAL' && p.phase === 'SECOND_DEAL') playDeal(4);
      if (view.phase === 'PLAYING' && p.phase === 'THIRD_DEAL') playDeal(4);
    }
    // Bids and passes.
    if (view.bidding.history.length > p.bidding.history.length && view.phase !== 'SHUFFLE') {
      const last = view.bidding.history[view.bidding.history.length - 1];
      if (last.action === 'bid' || last.action === 'forced') playBid(); else playPass();
    }
    // The trump is shown.
    if (view.trump.revealed && !p.trump.revealed) playReveal();
    // Your turn (bidding or playing).
    const myTurnNow = view.currentPlayer === view.seat && (view.phase === 'BIDDING' || view.phase === 'PLAYING' || view.phase === 'TRUMP_RESERVATION');
    const myTurnBefore = p.currentPlayer === p.seat && p.phase === view.phase;
    if (myTurnNow && !myTurnBefore) setTimeout(playYourTurn, 250);
    // Round over: did my side do well?
    if (view.roundHistory.length > p.roundHistory.length) {
      const r = view.roundHistory[view.roundHistory.length - 1];
      const mine = r.teams ? r.teams.find((t) => t.id === teamOf(view.seat))?.roundScore ?? 0 : r.players.find((x) => x.seat === view.seat)?.roundScore ?? 0;
      setTimeout(() => playRoundEnd(mine > 0), 600);
    }
  }, [view]);
}
