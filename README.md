# Italian Bridge

A desktop-first, browser-based version of **Italian Bridge** (Italian Call Bridge): four players, one 52-card deck, a 5 + 4 + 4 deal, one-turn bidding from 7 to 13, a reshuffle call, a hidden reserved trump card, and bid-based scoring. Play against three computer opponents, or create an online room, share its code and play with friends (empty seats are filled by the computer). Individual or two-team mode, to 30 or 50 points, in English or Bangla. Team games can use a Friends table, where players throw emojis at each other.

**To put it online and play with friends, follow [DEPLOY.md](DEPLOY.md).**

## Run it

Requires Node.js 20+.

```bash
npm install
npm run build        # builds the game (dist/) and the server (dist-server/)
npm start            # game + online rooms on http://localhost:3000
npm test             # 90 automated tests: rules, scoring, simulated rounds, server rooms
npm run dev          # live development on http://localhost:5173 (run `npm run dev:server` too for online play)
npm run build:single # one self-contained dist-single/index.html (computer play only)
```

No accounts or database. The server keeps rooms in memory; settings, statistics and the offline game are saved in each browser.

## Project structure

```
src/
  engine/            Pure TypeScript rules engine — no React, no DOM
    types.ts         Card, Player, Team, GameState, Action, RuleConfig
    config.ts        Default rules; every open question is a setting here
    cards.ts         Deck, numeric rank strength (A=14 … 2=2), sorting
    deck.ts          Fisher–Yates shuffle, cut (B followed by A)
    seating.ts       Clockwise seats A(top) B(right) C(bottom) D(left), partners A–C / B–D
    rules.ts         Legal plays, reveal eligibility, trick resolution
    scoring.ts       calculateRoundScore, match-end and tie handling
    game.ts          Finite-state machine: createMatch + applyAction (validates every action)
    integrity.ts     52-card accounting checks
    view.ts          getPlayerView: the private per-seat projection the UI and AI use
  ai/
    index.ts         Bidding, trump choice, card play, reveal decisions (sees only its own PlayerView)
    simulate.ts      Headless driver for all-AI rounds (used by tests)
  online/            protocol.ts (browser ↔ server messages), net.ts (connection + auto-reconnect), emojis.ts
  ui/                React UI: screens, card table, panels, Bangla text (bn.ts, i18n.tsx), emoji throws, storage
server/
  index.ts           Serves dist/ and the /ws WebSocket; identity, rate limits, optional save file
  rooms.ts           Rooms, lobby, chat, and the server-side game loop (computer seats, away players)
tests/               Vitest suites for deck, dealing, bidding, trump, play, scoring, full rounds, server rooms
render.yaml          One-click hosting on Render (free)
DEPLOY.md            Step-by-step: GitHub + Render, or your own PC on home Wi-Fi
docs/
  RULES.md           The rules as implemented
  ASSUMPTIONS.md     Open points in the spec and how each is configured
  MOBILE.md          Adapting the engine for Android/iOS and online play
  ONLINE.md          Online rooms: how they work, messages, fair play
```

## How the engine works

`applyAction(state, action, rng)` is the only way to change a game. It clones the state, checks the phase, the acting seat and the rules, and returns either `{ ok: true, state }` or `{ ok: false, error }`. Phases:

```
SHUFFLE → CUT → INITIAL_DEAL → BIDDING → TRUMP_RESERVATION → SECOND_DEAL → THIRD_DEAL
       → PLAYING ⇄ (MANDATORY_REVEAL after trick 12 if still hidden) → ROUND_RESULT → SHUFFLE … → MATCH_OVER
```

Menu, pause and resume live in the UI layer; restart is "New game"; error recovery is that rejected actions never change state, and a saved game can always be resumed.

The UI and AI never read raw `GameState` — they get `getPlayerView(state, seat)`, which contains only that seat's hand, card counts for others, and the reserved card only for its owner (or for everyone once revealed). Developer mode (Settings) is the single exception and is off by default.

## Testing the complete game

* `npm test` runs the rule tests and 800+ simulated all-AI rounds across both modes and both trump-effect settings, checking that every card is dealt and played exactly once, trick counts sum to 13, and scores match the formula.
* To play by hand: `npm run dev`, choose New game. Turn on **Settings → Developer mode** to see every hand while checking rules; set **House rules → Who cuts → Always me** to exercise the cut screen each round.

## Highlights

* Bids are 7 (Small), 8, 9 or 10 (Bonus). A made 10 scores 13; a missed 10 costs 10.
* Full-screen landscape table with a 3D felt, fanned hand, Smack / বাড়ি, emoji throwing, last-trick viewer and lots of synthesized sounds.
* Online rooms with chat, quick chat, **live voice chat** and **player cards** (unique player ID + photo or avatar). See `docs/ONLINE.md`.
* English and Bangla.

## What's done and what isn't

Implemented and tested: everything in the specification's core rules — deck, shuffle, interactive cut, 5/4/4 dealing, bidding with pass and all-pass handling, private trump reservation, voluntary / requested / mandatory reveal, follow-suit validation, trick resolution, individual and team scoring, 30/50 targets, tie handling, three AI opponents with three difficulty levels, save/resume, statistics, responsive layout, reduced-motion support.

Online rooms (own server, invite links, lobby chat, reconnect, computer stand-ins for away players), Bangla, Friends tables and sound effects are included. Not included: a native mobile app — see `docs/MOBILE.md`.

**Balance:** team games with team-wise scoring finish in about 7–25 rounds to 30 points. Individual games score harshly (bidder needs 7+, every passer needs 5) and can run long. See `docs/ASSUMPTIONS.md` §Balance.
