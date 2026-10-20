/**
 * Italian Bridge server: serves the built game (dist/) and runs online rooms over a WebSocket at /ws.
 *
 *   PORT       port to listen on (default 3000; hosting services set it)
 *   DATA_FILE  optional path of a JSON file to keep rooms across restarts
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, stat, writeFile, rename } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { RoomManager, cleanName, type Client } from './rooms';
import type { ClientMsg, ServerMsg } from '../src/online/protocol';

const PORT = Number(process.env.PORT ?? 3000);
const ROOT = resolve(process.env.STATIC_DIR ?? join(process.cwd(), 'dist'));
const DATA_FILE = process.env.DATA_FILE ?? '';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

async function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); return; }
  let rel = '';
  try { rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, ''); } catch { res.writeHead(400); res.end(); return; }
  let file = resolve(ROOT, rel || 'index.html');
  if (!file.startsWith(ROOT)) { res.writeHead(400); res.end(); return; }
  try {
    const st = await stat(file);
    if (st.isDirectory()) file = join(file, 'index.html');
  } catch {
    file = join(ROOT, 'index.html'); // single-page app: unknown paths load the game
  }
  try {
    const body = await readFile(file);
    const type = TYPES[extname(file)] ?? 'application/octet-stream';
    const immutable = file.includes(`${join(ROOT, 'assets')}`);
    res.writeHead(200, {
      'content-type': type,
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found. Run "npm run build" first.');
  }
}

const rooms = new RoomManager();

// Optional persistence: rooms survive a restart on hosts with a disk.
let dirty = false;
if (DATA_FILE && existsSync(DATA_FILE)) {
  try { rooms.restore(JSON.parse(readFileSync(DATA_FILE, 'utf8'))); console.log(`Restored ${rooms.rooms.size} rooms`); } catch (e) { console.error('Could not read', DATA_FILE, e); }
  for (const r of rooms.rooms.values()) rooms.pump(r);
}
rooms.onDirty = () => { dirty = true; };
async function save() {
  if (!DATA_FILE || !dirty) return;
  dirty = false;
  const tmp = `${DATA_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(rooms.snapshot()));
  await rename(tmp, DATA_FILE);
}
setInterval(() => { save().catch((e) => console.error('save failed', e)); }, 10_000).unref();
setInterval(() => rooms.sweep(), 10 * 60_000).unref();

const server = createServer((req, res) => { void serveStatic(req, res); });
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

/** A player's public id is derived from their secret token, so it survives reconnects and restarts. */
const idFor = (token: string) => createHash('sha256').update(`ib:${token}`).digest('base64url').slice(0, 16);

wss.on('connection', (ws: WebSocket) => {
  let client: Client | null = null;
  let tokens = 30;
  let alive = true;
  const refill = setInterval(() => { tokens = Math.min(30, tokens + 10); }, 1000);
  const send = (msg: ServerMsg) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); };
  ws.on('pong', () => { alive = true; });
  const beat = setInterval(() => {
    if (!alive) { ws.terminate(); return; }
    alive = false;
    try { ws.ping(); } catch { /* closing */ }
  }, 25_000);

  ws.on('message', (data) => {
    if (--tokens < 0) return; // too many messages: drop
    let m: ClientMsg;
    try { m = JSON.parse(String(data)); } catch { return; }
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
    if (m.t === 'ping') { send({ t: 'pong' }); return; }
    if (m.t === 'hello') {
      const token = String(m.token ?? '');
      if (token.length < 16 || token.length > 64) { send({ t: 'error', msg: 'Bad sign-in token.' }); return; }
      if (client) rooms.disconnected(client);
      client = { id: idFor(token), name: cleanName(String(m.name ?? '')) || 'Player', room: null, send };
      send({ t: 'welcome', id: client.id });
      return;
    }
    if (!client) return;
    if (m.t === 'rename') { client.name = cleanName(String(m.name ?? '')) || client.name; }
    try { rooms.handle(client, m); } catch (e) { console.error('handler error', e); send({ t: 'error', msg: 'Something went wrong on the server.' }); }
  });

  ws.on('close', () => {
    clearInterval(refill);
    clearInterval(beat);
    if (client) rooms.disconnected(client);
  });
});

server.listen(PORT, () => console.log(`Italian Bridge running on http://localhost:${PORT}`));

process.on('SIGTERM', () => { save().finally(() => process.exit(0)); });
