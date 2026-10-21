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

## Player cards (ID and picture)

* **Your player card** (main menu, or *Edit* on the online screen) holds your name, a unique **player ID** (`@ashik_07`, 3–16 letters, numbers or `_`) and a photo or a ready-made avatar. It also shows your level, earned from your matches on that device.
* Photos are cropped and shrunk to a 160×160 JPEG in the browser before they are sent. The server serves them at `/avatar/<player>.jpg` so the copy on aashik.xyz can show them too.
* The browser sends its card again every time it connects, so cards come back after the free server restarts. A player ID belongs to whoever registered it first since the server last started.
* **Login code**: the secret token that identifies you. Paste it on another phone or computer (*Play on another device*) to play there as the same person.

## Voice chat

* Anyone in a room can press **Join voice** in the lobby or 🎙 on the table. Everyone in the voice chat hears everyone else; the 🎙 button then mutes and unmutes you. A green ring shows who is talking.
* Sound goes directly between the players' browsers (WebRTC, audio only). The game server only passes the set-up messages along and never hears anything.
* It needs a secure page (https — Render and aashik.xyz both are) and microphone permission.
* Direct links use public STUN servers. When two players can't reach each other directly (common on mobile data), sound goes through a relay (TURN). The server hands out short-lived relay passwords in its `welcome` message: by default for the free Open Relay project (`staticauth.openrelay.metered.ca`); set `TURN_URLS` (comma separated) and `TURN_SECRET` on Render to use your own relay instead (for example a free Metered account or coturn).
* Each person's link to every other person is watched: a link that fails or doesn't connect within a few seconds is rebuilt automatically, and a player whose connection drops is reconnected to everyone when they come back. The voice panel shows "connecting…" next to anyone you can't hear yet.

## Team names

When creating a two-team room, the host can name both teams (North & South, East & West). The names show in the lobby, the score sheet and the results.

## Other table features

* **Smack / বাড়ি** appears after you play a card and disappears as soon as the next player plays.
* **Last trick** (↶ on the top bar) shows the four cards of the previous trick and who won it.
* **Quick chat**: one-tap messages under the chat box.
* **Table colour** (Emerald, Royal blue, Crimson, Midnight), **card backs** and **vibration** are in Settings.
