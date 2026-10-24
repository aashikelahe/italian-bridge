import { useEffect, useState, type CSSProperties } from 'react';
import type { Action, Card, GameState, Seat } from '../../engine/types';
import type { PlayerView } from '../../engine/view';
import { sortHand, SUIT_SYMBOL, type SortPref } from '../../engine/cards';
import { currentWinningPlay } from '../../engine/rules';
import { partnerOf, teamOf } from '../../engine/seating';
import { CardBack, CardFace } from './Card';
import type { Sweep } from '../useGameDriver';
import { callOf, teamContractMode } from './ScorePanel';
import { useI18n, useSeatName } from '../i18n';
import { relPos } from '../layout';
import { playSelect } from '../sound';

import { Face, colorFor } from '../profile';
import { useSeatExtra } from '../seatExtras';
import { TurnRing } from '../turnClock';

/**
 * A player around the table: round avatar, name, trick badge (won/needed), call, dealer chip,
 * turn glow, speech bubble for chat, and a small stack of card backs for opponents.
 */
export function Avatar({ view, seat, devHand, won, hit, bubble, onPick }: {
  view: PlayerView; seat: Seat; devHand?: Card[]; won?: boolean; hit?: boolean; bubble?: string | null; onPick?: (seat: Seat) => void;
}) {
  const i = useI18n();
  const seatName = useSeatName(view.players);
  const p = view.players[seat];
  const pos = relPos(view.seat, seat);
  const name = seatName(seat);
  const playing = ['PLAYING', 'MANDATORY_REVEAL', 'ROUND_RESULT'].includes(view.phase);
  const call = callOf(view, seat);
  const tc = teamContractMode(view);
  // Trick badge: in team play, the team's tricks against the team's target.
  let won_ = p.tricksWon;
  let target: number | null = call === null ? null : call === 'pass' ? view.config.passTarget : call;
  if (tc && view.teams) {
    const t = view.teams.find((x) => x.id === teamOf(seat))!;
    won_ = view.players[t.members[0]].tricksWon + view.players[t.members[1]].tricksWon;
  }
  if (!playing) target = call === null ? null : target;
  const badge = playing ? `${i.num(won_)}/${target != null ? i.num(target) : '–'}` : call === null ? (view.phase === 'BIDDING' ? '…' : '') : call === 'pass' ? i.t('Pass') : i.num(call);
  const isTurn = view.currentPlayer === seat;
  const extra = useSeatExtra()(seat);
  const Tag = onPick && seat !== view.seat ? 'button' : 'div';
  const fan = Math.min(p.handCount, 13);
  return (
    <div className={`av av-${pos} ${seat === view.seat ? 'me' : view.mode === 'team' && seat === partnerOf(view.seat) ? 'ally' : 'foe'} ${isTurn ? 'turn' : ''} ${won ? 'won' : ''} ${hit ? 'hit' : ''} ${extra?.speaking ? 'speaking' : ''} ${p.team ? `team-${p.team}` : ''}`} data-seat={seat}>
      <Tag className="av-plate" {...(Tag === 'button' ? { type: 'button', onClick: () => onPick!(seat), title: i.t('Throw something at {p}', { p: name }) } : {})}>
        <span className="av-ring" aria-hidden><Face pic={extra?.pic} name={name} color={colorFor(p.name, seat)} className="av-face" /><TurnRing seat={seat} mine={seat === view.seat} /></span>
        {extra?.voice && <span className={`av-mic ${extra.muted ? 'off' : ''} ${extra.link && extra.link !== 'connected' ? 'linking' : ''}`} title={extra.link && extra.link !== 'connected' ? i.t('connecting…') : extra.muted ? i.t('Microphone off') : i.t('In voice chat')} aria-hidden>{extra.link && extra.link !== 'connected' ? '⏳' : extra.muted ? '🔇' : '🎙'}</span>}
        {badge && <span className={`av-badge ${playing && target != null && won_ >= target ? 'made' : ''}`}>{badge}</span>}
        {view.dealer === seat && <span className="av-dealer" title={i.t('Dealer')}>{i.lang === 'bn' ? 'ড' : 'D'}</span>}
        <span className="av-name">{name}{view.trump.bidder === seat && <em className="av-bidder" title={i.t('bidder')}>★</em>}</span>
      </Tag>
      {won && <span className="won-badge" aria-hidden>{i.t('+1 trick')}</span>}
      {bubble && <span className="av-bubble" role="status">{bubble}</span>}
      {seat !== view.seat && fan > 0 && (
        <div className="av-cards" aria-label={i.t(fan === 1 ? '{n} card' : '{n} cards', { n: fan })}>
          {devHand
            ? sortHand(devHand).map((c) => <CardFace key={c.id} card={c} size="sm" />)
            : Array.from({ length: Math.min(fan, 5) }, (_, k) => <CardBack key={k} size="xs" />)}
          {!devHand && <span className="av-count">{i.num(fan)}{p.hasReservedCard ? '+1' : ''}</span>}
        </div>
      )}
    </div>
  );
}

export function TrickArea({ view, sweeping, smackedSeat }: { view: PlayerView; sweeping: Sweep | null; smackedSeat: Seat | null }) {
  const i = useI18n();
  const seatName = useSeatName(view.players);
  const t = view.currentTrick;
  const winning = t && t.plays.length > 0 && t.plays.length < 4 ? currentWinningPlay(t.plays, view.trump.revealed ? view.trump.suit : null) : null;
  return (
    <div className={`trick ${sweeping ? `${sweeping.stage} to-${relPos(view.seat, sweeping.seat)}` : ''}`} aria-live="polite" aria-label={i.t('Current trick')}>
      {t?.plays.map((pl) => {
        const isWinner = t.winner === pl.seat || winning?.seat === pl.seat;
        return (
          <div key={pl.card.id} className={`played from-${relPos(view.seat, pl.seat)} ${isWinner ? 'winning' : ''} ${smackedSeat === pl.seat ? 'smacked' : ''}`}>
            <CardFace card={pl.card} size="md" />
          </div>
        );
      })}
      {t && t.plays.length === 0 && (
        <p className="trick-hint">{t.leader === view.seat ? i.t('Your lead') : i.t('{p} leads', { p: seatName(t.leader) })}</p>
      )}
      {t?.winner && <p className="trick-win">{t.winner === view.seat ? i.t('You win the trick') : i.t('{p} wins the trick', { p: seatName(t.winner) })}</p>}
    </div>
  );
}

export function HumanHand({ view, dispatch, sort }: { view: PlayerView; dispatch: (a: Action) => string | null; sort: SortPref }) {
  const i = useI18n();
  const seatName = useSeatName(view.players);
  const [selected, setSelected] = useState<string | null>(null);
  const myTurn = view.legalCardIds.length > 0;
  useEffect(() => { if (!myTurn) setSelected(null); }, [myTurn]);
  const cards = sortHand(view.hand, sort);
  const led = view.currentTrick?.ledSuit;
  const play = (id: string) => { setSelected(null); dispatch({ type: 'PLAY_CARD', seat: view.seat, cardId: id }); };

  let hint = '';
  if (view.phase === 'PLAYING') {
    if (myTurn) {
      hint = !led ? i.t('Your lead — choose any card.')
        : view.hand.some((c) => c.suit === led) ? i.t('Your turn — follow {suit} {sym}.', { suit: i.suit(led), sym: SUIT_SYMBOL[led] })
        : i.t('You have no {suit} — play any card.', { suit: i.suit(led) });
      if (view.mustPlayTrump && view.trump.suit && view.hand.some((c) => c.suit === view.trump.suit)) {
        hint = i.t('The trump is shown — you must play a {suit} card.', { suit: i.suit(view.trump.suit) });
      }
      if (selected) hint = i.t('Tap the raised card again to play it.');
    } else if (view.currentPlayer) hint = i.t('Waiting for {p}…', { p: seatName(view.currentPlayer) });
  }

  return (
    <div className="hand-wrap">
      {hint && <p className={`hand-hint ${myTurn ? 'go' : ''}`} role="status">{hint}</p>}
      <div className={`hand ${myTurn ? 'my-turn' : ''}`} role="group" aria-label={i.t('Your hand')} style={{ ['--n' as string]: Math.max(cards.length, 2) } as CSSProperties}>
        {cards.map((c, k) => {
          const mid = k - (cards.length - 1) / 2;
          const spread = Math.min(2.4, 26 / Math.max(cards.length, 1));
          const fan = { ['--i' as string]: k, ['--rot' as string]: `${(mid * spread).toFixed(2)}deg`, ['--lift' as string]: `${(Math.abs(mid) ** 1.6 * 0.9).toFixed(1)}px` } as CSSProperties;
          const legal = view.legalCardIds.includes(c.id);
          const reason = myTurn && !legal && led ? i.t('You must follow {suit}', { suit: i.suit(led) }) : '';
          return (
            <button
              key={c.id}
              className={`card-btn in-hand ${myTurn ? (legal ? 'legal' : 'illegal') : ''} ${selected === c.id ? 'selected' : ''}`}
              style={fan}
              disabled={!myTurn || !legal}
              aria-pressed={selected === c.id}
              aria-label={`${i.cardName(c)}${reason ? ` — ${reason}` : ''}`}
              title={reason || undefined}
              onClick={() => { if (selected === c.id) play(c.id); else { setSelected(c.id); playSelect(); } }}
              onDoubleClick={() => play(c.id)}
            >
              <CardFace card={c} size="lg" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function devHands(state: GameState, me: Seat): Partial<Record<Seat, Card[]>> {
  const out: Partial<Record<Seat, Card[]>> = {};
  for (const s of ['A', 'B', 'C', 'D'] as Seat[]) if (s !== me) out[s] = state.players[s].hand;
  return out;
}
