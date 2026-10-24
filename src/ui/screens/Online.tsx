/**
 * Online rooms: create a room, share its code or link, gather in the lobby (pick seats, chat), and play.
 * The game server runs every game; this screen only shows what the server sends.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Difficulty, GameMode, Seat } from '../../engine/types';
import { SEATS, teamOf } from '../../engine/seating';
import { MATCH_TARGETS } from '../../engine/config';
import { cleanName, normalizeCode, PACE_FACTOR, PACE_MS, TURN_TIMERS, type Pace, type RoomInfo } from '../../online/protocol';
import { inviteLink, memberPic, useServer, type ThrowEvent } from '../../online/net';
import { useVoice, type Voice } from '../../online/voice';
import { Face, botEmoji, colorFor, levelOf, useProfile, type PicInfo } from '../profile';
import { SeatExtraProvider } from '../seatExtras';
import { TurnClockProvider, type TurnClock } from '../turnClock';
import { storage } from '../storage';
import { QUICK_PHRASES } from '../quickChat';
import { playJoin, playVoiceJoin } from '../sound';
import type { MemberInfo } from '../../online/protocol';
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
  onProfile: () => void;
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
  const profile = useProfile();
  const level = useMemo(() => levelOf(storage.loadStats()).level, []);
  const profileMsg = useMemo(() => (profile.handle || profile.avatar ? { t: 'profile' as const, handle: profile.handle, avatar: profile.avatar, level } : null), [profile.handle, profile.avatar, level]);
  const frameRef = useRef<((frame: Uint8Array) => void) | null>(null);
  const handlers = useMemo(() => ({ onThrow, onSmack: sm.add, onVoice: (f: Uint8Array) => frameRef.current?.(f) }), [onThrow, sm.add]);
  const srv = useServer(name, handlers, profileMsg);
  const voice = useVoice(srv.room, srv.me, srv.send, srv.sendBinary, frameRef);
  useRoomSounds(srv.room, srv.me);
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

  const profileErr = srv.profileResult && !srv.profileResult.ok ? i.t(srv.profileResult.error ?? 'That player ID is taken. Try another one.') : null;
  const room = srv.room;
  const me = srv.me;
  const mySeat = room && me ? SEATS.find((s) => room.seats[s] === me) ?? null : null;

  if (room && me && room.status !== 'lobby' && mySeat && srv.view) {
    return (
      <OnlineTable {...props} room={room} me={me} view={srv.view} send={srv.send} error={srv.error} clearError={srv.clearError}
        reactions={reactions} hits={hits} banner={banner} smacks={sm.smacks} voice={voice} turn={srv.turn ?? null} />
    );
  }
  if (room && me) {
    return <Lobby {...props} room={room} me={me} send={srv.send} error={srv.error} clearError={srv.clearError} banner={banner ?? profileErr} voice={voice} />;
  }
  return (
    <OnlineHome {...props} name={name} connected={srv.status === 'open'} banner={banner} left={srv.left} clearLeft={srv.clearLeft}
      error={srv.error ?? (srv.profileResult && !srv.profileResult.ok ? srv.profileResult.error ?? null : null)} send={srv.send} />
  );
}

type Send = ReturnType<typeof useServer>['send'];

function OnlineHome({ settings, saveSettings, onBack, connected, banner, left, clearLeft, error, send, inviteCode, onProfile }: Props & {
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
  const [turnTimer, setTurnTimer] = useState<number>(settings.turnTimer ?? 0);
  const [teamX, setTeamX] = useState(lsTeam('X'));
  const [teamY, setTeamY] = useState(lsTeam('Y'));
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
    const tn = { X: cleanName(teamX) || 'Team X', Y: cleanName(teamY) || 'Team Y' };
    try { localStorage.setItem('ib.teamNames', JSON.stringify(tn)); } catch { /* ignore */ }
    if (turnTimer !== settings.turnTimer) saveSettings({ ...settings, onlineNick: cleanName(nick), turnTimer });
    send({ t: 'create', settings: { mode, matchTarget: target, tableType: mode === 'team' ? tableType : 'regular', difficulty, pace, rules: settings.rules, teamNames: tn, turnTimer } });
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
      <div className="oh-grid"><div className="oh-left">
      <ProfileStrip name={cleanName(nick) || i.t('Your name')} onEdit={onProfile} />
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

      </div>
      <section className="online-card">
        <h2>{i.t('Create a room')}</h2>
        <div className="seg-opts">
          {(['team', 'individual'] as GameMode[]).map((m) => (
            <label key={m} className={mode === m ? 'on' : ''}><input type="radio" checked={mode === m} onChange={() => setMode(m)} />{m === 'team' ? i.t('Two teams') : i.t('Individual')}</label>
          ))}
        </div>
        {mode === 'team' && (
          <div className="team-names">
            <label className="field"><span>{i.t('Team 1 name (North & South)')}</span><input id="team-x" value={teamX} maxLength={16} placeholder={i.t('Team X')} onChange={(e) => setTeamX(e.target.value)} /></label>
            <label className="field"><span>{i.t('Team 2 name (East & West)')}</span><input id="team-y" value={teamY} maxLength={16} placeholder={i.t('Team Y')} onChange={(e) => setTeamY(e.target.value)} /></label>
          </div>
        )}
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
        <TimerPicker value={turnTimer} onChange={setTurnTimer} />
        <p className="muted oh-note">{i.t('Your house rules from New game are used. Empty seats are filled by computer players when the game starts.')}</p>
        <button className="btn brass big" disabled={!connected} onClick={create}>{i.t('Create room')}</button>
      </section>
      </div>
      {(err || error || leftMsg) && <p className="form-error" role="alert">{err ?? (error ? i.t(error) : leftMsg)}</p>}
    </div>
  );
}

/** Move timer: off, or 15 / 30 / 45 seconds a move. */
export function TimerPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const i = useI18n();
  return (
    <div className="field timer-pick">
      <span>⏱ {i.t('Move timer')}</span>
      <div className="seg-opts">
        {TURN_TIMERS.map((t) => (
          <label key={t} className={value === t ? 'on' : ''}><input type="radio" name="turn-timer" checked={value === t} onChange={() => onChange(t)} />{t === 0 ? i.t('No timer') : i.t('{n} sec', { n: t })}</label>
        ))}
      </div>
      <small className="muted">{i.t('If time runs out, the computer makes the move for that player.')}</small>
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
        {room.chat.map((m) => {
          const who = room.members.find((x) => x.id === m.from);
          return (
            <li key={m.id} className={m.from === me ? 'mine' : ''}>
              {m.from !== me && <Face pic={who ? memberPic(who.id, who.pic) : null} name={m.name} color={colorFor(m.name)} className="chat-face" />}
              <div><b>{m.from === me ? i.t('You') : m.name}</b><span>{m.text}</span></div>
            </li>
          );
        })}
      </ol>
      <div className="quick-row">{QUICK_PHRASES.map((q) => <button key={q} type="button" className="quick-btn" onClick={() => send({ t: 'chat', text: i.t(q) })}>{i.t(q)}</button>)}</div>
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

function Lobby({ room, me, send, error, clearError, banner, voice }: Props & { room: RoomInfo; me: string; send: Send; error: string | null; clearError: () => void; banner: string | null; voice: Voice }) {
  const i = useI18n();
  useToastError(error, clearError);
  const isHost = room.hostId === me;
  const mySeat = SEATS.find((s) => room.seats[s] === me) ?? null;
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const member = (id: string | null) => (id ? room.members.find((m) => m.id === id) : undefined);
  const playing = room.status !== 'lobby';
  const link = inviteLink(room.code);

  const copy = async (what: 'code' | 'link') => {
    try { await navigator.clipboard.writeText(what === 'code' ? room.code : link); setCopied(what); setTimeout(() => setCopied(null), 1500); } catch { setCopied(null); }
  };
  const seatLabel: Record<Seat, string> = { A: i.t('North'), B: i.t('East'), C: i.t('South'), D: i.t('West') };

  const share = async () => {
    try {
      if (navigator.share) { await navigator.share({ title: 'Italian Bridge', text: i.t('Join my Italian Bridge room {c}', { c: room.code }), url: link }); return; }
    } catch { /* cancelled */ }
    void copy('link');
  };
  const settingsLine = [
    room.settings.mode === 'team' ? `${teamName(room, 'X', i)} ${i.t('vs')} ${teamName(room, 'Y', i)}` : i.t('Individual'),
    room.settings.mode === 'team' ? (room.settings.tableType === 'friends' ? i.t('Friends table') : i.t('Regular table')) : null,
    i.t('{n} points', { n: room.settings.matchTarget }),
    room.settings.turnTimer ? `⏱ ${i.t('{n} sec', { n: room.settings.turnTimer })}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="lobby2">
      {banner && <p className="notice" role="status">{banner}</p>}
      <header className="lobby-bar glass">
        <button className="icon-btn" onClick={() => send({ t: 'leave' })} aria-label={i.t('Leave room')} title={i.t('Leave room')}>←</button>
        <div className="lb-title">
          <b>{i.t('Room')} <button className="room-code code-chip" onClick={() => void copy('code')} title={i.t('Copy code')}>{room.code}</button>{copied === 'code' && <small className="copied">{i.t('Copied')}</small>}</b>
          <small>{settingsLine}</small>
        </div>
        <button className="icon-btn" onClick={() => void share()} aria-label={i.t('Copy invite link')} title={i.t('Copy invite link')}>{copied === 'link' ? '✓' : '🔗'}</button>
        <div className="lb-members" aria-label={i.t('In the lobby')}>
          {room.members.slice(0, 8).map((m) => (
            <span key={m.id} className={`lb-member ${m.online ? '' : 'away'}`} title={`${m.id === me ? i.t('You') : m.name}${m.handle ? ` @${m.handle}` : ''}${m.id === room.hostId ? ` · ${i.t('host')}` : ''}`}>
              <MemberFace m={m} small speaking={voice.speaking.has(m.id)} />
              {m.voice && <i className="lb-mic">{m.muted ? '🔇' : '🎙'}</i>}
            </span>
          ))}
        </div>
        <div className="lb-actions">
          {isHost && !playing && (confirmClose
            ? <><button className="btn small ghost" onClick={() => setConfirmClose(false)}>{i.t('Keep it')}</button><button className="btn small" onClick={() => send({ t: 'close' })}>{i.t('Close room')}</button></>
            : <button className="icon-btn" onClick={() => setConfirmClose(true)} aria-label={i.t('Close room')} title={i.t('Close room')}>✕</button>)}
          {isHost && !playing && <button className="btn brass small start-btn" disabled={!mySeat} onClick={() => send({ t: 'start' })} title={mySeat ? '' : i.t('Take a seat before you start.')}>▶ {i.t('Start game')}</button>}
          {!isHost && !playing && <small className="muted lb-wait">{i.t('Waiting for {p} to start the game.', { p: member(room.hostId)?.name || i.t('the host') })}</small>}
        </div>
      </header>
      {confirmClose && <p className="notice">{i.t('Close this room for everyone?')}</p>}
      {playing && <p className="notice">{mySeat ? i.t('Loading the table…') : i.t('A game is being played in this room. You can chat; you can sit down when it ends.')}</p>}
      {isHost && !playing && !mySeat && <p className="lobby-hint">{i.t('Take a seat before you start.')}</p>}

      <div className="lobby-body">
        <section className="seat-board" aria-label={i.t('Seats')}>
          {SEATS.map((s) => {
            const id = room.seats[s];
            const m = member(id);
            const mine = id === me;
            return (
              <div key={s} className={`seat-slot slot-${s} ${id ? 'taken' : ''} ${mine ? 'mine' : ''} ${room.settings.mode === 'team' ? `team-${teamOf(s)}` : ''}`}>
                <span className="slot-name">{seatLabel[s]}{room.settings.mode === 'team' && <em> · {teamName(room, teamOf(s), i)}</em>}</span>
                {id && m ? (
                  <div className="slot-who">
                    <MemberFace m={m} speaking={voice.speaking.has(m.id)} />
                    <div className="slot-text">
                      <strong>
                        <span className={`dot ${m.online ? 'on' : ''}`} aria-label={m.online ? i.t('online') : i.t('away')} />
                        <span>{mine ? i.t('You') : m.name || i.t('Someone')}</span>
                        {id === room.hostId && <span className="tag">{i.t('host')}</span>}
                      </strong>
                      {m.handle && <small className="handle">@{m.handle} · {i.t('Lv {n}', { n: m.level ?? 1 })}</small>}
                    </div>
                  </div>
                ) : (
                  <div className="slot-who empty"><span className="pface bot-face" aria-hidden>🤖</span><span className="muted">{i.t('Computer')}</span></div>
                )}
                {!id && !playing && <button className="btn small" onClick={() => send({ t: 'sit', seat: s })}>{i.t('Sit here')}</button>}
                {mine && !playing && <button className="btn small ghost" onClick={() => send({ t: 'stand' })}>{i.t('Stand up')}</button>}
              </div>
            );
          })}
          <div className="table-mark" aria-hidden>{room.settings.mode === 'team' ? i.t('Partners sit opposite') : ''}</div>
        </section>
        <div className="lobby-side">
          <VoiceBar voice={voice} room={room} me={me} />
          <Chat room={room} me={me} send={send} />
        </div>
      </div>
      {error && <p className="toast" role="alert">{i.t(error)}</p>}
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
  turn: TurnClock | null;
  room: RoomInfo; me: string; view: PlayerView; send: Send; error: string | null; clearError: () => void;
  reactions: ReturnType<typeof useReactions>['reactions']; hits: ReturnType<typeof useReactions>['hits']; banner: string | null;
  smacks: ReturnType<typeof useSmacks>['smacks']; voice: Voice;
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
  const { voice } = props;
  const extra = useCallback((seat: Seat) => {
    const id = room.seats[seat];
    const m = id ? room.members.find((x) => x.id === id) : undefined;
    if (!m) return { pic: { emoji: botEmoji(view.players[seat]?.name ?? seat) } };
    return { pic: memberPic(m.id, m.pic), handle: m.handle, level: m.level, voice: m.voice, muted: m.muted, speaking: voice.speaking.has(m.id), link: voice.joined && m.id !== me && m.voice ? voice.links[m.id] ?? 'connecting' : undefined };
  }, [room.seats, room.members, voice.speaking, voice.links, voice.joined, me, view.players]);
  return (
    <I18nProvider lang={settings.lang} friends={friends}>
      <SeatNameProvider resolve={resolve}>
        <SeatExtraProvider resolve={extra}>
          <TurnClockProvider clock={props.turn}>
            <TableWithNotices {...props} friends={friends} sweeping={sweeping} away={away} send={send} />
          </TurnClockProvider>
        </SeatExtraProvider>
      </SeatNameProvider>
    </I18nProvider>
  );
}

function TableWithNotices(props: Props & {
  room: RoomInfo; me: string; view: PlayerView; send: Send; error: string | null; clearError: () => void;
  reactions: ReturnType<typeof useReactions>['reactions']; hits: ReturnType<typeof useReactions>['hits']; banner: string | null;
  smacks: ReturnType<typeof useSmacks>['smacks']; voice: Voice;
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
    picOf: (id) => { const m = room.members.find((x) => x.id === id); return m ? memberPic(m.id, m.pic) : null; },
  }), [room.chat, room.seats, room.members, me, send]);
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
      onChangeSettings={props.saveSettings}
      exitLabel={i.t('Leave room')}
      voice={props.voice}
      notice={notice}
    />
  );
}

/** Your player card on the online screen. */
function ProfileStrip({ name, onEdit }: { name: string; onEdit: () => void }) {
  const i = useI18n();
  const profile = useProfile();
  const lv = levelOf(storage.loadStats()).level;
  const pic: PicInfo | null = profile.avatar ? (profile.avatar.startsWith('e:') ? { emoji: profile.avatar.slice(2) } : { src: profile.avatar }) : null;
  return (
    <button className="profile-chip glass wide" onClick={onEdit}>
      <Face pic={pic} name={name} color={colorFor(name)} />
      <span className="pc-text">
        <b>{name}</b>
        <small>{profile.handle ? `@${profile.handle}` : i.t('Create your player ID and add a photo')} · {i.t('Level {n}', { n: lv })}</small>
      </span>
      <span className="pc-edit">{i.t('Edit')}</span>
    </button>
  );
}

function MemberFace({ m, small, speaking }: { m: MemberInfo; small?: boolean; speaking?: boolean }) {
  return <Face pic={memberPic(m.id, m.pic)} name={m.name} color={colorFor(m.name)} className={`member-face ${small ? 'sm' : ''} ${speaking ? 'speaking' : ''}`} />;
}

/** Join / mute / leave the room's voice chat. */
export function VoiceBar({ voice, room, me }: { voice: Voice; room: RoomInfo; me: string }) {
  const i = useI18n();
  const inCall = room.members.filter((m) => m.voice);
  return (
    <section className={`voice-bar glass ${voice.joined ? 'on' : ''}`} aria-label={i.t('Voice chat')}>
      <div className="vb-head">
        <h3>🎧 {i.t('Voice chat')}</h3>
        <span className="muted">{inCall.length ? i.t('{n} talking here', { n: inCall.length }) : i.t('Nobody in voice yet')}</span>
      </div>
      <div className="vb-people">
        {inCall.map((m) => (
          <span key={m.id} className={`vb-person ${voice.speaking.has(m.id) ? 'speaking' : ''} ${voice.joined && m.id !== me ? `link-${voice.links[m.id] ?? 'connecting'}` : ''}`}>
            <MemberFace m={m} small speaking={voice.speaking.has(m.id)} />
            {m.id === me ? i.t('You') : m.name}{m.muted ? ' 🔇' : ''}
            {voice.joined && m.id !== me && voice.links[m.id] !== 'connected' && (
              <small className="link-note">{voice.links[m.id] === 'trouble' ? i.t('reconnecting…') : i.t('connecting…')}</small>
            )}
          </span>
        ))}
      </div>
      <div className="row-gap">
        {!voice.joined
          ? <button className="btn brass" disabled={!voice.supported || voice.joining} onClick={voice.join}>🎙 {voice.joining ? i.t('Connecting…') : i.t('Join voice')}</button>
          : <>
              <button className={`btn ${voice.muted ? '' : 'brass'}`} onClick={voice.toggleMute}>{voice.muted ? `🔇 ${i.t('Unmute')}` : `🎙 ${i.t('Mute')}`}</button>
              <button className="btn ghost" onClick={voice.leave}>{i.t('Leave voice')}</button>
            </>}
      </div>
      {(voice.error || !voice.supported) && <p className="form-error">{i.t(voice.error ?? 'Voice chat does not work in this browser.')}</p>}
    </section>
  );
}

/** Small sounds for people arriving and joining the voice chat. */
function useRoomSounds(room: RoomInfo | null, me: string | null) {
  const prev = useRef<RoomInfo | null>(null);
  useEffect(() => {
    const p = prev.current;
    prev.current = room;
    if (!p || !room || p.code !== room.code) return;
    const was = new Set(p.members.filter((m) => m.online).map((m) => m.id));
    if (room.members.some((m) => m.online && m.id !== me && !was.has(m.id))) playJoin();
    const vWas = new Set(p.members.filter((m) => m.voice).map((m) => m.id));
    const vNow = new Set(room.members.filter((m) => m.voice).map((m) => m.id));
    if ([...vNow].some((id) => !vWas.has(id))) playVoiceJoin(true);
    else if ([...vWas].some((id) => !vNow.has(id))) playVoiceJoin(false);
  }, [room, me]);
}

function lsTeam(k: 'X' | 'Y'): string {
  try { const v = JSON.parse(localStorage.getItem('ib.teamNames') ?? '{}')[k]; return typeof v === 'string' && v !== `Team ${k}` ? v : ''; } catch { return ''; }
}
function teamName(room: RoomInfo, t: 'X' | 'Y', i: ReturnType<typeof useI18n>): string {
  const n = room.settings.teamNames?.[t];
  return n && n !== `Team ${t}` ? n : i.t(t === 'X' ? 'Team X' : 'Team Y');
}
