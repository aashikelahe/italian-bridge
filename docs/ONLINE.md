# Online rooms

Online play uses a small Node.js server (`server/`) that serves the game page and accepts one WebSocket
per browser at `/ws`. See `DEPLOY.md` for putting it online.

## How it works
* **The server owns every game.** It deals, keeps all hands, applies every move through the same engine the
  offline game uses, and runs the computer seats. Each player receives only their own `PlayerView`, so no
  browser ever holds another player's cards.
* **Identity without accounts.** Each browser makes a random secret token and keeps it in local storage.
  The server derives a public player id from it, so reloading or reconnecting puts you back in your seat.
* **Moves are tied to the connection.** The seat in a move always comes from who sent it, never from the message.
* **Rooms** have a 5-character code (no I, O, 0 or 1) and an invite link `https://<site>/?room=CODE`.
  Up to 12 people can be in a room; four sit, the rest can chat and watch the lobby.
* **Away players.** If a seated player's connection is gone for 45 seconds when it is their turn, the computer
  plays for them until they come back.
* **Housekeeping.** Empty lobbies are removed after 2 hours, any unused room after 12 hours.
  Messages are size- and rate-limited; names and chat are cleaned.
* **Restarts.** With `DATA_FILE` set, rooms (including games in progress) are saved every 10 seconds and
  restored on start. Free hosting without a disk loses rooms on restart.

## Messages
Defined in `src/online/protocol.ts`.

| Browser → server | |
|---|---|
| `hello {token, name}` | identify (first message) |
| `create {settings}` / `join {code}` / `leave` | rooms |
| `sit {seat}` / `stand` / `chat {text}` | lobby |
| `start` / `lobby` / `close` | host controls |
| `act {action}` | a game move (bid, pass, reserve, reveal, play, next round…) |
| `throw {to, e}` | Friends table emoji |

| Server → browser | |
|---|---|
| `welcome {id}` | your player id |
| `room {room}` | room info: seats, members (online/away), chat, status |
| `view {view}` | your private view of the game |
| `throw {from, to, e}` | an emoji in flight |
| `error {msg}` / `left {reason}` | problems; you are no longer in a room |
