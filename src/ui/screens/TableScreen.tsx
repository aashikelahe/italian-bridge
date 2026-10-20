/**
 * The card table, shared by offline play and online rooms. It only renders a PlayerView and
 * sends actions; whoever runs the engine (local driver or online host) is outside.
 */
import { useEffect, useState, type ReactNode } from 'react';
import type { Action, Card, Seat } from '../../engine/types';
import type { PlayerView } from '../../engine/view';
import type { Sweep } from '../useGameDriver';
import type { Settings } from '../storage';
import { SeatPlate, TrickArea, HumanHand } from '../components/Table';
import { TrumpSeal } from '../components/TrumpSeal';
import { ScorePanel } from '../components/ScorePanel';
import { BidPanel, CutPanel, MatchResult, PhaseBanner, ReservePanel, RoundResult } from '../components/Panels';
import { ReactionLayer, ThrowTray, type Reaction } from '../reactions';
import { useI18n, useSeatName } from '../i18n';
import { SEATS } from '../../engine/seating';

export interface TableScreenProps {
  view: PlayerView;
  dispatch: (a: Action) => string | null;
  sweeping: Sweep | null;
  error: string | null;
  clearError: () => void;
  settings: Settings;
  onExit: () => void;
  onNewGame?: () => void;
  paused?: boolean;
  onTogglePause?: () => void;
  devHands?: Partial<Record<Seat, Card[]>>;
  friends: boolean;
  reactions: Reaction[];
  hits: Partial<Record<Seat, number>>;
  onThrow?: (to: Seat, e: string) => void;
  /** Online clients wait for the host to start the next round. */
  canContinue?: boolean;
  onToggleLang: () => void;
  /** Extra panels for the sidebar (online chat, room info). */
  side?: ReactNode;
  /** Shown under the top bar (connection problems, waiting for host). */
  notice?: string | null;
}

function phaseLabel(i: ReturnType<typeof useI18n>, p: string): string {
  const m: Record<string, string> = {
    SHUFFLE: 'Shuffling', CUT: 'Cutting', INITIAL_DEAL: 'Dealing', BIDDING: 'Bidding', TRUMP_RESERVATION: 'Choosing trump',
    SECOND_DEAL: 'Second deal', THIRD_DEAL: 'Third deal', ROUND_RESULT: 'Round over', MATCH_OVER: 'Match over',
  };
  return m[p] ? i.t(m[p]) : p;
}

export function TableScreen(props: TableScreenProps) {
  const { view, dispatch, sweeping, error, clearError, settings, friends, reactions, hits, onThrow } = props;
  const i = useI18n();
  const seatName = useSeatName(view.players);
  const [tray, setTray] = useState(false);
  const [target, setTarget] = useState<Seat | null>(null);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(clearError, 3500);
    return () => clearTimeout(t);
  }, [error, clearError]);

  const me = view.seat;
  const bidder = view.trump.bidder;
  const contract = bidder && view.bidding.highestBid ? i.t('{p} bid {n}', { p: seatName(bidder), n: view.bidding.highestBid }) : i.t('Bidding open');
  const showHand = view.hand.length > 0 && view.phase !== 'TRUMP_RESERVATION';
  const phase = view.phase;
  const others = SEATS.filter((s) => s !== me);
  const pick = friends && onThrow ? (s: Seat) => { setTarget(s); setTray(true); } : undefined;

  let center: JSX.Element | null = null;
  if (phase === 'CUT' && view.cutter === me) center = <CutPanel view={view} dispatch={dispatch} />;
  else if (phase === 'BIDDING') center = <BidPanel view={view} dispatch={dispatch} />;
  else if (phase === 'TRUMP_RESERVATION') center = <ReservePanel view={view} dispatch={dispatch} />;
  else if (phase === 'ROUND_RESULT') center = <RoundResult view={view} dispatch={dispatch} canContinue={props.canContinue ?? true} />;
  else if (phase === 'MATCH_OVER') center = <MatchResult view={view} onNewGame={props.onNewGame} onMenu={props.onExit} />;

  return (
    <div className={`game anim-${settings.anim} ${friends ? 'friends' : ''} lang-${i.lang}`}>
      <header className="topbar">
        <button className="btn ghost small" onClick={props.onExit}>{i.t('Menu')}</button>
        <div className="status">
          <span>{i.t('Round {n}', { n: view.round })}</span>
          <span>{i.t('Dealer: {p}', { p: seatName(view.dealer) })}</span>
          <span>{phase === 'PLAYING' || phase === 'MANDATORY_REVEAL' ? i.t('Trick {n} of 13', { n: view.trickNumber }) : phaseLabel(i, phase)}</span>
          <span>{contract}</span>
          <span className="muted">{view.mode === 'team' ? (friends ? i.t('Friends table') : i.t('Team game')) : i.t('Every player for themselves')}</span>
          <span className="mobile-only">
            {view.teams
              ? view.teams.map((t) => `${i.name(t.name)} ${i.num(t.cumulativeScore)}`).join(' / ')
              : `${seatName(me)} ${i.num(view.players[me].cumulativeScore)}`}
          </span>
        </div>
        <div className="topbar-actions">
          <button className="btn ghost small" onClick={props.onToggleLang} aria-label={i.t('Switch language')}>{i.lang === 'bn' ? 'EN' : 'বাংলা'}</button>
          {props.onTogglePause && (
            <button className="btn ghost small" onClick={props.onTogglePause} aria-pressed={props.paused}>{props.paused ? i.t('Resume') : i.t('Pause')}</button>
          )}
        </div>
      </header>
      {props.notice && <p className="notice" role="status">{props.notice}</p>}

      <main className="layout">
        <section className="felt" aria-label={i.t('Card table')}>
          {others.map((s) => (
            <SeatPlate key={s} view={view} seat={s} devHand={props.devHands?.[s]} won={sweeping?.seat === s} hit={!!hits[s]} onPick={pick} />
          ))}
          <div className="center">
            {center ?? (
              <>
                <PhaseBanner view={view} />
                {(phase === 'PLAYING' || phase === 'MANDATORY_REVEAL') && <TrickArea view={view} sweeping={sweeping} />}
              </>
            )}
            {props.paused && (
              <div className="paused-veil"><p>{i.t('Paused')}</p><button className="btn brass" onClick={props.onTogglePause}>{i.t('Resume')}</button></div>
            )}
          </div>
          <div className="seat-bottom-area">
            <SeatPlate view={view} seat={me} won={sweeping?.seat === me} hit={!!hits[me]} />
            {showHand && <HumanHand view={view} dispatch={dispatch} sort={settings.sort} />}
          </div>
          {friends && <ReactionLayer me={me} reactions={reactions} />}
          {friends && onThrow && !tray && (
            <button className="throw-fab" onClick={() => setTray(true)} aria-label={i.t('Throw an emoji')} title={i.t('Throw an emoji')}>😜</button>
          )}
          {friends && onThrow && tray && (
            <ThrowTray view={view} target={target} setTarget={setTarget} onClose={() => setTray(false)} onThrow={(to, e) => onThrow(to, e)} />
          )}
          {error && <div className="toast" role="alert">{i.t(error)}</div>}
        </section>

        <aside className="side">
          <TrumpSeal
            view={view}
            onReveal={() => dispatch({ type: 'REVEAL_VOLUNTARY', seat: me })}
            onRequest={() => dispatch({ type: 'REQUEST_REVEAL', seat: me })}
          />
          <ScorePanel view={view} />
          {props.side}
          <details className="log">
            <summary>{i.t('Game log')}</summary>
            <ol>{[...view.log].reverse().slice(0, 40).map((l, k) => <li key={k}>{i.logLine(l, seatName)}</li>)}</ol>
          </details>
          {props.devHands && <p className="dev-note">{i.t('Developer mode is on: opponents’ hands are visible.')}</p>}
        </aside>
      </main>
    </div>
  );
}
