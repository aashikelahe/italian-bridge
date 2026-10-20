import { useEffect, useState, type CSSProperties } from 'react';
import type { Action, Card, GameState, Seat } from '../../engine/types';
import type { PlayerView } from '../../engine/view';
import { sortHand, SUIT_SYMBOL, type SortPref } from '../../engine/cards';
import { currentWinningPlay } from '../../engine/rules';
import { teamOf } from '../../engine/seating';
import { CardBack, CardFace } from './Card';
import type { Sweep } from '../useGameDriver';
import { callOf, teamContractMode } from './ScorePanel';
import { useI18n, useSeatName } from '../i18n';
import { relPos } from '../layout';

const AVATAR_COLORS = ['#e0a33a', '#4fb3c9', '#d0607a', '#7bc96f', '#a98be0', '#e07b4f'];
function colorFor(name: string, seat: Seat): string {
  let h = seat.charCodeAt(0);
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = Array.from(parts[0])[0] ?? '?';
  const second = parts.length > 1 ? Array.from(parts[parts.length - 1])[0] ?? '' : '';
  return (first + second).toUpperCase();
}

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
  const Tag = onPick && seat !== view.seat ? 'button' : 'div';
  const fan = Math.min(p.handCount, 13);
  return (
    <div className={`av av-${pos} ${isTurn ? 'turn' : ''} ${won ? 'won' : ''} ${hit ? 'hit' : ''} ${p.team ? `team-${p.team}` : ''}`} data-seat={seat}>
      <Tag className="av-plate" {...(Tag === 'button' ? { type: 'button', onClick: () => onPick!(seat), title: i.t('Throw something at {p}', { p: name }) } : {})}>
        <span className="av-face" style={{ ['--c' as string]: colorFor(p.name, seat) } as CSSProperties} aria-hidden>{initials(name)}</span>
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
          const legal = view.legalCardIds.includes(c.id);
          const reason = myTurn && !legal && led ? i.t('You must follow {suit}', { suit: i.suit(led) }) : '';
          return (
            <button
              key={c.id}
              className={`card-btn in-hand ${myTurn ? (legal ? 'legal' : 'illegal') : ''} ${selected === c.id ? 'selected' : ''}`}
              style={{ ['--i' as string]: k } as CSSProperties}
              disabled={!myTurn || !legal}
              aria-pressed={selected === c.id}
              aria-label={`${i.cardName(c)}${reason ? ` — ${reason}` : ''}`}
              title={reason || undefined}
              onClick={() => (selected === c.id ? play(c.id) : setSelected(c.id))}
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
