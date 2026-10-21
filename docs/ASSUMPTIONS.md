# Assumptions and configurable rules

Every point the specification left open is a field in `RuleConfig` (`src/engine/config.ts`) and can be changed in **New game → House rules**. Nothing below changes a rule the specification confirmed.

| Setting | Default | Alternative | Why this default |
|---|---|---|---|
| `biddingStyle` | `singleRound` | `auction` | Confirmed by the game owner: each player bids once. |
| `reshuffleCall` | `firstHand` | `anyPlayer`, `off` | Confirmed: the first hand with no A/K/Q/J may call a reshuffle and becomes dealer. |
| `voluntaryReveal` | `whenVoid` | `anyTurn` | Confirmed: the bidder reveals only when they can't follow suit, and must then play a trump-suit card (any). |
| `shuffleStyle` | `realistic` | `full` | Confirmed: stack the tricks and shuffle by hand, with varying strength. |
| `teamScoring` | `teamContract` | `sumOfPlayers` | Confirmed: team mode is team-wise — bidding team needs its bid, the other team 5, no individual points. |
| `nextTrickLeader` | `winner` | `afterWinner` | Confirmed: the trick winner leads the next trick. |
| `dealStyle` | `packets` | `oneAtATime` | Cards go out in packets of 5/4/4, so stacked tricks can reach one player together. |
| `firstBidder` | `nextAfterDealer` | `beforeDealer` | The spec says "the player to the dealer's right" and also "continue clockwise". Read as the next player in turn order after the dealer. |
| `firstLeader` | `nextAfterBidder` | `bidder`, `nextAfterDealer` | Spec default. |
| `allPass` | `forceDealerSeven` | `forceFirstBidderSeven`, `redeal` | Confirmed: if nobody bids, the dealer must call 7. |
| `trumpEffect` | `afterReveal` | `always` | Confirmed by the owner's example: a trump-suit card played before the reveal has no power. |
| `outbidPlayersScoreAs` | `pass` | `ownHighestBid` | Individual mode only: A bids 7, D later bids 9 — A scores as a passer (needs 5). In team mode this is settled by team scoring. |
| `partnerMayRequestReveal` | `true` | `false` | Confirmed by the game owner: anyone who cannot follow suit, the bidder's partner included, may ask to see the trump. |
| `winCondition` | `reachOrExceed` | `exact` | Spec default; exact-target is offered as the "future" option. |
| `tieRule` | `playOn` | `shared` | Spec asks for explicit tie handling. Several sides over the target: highest total wins. Tied highest: play another round. |
| `cutter` | `beforeDealer` | `human` | Traditional; `human` lets you cut every round. |
| `minBid` / `maxBid` / `bonusBid` / `bonusPoints` / `passTarget` / `passPoints` | 7 / 10 / 10 / 13 / 5 / 5 | — | Confirmed by the game owner: bids stop at 10 (Bonus), worth 13 when made. |

Other decisions:
* **Bid of 13** ends the auction immediately; the remaining players are recorded as "auto-pass".
* **Reveal request** is allowed only on your turn, when you can't follow suit, and is always granted.
* **Trump led after a reveal mid-trick:** if trump is the led suit, all cards are compared as led-suit cards, so an earlier trump card can't lose to a smaller one just because of reveal timing.
* **Dealer** for the first round is chosen at random; it then rotates clockwise.
* **Dealing** is in packets (5, then 4, then 4 per player) by default, starting with the player after the dealer.

## Balance

Team mode with team scoring is well balanced: in 20 simulated matches to 30, every match finished in 7–25 rounds and the bidding team made its contract 54% of the time. The notes below apply to individual mode.

With the scoring exactly as specified, the numbers work against everyone: 13 tricks are shared by four players (3.25 on average), the bidder needs at least 7 and every passer needs 5. At most two players can succeed in a round. Simulating 150 rounds per configuration with the hard AI:

| Trump effect | Mode | Bidder made contract | Passers reached 5 | Avg points per player per round |
|---|---|---|---|---|
| afterReveal | individual | 9% | 14% | −4.2 |
| afterReveal | team | 10% | 14% | −4.1 |
| always | individual | 9% | 12% | −4.3 |
| always | team | 11% | 13% | −4.1 |

None of 40 AI-only matches reached +30 within 80 rounds. A human playing well will do better than the AI, but matches can run very long. If that isn't how the game plays at your table, the likely candidates are the pass target (5) or how passers score; both are already data in `RuleConfig`, so changing them is a one-line config change once the intended rule is confirmed.
