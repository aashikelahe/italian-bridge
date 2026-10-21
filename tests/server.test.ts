import { RoomManager, sanitizeSettings, type Client } from '../server/rooms';
import type { ServerMsg, RoomInfo, RoomSettings } from '../src/online/protocol';
import type { PlayerView } from '../src/engine/view';
import { decideAIAction } from '../src/ai';
import { seededRng, DEFAULT_RULES, type Seat } from '../src/engine';

interface Fake extends Client { inbox: ServerMsg[]; lastRoom(): RoomInfo | null; lastView(): PlayerView | null }

function fake(id: string, name = id): Fake {
  const inbox: ServerMsg[] = [];
  return {
    id, name, room: null, inbox,
    send: (m) => inbox.push(JSON.parse(JSON.stringify(m))),
    lastRoom: () => [...inbox].reverse().find((m): m is Extract<ServerMsg, { t: 'room' }> => m.t === 'room')?.room ?? null,
    lastView: () => [...inbox].reverse().find((m): m is Extract<ServerMsg, { t: 'view' }> => m.t === 'view')?.view ?? null,
  };
}

const SETTINGS: RoomSettings = { mode: 'team', matchTarget: 30, tableType: 'friends', difficulty: 'normal', pace: 'fast', rules: DEFAULT_RULES };

function setup() {
  const rm = new RoomManager();
  const host = fake('host', 'Ashik');
  const guest = fake('guest', 'Rahim');
  rm.handle(host, { t: 'create', settings: SETTINGS });
  const code = host.lastRoom()!.code;
  rm.handle(guest, { t: 'join', code });
  rm.handle(host, { t: 'sit', seat: 'C' });
  rm.handle(guest, { t: 'sit', seat: 'A' });
  return { rm, host, guest, code };
}

/** Let each human act like a computer player whenever it is their turn, while time passes. */
function playUntil(rm: RoomManager, code: string, people: Record<string, Fake>, done: () => boolean, maxSteps = 4000) {
  const rng = seededRng(5);
  for (let i = 0; i < maxSteps && !done(); i++) {
    vi.advanceTimersByTime(500);
    const g = rm.rooms.get(code)!.game!;
    for (const p of Object.values(people)) {
      const seat = (['A', 'B', 'C', 'D'] as Seat[]).find((s) => rm.rooms.get(code)!.seats[s] === p.id);
      const v = p.lastView();
      if (!seat || !v || g.currentPlayer !== seat) continue;
      const a = decideAIAction(v, 'normal', rng);
      if (a) rm.handle(p, { t: 'act', action: a });
    }
  }
}

describe('game server rooms', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('creates a room with a 5-character code and lets a friend join, sit and chat', () => {
    const { host, guest, code } = setup();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
    const r = guest.lastRoom()!;
    expect(r.members.map((m) => m.name).sort()).toEqual(['Ashik', 'Rahim']);
    expect(r.seats.C).toBe('host');
    expect(r.seats.A).toBe('guest');
    expect(host.lastRoom()!.hostId).toBe('host');
  });

  it('chat is shared, trimmed and limited', () => {
    const { rm, host, guest } = setup();
    rm.handle(guest, { t: 'chat', text: '  hello   from <b>Rahim</b>  ' });
    rm.handle(guest, { t: 'chat', text: '   ' });
    const chat = host.lastRoom()!.chat;
    expect(chat).toHaveLength(1);
    expect(chat[0].text).toBe('hello from <b>Rahim</b>');
    rm.handle(guest, { t: 'chat', text: 'x'.repeat(1000) });
    expect(host.lastRoom()!.chat[1].text).toHaveLength(300);
  });

  it('a taken seat cannot be stolen, and only the host can start', () => {
    const { rm, guest, host } = setup();
    rm.handle(guest, { t: 'sit', seat: 'C' });
    expect(guest.inbox.at(-1)).toEqual({ t: 'error', msg: 'Someone else just took that seat.' });
    rm.handle(guest, { t: 'start' });
    expect(guest.inbox.at(-1)).toEqual({ t: 'error', msg: 'Only the host can start the game.' });
    rm.handle(host, { t: 'start' });
    expect(host.lastRoom()!.status).toBe('playing');
  });

  it('each player only ever receives their own cards', () => {
    const { rm, host, guest, code } = setup();
    rm.handle(host, { t: 'start' });
    vi.advanceTimersByTime(20_000);
    const g = rm.rooms.get(code)!.game!;
    const others = (['B', 'C', 'D'] as Seat[]).flatMap((s) => g.players[s].hand.map((c) => c.id));
    const views = guest.inbox.filter((m) => m.t === 'view') as Extract<ServerMsg, { t: 'view' }>[];
    expect(views.length).toBeGreaterThan(0);
    for (const v of views) {
      const text = JSON.stringify(v.view.hand) + JSON.stringify(v.view.myReserved);
      for (const id of others) expect(text).not.toContain(`"${id}"`);
      expect(v.view.seat).toBe('A');
    }
    expect(host.lastView()!.seat).toBe('C');
  });

  it('plays a whole round with two people and two computer players', () => {
    const { rm, host, guest, code } = setup();
    rm.handle(host, { t: 'start' });
    playUntil(rm, code, { host, guest }, () => rm.rooms.get(code)!.game!.phase === 'ROUND_RESULT');
    const g = rm.rooms.get(code)!.game!;
    expect(g.phase).toBe('ROUND_RESULT');
    expect(g.completedTricks).toHaveLength(13);
    expect(g.teams!.reduce((n, t) => n + Math.abs(t.roundScore), 0)).toBeGreaterThan(0);
    expect(guest.lastView()!.roundHistory).toHaveLength(1);
    // Anyone seated may continue to the next round.
    rm.handle(guest, { t: 'act', action: { type: 'NEXT_ROUND' } });
    expect(rm.rooms.get(code)!.game!.round).toBe(2);
  });

  it('a move is always made for the sender’s own seat, whatever the message says', () => {
    const { rm, host, guest, code } = setup();
    rm.handle(host, { t: 'start' });
    let g = rm.rooms.get(code)!.game!;
    for (let i = 0; i < 100 && g.phase !== 'BIDDING'; i++) {
      // A person may be the one who cuts.
      if (g.phase === 'CUT') for (const p of [host, guest]) rm.handle(p, { t: 'act', action: { type: 'CUT', seat: 'A', position: 20 } });
      vi.advanceTimersByTime(1000);
      g = rm.rooms.get(code)!.game!;
    }
    expect(g.phase).toBe('BIDDING');
    const cur = g.currentPlayer!;
    // The guest (seat A) tries to bid in someone else's name.
    const intruder = cur === 'A' ? host : guest;
    const before = g.bidding.history.length;
    rm.handle(intruder, { t: 'act', action: { type: 'PASS', seat: cur } });
    const after = rm.rooms.get(code)!.game!;
    expect(after.bidding.history).toHaveLength(before);
    expect(intruder.inbox.at(-1)).toEqual({ t: 'error', msg: 'It is not your turn to bid' });
  });

  it('a player who drops out is played by the computer after 45 seconds, and gets their seat back on return', () => {
    const { rm, host, guest, code } = setup();
    rm.handle(host, { t: 'start' });
    rm.disconnected(guest);
    expect(host.lastRoom()!.members.find((m) => m.id === 'guest')!.online).toBe(false);
    playUntil(rm, code, { host }, () => rm.rooms.get(code)!.game!.completedTricks.length >= 2, 3000);
    expect(rm.rooms.get(code)!.game!.completedTricks.length).toBeGreaterThanOrEqual(2);
    expect(host.lastRoom()!.autoplay).toContain('A');
    const back = fake('guest', 'Rahim');
    rm.handle(back, { t: 'join', code });
    expect(back.lastView()!.seat).toBe('A');
    expect(back.lastRoom()!.autoplay).not.toContain('A');
  });

  it('emoji throws: friends tables only, and always from the sender’s own seat', () => {
    const { rm, host, guest } = setup();
    rm.handle(host, { t: 'start' });
    rm.handle(guest, { t: 'throw', to: 'C', e: '💩' });
    expect(host.inbox.at(-1)).toEqual({ t: 'throw', from: 'A', to: 'C', e: '💩' });
    const before = host.inbox.length;
    rm.handle(guest, { t: 'throw', to: 'C', e: '<script>' });
    expect(host.inbox.length).toBe(before);
  });

  it('leaving the lobby frees the seat and hands over the host role; an empty room disappears', () => {
    const { rm, host, guest, code } = setup();
    rm.handle(host, { t: 'leave' });
    const r = guest.lastRoom()!;
    expect(r.hostId).toBe('guest');
    expect(r.seats.C).toBeNull();
    rm.handle(guest, { t: 'leave' });
    expect(rm.rooms.has(code)).toBe(false);
  });

  it('smack: only after playing a card in the current trick, once per trick, sent to everyone', () => {
    const { rm, host, guest, code } = setup();
    rm.handle(host, { t: 'start' });
    rm.handle(guest, { t: 'smack' });
    expect(guest.inbox.some((m) => m.t === 'smack')).toBe(false);
    const people = { host, guest };
    // Play until the guest has a card in the current trick.
    playUntil(rm, code, people, () => !!rm.rooms.get(code)!.game?.currentTrick?.plays.some((p) => p.seat === 'A'));
    const before = host.inbox.filter((m) => m.t === 'smack').length;
    rm.handle(guest, { t: 'smack' });
    rm.handle(guest, { t: 'smack' });
    const got = host.inbox.filter((m): m is Extract<ServerMsg, { t: 'smack' }> => m.t === 'smack').slice(before);
    expect(got.filter((m) => m.seat === 'A')).toHaveLength(1);
    // Once the next player has played, it is too late.
    const g = rm.rooms.get(code)!;
    g.smacked = { trick: 0, seats: [] };
    playUntil(rm, code, people, () => { const t = g.game?.currentTrick; return !!t && t.plays.length > 0 && t.plays[t.plays.length - 1].seat !== 'A'; });
    const n = host.inbox.filter((m) => m.t === 'smack' && m.seat === 'A').length;
    rm.handle(guest, { t: 'smack' });
    expect(host.inbox.filter((m) => m.t === 'smack' && m.seat === 'A').length).toBe(n);
  });

  it('player IDs are unique, pictures are checked, and room members show them', () => {
    const { rm, host, guest } = setup();
    rm.handle(host, { t: 'profile', handle: 'ashik_07', avatar: 'e:🦁', level: 4 });
    expect(host.inbox.at(-2)).toEqual({ t: 'profile', ok: true, handle: 'ashik_07' });
    rm.handle(guest, { t: 'profile', handle: 'ashik_07', avatar: 'e:🐼', level: 1 });
    expect(guest.inbox.find((m) => m.t === 'profile')).toMatchObject({ t: 'profile', ok: false });
    // the picture is kept even though the ID was refused
    expect(host.lastRoom()!.members.find((m) => m.id === 'guest')).toMatchObject({ handle: null, pic: 'e:🐼' });
    const lastProfile = () => [...guest.inbox].reverse().find((m) => m.t === 'profile');
    rm.handle(guest, { t: 'profile', handle: 'Bad Name!', avatar: null, level: 1 });
    expect(lastProfile()).toMatchObject({ t: 'profile', ok: false });
    rm.handle(guest, { t: 'profile', handle: 'rahim', avatar: 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64'), level: 2 });
    const r = host.lastRoom()!;
    expect(r.members.find((m) => m.id === 'host')).toMatchObject({ handle: 'ashik_07', pic: 'e:🦁', level: 4 });
    expect(r.members.find((m) => m.id === 'guest')).toMatchObject({ handle: 'rahim', pic: expect.stringMatching(/^u:\d+$/) });
    expect(rm.profiles.photo('guest')?.[0]).toBe(0xff);
    // a not-JPEG "photo" is refused
    rm.handle(guest, { t: 'profile', handle: 'rahim', avatar: 'data:image/jpeg;base64,' + Buffer.from('<svg>').toString('base64'), level: 2 });
    expect(lastProfile()).toMatchObject({ t: 'profile', ok: false });
  });

  it('voice: set-up messages are relayed only between voice members of the same room', () => {
    const { rm, host, guest } = setup();
    rm.handle(host, { t: 'rtc', to: 'guest', data: { sdp: 'x' } });
    expect(guest.inbox.some((m) => m.t === 'rtc')).toBe(false);
    rm.handle(host, { t: 'voice', on: true, muted: false });
    rm.handle(guest, { t: 'voice', on: true, muted: true });
    expect(host.lastRoom()!.members.find((m) => m.id === 'guest')).toMatchObject({ voice: true, muted: true });
    rm.handle(host, { t: 'rtc', to: 'guest', data: { sdp: 'x' } });
    expect(guest.inbox.at(-1)).toEqual({ t: 'rtc', from: 'host', data: { sdp: 'x' } });
    const stranger = fake('stranger');
    rm.handle(stranger, { t: 'create', settings: SETTINGS });
    rm.handle(stranger, { t: 'voice', on: true, muted: false });
    const n = guest.inbox.length;
    rm.handle(stranger, { t: 'rtc', to: 'guest', data: { sdp: 'y' } });
    expect(guest.inbox.length).toBe(n);
    rm.disconnected(guest);
    expect(host.lastRoom()!.members.find((m) => m.id === 'guest')?.voice).toBe(false);
  });

  it('joining a missing room says so', () => {
    const rm = new RoomManager();
    const c = fake('x');
    rm.handle(c, { t: 'join', code: 'ZZZZZ' });
    expect(c.inbox.at(-1)).toEqual({ t: 'left', reason: 'missing' });
  });

  it('settings from the browser are cleaned up', () => {
    const s = sanitizeSettings({ mode: 'individual', matchTarget: 999, tableType: 'friends', difficulty: 'evil' as 'hard', pace: 'fast', rules: { ...DEFAULT_RULES, minBid: 1, allPass: 'redeal' } });
    expect(s.matchTarget).toBe(30);
    expect(s.tableType).toBe('regular');
    expect(s.difficulty).toBe('normal');
    expect(s.rules.minBid).toBe(7);
    expect(s.rules.allPass).toBe('redeal');
  });

  it('rooms survive a restart through the snapshot', () => {
    const { rm, host, code } = setup();
    rm.handle(host, { t: 'start' });
    vi.advanceTimersByTime(10_000);
    const snap = JSON.parse(JSON.stringify(rm.snapshot()));
    const rm2 = new RoomManager();
    rm2.restore(snap);
    const back = fake('host', 'Ashik');
    rm2.handle(back, { t: 'join', code });
    expect(back.lastView()!.seat).toBe('C');
    expect(back.lastRoom()!.status).toBe('playing');
  });
});
