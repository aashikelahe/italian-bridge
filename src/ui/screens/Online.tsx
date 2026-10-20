/**
 * Online rooms: create a room, share its code or link, gather in the lobby (pick seats, chat), and play.
 * The game server runs every game; this screen only shows what the server sends.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Difficulty, GameMode, Seat } from '../../engine/types';
import { SEATS, teamOf } from '../../engine/seating';
import { MATCH_TARGETS } from '../../engine/config';
import { cleanName, normalizeCode, PACE_FACTOR, PACE_MS, type Pace, type RoomInfo } from '../../online/protocol';
import { inviteLink, useServer, type ThrowEvent } from '../../online/net';
import type { Settings } from '../storage';
import type { Sweep } from '../useGameDriver';
import type { PlayerView } from '../../engine/view';
import { useI18n, I18nProvider, SeatNameProvider } from '../i18n';
import { TableScreen } from './TableScreen';
import { useReactions, useSmacks } from '../reactions';
import type { TableChat } from './TableScreen';
import { playCardTap, playSweep } from '../sound';

interface Props {
  settings: Settings;
  saveSettings: (s: Settings) => void;
  onBack: () => void;
  onToggleLang: () => void;
  onToggleSound: () => void;
  /** Room code from an invite link. */
  inviteCode?: string | null;
}

function recentRooms(): string[] { try { return JSON.parse(localStorage.getItem('ib.rooms') ?? '[]'); } catch { return []; } }
function rememberRoom(code: string) {
  try { localStorage.setItem('ib.rooms', JSON.stringify([code, ...recentRooms().filter((c) => c !== code)].slice(0, 6))); } catch { /* ignore */ }
}

export function OnlineScreen(props: Props) {
  const i = useI18n();
  const name = cleanName(props.settings.onlineNick) || cleanName(props.settings.playerName) || 'Player';
  const { reactions, hits, add } = useReactions();
  const onThrow = useCallback((t: ThrowEvent) => add({ from: t.from, to: t.to, e: t.e }), [add]);
  const sm = useSmacks();
  const srv = useServer(name, onThrow, sm.add);
  const askedInvite = useRef(false);

  // Invite links join automatically once connected (if we already know your name).
  const hasName = !!cleanName(props.settings.onlineNick);
  useEffect(() => {
    if (hasName && srv.status === 'open' && props.inviteCode && !askedInvite.current && !srv.room) {
      askedInvite.current = true;
      srv.send({ t: 'join', code: props.inviteCode });
    }
  }, [hasName, srv.status, props.inviteCode, srv.room, srv]);

  useEffect(() => { if (srv.room) rememberRoom(srv.room.code); }, [srv.room?.code]);

  if (srv.status === 'unavailable') {
    return (
      <div className="page">
        <header className="page-head"><button className="btn ghost small" onClick={props.onBack}>{i.t('Back')}</button><h1>{i.t('Play online')}</h1></header>
        <p>{i.t('Online play is not switched on for this copy of the game yet. You can still play against the computer.')}</p>
      </div>
    );
  }

  const banner = srv.status === 'open' ? null
    : srv.status === 'connecting' ? i.t('Connecting to the game server… (a sleeping server can take up to a minute to wake up)')
    : i.t('Connection lost. Reconnecting…');

  const room = srv.room;
  const me = srv.me;
  const mySeat = room && me ? SEATS.find((s) => room.seats[s] === me) ?? null : null;

  if (room && me && room.status !== 'lobby' && mySeat && srv.view) {
    return (
      <OnlineTable {...props} room={room} me={me} view={srv.view} send={srv.send} error={srv.error} clearError={srv.clearError}
        reactions={reactions} hits={hits} banner={banner} smacks={sm.smacks} />
    );
  }
  if (room && me) {
    return <Lobby {...props} room={room} me={me} send={srv.send} error={srv.error} clearError={srv.clearError} banner={banner} />;
  }
  return (
    <OnlineHome {...props} name={name} connected={srv.status === 'open'} banner={banner} left={srv.left} clearLeft={srv.clearLeft}
      error={srv.error} send={srv.send} />
  );
}

type Send = ReturnType<typeof useServer>['send'];

function OnlineHome({ settings, saveSettings, onBack, connected, banner, left, clearLeft, error, send, inviteCode }: Props & {
  name: string; connected: boolean; banner: string | null; left: string | null; clearLeft: () => void; error: string | null; send: Send;
}) {
  const i = useI18n();
  const [nick, setNick] = useState(settings.onlineNick || (settings.playerName !== 'You' ? settings.playerName : ''));
  const [joinCode, setJoinCode] = useState(inviteCode ?? '');
  const [mode, setMode] = useState<GameMode>(settings.mode);
  const [target, setTarget] = useState(settings.matchTarget);
  const [tableType, setTableType] = useState(settings.tableType);
  const [difficulty, setDifficulty] = useState<Difficulty>(settings.difficulty);
  const [pace, setPace] = useState<Pace>(settings.anim === 'fast' ? 'fast' : 'normal');
  const [err, setErr] = useState<string | null>(null);
  const recent = recentRooms();

  const remember = () => {
    const n = cleanName(nick);
    if (n !== settings.onlineNick) saveSettings({ ...settings, onlineNick: n });
  };
  const needName = () => {
    if (cleanName(nick)) return false;
    setErr(i.t('Type the name your friends will see.'));
    return true;
  };

  const create = () => {
    if (needName()) return;
    setErr(null); clearLeft(); remember();
    send({ t: 'create', settings: { mode, matchTarget: target, tableType: mode === 'team' ? tableType : 'regular', difficulty, pace, rules: settings.rules } });
  };
  const join = (raw: string) => {
    const code = normalizeCode(raw);
    if (code.length < 4) { setErr(i.t('Enter the room code you were given.')); return; }
    if (needName()) return;
    setErr(null); clearLeft(); remember();
    send({ t: 'join', code });
  };

  const leftMsg = left === 'closed' ? i.t('The host closed the room.') : left === 'missing' ? i.t('That room does not exist any more. Check the code, or ask the host to create a new room.') : null;

  return (
    <div className="page online-home">
      <header className="page-head"><button className="btn ghost small" onClick={onBack}>{i.t('Back')}</button><h1>{i.t('Play online')}</h1></header>
      {banner && <p className="notice" role="status">{banner}</p>}
      <label className="field">
        <span>{i.t('Your name at the table')}</span>
        <input id="nick" value={nick} maxLength={16} placeholder={i.t('Your name')} onChange={(e) => setNick(e.target.value)} />
      </label>

      <section className={`online-card ${inviteCode ? 'invited' : ''}`}>
        <h2>{inviteCode ? i.t('You are invited to room {c}', { c: inviteCode }) : i.t('Join a room')}</h2>
        <form className="join-row" onSubmit={(e) => { e.preventDefault(); join(joinCode); }}>
          <input id="join-code" className="code-input" value={joinCode} onChange={(e) => setJoinCode(normalizeCode(e.target.value))} placeholder="K7QXM" aria-label={i.t('Room code')} autoCapitalize="characters" />
          <button className="btn brass" disabled={!connected} type="submit">{i.t('Join')}</button>
        </form>
        {recent.length > 0 && (
          <p className="muted recent">{i.t('Recent rooms')}: {recent.map((c) => <button key={c} className="link-btn" onClick={() => join(c)}>{c}</button>)}</p>
        )}
      </section>

      <section className="online-card">
        <h2>{i.t('Create a room')}</h2>
        <div className="seg-opts">
          {(['team', 'individual'] as GameMode[]).map((m) => (
            <label key={m} className={mode === m ? 'on' : ''}><input type="radio" checked={mode === m} onChange={() => setMode(m)} />{m === 'team' ? i.t('Two teams') : i.t('Individual')}</label>
          ))}
        </div>
        {mode === 'team' && (
          <div className="seg-opts">
            <label className={tableType === 'regular' ? 'on' : ''}><input type="radio" checked={tableType === 'regular'} onChange={() => setTableType('regular')} />{i.t('Regular')}</label>
            <label className={tableType === 'friends' ? 'on' : ''}><input type="radio" checked={tableType === 'friends'} onChange={() => setTableType('friends')} />{i.t('Friends (emoji throwing)')}</label>
          </div>
        )}
        <div className="seg-opts">
          {MATCH_TARGETS.map((t) => (
            <label key={t} className={target === t ? 'on' : ''}><input type="radio" checked={target === t} onChange={() => setTarget(t)} />{i.t('{n} points', { n: t })}</label>
          ))}
        </div>
        <div className="seg-opts">
          {(['easy', 'normal', 'hard'] as Difficulty[]).map((d) => (
            <label key={d} className={difficulty === d ? 'on' : ''}><input type="radio" checked={difficulty === d} onChange={() => setDifficulty(d)} />{i.t(d === 'easy' ? 'Easy computer' : d === 'normal' ? 'Normal computer' : 'Hard computer')}</label>
          ))}
        </div>
        <div className="seg-opts">
          <label className={pace === 'normal' ? 'on' : ''}><input type="radio" checked={pace === 'normal'} onChange={() => setPace('normal')} />{i.t('Relaxed pace')}</label>
          <label className={pace === 'fast' ? 'on' : ''}><input type="radio" checked={pace === 'fast'} onChange={() => setPace('fast')} />{i.t('Fast pace')}</label>
        </div>
        <p className="muted">{i.t('Your house rules from New game are used. Empty seats are filled by computer players when the game starts.')}</p>
        <button className="btn brass big" disabled={!connected} onClick={create}>{i.t('Create room')}</button>
      </section>
      {(err || error || leftMsg) && <p className="form-error" role="alert">{err ?? (error ? i.t(error) : leftMsg)}</p>}
    </div>
  );
}

function Chat({ room, me, send, compact }: { room: RoomInfo; me: string; send: Send; compact?: boolean }) {
  const i = useI18n();
  const [text, setText] = useState('');
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }); }, [room.chat.length]);
  return (
    <section className={`chat ${compact ? 'compact' : ''}`} aria-label={i.t('Chat')}>
      <h3>{i.t('Chat')}</h3>
      <ol ref={list} className="chat-list">
        {room.chat.length === 0 && <li className="muted">{i.t('Say hello while you wait.')}</li>}
        {room.chat.map((m) => (
          <li key={m.id} className={m.from === me ? 'mine' : ''}>
            <b>{m.from === me ? i.t('You') : m.name}</b>
            <span>{m.text}</span>
          </li>
        ))}
      </ol>
      <form className="chat-form" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { send({ t: 'chat', text }); setText(''); } }}>
        <input id={`chat-${compact ? 'game' : 'lobby'}`} value={text} maxLength={300} onChange={(e) => setText(e.target.value)} placeholder={i.t('Message')} aria-label={i.t('Message')} />
        <button className="btn small brass" type="submit" disabled={!text.trim()}>{i.t('Send')}</button>
      </form>
    </section>
  );
}

function useToastError(error: string | null, clearError: () => void) {
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(clearError, 4000);
    return () => clearTimeout(t);
  }, [error, clearError]);
}

function Lobby({ room, me, send, error, clearError, banner }: Props & { room: RoomInfo; me: string; send: Send; error: string | null; clearError: () => void; banner: string | null }) {
  const i = useI18n();
  useToastError(error, clearError);
  const isHost = room.hostId === me;
  const mySeat = SEATS.find((s) => room.seats[s] === me) ?? null;
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const member = (id: string | null) => (id ? room.members.find((m) => m.id === id) : undefined);
  const humans = SEATS.filter((s) => room.seats[s]);
  const playing = room.status !== 'lobby';
  const link = inviteLink(room.code);

  const copy = async (what: 'code' | 'link') => {
    try { await navigator.clipboard.writeText(what === 'code' ? room.code : link); setCopied(what); setTimeout(() => setCopied(null), 1500); } catch { setCopied(null); }
  };
  const seatLabel: Record<Seat, string> = { A: i.t('North'), B: i.t('East'), C: i.t('South'), D: i.t('West') };

  return (
    <div className="page lobby">
      {banner && <p className="notice" role="status">{banner}</p>}
      <header className="page-head">
        <button className="btn ghost small" onClick={() => send({ t: 'leave' })}>{i.t('Leave room')}</button>
        <h1>{i.t('Room')} <span className="room-code">{room.code}</span></h1>
        <button className="btn small ghost" onClick={() => void copy('code')}>{copied === 'code' ? i.t('Copied') : i.t('Copy code')}</button>
        <button className="btn small ghost" onClick={() => void copy('link')}>{copied === 'link' ? i.t('Copied') : i.t('Copy invite link')}</button>
      </header>
      <p className="muted">{i.t('Send your friends this link, or tell them the code {c}:', { c: room.code })} <span className="invite-link">{link}</span></p>
      <p className="lobby-settings">
        {room.settings.mode === 'team' ? i.t('Two teams') : i.t('Individual')}
        {room.settings.mode === 'team' && ` · ${room.settings.tableType === 'friends' ? i.t('Friends table') : i.t('Regular table')}`}
        {` · ${i.t('{n} points', { n: room.settings.matchTarget })}`}
      </p>
      {playing && <p className="notice">{mySeat ? i.t('Loading the table…') : i.t('A game is being played in this room. You can chat; you can sit down when it ends.')}</p>}

      <div className="lobby-grid">
        <section className="seat-board" aria-label={i.t('Seats')}>
          {SEATS.map((s) => {
            const id = room.seats[s];
            const m = member(id);
            const mine = id === me;
            return (
              <div key={s} className={`seat-slot slot-${s} ${id ? 'taken' : ''} ${mine ? 'mine' : ''} ${room.settings.mode === 'team' ? `team-${teamOf(s)}` : ''}`}>
                <span className="slot-name">{seatLabel[s]}{room.settings.mode === 'team' && <em> · {i.t(teamOf(s) === 'X' ? 'Team X' : 'Team Y')}</em>}</span>
                {id ? (
                  <strong>
                    <span className={`dot ${m?.online ? 'on' : ''}`} aria-label={m?.online ? i.t('online') : i.t('away')} />
                    <span>{mine ? i.t('You') : m?.name || i.t('Someone')}</span>
                    {id === room.hostId && <span className="tag">{i.t('host')}</span>}
                  </strong>
                ) : (
                  <span className="muted">{i.t('Computer player if empty')}</span>
                )}
                {!id && !playing && <button className="btn small" onClick={() => send({ t: 'sit', seat: s })}>{i.t('Sit here')}</button>}
                {mine && !playing && <button className="btn small ghost" onClick={() => send({ t: 'stand' })}>{i.t('Stand up')}</button>}
              </div>
            );
          })}
          <div className="table-mark" aria-hidden>{room.settings.mode === 'team' ? i.t('Partners sit opposite') : ''}</div>
        </section>
        <Chat room={room} me={me} send={send} />
      </div>

      <section className="lobby-actions">
        <h3>{i.t('In the lobby')}</h3>
        <ul className="member-list">
          {room.members.map((m) => (
            <li key={m.id}><span className={`dot ${m.online ? 'on' : ''}`} />{m.id === me ? i.t('You') : m.name}{m.id === room.hostId && <span className="tag">{i.t('host')}</span>}</li>
          ))}
        </ul>
        {isHost && !playing && (
          <div className="row">
            <span className="muted">{mySeat ? i.t('{n} people seated. Empty seats become computer players.', { n: humans.length }) : i.t('Take a seat before you start.')}</span>
            <div className="row-gap">
              {confirmClose
                ? <><span>{i.t('Close this room for everyone?')}</span><button className="btn small ghost" onClick={() => setConfirmClose(false)}>{i.t('Keep it')}</button><button className="btn small" onClick={() => send({ t: 'close' })}>{i.t('Close room')}</button></>
                : <button className="btn ghost" onClick={() => setConfirmClose(true)}>{i.t('Close room')}</button>}
              <button className="btn brass big" disabled={!mySeat} onClick={() => send({ t: 'start' })}>{i.t('Start game')}</button>
            </div>
          </div>
        )}
        {!isHost && !playing && <p className="muted">{i.t('Waiting for {p} to start the game.', { p: member(room.hostId)?.name || i.t('the host') })}</p>}
        {error && <p className="form-error" role="alert">{i.t(error)}</p>}
      </section>
    </div>
  );
}

/** Trick-sweep animation and card sounds for a view that arrives from the server. */
function useServerViewEffects(view: PlayerView, pace: Pace, anim: Settings['anim']): Sweep | null {
  const [sweep, setSweep] = useState<Sweep | null>(null);
  const k = PACE_FACTOR[pace] * (anim === 'reduced' ? 0.6 : 1);
  const winner = view.currentTrick?.winner ?? null;
  const idx = view.currentTrick?.index ?? 0;
  const plays = view.currentTrick?.plays.length ?? 0;
  const lastPlays = useRef(plays);
  useEffect(() => {
    if (plays > lastPlays.current) playCardTap();
    lastPlays.current = plays;
  }, [plays]);
  useEffect(() => {
    setSweep(null);
    if (!winner) return;
    const t1 = window.setTimeout(() => setSweep({ seat: winner, stage: 'gather' }), PACE_MS.TRICK_SHOW * k);
    const t2 = window.setTimeout(() => { setSweep({ seat: winner, stage: 'slide' }); playSweep(); }, (PACE_MS.TRICK_SHOW + PACE_MS.TRICK_GATHER) * k);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [winner, idx, k]);
  return sweep;
}

function OnlineTable(props: Props & {
  room: RoomInfo; me: string; view: PlayerView; send: Send; error: string | null; clearError: () => void;
  reactions: ReturnType<typeof useReactions>['reactions']; hits: ReturnType<typeof useReactions>['hits']; banner: string | null;
  smacks: ReturnType<typeof useSmacks>['smacks'];
}) {
  const { room, me, view, send, settings } = props;
  const friends = room.settings.mode === 'team' && room.settings.tableType === 'friends';
  const sweeping = useServerViewEffects(view, room.settings.pace, settings.anim);
  const names = useMemo(() => Object.fromEntries(room.members.map((m) => [m.id, m.name])), [room.members]);
  // Names: the server's names for people (they can rename); "You" for yourself.
  const resolve = useCallback((seat: Seat) => {
    const id = room.seats[seat];
    if (!id || id === me) return null;
    return names[id] || null;
  }, [room.seats, me, names]);
  const away = room.autoplay.filter((s) => room.seats[s] !== me);
  return (
    <I18nProvider lang={settings.lang} friends={friends}>
      <SeatNameProvider resolve={resolve}>
        <TableWithNotices {...props} friends={friends} sweeping={sweeping} away={away} send={send} />
      </SeatNameProvider>
    </I18nProvider>
  );
}

function TableWithNotices(props: Props & {
  room: RoomInfo; me: string; view: PlayerView; send: Send; error: string | null; clearError: () => void;
  reactions: ReturnType<typeof useReactions>['reactions']; hits: ReturnType<typeof useReactions>['hits']; banner: string | null;
  smacks: ReturnType<typeof useSmacks>['smacks'];
  friends: boolean; sweeping: Sweep | null; away: Seat[];
}) {
  const i = useI18n();
  const { room, me, view, send } = props;
  const awayNames = props.away.map((s) => room.members.find((m) => m.id === room.seats[s])?.name).filter(Boolean).join(', ');
  const chat = useMemo<TableChat>(() => ({
    messages: room.chat,
    me,
    onSend: (text) => send({ t: 'chat', text }),
    seatOf: (id) => SEATS.find((s) => room.seats[s] === id) ?? null,
  }), [room.chat, room.seats, me, send]);
  const notice = props.banner ?? (awayNames ? i.t('{p} is away — the computer is playing for them until they come back.', { p: awayNames }) : null);
  return (
    <TableScreen
      view={view}
      dispatch={(a) => { send({ t: 'act', action: a }); return null; }}
      sweeping={props.sweeping}
      error={props.error}
      clearError={props.clearError}
      settings={props.settings}
      onExit={() => send({ t: 'leave' })}
      onNewGame={room.hostId === me ? () => send({ t: 'lobby' }) : undefined}
      friends={props.friends}
      reactions={props.reactions}
      hits={props.hits}
      onThrow={(to, e) => send({ t: 'throw', to, e })}
      onToggleLang={props.onToggleLang}
      chat={chat}
      smacks={props.smacks}
      onSmack={() => send({ t: 'smack' })}
      onToggleSound={props.onToggleSound}
      exitLabel={i.t('Leave room')}
      notice={notice}
    />
  );
}
