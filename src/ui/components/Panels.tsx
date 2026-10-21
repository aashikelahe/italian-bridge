import { useState } from 'react';
import type { Action, BidStatus } from '../../engine/types';
import type { PlayerView } from '../../engine/view';
import { SEATS } from '../../engine/seating';
import { sortHand, cardFromId } from '../../engine/cards';
import { CardBack, CardFace } from './Card';
import { useI18n, useSeatName, type I18n } from '../i18n';

type Dispatch = (a: Action) => string | null;

const bidText = (i: I18n, b: BidStatus) => (b.kind === 'bid' ? i.num(b.amount) : b.kind === 'pass' ? i.t('Pass') : '—');

export function CutPanel({ view, dispatch }: { view: PlayerView; dispatch: Dispatch }) {
  const i = useI18n();
  const [pos, setPos] = useState(26);
  return (
    <div className="panel cut-panel" role="dialog" aria-label={i.t('Cut the deck')}>
      <h3>{i.t('Cut the deck')}</h3>
      <p className="muted">{i.t(pos === 1 ? 'Lift {n} card off the top. The bottom part goes on top.' : 'Lift {n} cards off the top. The bottom part goes on top.', { n: pos })}</p>
      <div className="cut-deck" aria-hidden>
        <div className="stack lower" style={{ ['--n' as string]: Math.max(1, Math.round((52 - pos) / 4)) }} />
        <div className="stack upper" style={{ ['--n' as string]: Math.max(1, Math.round(pos / 4)) }} />
      </div>
      <label className="cut-range">
        <span>{i.t('Cut at card {n}', { n: pos })}</span>
        <input type="range" id="cut-pos" min={1} max={51} value={pos} onChange={(e) => setPos(Number(e.target.value))} />
      </label>
      <div className="row">
        <button className="btn ghost" onClick={() => setPos(1 + Math.floor(Math.random() * 51))}>{i.t('Pick for me')}</button>
        <button className="btn brass" onClick={() => dispatch({ type: 'CUT', seat: view.seat, position: pos })}>{i.t('Cut and deal')}</button>
      </div>
    </div>
  );
}

export function BidPanel({ view, dispatch }: { view: PlayerView; dispatch: Dispatch }) {
  const i = useI18n();
  const seatName = useSeatName(view.players);
  const { minBid, maxBid } = view.config;
  const high = view.bidding.highestBid;
  const myTurn = view.currentPlayer === view.seat;
  const bids = Array.from({ length: maxBid - minBid + 1 }, (_, k) => minBid + k);
  const teamPlay = view.teams && view.config.teamScoring === 'teamContract';
  return (
    <div className="panel bid-panel" aria-label={i.t('Bidding')}>
      <div className="bid-head">
        <h3>{i.t('Bidding')}</h3>
        <span className="muted">{high ? i.t('Highest: {n} by {p}', { n: high, p: seatName(view.bidding.highestBidder!) }) : i.t('No bids yet')}</span>
      </div>
      <ol className="bid-history">
        {view.bidding.history.map((h, k) => (
          <li key={k}>
            <b>{seatName(h.seat)}</b>{' '}
            {h.action === 'bid' ? i.t(h.amount === minBid ? 'bids {n} (Small)' : h.amount === view.config.bonusBid ? 'bids {n} (Bonus)' : 'bids {n}', { n: h.amount! })
              : h.action === 'forced' ? i.t(h.seat === view.dealer ? 'must call {n} as dealer' : 'must call {n}', { n: h.amount! })
              : h.action === 'auto-pass' ? i.t('passes (no higher bid possible)') : i.t('passes')}
          </li>
        ))}
        {view.bidding.history.length === 0 && <li className="muted">{i.t('{p} bids first.', { p: seatName(view.bidding.starter) })}</li>}
      </ol>
      {myTurn ? (
        <>
          <p className="prompt">
            {teamPlay
              ? i.t('How many tricks will your team take together? If the other team wins the bid, your team needs {n}.', { n: view.config.passTarget })
              : i.t('How many tricks will you take? Passing means you need {n}.', { n: view.config.passTarget })}
            {view.config.biddingStyle === 'singleRound' && ` ${i.t('You get one turn to bid.')}`}
          </p>
          {view.canCallReshuffle && (
            <div className="reshuffle-offer">
              <span>{i.t('You have no A, K, Q or J.')}</span>
              <button className="btn small brass" onClick={() => dispatch({ type: 'CALL_RESHUFFLE', seat: view.seat })}>{i.t('Call for a reshuffle (you deal next)')}</button>
            </div>
          )}
          <div className="bid-buttons">
            {bids.map((b) => (
              <button key={b} className={`btn bid ${b === view.config.bonusBid ? 'bonus' : ''}`} title={b === view.config.bonusBid ? i.t('Make it and score {p}; miss it and lose {n}.', { p: view.config.bonusPoints, n: b }) : undefined} disabled={high != null && b <= high} onClick={() => dispatch({ type: 'BID', seat: view.seat, amount: b })}>
                {i.num(b)}{b === minBid && <small>{i.t('Small')}</small>}{b === view.config.bonusBid && <small>{i.t('Bonus')} +{i.num(view.config.bonusPoints)}</small>}
              </button>
            ))}
            <button className="btn ghost pass" onClick={() => dispatch({ type: 'PASS', seat: view.seat })}>{i.t('Pass')}</button>
          </div>
        </>
      ) : (
        <p className="prompt muted">{view.currentPlayer ? i.t('{p} is thinking…', { p: seatName(view.currentPlayer) }) : ''}</p>
      )}
    </div>
  );
}

export function ReservePanel({ view, dispatch }: { view: PlayerView; dispatch: Dispatch }) {
  const i = useI18n();
  const seatName = useSeatName(view.players);
  const [sel, setSel] = useState<string | null>(null);
  const bidder = view.trump.bidder!;
  if (bidder !== view.seat) {
    return (
      <div className="panel">
        <h3>{i.t('{p} won the bidding with {n}', { p: seatName(bidder), n: view.bidding.highestBid! })}</h3>
        <p className="muted">{i.t('They are choosing a card to reserve face down. Its suit will be trump.')}</p>
      </div>
    );
  }
  const chosen = sel ? cardFromId(sel) : null;
  return (
    <div className="panel reserve-panel" role="dialog" aria-label={i.t('Choose your trump card')}>
      <h3>{i.t('You won with {n}. Choose your trump card.', { n: view.bidding.highestBid! })}</h3>
      <p className="muted">{i.t('The card is set aside face down. Its suit becomes trump, and you get it back when the trump is revealed.')}</p>
      <div className="reserve-cards">
        {sortHand(view.hand).map((c) => (
          <button key={c.id} className={`card-btn ${sel === c.id ? 'selected' : ''}`} aria-pressed={sel === c.id} aria-label={i.cardName(c)} onClick={() => setSel(c.id)}>
            <CardFace card={c} size="lg" />
          </button>
        ))}
      </div>
      <div className="row">
        <span className="muted">{chosen ? i.t('{suit} will be trump.', { suit: i.suit(chosen.suit) }) : i.t('Select one card.')}</span>
        <button className="btn brass" disabled={!sel} onClick={() => sel && dispatch({ type: 'RESERVE', seat: view.seat, cardId: sel })}>
          {chosen ? i.t('Reserve {card}', { card: i.cardShort(chosen) }) : i.t('Reserve card')}
        </button>
      </div>
    </div>
  );
}

export function PhaseBanner({ view }: { view: PlayerView }) {
  const i = useI18n();
  const seatName = useSeatName(view.players);
  const dealer = seatName(view.dealer);
  const sh = view.lastShuffle;
  const shuffleNote = !sh || sh.kind === 'full' ? ''
    : sh.riffles >= 7 ? i.t('{p} shuffled the stacked tricks thoroughly.', { p: dealer })
    : sh.riffles === 1 ? i.t('{p} gave the stacked tricks one quick shuffle.', { p: dealer })
    : i.t('{p} riffled the stacked tricks {n} times.', { p: dealer, n: sh.riffles });
  const text: Partial<Record<string, [string, string]>> = {
    SHUFFLE: [i.t('{p} is shuffling', { p: dealer }), view.round > 1 && view.config.shuffleStyle === 'realistic' ? i.t('{p} gathers the tricks and shuffles. {p} will deal.', { p: dealer }) : i.t('{p} is the dealer this round.', { p: dealer })],
    CUT: [i.t('Cutting'), `${shuffleNote} ${i.t('{p} is cutting the deck.', { p: seatName(view.cutter) })}`.trim()],
    INITIAL_DEAL: [i.t('{p} is dealing', { p: dealer }), i.t('Five cards to each player.')],
    SECOND_DEAL: [i.t('{p} is dealing', { p: dealer }), i.t('Second deal: four more cards each.')],
    THIRD_DEAL: [i.t('{p} is dealing', { p: dealer }), i.t('Third deal: four more cards each — 13 in all.')],
    MANDATORY_REVEAL: [i.t('Final trick'), i.t('The trump card must be revealed before the last trick.')],
  };
  const t = text[view.phase];
  if (!t) return null;
  return (
    <div className={`banner phase-${view.phase}`} role="status">
      {(view.phase === 'SHUFFLE' || view.phase === 'CUT') && (
        <div className="shuffle-deck" aria-hidden><CardBack size="sm" /><CardBack size="sm" /><CardBack size="sm" /></div>
      )}
      <strong>{t[0]}</strong>
      <span>{t[1]}</span>
    </div>
  );
}

export function RoundResult({ view, dispatch, canContinue = true }: { view: PlayerView; dispatch: Dispatch; canContinue?: boolean }) {
  const i = useI18n();
  const seatName = useSeatName(view.players);
  const r = view.roundHistory[view.roundHistory.length - 1];
  if (!r) return null;
  const trump = cardFromId(r.trumpCardId);
  const last = !!view.matchWinner;
  return (
    <div className="panel result-panel" role="dialog" aria-label={i.t('Round {n} result', { n: r.round })}>
      <div className="result-head">
        <h3>{i.t('Round {n} result', { n: r.round })}</h3>
        <span className="muted">{i.t('Trump was')} <CardFace card={trump} size="sm" className="inline" /> · {i.t('{p} bid {n}', { p: seatName(r.highestBidder), n: r.highestBid })}</span>
      </div>
      {r.teams && view.config.teamScoring === 'teamContract' ? (
        <>
          <table className="result-table">
            <thead><tr><th scope="col">{i.t('Team')}</th><th scope="col">{i.t('Needed')}</th><th scope="col">{i.t('Tricks')}</th><th scope="col">{i.t('Round')}</th><th scope="col">{i.t('Total')}</th></tr></thead>
            <tbody>
              {r.teams.map((t) => {
                const team = view.teams!.find((x) => x.id === t.id)!;
                return (
                  <tr key={t.id} className={`team-${t.id}`}>
                    <th scope="row"><span className="team-dot" /> {i.name(team.name)}</th>
                    <td>{i.num(t.target)} {t.contract === 'bid' ? i.t('(bid)') : i.t('(defend)')}</td>
                    <td>{i.num(t.tricks)}</td>
                    <td className={t.roundScore < 0 ? 'neg' : 'pos'}>{i.signed(t.roundScore)}</td>
                    <td>{i.num(t.cumulativeScore)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted result-players">
            {i.t('Tricks')}: {r.players.map((p) => `${seatName(p.seat)} ${i.num(p.tricksWon)}`).join(', ')}
          </p>
        </>
      ) : (
        <>
          <table className="result-table">
            <thead><tr><th scope="col">{i.t('Player')}</th><th scope="col">{i.t('Bid')}</th><th scope="col">{i.t('Tricks')}</th><th scope="col">{i.t('Round')}</th><th scope="col">{i.t('Total')}</th></tr></thead>
            <tbody>
              {r.players.map((p) => (
                <tr key={p.seat}>
                  <th scope="row">{seatName(p.seat)}</th>
                  <td>{bidText(i, p.bid)}</td>
                  <td>{i.num(p.tricksWon)}</td>
                  <td className={p.roundScore < 0 ? 'neg' : 'pos'}>{i.signed(p.roundScore)}</td>
                  <td>{i.num(p.cumulativeScore)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {r.teams && (
            <div className="team-results">
              {r.teams.map((t) => {
                const team = view.teams!.find((x) => x.id === t.id)!;
                return (
                  <div key={t.id} className={`team-total team-${t.id}`}>
                    <span className="tname">{i.name(team.name)}</span>
                    <span className={t.roundScore < 0 ? 'neg' : 'pos'}>{i.t('{n} this round', { n: i.signed(t.roundScore) })}</span>
                    <strong>{i.num(t.cumulativeScore)}</strong>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
      {view.tieNote && <p className="note">{i.t('The leaders are tied — playing another round to break the tie.')}</p>}
      <div className="row end">
        {canContinue
          ? <button className="btn brass" autoFocus onClick={() => dispatch({ type: 'NEXT_ROUND' })}>{last ? i.t('See final results') : i.t('Next round')}</button>
          : <span className="muted">{i.t('Waiting for the host to continue…')}</span>}
      </div>
    </div>
  );
}

export function MatchResult({ view, onNewGame, onMenu }: { view: PlayerView; onNewGame?: () => void; onMenu: () => void }) {
  const i = useI18n();
  const seatName = useSeatName(view.players);
  const w = view.matchWinner!;
  const winnerName = w.kind === 'team' ? i.name(view.teams!.find((t) => t.id === w.id)!.name) : seatName(w.seat);
  const youWon = w.kind === 'team' ? view.players[view.seat].team === w.id : w.seat === view.seat;
  const sharedNames = view.sharedWinners?.map((k) => (view.teams?.find((t) => t.id === k) ? i.name(view.teams.find((t) => t.id === k)!.name) : seatName(k as 'A')));
  const standings = view.teams
    ? [...view.teams].sort((a, b) => b.cumulativeScore - a.cumulativeScore).map((t) => ({ name: i.name(t.name), total: t.cumulativeScore }))
    : [...SEATS].sort((a, b) => view.players[b].cumulativeScore - view.players[a].cumulativeScore).map((s) => ({ name: seatName(s), total: view.players[s].cumulativeScore }));
  return (
    <div className="panel match-panel" role="dialog" aria-label={i.t('Match result')}>
      <p className="muted">{i.t(view.roundHistory.length === 1 ? 'After {n} round' : 'After {n} rounds', { n: view.roundHistory.length })}</p>
      <h2>{sharedNames ? i.t('{p} share the win', { p: sharedNames.join(' & ') }) : youWon ? (view.teams ? i.t('Your team wins') : i.t('You win')) : i.t('{p} wins', { p: winnerName })}</h2>
      <ol className="standings">
        {standings.map((s) => <li key={s.name}><span>{s.name}</span><strong className={s.total < 0 ? 'neg' : ''}>{i.num(s.total)}</strong></li>)}
      </ol>
      <div className="row end">
        <button className="btn ghost" onClick={onMenu}>{i.t('Main menu')}</button>
        {onNewGame && <button className="btn brass" autoFocus onClick={onNewGame}>{i.t('New game')}</button>}
      </div>
    </div>
  );
}

/** After the second deal: call the Bonus (10), or go higher than the last call. */
export function BonusPanel({ view, dispatch }: { view: PlayerView; dispatch: Dispatch }) {
  const i = useI18n();
  const seatName = useSeatName(view.players);
  const b = view.bonus;
  if (!b) return null;
  const myTurn = view.currentPlayer === view.seat;
  const { bonusBid, bonusPoints, maxBonusBid } = view.config;
  const amounts = Array.from({ length: Math.max(0, maxBonusBid - b.minNext + 1) }, (_, k) => b.minNext + k);
  const points = (n: number) => (bonusPoints ?? 13) + (n - (bonusBid ?? 10));
  const holder = b.caller ?? view.trump.bidder;
  return (
    <div className="panel bid-panel bonus-panel" aria-label={i.t('Bonus call')}>
      <div className="bid-head">
        <h3>🔥 {i.t('Bonus call')}</h3>
        <span className="muted">{b.caller ? i.t('{p} called {n}', { p: seatName(b.caller), n: b.amount! }) : holder ? i.t('Contract now: {n} by {p}', { p: seatName(holder), n: view.bidding.highestBid ?? 0 }) : ''}</span>
      </div>
      <ol className="bid-history">
        {b.history.map((h, k) => (
          <li key={k}><b>{seatName(h.seat)}</b> {h.action === 'call' ? i.t('calls {n}', { n: h.amount! }) : h.action === 'auto-pass' ? i.t('cannot go higher') : i.t('no')}</li>
        ))}
        {b.history.length === 0 && <li className="muted">{i.t('{p} decides first.', { p: seatName(b.starter) })}</li>}
      </ol>
      {myTurn ? (
        <>
          <div className="bid-buttons">
            {amounts.map((n) => (
              <button key={n} className={`btn bid ${n === bonusBid ? 'bonus' : 'bonus high'}`} onClick={() => dispatch({ type: 'BONUS_CALL', seat: view.seat, amount: n })}>
                {i.num(n)}<small>{n === bonusBid ? i.t('Bonus') : ''} +{i.num(points(n))}</small>
              </button>
            ))}
            <button className="btn ghost pass" onClick={() => dispatch({ type: 'BONUS_PASS', seat: view.seat })}>{i.t('No')}</button>
          </div>
          <p className="prompt">{b.caller
            ? i.t('Go higher to take the contract — make it and score the points shown, miss it and lose your call.')
            : i.t('With nine cards in hand: call {n} for the Bonus? Make it and score {p}; miss it and lose {n}. The caller plays for it and picks the trump.', { n: b.minNext, p: points(b.minNext) })}</p>
        </>
      ) : (
        <p className="prompt muted">{view.currentPlayer ? i.t('{p} is deciding…', { p: seatName(view.currentPlayer) }) : ''}</p>
      )}
    </div>
  );
}
