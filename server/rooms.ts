/**
 * Rooms and the server-side game loop. The server is the only place a game's full state lives:
 * it applies every move through the engine, runs computer players, and sends each seated
 * player only their own PlayerView.
 */
import { randomBytes, randomInt } from 'node:crypto';
import type { Action, GameState, Rng, RuleConfig, Seat } from '../src/engine/types';
import { applyAction, createMatch } from '../src/engine/game';
import { getPlayerView } from '../src/engine/view';
import { DEFAULT_RULES, MATCH_TARGETS } from '../src/engine/config';
import { SEATS, areOpponents, teamOf } from '../src/engine/seating';
import { decideAIAction } from '../src/ai';
import { resolveTrickWinner } from '../src/engine/rules';
import { automaticAction } from '../src/ai/simulate';
import {
  AWAY_MS, PACE_FACTOR, PACE_MS, ROOM_CODE_ALPHABET, TIMED_PHASES, TURN_TIMERS, cleanName,
  type ChatMsg, type ClientMsg, type RoomInfo, type RoomSettings, type ServerMsg,
} from '../src/online/protocol';
import { KIND, MEAN, isEmoji } from '../src/online/emojis';
import { Profiles } from './profiles';

/** Server randomness: crypto-strength, never Math.random. */
export const serverRng: Rng = () => randomBytes(4).readUInt32BE(0) / 4294967296;

export interface Client {
  id: string;
  name: string;
  room: string | null;
  send(msg: ServerMsg): void;
  /** Binary frames (voice audio). Optional so test clients can leave it out. */
  sendBinary?(data: Uint8Array): void;
}

interface Member { name: string; sockets: Set<Client>; lastSeen: number; awaySince: number | null; voice?: boolean; muted?: boolean; vs?: string }

export interface Room {
  code: string;
  hostId: string;
  status: 'lobby' | 'playing' | 'over';
  settings: RoomSettings;
  seats: Record<Seat, string | null>;
  members: Map<string, Member>;
  chat: ChatMsg[];
  chatSeq: number;
  game: GameState | null;
  timer: NodeJS.Timeout | null;
  createdAt: number;
  lastActive: number;
  lastThrowAt: number;
  /** Seats that already smacked in the current trick (key = trick index). */
  smacked: { trick: number; seats: Seat[] };
  lastBotSmackAt: number;
  /** The running move timer (not saved). */
  turn?: { game: GameState; seat: Seat; at: number; total: number } | null;
}

const MAX_ROOMS = 500;
const MAX_MEMBERS = 12;
const CHAT_KEEP = 100;

export class RoomManager {
  rooms = new Map<string, Room>();
  profiles = new Profiles();
  /** Set by the server to persist changes (optional). */
  onDirty: () => void = () => undefined;

  // ---------------------------------------------------------------- messages

  handle(c: Client, m: ClientMsg): void {
    switch (m.t) {
      case 'create': return this.create(c, m.settings);
      case 'join': return this.join(c, m.code);
      case 'leave': return this.leave(c, true);
      case 'rename': return this.rename(c);
      case 'sit': return this.sit(c, m.seat);
      case 'stand': return this.stand(c);
      case 'chat': return this.chat(c, m.text);
      case 'start': return this.start(c);
      case 'act': return this.act(c, m.action);
      case 'throw': return this.throwEmoji(c, m.to, m.e);
      case 'smack': return this.smack(c);
      case 'profile': return this.setProfile(c, m.handle, m.avatar, m.level);
      case 'voice': return this.voice(c, !!m.on, !!m.muted, String(m.vs ?? '').slice(0, 16));
      case 'rtc': return this.rtc(c, String(m.to ?? ''), m.data);
      case 'lobby': return this.backToLobby(c);
      case 'close': return this.close(c);
      default: return undefined;
    }
  }

  private err(c: Client, msg: string) { c.send({ t: 'error', msg }); }

  private roomOf(c: Client): Room | null {
    if (!c.room) return null;
    return this.rooms.get(c.room) ?? null;
  }

  private newCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < 5; i++) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
  }

  private create(c: Client, raw: RoomSettings) {
    if (this.rooms.size >= MAX_ROOMS) return this.err(c, 'The server is full right now. Try again later.');
    const settings = sanitizeSettings(raw);
    if (c.room) this.leave(c, false);
    const now = Date.now();
    const room: Room = {
      code: this.newCode(), hostId: c.id, status: 'lobby', settings,
      seats: { A: null, B: null, C: null, D: null }, members: new Map(), chat: [], chatSeq: 0,
      game: null, timer: null, createdAt: now, lastActive: now, lastThrowAt: 0,
      smacked: { trick: 0, seats: [] }, lastBotSmackAt: 0,
    };
    this.rooms.set(room.code, room);
    this.attach(c, room);
    this.onDirty();
  }

  private join(c: Client, rawCode: string) {
    const code = String(rawCode ?? '').toUpperCase();
    const room = this.rooms.get(code);
    if (!room) { c.send({ t: 'left', reason: 'missing' }); return; }
    if (!room.members.has(c.id) && room.members.size >= MAX_MEMBERS) return this.err(c, 'This room is full.');
    if (c.room && c.room !== code) this.leave(c, false);
    this.attach(c, room);
  }

  private attach(c: Client, room: Room) {
    c.room = room.code;
    const m = room.members.get(c.id) ?? { name: c.name, sockets: new Set<Client>(), lastSeen: Date.now(), awaySince: null };
    m.name = c.name;
    m.sockets.add(c);
    m.awaySince = null;
    m.lastSeen = Date.now();
    room.members.set(c.id, m);
    room.lastActive = Date.now();
    this.broadcastRoom(room);
    this.sendView(room, c);
    if (room.turn) c.send({ t: 'turn', seat: room.turn.seat, ms: Math.max(0, room.turn.at - Date.now()), total: room.turn.total });
    this.pump(room);
  }

  /** A socket closed. The member stays in the room (they can come back), but is marked away. */
  disconnected(c: Client) {
    const room = this.roomOf(c);
    if (!room) return;
    const m = room.members.get(c.id);
    if (!m) return;
    m.sockets.delete(c);
    if (m.sockets.size === 0) { m.awaySince = Date.now(); m.lastSeen = Date.now(); m.voice = false; }
    this.broadcastRoom(room);
    this.pump(room);
  }

  private leave(c: Client, tell: boolean) {
    const room = this.roomOf(c);
    c.room = null;
    if (!room) return;
    const m = room.members.get(c.id);
    if (m) { m.sockets.delete(c); if (m.sockets.size === 0) m.voice = false; }
    // Leaving for real (not just a dropped connection): free your lobby seat and your membership.
    if (!m || m.sockets.size === 0) {
      if (room.status === 'lobby') {
        for (const s of SEATS) if (room.seats[s] === c.id) room.seats[s] = null;
        room.members.delete(c.id);
      } else if (m) {
        m.awaySince = Date.now();
      }
      if (room.hostId === c.id) this.passHost(room);
    }
    if (tell) c.send({ t: 'left', reason: 'left' });
    if (room.members.size === 0) this.deleteRoom(room);
    else { this.broadcastRoom(room); this.pump(room); }
    this.onDirty();
  }

  private passHost(room: Room) {
    const online = [...room.members.entries()].find(([id, m]) => id !== room.hostId && m.sockets.size > 0);
    const any = [...room.members.keys()].find((id) => id !== room.hostId);
    const next = online?.[0] ?? any;
    if (next) room.hostId = next;
  }

  private rename(c: Client) {
    const room = this.roomOf(c);
    if (!room) return;
    const m = room.members.get(c.id);
    if (m) m.name = c.name;
    if (room.game) for (const s of SEATS) if (room.seats[s] === c.id) room.game.players[s].name = c.name;
    this.broadcastRoom(room);
    this.broadcastViews(room);
  }

  private sit(c: Client, seat: Seat) {
    const room = this.roomOf(c);
    if (!room || !SEATS.includes(seat)) return;
    if (room.status !== 'lobby') return this.err(c, 'Seats are fixed once the game has started.');
    if (room.seats[seat] && room.seats[seat] !== c.id) return this.err(c, 'Someone else just took that seat.');
    for (const s of SEATS) if (room.seats[s] === c.id) room.seats[s] = null;
    room.seats[seat] = c.id;
    room.lastActive = Date.now();
    this.broadcastRoom(room);
  }

  private stand(c: Client) {
    const room = this.roomOf(c);
    if (!room || room.status !== 'lobby') return;
    for (const s of SEATS) if (room.seats[s] === c.id) room.seats[s] = null;
    this.broadcastRoom(room);
  }

  private chat(c: Client, text: string) {
    const room = this.roomOf(c);
    if (!room) return;
    const clean = String(text ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!clean) return;
    room.chat.push({ id: ++room.chatSeq, from: c.id, name: c.name, text: clean, at: Date.now() });
    if (room.chat.length > CHAT_KEEP) room.chat.splice(0, room.chat.length - CHAT_KEEP);
    room.lastActive = Date.now();
    this.broadcastRoom(room);
    this.onDirty();
  }

  private start(c: Client) {
    const room = this.roomOf(c);
    if (!room) return;
    if (room.hostId !== c.id) return this.err(c, 'Only the host can start the game.');
    if (room.status === 'playing') return;
    if (!SEATS.some((s) => room.seats[s] === c.id)) return this.err(c, 'Take a seat before you start.');
    let bot = 0;
    room.game = createMatch({
      mode: room.settings.mode,
      matchTarget: room.settings.matchTarget,
      rules: room.settings.rules,
      teamNames: { X: room.settings.teamNames?.X || 'Team X', Y: room.settings.teamNames?.Y || 'Team Y' },
      rng: serverRng,
      players: Object.fromEntries(SEATS.map((s) => {
        const id = room.seats[s];
        const name = id ? room.members.get(id)?.name || 'Player' : `Bot ${++bot}`;
        return [s, { name, type: id ? 'human' as const : 'ai' as const }];
      })) as Record<Seat, { name: string; type: 'human' | 'ai' }>,
    });
    room.status = 'playing';
    room.lastActive = Date.now();
    this.broadcastRoom(room);
    this.broadcastViews(room);
    this.pump(room);
    this.onDirty();
  }

  private seatOf(room: Room, id: string): Seat | null {
    return SEATS.find((s) => room.seats[s] === id) ?? null;
  }

  private act(c: Client, action: Action) {
    const room = this.roomOf(c);
    if (!room?.game || room.status === 'lobby') return;
    const seat = this.seatOf(room, c.id);
    if (!seat) return this.err(c, 'You are watching this game, not playing in it.');
    if (!action || typeof action !== 'object') return;
    // The seat always comes from the connection, never from the message.
    const a = { ...action, seat } as Action;
    if (a.type === 'NEXT_ROUND') delete (a as { seat?: Seat }).seat;
    const allowed = ['CUT', 'BID', 'PASS', 'CALL_RESHUFFLE', 'RESERVE', 'BONUS_CALL', 'BONUS_PASS', 'REVEAL_VOLUNTARY', 'REQUEST_REVEAL', 'PLAY_CARD', 'NEXT_ROUND'];
    if (!allowed.includes(a.type)) return this.err(c, 'Unknown action');
    const m = room.members.get(c.id);
    if (m) m.awaySince = null;
    const errMsg = this.apply(room, a);
    if (errMsg) this.err(c, errMsg);
  }

  /** Apply one action to the room's game, broadcast, and continue the loop. */
  private apply(room: Room, a: Action): string | null {
    if (!room.game) return 'No game';
    const prev = room.game;
    const r = applyAction(prev, a, serverRng);
    if (!r.ok) return r.error;
    room.game = r.state;
    room.lastActive = Date.now();
    if (r.state.phase === 'MATCH_OVER') room.status = 'over';
    this.afterChange(room, prev, r.state);
    this.broadcastViews(room);
    if (prev.phase !== r.state.phase) this.broadcastRoom(room);
    this.pump(room);
    this.onDirty();
    return null;
  }

  private backToLobby(c: Client) {
    const room = this.roomOf(c);
    if (!room || room.hostId !== c.id || room.status !== 'over') return;
    room.status = 'lobby';
    room.game = null;
    this.clearTimer(room);
    this.broadcastRoom(room);
    this.onDirty();
  }

  private close(c: Client) {
    const room = this.roomOf(c);
    if (!room || room.hostId !== c.id) return;
    for (const m of room.members.values()) for (const s of m.sockets) { s.room = null; s.send({ t: 'left', reason: 'closed' }); }
    this.deleteRoom(room);
    this.onDirty();
  }

  private deleteRoom(room: Room) {
    this.clearTimer(room);
    this.rooms.delete(room.code);
  }

  // ---------------------------------------------------------------- the game loop

  private clearTimer(room: Room) {
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
  }

  /** Schedule the next automatic step (dealing, collecting tricks, computer turns, away players). */
  pump(room: Room) {
    this.clearTimer(room);
    const s = room.game;
    if (!s || room.status === 'lobby') { this.stopTurn(room); return; }
    if (room.turn && room.turn.game !== s) this.stopTurn(room);
    const k = PACE_FACTOR[room.settings.pace];
    if (s.phase === 'PLAYING' && s.currentTrick?.plays.length === 4) {
      const ms = (PACE_MS.TRICK_SHOW + PACE_MS.TRICK_GATHER + PACE_MS.TRICK_SLIDE) * k + 120;
      room.timer = setTimeout(() => this.apply(room, { type: 'COLLECT_TRICK' }), ms);
      return;
    }
    const auto = automaticAction(s);
    if (auto) {
      const ms = (PACE_MS[s.phase as keyof typeof PACE_MS] ?? 800) * k;
      room.timer = setTimeout(() => this.apply(room, auto), ms);
      return;
    }
    const seat = s.currentPlayer;
    if (!seat) return;
    const id = room.seats[seat];
    const human = !!id;
    let delay = (PACE_MS[s.phase as keyof typeof PACE_MS] ?? 1000) * k;
    if (human) {
      const m = room.members.get(id!);
      const online = !!m && m.sockets.size > 0;
      // With the move timer on, the timer decides (online or not); otherwise wait for them.
      if (room.settings.turnTimer && (TIMED_PHASES as readonly string[]).includes(s.phase)) { this.armTurn(room, seat); return; }
      if (online) return;
      const awayFor = m?.awaySince ? Date.now() - m.awaySince : AWAY_MS;
      if (awayFor < AWAY_MS) {
        room.timer = setTimeout(() => { this.broadcastRoom(room); this.pump(room); }, AWAY_MS - awayFor + 50);
        return;
      }
      delay = 900;
    }
    room.timer = setTimeout(() => {
      if (!room.game) return;
      const action = decideAIAction(getPlayerView(room.game, seat), room.settings.difficulty, serverRng);
      if (!action) return;
      const err = this.apply(room, action);
      if (err) console.error(`[${room.code}] computer move rejected`, action, err);
    }, delay);
  }

  /** Start (or keep) the move timer for a human on their turn; the computer moves for them when it runs out. */
  private armTurn(room: Room, seat: Seat) {
    const s = room.game!;
    const secs = room.settings.turnTimer ?? 0;
    if (!secs || !(TIMED_PHASES as readonly string[]).includes(s.phase)) { this.stopTurn(room); return; }
    const total = secs * 1000 + (s.phase === 'PLAYING' && s.currentTrick?.plays.length === 0 && s.completedTricks.length === 0 ? 1500 : 0);
    if (!room.turn || room.turn.game !== s || room.turn.seat !== seat) {
      room.turn = { game: s, seat, at: Date.now() + total, total };
      this.broadcast(room, { t: 'turn', seat, ms: total, total });
    }
    const left = Math.max(0, room.turn.at - Date.now());
    room.timer = setTimeout(() => {
      if (!room.game || room.game !== s) return;
      room.turn = null;
      const action = decideAIAction(getPlayerView(room.game, seat), room.settings.difficulty, serverRng);
      if (!action) return;
      const err = this.apply(room, action);
      if (err) console.error(`[${room.code}] timed-out move rejected`, action, err);
    }, left + 250);
  }

  private stopTurn(room: Room) {
    if (!room.turn) return;
    room.turn = null;
    this.broadcast(room, { t: 'turn', seat: null, ms: 0, total: 0 });
  }

  /** Computer players' emoji habits on a Friends table. */
  private afterChange(room: Room, prev: GameState, s: GameState) {
    this.botSmack(room, prev, s);
    if (room.settings.tableType !== 'friends' || room.settings.mode !== 'team') return;
    const isBot = (seat: Seat) => !room.seats[seat];
    const pick = <T,>(xs: readonly T[]) => xs[randomInt(xs.length)];
    if (s.completedTricks.length > prev.completedTricks.length && serverRng() < 0.3) {
      const w = s.completedTricks[s.completedTricks.length - 1].winner;
      if (isBot(w)) this.botThrow(room, w, pick(SEATS.filter((x) => areOpponents(w, x, s.mode))), pick(MEAN), 400);
      else {
        const losers = SEATS.filter((x) => isBot(x) && areOpponents(x, w, s.mode));
        if (losers.length) this.botThrow(room, pick(losers), w, pick(['🍅', '🥚', '😭', '🐔']), 400);
      }
    }
    if (s.phase === 'ROUND_RESULT' && prev.phase !== 'ROUND_RESULT' && s.trump.bidder) {
      const b = s.trump.bidder;
      const made = s.roundHistory[s.roundHistory.length - 1]?.teams?.find((t) => t.id === teamOf(b))?.roundScore ?? 0;
      const opp = SEATS.filter((x) => isBot(x) && areOpponents(x, b, s.mode));
      if (made < 0 && opp.length) this.botThrow(room, pick(opp), b, pick(['😂', '🤡', '💩']), 900);
      else if (made > 0 && isBot(b)) this.botThrow(room, b, pick(SEATS.filter((x) => x !== b)), pick(['🔥', '😘', '👏']), 900);
    }
  }

  private botThrow(room: Room, from: Seat, to: Seat, e: string, delay: number) {
    const now = Date.now();
    if (now - room.lastThrowAt < 3000) return;
    room.lastThrowAt = now;
    setTimeout(() => this.broadcast(room, { t: 'throw', from, to, e }), delay);
  }

  /** Save a player's ID and picture; everyone in their room sees the change. */
  private setProfile(c: Client, handle: string, avatar: string | null, level: number) {
    const error = this.profiles.set(c.id, handle, avatar, level);
    c.send({ t: 'profile', ok: !error, handle: String(handle ?? ''), ...(error ? { error } : {}) });
    this.onDirty();
    const room = this.roomOf(c);
    if (room) this.broadcastRoom(room);
  }

  /** Join or leave the room's voice chat, or mute. */
  private voice(c: Client, on: boolean, muted: boolean, vs: string) {
    const room = this.roomOf(c);
    const m = room?.members.get(c.id);
    if (!room || !m) return;
    if (m.voice === on && m.muted === muted && (m.vs ?? '') === vs) return;
    m.voice = on;
    m.muted = on && muted;
    m.vs = on ? vs : '';
    this.broadcastRoom(room);
  }

  /**
   * Voice audio relay: a binary frame from a voice member goes to every other voice member of
   * the room, tagged with the sender's id. Frame in:  [1, ...payload]
   *                                           frame out: [2, idLength, ...id, ...payload]
   */
  voiceData(c: Client, frame: Uint8Array) {
    if (frame.length < 7 || frame.length > 2048 || frame[0] !== 1) return;
    const room = this.roomOf(c);
    const from = room?.members.get(c.id);
    if (!room || !from?.voice || from.muted) return;
    const id = Buffer.from(c.id, 'utf8');
    const out = new Uint8Array(2 + id.length + frame.length - 1);
    out[0] = 2; out[1] = id.length; out.set(id, 2); out.set(frame.subarray(1), 2 + id.length);
    for (const [mid, m] of room.members) {
      if (mid === c.id || !m.voice) continue;
      for (const s of m.sockets) s.sendBinary?.(out);
    }
  }

  /** Voice call set-up messages between two people in the same room's voice chat (relayed, never read). */
  private rtc(c: Client, to: string, data: unknown) {
    const room = this.roomOf(c);
    if (!room || to === c.id) return;
    const from = room.members.get(c.id);
    const target = room.members.get(to);
    if (!from?.voice || !target?.voice) return;
    for (const s of target.sockets) s.send({ t: 'rtc', from: c.id, data });
  }

  /** SMACK / বাড়ি: once per trick, right after playing your card — until the next player plays. */
  private trySmack(room: Room, seat: Seat): boolean {
    const t = room.game?.currentTrick;
    if (!t || room.game?.phase !== 'PLAYING' || t.plays.length === 0 || t.plays[t.plays.length - 1].seat !== seat) return false;
    if (room.smacked.trick !== t.index) room.smacked = { trick: t.index, seats: [] };
    if (room.smacked.seats.includes(seat)) return false;
    room.smacked.seats.push(seat);
    this.broadcast(room, { t: 'smack', seat });
    return true;
  }

  private smack(c: Client) {
    const room = this.roomOf(c);
    if (!room?.game) return;
    const seat = this.seatOf(room, c.id);
    if (seat) this.trySmack(room, seat);
  }

  /** Computer players sometimes smack a strong winning card. */
  private botSmack(room: Room, prev: GameState, s: GameState) {
    const t = s.currentTrick;
    if (!t || s.phase !== 'PLAYING' || t.plays.length <= (prev.currentTrick?.index === t.index ? prev.currentTrick.plays.length : 0)) return;
    const last = t.plays[t.plays.length - 1];
    if (room.seats[last.seat]) return; // a person — they smack themselves
    const now = Date.now();
    if (now - room.lastBotSmackAt < 6000) return;
    const winning = resolveTrickWinner(t.plays, t.plays[0].card.suit, s.trump.revealed ? s.trump.suit : null) === last.seat;
    if (!winning || (last.card.strength < 13 && !(s.trump.revealed && last.card.suit === s.trump.suit)) || serverRng() > 0.35) return;
    room.lastBotSmackAt = now;
    setTimeout(() => this.trySmack(room, last.seat), 350);
  }

  private throwEmoji(c: Client, to: Seat, e: string) {
    const room = this.roomOf(c);
    if (!room?.game || room.settings.tableType !== 'friends' || room.settings.mode !== 'team') return;
    const from = this.seatOf(room, c.id);
    if (!from || !SEATS.includes(to) || to === from || !isEmoji(e)) return;
    this.broadcast(room, { t: 'throw', from, to, e });
    // A computer player sometimes answers back.
    if (!room.seats[to] && serverRng() < 0.5) {
      const reply = KIND.has(e) ? ['❤️', '😘', '👏'][randomInt(3)] : MEAN[randomInt(MEAN.length)];
      room.lastThrowAt = 0;
      this.botThrow(room, to, from, reply, 1500);
    }
  }

  // ---------------------------------------------------------------- broadcasting

  private broadcast(room: Room, msg: ServerMsg) {
    for (const m of room.members.values()) for (const s of m.sockets) s.send(msg);
  }

  info(room: Room): RoomInfo {
    const autoplay: Seat[] = [];
    if (room.game && room.status === 'playing') {
      for (const s of SEATS) {
        const id = room.seats[s];
        const m = id ? room.members.get(id) : null;
        if (id && (!m || (m.sockets.size === 0 && m.awaySince && Date.now() - m.awaySince >= AWAY_MS))) autoplay.push(s);
      }
    }
    return {
      code: room.code,
      hostId: room.hostId,
      status: room.status,
      settings: room.settings,
      seats: { ...room.seats },
      members: [...room.members.entries()].map(([id, m]) => {
        const p = this.profiles.get(id);
        return { id, name: m.name, online: m.sockets.size > 0, handle: p?.handle || null, pic: p?.pic ?? null, level: p?.level ?? 1, voice: !!m.voice, muted: !!m.muted, vs: m.vs ?? '' };
      }),
      chat: room.chat.slice(-CHAT_KEEP),
      autoplay,
    };
  }

  private broadcastRoom(room: Room) {
    this.broadcast(room, { t: 'room', room: this.info(room) });
  }

  private sendView(room: Room, c: Client) {
    if (!room.game) return;
    const seat = this.seatOf(room, c.id);
    if (seat) c.send({ t: 'view', view: getPlayerView(room.game, seat) });
  }

  private broadcastViews(room: Room) {
    if (!room.game) return;
    for (const s of SEATS) {
      const id = room.seats[s];
      if (!id) continue;
      const m = room.members.get(id);
      if (!m || m.sockets.size === 0) continue;
      const view = getPlayerView(room.game, s);
      for (const sock of m.sockets) sock.send({ t: 'view', view });
    }
  }

  // ---------------------------------------------------------------- housekeeping

  /** Remove rooms nobody has used for a while. */
  sweep(now = Date.now()) {
    for (const room of [...this.rooms.values()]) {
      const online = [...room.members.values()].some((m) => m.sockets.size > 0);
      if (online) continue;
      const idle = now - room.lastActive;
      if ((room.status === 'lobby' && idle > 2 * 3600_000) || idle > 12 * 3600_000) this.deleteRoom(room);
    }
  }

  /** Serializable snapshot for an optional data file. */
  snapshot() {
    return [...this.rooms.values()].map((r) => ({
      code: r.code, hostId: r.hostId, status: r.status, settings: r.settings, seats: r.seats,
      members: [...r.members.entries()].map(([id, m]) => ({ id, name: m.name })),
      chat: r.chat, chatSeq: r.chatSeq, game: r.game, createdAt: r.createdAt, lastActive: r.lastActive,
    }));
  }

  restore(rows: ReturnType<RoomManager['snapshot']>) {
    const now = Date.now();
    for (const r of rows) {
      this.rooms.set(r.code, {
        ...r, settings: sanitizeSettings(r.settings),
        members: new Map(r.members.map((m) => [m.id, { name: m.name, sockets: new Set(), lastSeen: now, awaySince: now }])),
        timer: null, lastThrowAt: 0, smacked: { trick: 0, seats: [] }, lastBotSmackAt: 0,
      });
    }
  }
}

export function sanitizeSettings(raw: Partial<RoomSettings> | undefined): RoomSettings {
  const r = raw ?? {};
  const rules: RuleConfig = { ...DEFAULT_RULES };
  const given = (r.rules ?? {}) as Partial<RuleConfig>;
  for (const k of Object.keys(DEFAULT_RULES) as (keyof RuleConfig)[]) {
    if (typeof given[k] === typeof DEFAULT_RULES[k]) (rules as unknown as Record<string, unknown>)[k] = given[k];
  }
  // Keep the core numbers fixed; they are not house rules.
  rules.minBid = 7; rules.maxBid = 10; rules.bonusBid = 10; rules.bonusPoints = 13; rules.passTarget = 5; rules.passPoints = 5; rules.cutter = 'beforeDealer';
  const mode = r.mode === 'individual' ? 'individual' : 'team';
  return {
    mode,
    matchTarget: (MATCH_TARGETS as readonly number[]).includes(Number(r.matchTarget)) ? Number(r.matchTarget) : 30,
    tableType: mode === 'team' && r.tableType === 'friends' ? 'friends' : 'regular',
    difficulty: r.difficulty === 'easy' || r.difficulty === 'hard' ? r.difficulty : 'normal',
    pace: r.pace === 'fast' ? 'fast' : 'normal',
    rules,
    teamNames: {
      X: cleanName(String(r.teamNames?.X ?? '')) || 'Team X',
      Y: cleanName(String(r.teamNames?.Y ?? '')) || 'Team Y',
    },
    turnTimer: (TURN_TIMERS as readonly number[]).includes(Number(r.turnTimer)) ? Number(r.turnTimer) : 0,
  };
}

export { cleanName };
