# Rules as implemented

## Table and deck
* Exactly four players. Seats in clockwise order: A (top), B (right), C (bottom — the human), D (left).
* Team mode partners sit opposite: Team X = A + C, Team Y = B + D.
* One standard 52-card deck, no jokers. Rank order A K Q J 10 9 8 7 6 5 4 3 2, compared by numeric strength (A = 14 … 2 = 2).

## Each round
1. **Shuffle** — Fisher–Yates with a cryptographic random source.
2. **Cut** — the cutter picks a position 1–51; the deck becomes section B followed by section A. Nothing else is randomised.
   From the second board on, the previous board's tricks (four cards each, stacked pile on pile) are gathered and riffled by hand 1, 2, 3 or 7 times at random — usually a light shuffle, sometimes thorough — so parts of old tricks can come back together.
3. **First deal** — a packet of five cards to each player, starting with the player after the dealer. 32 cards remain.
4. **Reshuffle call** — if the first hand (the player after the dealer) has no A, K, Q or J among their five cards, they may call for a reshuffle before bidding. The cards are gathered and shuffled, and that player becomes the dealer.
5. **Bidding** — starting after the dealer, each player gets exactly one turn: bid a number higher than the current highest (7 = “Small”, 8, 9, or 10 = “Bonus”) or pass. Nobody bids twice. The highest bid wins. If nobody bids, the dealer must call 7.
   *Scoring the Bonus:* a 10 that is made scores **13**; a 10 that is missed scores **−10**.
6. **Trump reservation** — the highest bidder picks one of their five cards and sets it aside face down. Its suit is trump. Only the bidder can see it.
7. **Second deal** — four cards each. **Third deal** — four cards each. Everyone now holds 13 cards; the bidder holds 12 playable cards plus the reserved one.
8. **Play** — 13 tricks. The player after the bidder leads trick 1; each trick's winner leads the next.

## Legal plays
* You must follow the led suit if you hold a card of it (the reserved card does not count while reserved).
* If you can't follow, you may play any card, trump or not; you are never forced to trump.
* The engine rejects: cards you don't hold, the reserved card while reserved, playing out of turn, failing to follow suit, playing the same card twice, and any play outside the playing phase.

## Revealing the trump
* **By the bidder** — only on their own turn when they cannot follow the led suit (for example trump was led and the reserved card is their only trump, or they want to trump). They must then play a trump-suit card (any one, not necessarily the reserved card) to that trick. The bidder can't reveal while leading.
* **On request** — the current player (an opponent of the bidder) who cannot follow the led suit may ask to see it. Revealing doesn't win the trick; the requester must then play a trump-suit card if they hold one, otherwise any card.
* **Mandatory** — if the trump is still hidden after trick 12, it is revealed automatically before anyone plays to trick 13.
* In every case the very same card goes back into the bidder's hand and can then be played like any other card. It is revealed once only.

## Winning a trick
1. If any trump with trump power was played, the highest trump wins.
2. Otherwise the highest card of the led suit wins. Off-suit, non-trump cards never win.
3. A trump has trump power only if it was played after the reveal. Before that, a trump-suit card played on another suit is just an off-suit card. Example: A holds the hidden 5♠. B leads 3♥, C (no hearts) plays 7♠, D plays 9♣, A plays K♠ without revealing — B wins with 3♥. When trump is led, the trick is decided as an ordinary led-suit trick.
The winner takes the four cards and adds one trick to their count.

## Scoring
Individual game:
* Bid N: +N with at least N tricks, otherwise −N. Overtricks score nothing extra.
* Pass: +5 with at least 5 tricks, otherwise −5.

Team game (default team scoring):
* Bidding is still one turn each, and partners may outbid each other. The team holding the highest bid needs that many tricks together (+N or −N). The other team needs 5 together (+5 or −5). There are no individual points.
* Example: A bids 7, B passes, C passes, D bids 8 → B+D need 8 tricks, A+C need 5.
* Totals can go negative.

## Score sheet
One row per round, numbered 1, 2, 3… Under each name (team or player) there are two boxes: the running total after that round, and the next round's points. While a round is being played its call is shown in brackets.

## Ending the match
After each completed round, if any side (team, or player in individual mode) has reached the target (30 or 50), the highest total wins. If two sides tie for the highest total at or above the target, another round is played (or, with the “share” house rule, they share the win). A match never ends mid-round. The dealer moves one seat clockwise each round.
