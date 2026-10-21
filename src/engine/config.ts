import type { RuleConfig } from './types';

/**
 * Default rule configuration. Each value marked "assumption" is a documented choice
 * for a rule the specification left open — see docs/ASSUMPTIONS.md.
 */
export const DEFAULT_RULES: RuleConfig = {
  // Each player bids or passes once; the highest bid wins. (confirmed by the game owner)
  biddingStyle: 'singleRound',
  // The first hand (player after the dealer) may call for a reshuffle if their five cards
  // hold no A, K, Q or J; they then become the dealer. (confirmed by the game owner)
  reshuffleCall: 'firstHand',
  // The bidder may reveal only when they cannot follow the led suit, and must then play a
  // trump-suit card in that trick (any one). (confirmed by the game owner)
  voluntaryReveal: 'whenVoid',
  // Cards go out in packets (5, then 4, then 4 to each player), as at a real table.
  dealStyle: 'packets',
  // From round 2 the previous round's tricks are stacked and shuffled by hand, sometimes
  // lightly, sometimes thoroughly. (confirmed by the game owner)
  shuffleStyle: 'realistic',
  // The winner of a trick leads the next trick. (confirmed by the game owner)
  nextTrickLeader: 'winner',
  // Team mode: the bidding team needs its bid in combined tricks, the other team needs 5;
  // only teams score. (confirmed by the game owner)
  teamScoring: 'teamContract',
  // Spec: "the player immediately to the dealer's right starts bidding" + "continue clockwise".
  // Interpreted as the next seat after the dealer in turn order. (assumption)
  firstBidder: 'nextAfterDealer',
  // Spec default: the highest bidder's next clockwise opponent leads trick 1.
  firstLeader: 'nextAfterBidder',
  // If nobody bids, the dealer must bid 7. (confirmed by the game owner)
  allPass: 'forceDealerSeven',
  // Trump cards only beat other suits once the trump has been revealed. (confirmed by the game owner)
  trumpEffect: 'afterReveal',
  // A player outbid during the auction ends it as a passer (their last action). (assumption)
  outbidPlayersScoreAs: 'pass',
  // Anyone who cannot follow suit — the bidder's partner too — may ask to see the trump. (confirmed by the game owner)
  partnerMayRequestReveal: true,
  minBid: 7,
  // Bids are 7 (Small), 8, 9 or 10 (Bonus). Making a 10 scores 13; failing it costs 10. (confirmed by the game owner)
  maxBid: 10,
  bonusBid: 10,
  bonusPoints: 13,
  // After the second deal each player in turn may call the Bonus (10); after a Bonus call the
  // next players may only go higher (11, 12, 13). A 13 ends it. The highest caller takes over
  // the contract (and picks a new trump if they were not already the bidder). (confirmed by the game owner)
  // Calls above 10 score 13 + 1 per extra trick when made (assumption) and lose the call when missed.
  bonusRound: 'afterSecondDeal',
  maxBonusBid: 13,
  passTarget: 5,
  passPoints: 5,
  winCondition: 'reachOrExceed',
  // If two sides reach the target with equal top totals, play another round. (assumption)
  tieRule: 'playOn',
  // The seat before the dealer cuts. 'human' lets the human always cut.
  cutter: 'beforeDealer',
};

export function withRules(overrides: Partial<RuleConfig> = {}): RuleConfig {
  return { ...DEFAULT_RULES, ...overrides };
}

export const MATCH_TARGETS = [30, 50] as const;
