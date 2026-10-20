import type { RoundSummary, Seat } from '../../engine/types';
import type { PlayerView } from '../../engine/view';
import { SEATS, teamOf } from '../../engine/seating';
import { useI18n, useSeatName, type I18n } from '../i18n';

export const teamContractMode = (view: PlayerView) => view.mode === 'team' && view.config.teamScoring === 'teamContract';

/** Trick target for a team this round (team contract mode), once bidding is over. */
export function teamTarget(view: PlayerView, teamId: 'X' | 'Y'): number | null {
  const bidder = view.trump.bidder;
  if (!bidder || view.bidding.highestBid == null) return null;
  return teamId === teamOf(bidder) ? view.bidding.highestBid : view.config.passTarget;
}

/**
 * A player's call as shown on the table. During bidding: what they said. Afterwards, in team
 * play, each member of the bidding team shows the winning bid and each opponent shows 5.
 * Returns a number, 'pass', or null (hasn't spoken).
 */
export function callOf(view: PlayerView, seat: Seat): number | 'pass' | null {
  if (teamContractMode(view) && view.trump.bidder && view.bidding.highestBid != null && view.phase !== 'BIDDING') {
    return teamTarget(view, teamOf(seat))!;
  }
  if (view.trump.bidder && view.phase !== 'BIDDING') {
    const b = view.players[seat].bid;
    if (b.kind === 'bid') return b.amount;
    if (b.kind === 'pass') return 'pass';
  }
  const ev = [...view.bidding.history].reverse().find((h) => h.seat === seat && h.action !== 'reshuffle');
  if (!ev) return null;
  if (ev.action === 'bid' || ev.action === 'forced') return ev.amount!;
  return 'pass';
}

export function callLabel(i: I18n, c: number | 'pass' | null): string {
  if (c === null) return '—';
  if (c === 'pass') return i.t('Pass');
  return i.num(c);
}

interface Side {
  key: string;
  name: string;
  score: (r: RoundSummary) => number;
}

function useSides(view: PlayerView): Side[] {
  const i = useI18n();
  const seatName = useSeatName(view.players);
  if (view.teams) {
    return view.teams.map((t) => ({ key: t.id, name: i.name(t.name), score: (r) => r.teams!.find((x) => x.id === t.id)!.roundScore }));
  }
  return SEATS.map((s) => ({ key: s, name: seatName(s), score: (r) => r.players.find((p) => p.seat === s)!.roundScore }));
}

/**
 * The paper-style sheet: Round column, then two boxes per name — the running total after
 * that round, and the next round's points. While a round is being played, its call shows
 * in brackets in the last right-hand box.
 */
function ScoreSheet({ view }: { view: PlayerView }) {
  const i = useI18n();
  const cols = useSides(view);
  const rounds = view.roundHistory;
  const roundOver = view.phase === 'ROUND_RESULT' || view.phase === 'MATCH_OVER';
  const callsMade = view.bidding.history.length > 0 && !roundOver;
  const pendingCall = (c: Side): string => {
    if (!callsMade) return '';
    if (view.teams) {
      const tt = teamTarget(view, c.key as 'X' | 'Y');
      return tt == null ? '' : `(${i.num(tt)})`;
    }
    const call = callOf(view, c.key as Seat);
    if (call === null) return '';
    return `(${i.num(call === 'pass' ? view.config.passTarget : call)})`;
  };
  if (rounds.length === 0 && !callsMade) return <p className="muted sheet-empty">{i.t('The sheet starts with the first call.')}</p>;
  const totals = cols.map(() => 0);
  const rows = rounds.map((r) => cols.map((c, k) => (totals[k] += c.score(r))));
  return (
    <div className="sheet-wrap">
      <table className="sheet">
        <thead>
          <tr>
            <th scope="col" className="rnd">{i.t('Round')}</th>
            {cols.map((c, k) => (
              <th key={c.key} colSpan={2} scope="colgroup" className={`side-${k}`}><span className="sheet-name">{c.name}</span></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr className="pending">
              <th scope="row" className="rnd">{i.num(1)}</th>
              {cols.map((c, k) => [<td key={`${c.key}t`} className={`tot muted side-${k}`}>{pendingCall(c)}</td>, <td key={`${c.key}n`} className={`nxt side-${k}`} />])}
            </tr>
          )}
          {rows.map((row, ri) => (
            <tr key={ri}>
              <th scope="row" className="rnd">{i.num(ri + 1)}</th>
              {row.map((total, k) => {
                const next = rounds[ri + 1] ? cols[k].score(rounds[ri + 1]) : null;
                const isLast = ri === rows.length - 1;
                return [
                  <td key={`${k}t`} className={`tot side-${k} ${total < 0 ? 'neg' : ''}`}>{i.num(total)}</td>,
                  <td key={`${k}n`} className={`nxt side-${k} ${next == null ? 'muted' : next < 0 ? 'neg' : 'pos'}`}>
                    {next != null ? i.signed(next) : isLast ? pendingCall(cols[k]) : ''}
                  </td>,
                ];
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="sheet-key muted">{i.t('Left box: total after the round. Right box: next round’s points (its call in brackets while it is being played).')}</p>
    </div>
  );
}

/** Always-visible scores: the round-by-round sheet, then totals. */
export function ScorePanel({ view }: { view: PlayerView }) {
  const i = useI18n();
  const seatName = useSeatName(view.players);
  const order: Seat[] = view.mode === 'team' ? [view.seat, ...SEATS.filter((s) => s !== view.seat && teamOf(s) === teamOf(view.seat)), ...SEATS.filter((s) => teamOf(s) !== teamOf(view.seat))] : SEATS;
  const inPlay = ['PLAYING', 'MANDATORY_REVEAL', 'ROUND_RESULT'].includes(view.phase);
  const tc = teamContractMode(view);
  return (
    <section className="score-panel" aria-label={i.t('Scores')}>
      <header>
        <h2>{i.t('Score sheet')}</h2>
        <span className="muted">{view.config.winCondition === 'exact' ? i.t('First to exactly {n}', { n: view.matchTarget }) : i.t('First to {n}', { n: view.matchTarget })}</span>
      </header>
      <ScoreSheet view={view} />

      <h3 className="totals-head">{tc ? i.t('Team totals') : i.t('Totals')}</h3>
      {view.teams && (
        <div className="team-totals">
          {view.teams.map((t) => {
            const tt = teamTarget(view, t.id);
            return (
              <div key={t.id} className={`team-total team-${t.id}`}>
                <span className="tname">{i.name(t.name)}</span>
                <span className="tmembers">{t.members.map((m) => seatName(m)).join(' & ')}</span>
                {tc && inPlay && tt != null && (
                  <span className="tmembers">
                    {i.t('Tricks {a} of {b}', { a: view.players[t.members[0]].tricksWon + view.players[t.members[1]].tricksWon, b: tt })}
                    {' '}{view.trump.bidder && t.members.includes(view.trump.bidder) ? i.t('(bid)') : i.t('(defend)')}
                  </span>
                )}
                <strong className={t.cumulativeScore < 0 ? 'neg' : ''}>{i.num(t.cumulativeScore)}</strong>
              </div>
            );
          })}
        </div>
      )}
      <table className="totals">
        <thead>
          <tr><th scope="col">{i.t('Player')}</th><th scope="col">{i.t('Call')}</th><th scope="col">{i.t('Tricks')}</th>{!tc && <th scope="col">{i.t('Total')}</th>}</tr>
        </thead>
        <tbody>
          {order.map((s) => {
            const p = view.players[s];
            const call = callOf(view, s);
            const tg = !tc && inPlay ? (call === 'pass' ? view.config.passTarget : call) : null;
            const met = tg != null && p.tricksWon >= tg;
            return (
              <tr key={s} className={`${view.currentPlayer === s ? 'turn' : ''} ${p.team ? `team-${p.team}` : ''}`}>
                <th scope="row">
                  {p.team && <span className="team-dot" />}
                  {seatName(s)}
                  {view.trump.bidder === s && <span className="tag">{i.t('bidder')}</span>}
                </th>
                <td>{callLabel(i, call)}</td>
                <td className={met ? 'met' : ''}>{inPlay ? (tg != null ? `${i.num(p.tricksWon)}/${i.num(tg)}` : i.num(p.tricksWon)) : '—'}</td>
                {!tc && <td className={p.cumulativeScore < 0 ? 'neg' : ''}>{i.num(p.cumulativeScore)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
