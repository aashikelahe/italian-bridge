/**
 * The card table, shared by offline play and online rooms: a full-screen landscape table with
 * players around a felt, your hand along the bottom, chat beside the board, and scores behind a button.
 * It only renders a PlayerView and sends actions; whoever runs the engine is outside.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Action, Card, Seat } from '../../engine/types';
import type { PlayerView } from '../../engine/view';
import type { Sweep } from '../useGameDriver';
import type { Settings } from '../storage';
import type { ChatMsg } from '../../online/protocol';
import { SEATS } from '../../engine/seating';
import { SUIT_SYMBOL, isRed } from '../../engine/cards';
import { Avatar, TrickArea, HumanHand } from '../components/Table';
import { TrumpSeal } from '../components/TrumpSeal';
import { ScorePanel } from '../components/ScorePanel';
import { BidPanel, BonusPanel, CutPanel, MatchResult, PhaseBanner, ReservePanel, RoundResult } from '../components/Panels';
import { ReactionLayer, SmackLayer, ThrowTray, type Reaction, type SmackEvent } from '../reactions';
import { useI18n, useSeatName } from '../i18n';
import { useTableSounds } from '../useTableSounds';
import { playChat, playError } from '../sound';
import type { Voice } from '../../online/voice';
import { Face, colorFor, type PicInfo } from '../profile';
import { QUICK_PHRASES } from '../quickChat';
import { cardFromId } from '../../engine/cards';
import { CardFace } from '../components/Card';
import { relPos } from '../layout';

export interface TableChat {
  messages: ChatMsg[];
  me: string;
  onSend: (text: string) => void;
  /** Which seat a chat author sits in (for speech bubbles), if any. */
  seatOf: (userId: string) => Seat | null;
  picOf?: (userId: string) => PicInfo | null;
}

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
  smacks: SmackEvent[];
  onSmack: () => void;
  /** Online clients wait for the host to start the next round. */
  canContinue?: boolean;
  onToggleLang: () => void;
  onToggleSound?: () => void;
  /** Online rooms: chat beside the board. */
  chat?: TableChat;
  /** Shown over the top of the table (connection problems, away players). */
  notice?: string | null;
  exitLabel?: string;
  /** Online rooms: the voice chat. */
  voice?: Voice;
}

function phaseLabel(i: ReturnType<typeof useI18n>, p: string): string {
  const m: Record<string, string> = {
    SHUFFLE: 'Shuffling', CUT: 'Cutting', INITIAL_DEAL: 'Dealing', BIDDING: 'Bidding', TRUMP_RESERVATION: 'Choosing trump',
    SECOND_DEAL: 'Second deal', BONUS_CALL: 'Bonus call', THIRD_DEAL: 'Third deal', ROUND_RESULT: 'Round over', MATCH_OVER: 'Match over',
  };
  return m[p] ? i.t(m[p]) : p;
}

const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

function useIsPortraitPhone() {
  const q = '(orientation: portrait) and (max-width: 760px)';
  const [m, setM] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(q).matches);
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const mq = matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return m;
}

async function goFullscreenLandscape() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
  } catch { /* not allowed here */ }
  try {
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    await o.lock?.('landscape');
  } catch { /* the phone may not allow locking: the player rotates it by hand */ }
}

export function TableScreen(props: TableScreenProps) {
  const { view, dispatch, sweeping, error, clearError, settings, friends, reactions, hits, onThrow, chat } = props;
  const i = useI18n();
  const seatName = useSeatName(view.players);
  const [tray, setTray] = useState(false);
  const [target, setTarget] = useState<Seat | null>(null);
  const [menu, setMenu] = useState(false);
  const [scores, setScores] = useState(false);
  const [lastTrick, setLastTrick] = useState(false);
  const [chatOpen, setChatOpen] = useState(() => lsGet('ib.chatOpen') !== '0');
  const [uprightOk, setUprightOk] = useState(() => lsGet('ib.upright') === '1');
  const portraitPhone = useIsPortraitPhone();
  useTableSounds(view);

  useEffect(() => {
    if (!error) return;
    playError();
    const t = setTimeout(clearError, 3500);
    return () => clearTimeout(t);
  }, [error, clearError]);

  // ---- chat: speech bubbles, unread count, sound
  const [bubbles, setBubbles] = useState<Partial<Record<Seat, { text: string; id: number }>>>({});
  const [unread, setUnread] = useState(0);
  const lastSeen = useRef<number>(chat?.messages.at(-1)?.id ?? 0);
  useEffect(() => {
    if (!chat) return;
    const fresh = chat.messages.filter((m) => m.id > lastSeen.current);
    if (!fresh.length) return;
    lastSeen.current = fresh[fresh.length - 1].id;
    const fromOthers = fresh.filter((m) => m.from !== chat.me);
    if (fromOthers.length) playChat();
    for (const m of fresh) {
      const seat = chat.seatOf(m.from);
      if (!seat) continue;
      setBubbles((b) => ({ ...b, [seat]: { text: m.text.length > 60 ? `${m.text.slice(0, 57)}…` : m.text, id: m.id } }));
      window.setTimeout(() => setBubbles((b) => (b[seat]?.id === m.id ? { ...b, [seat]: undefined } : b)), 5000);
    }
    if (!chatOpen) setUnread((u) => u + fromOthers.length);
  }, [chat, chatOpen]);
  useEffect(() => { if (chatOpen) setUnread(0); lsSet('ib.chatOpen', chatOpen ? '1' : '0'); }, [chatOpen]);

  // ---- smack: once per trick, after playing your card
  const me = view.seat;
  const t = view.currentTrick;
  const iPlayed = !!t && view.phase === 'PLAYING' && t.plays.length > 0 && t.plays[t.plays.length - 1].seat === me;
  const [smackedTrick, setSmackedTrick] = useState<number | null>(null);
  const canSmack = iPlayed && smackedTrick !== t!.index && !sweeping;
  const latestSmack = props.smacks[props.smacks.length - 1] ?? null;
  const smackedSeat = latestSmack && t?.plays.some((p) => p.seat === latestSmack.seat) ? latestSmack.seat : null;

  const bidder = view.trump.bidder;
  const contract = bidder && view.bidding.highestBid ? i.t('{p} bid {n}', { p: seatName(bidder), n: view.bidding.highestBid }) : i.t('Bidding open');
  const showHand = view.hand.length > 0 && !(view.phase === 'TRUMP_RESERVATION' && view.trump.bidder === view.seat);
  const phase = view.phase;
  const others = SEATS.filter((s) => s !== me);
  const pick = friends && onThrow ? (s: Seat) => { setTarget(s); setTray(true); } : undefined;

  let modal: JSX.Element | null = null;
  let modalKind = '';
  if (phase === 'CUT' && view.cutter === me) { modal = <CutPanel view={view} dispatch={dispatch} />; modalKind = 'full'; }
  else if (phase === 'BIDDING') { modal = <BidPanel view={view} dispatch={dispatch} />; modalKind = 'above-hand'; }
  else if (phase === 'BONUS_CALL') { modal = <BonusPanel view={view} dispatch={dispatch} />; modalKind = 'above-hand'; }
  else if (phase === 'TRUMP_RESERVATION') { modal = <ReservePanel view={view} dispatch={dispatch} />; modalKind = view.trump.bidder === me ? 'full' : 'above-hand'; }
  else if (phase === 'ROUND_RESULT') { modal = <RoundResult view={view} dispatch={dispatch} canContinue={props.canContinue ?? true} />; modalKind = 'full'; }
  else if (phase === 'MATCH_OVER') { modal = <MatchResult view={view} onNewGame={props.onNewGame} onMenu={props.onExit} />; modalKind = 'full'; }

  const trumpChip = useMemo(() => {
    if (!view.trump.bidder || phase === 'TRUMP_RESERVATION' || phase === 'BIDDING') return null;
    if (view.trump.revealed && view.trump.revealedCard) {
      const s = view.trump.revealedCard.suit;
      return <span className={`trump-chip shown ${isRed(s) ? 'red' : ''}`}>{SUIT_SYMBOL[s]} {i.t('Trump')}</span>;
    }
    return <span className="trump-chip sealed">{view.myReserved ? `${SUIT_SYMBOL[view.myReserved.suit]} ` : '? '}{i.t('Trump hidden')}</span>;
  }, [view.trump, view.myReserved, phase, i]);

  const actions = (
    <div className="tbl-actions">
      {view.canRevealVoluntarily && <button className="act-btn gold" onClick={() => dispatch({ type: 'REVEAL_VOLUNTARY', seat: me })}>{i.t('Reveal trump and play one')}</button>}
      {view.canRequestReveal && <button className="act-btn gold" onClick={() => dispatch({ type: 'REQUEST_REVEAL', seat: me })}>{i.t('Ask to see trump')}</button>}
      {canSmack && (
        <button className="act-btn smack" onClick={() => { setSmackedTrick(t!.index); props.onSmack(); }}>
          {i.lang === 'bn' ? 'বাড়ি!' : 'Smack!'}
        </button>
      )}
    </div>
  );

  const showRotate = portraitPhone && !uprightOk;

  return (
    <div className={`tbl phase-${phase} anim-${settings.anim} ${friends ? 'friends' : ''} lang-${i.lang} ${chat ? 'has-chat' : ''} ${chat && chatOpen ? 'chat-open' : ''}`}>
      <header className="tbl-top">
        <button className="icon-btn" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-label={i.t('Menu')}>☰</button>
        <div className="tbl-status">
          <span>{i.t('Round {n}', { n: view.round })}</span>
          <span>{phase === 'PLAYING' || phase === 'MANDATORY_REVEAL' ? i.t('Trick {n} of 13', { n: view.trickNumber }) : phaseLabel(i, phase)}</span>
          <span className="wide-only">{contract}</span>
          {trumpChip}
        </div>
        <div className="tbl-top-right">
          {view.completedTricks.length > 0 && (phase === 'PLAYING' || phase === 'MANDATORY_REVEAL') && (
            <button className="icon-btn" onClick={() => setLastTrick((v) => !v)} aria-pressed={lastTrick} aria-label={i.t('Last trick')} title={i.t('Last trick')}>↶</button>
          )}
          {props.voice && (
            <button
              className={`icon-btn mic-btn ${props.voice.joined ? (props.voice.muted ? 'muted' : 'live') : ''} ${props.voice.speaking.has(chat?.me ?? '') ? 'talking' : ''}`}
              onClick={props.voice.joined ? props.voice.toggleMute : props.voice.join}
              disabled={!props.voice.supported || props.voice.joining}
              aria-label={props.voice.joined ? (props.voice.muted ? i.t('Unmute') : i.t('Mute')) : i.t('Join voice')}
              title={props.voice.joined ? (props.voice.muted ? i.t('Unmute') : i.t('Mute')) : i.t('Join voice')}
            >{props.voice.joined && props.voice.muted ? '🔇' : '🎙'}</button>
          )}
          <button className="pill-btn" onClick={() => setScores(true)}>
            <span>{i.t('Scores')}</span>
            {view.teams
              ? <b>{view.teams.map((x) => i.num(x.cumulativeScore)).join(' : ')}</b>
              : <b>{i.num(view.players[me].cumulativeScore)}</b>}
          </button>
          {chat && (
            <button className="icon-btn chat-toggle" onClick={() => setChatOpen((o) => !o)} aria-pressed={chatOpen} aria-label={i.t('Chat')}>
              💬{unread > 0 && <span className="unread">{i.num(unread)}</span>}
            </button>
          )}
        </div>
        {menu && (
          <div className="tbl-menu" role="menu" onClick={() => setMenu(false)}>
            <button role="menuitem" onClick={props.onExit}>{props.exitLabel ?? i.t('Main menu')}</button>
            {props.onTogglePause && <button role="menuitem" onClick={props.onTogglePause}>{props.paused ? i.t('Resume') : i.t('Pause')}</button>}
            <button role="menuitem" onClick={() => void goFullscreenLandscape()}>{i.t('Full screen')}</button>
            <button role="menuitem" onClick={props.onToggleLang}>{i.lang === 'bn' ? 'English' : 'বাংলা'}</button>
            {props.onToggleSound && <button role="menuitem" onClick={props.onToggleSound}>{settings.sound ? i.t('Sound off') : i.t('Sound on')}</button>}
            {props.voice?.joined && <button role="menuitem" onClick={props.voice.leave}>{i.t('Leave voice')}</button>}
          </div>
        )}
      </header>

      <main className="tbl-main">
        <section className={`tbl-felt ${smackedSeat ? 'shake' : ''}`} aria-label={i.t('Card table')}>
          <div className="felt-oval" aria-hidden />
          {props.notice && <p className="tbl-notice" role="status">{props.notice}</p>}
          {others.map((s) => (
            <Avatar key={s} view={view} seat={s} devHand={props.devHands?.[s]} won={sweeping?.seat === s} hit={!!hits[s]} bubble={bubbles[s]?.text} onPick={pick} />
          ))}
          <Avatar view={view} seat={me} won={sweeping?.seat === me} hit={!!hits[me]} bubble={bubbles[me]?.text} />

          <div className="tbl-center">
            {!modal ? (
              <>
                <PhaseBanner view={view} />
                {(phase === 'PLAYING' || phase === 'MANDATORY_REVEAL') && <TrickArea view={view} sweeping={sweeping} smackedSeat={smackedSeat} />}
              </>
            ) : null}
          </div>
          {modal && <div className={`tbl-modal ${modalKind}`}>{modal}</div>}

          {showHand && <div className="tbl-hand"><HumanHand view={view} dispatch={dispatch} sort={settings.sort} /></div>}
          {actions}

          {lastTrick && view.completedTricks.length > 0 && (() => {
            const lt = view.completedTricks[view.completedTricks.length - 1];
            return (
              <div className="last-trick glass" role="dialog" aria-label={i.t('Last trick')} onClick={() => setLastTrick(false)}>
                <header><b>{i.t('Last trick')}</b><span>{i.t('{p} won it', { p: seatName(lt.winner) })}</span></header>
                <div className="lt-cards">
                  {lt.plays.map((pl) => (
                    <figure key={pl.cardId} className={`lt-${relPos(me, pl.seat)} ${pl.seat === lt.winner ? 'won' : ''}`}>
                      <CardFace card={cardFromId(pl.cardId)} size="sm" />
                      <figcaption>{seatName(pl.seat)}</figcaption>
                    </figure>
                  ))}
                </div>
              </div>
            );
          })()}
          <SmackLayer me={me} smacks={props.smacks} />
          {friends && <ReactionLayer me={me} reactions={reactions} />}
          {friends && onThrow && !tray && (
            <button className="throw-fab" onClick={() => setTray(true)} aria-label={i.t('Throw an emoji')} title={i.t('Throw an emoji')}>😜</button>
          )}
          {friends && onThrow && tray && (
            <ThrowTray view={view} target={target} setTarget={setTarget} onClose={() => setTray(false)} onThrow={(to, e) => onThrow(to, e)} />
          )}
          {error && <div className="toast" role="alert">{i.t(error)}</div>}
          {props.paused && (
            <div className="paused-veil"><p>{i.t('Paused')}</p><button className="btn brass" onClick={props.onTogglePause}>{i.t('Resume')}</button></div>
          )}
        </section>

        {chat && chatOpen && <ChatRail chat={chat} onClose={() => setChatOpen(false)} />}
      </main>

      {scores && (
        <div className="tbl-sheet" role="dialog" aria-label={i.t('Scores')} onClick={(e) => { if (e.target === e.currentTarget) setScores(false); }}>
          <div className="sheet-body">
            <header className="sheet-head">
              <h2>{i.t('Scores')}</h2>
              <button className="icon-btn" onClick={() => setScores(false)} aria-label={i.t('Close')}>✕</button>
            </header>
            <TrumpSeal view={view} onReveal={() => dispatch({ type: 'REVEAL_VOLUNTARY', seat: me })} onRequest={() => dispatch({ type: 'REQUEST_REVEAL', seat: me })} />
            <ScorePanel view={view} />
            <details className="log">
              <summary>{i.t('Game log')}</summary>
              <ol>{[...view.log].reverse().slice(0, 60).map((l, k) => <li key={k}>{i.logLine(l, seatName)}</li>)}</ol>
            </details>
            {props.devHands && <p className="dev-note">{i.t('Developer mode is on: opponents’ hands are visible.')}</p>}
          </div>
        </div>
      )}

      {showRotate && (
        <div className="rotate-veil" role="dialog" aria-label={i.t('Turn your phone sideways')}>
          <div className="rotate-phone" aria-hidden>📱</div>
          <p>{i.t('Turn your phone sideways for the best table.')}</p>
          <button className="btn brass" onClick={() => void goFullscreenLandscape()}>{i.t('Full screen')}</button>
          <button className="btn ghost small" onClick={() => { setUprightOk(true); lsSet('ib.upright', '1'); }}>{i.t('Keep it upright')}</button>
        </div>
      )}
    </div>
  );
}

function ChatRail({ chat, onClose }: { chat: TableChat; onClose: () => void }) {
  const i = useI18n();
  const [text, setText] = useState('');
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }); }, [chat.messages.length]);
  return (
    <aside className="chat-rail" aria-label={i.t('Chat')}>
      <header className="rail-head">
        <h3>{i.t('Chat')}</h3>
        <button className="icon-btn small" onClick={onClose} aria-label={i.t('Close')}>✕</button>
      </header>
      <ol ref={list} className="rail-list">
        {chat.messages.length === 0 && <li className="muted">{i.t('Say something to the table.')}</li>}
        {chat.messages.map((m) => (
          <li key={m.id} className={m.from === chat.me ? 'mine' : ''}>
            {m.from !== chat.me && <Face pic={chat.picOf?.(m.from)} name={m.name} color={colorFor(m.name)} className="chat-face" />}
            <div><b>{m.from === chat.me ? i.t('You') : m.name}</b><span>{m.text}</span></div>
          </li>
        ))}
      </ol>
      <div className="quick-row">{QUICK_PHRASES.map((q) => <button key={q} type="button" className="quick-btn" onClick={() => chat.onSend(i.t(q))}>{i.t(q)}</button>)}</div>
      <form className="rail-form" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { chat.onSend(text); setText(''); } }}>
        <input id="chat-table" value={text} maxLength={300} onChange={(e) => setText(e.target.value)} placeholder={i.t('Message')} aria-label={i.t('Message')} autoComplete="off" />
        <button className="btn small brass" type="submit" disabled={!text.trim()}>{i.t('Send')}</button>
      </form>
    </aside>
  );
}
