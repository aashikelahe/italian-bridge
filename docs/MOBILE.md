# Taking the engine to Android, iOS and online play

The rules engine in `src/engine/` is plain TypeScript with no React or browser dependencies (it uses only `structuredClone` and, optionally, `crypto.getRandomValues`). That is the piece to keep; the UI is replaceable.

## Native mobile app
* **React Native / Expo** — copy or package `src/engine` and `src/ai` as a shared module (e.g. a workspace package `@italian-bridge/engine`). Rebuild only the UI: the table, hand, panels. `useGameDriver.ts` ports almost unchanged (swap `window.setTimeout` for `setTimeout`).
* **Capacitor** — wrap the existing web build as an app with no engine changes. Quickest route; the layout already works down to phone width.
* **Flutter / Kotlin / Swift** — run the engine in a JS runtime, or port it. The tests in `tests/` are the specification for a port: they describe every rule as executable checks.
* Persistence: replace `src/ui/storage.ts` (localStorage) with AsyncStorage / SQLite. The saved object is the serialisable `GameState`.

## Online multiplayer (built — see ONLINE.md)
* Move `applyAction` to the server. The server owns the RNG, the deck, every hand and the reserved card.
* Clients send `Action`s and receive `getPlayerView(state, seat)` for their own seat — never the full state. `PlayerView` was designed for exactly this: it already redacts other hands, the deck and a hidden trump card.
* All validation already lives in the engine, so the server needs no extra rule code. Add seat ↔ user mapping, turn timeouts and reconnection.
* The public `log` contains no private card information and can be broadcast.

## Adding new rules later
Add a field to `RuleConfig`, give it a default in `config.ts`, branch on it in `game.ts` / `rules.ts` / `scoring.ts`, expose it in the setup screen, and add a test. Existing games keep their own config, because the config is stored inside each `GameState`.
