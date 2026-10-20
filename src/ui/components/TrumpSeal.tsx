import type { PlayerView } from '../../engine/view';
import { SUIT_SYMBOL, isRed } from '../../engine/cards';
import { CardFace } from './Card';
import { useI18n, useSeatName } from '../i18n';

/** The reserved trump card: a sealed card until it is revealed. */
export function TrumpSeal({ view, onReveal, onRequest }: { view: PlayerView; onReveal: () => void; onRequest: () => void }) {
  const i = useI18n();
  const seatName = useSeatName(view.players);
  const { trump } = view;
  if (!trump.bidder) {
    return (
      <div className="seal-box empty">
        <div className="seal-slot" aria-hidden />
        <p>{i.t('No trump yet')}</p>
      </div>
    );
  }
  const mine = trump.bidder === view.seat;
  if (view.phase === 'TRUMP_RESERVATION') {
    return (
      <div className="seal-box empty">
        <div className="seal-slot" aria-hidden />
        <p>{mine ? i.t('Choose your trump card') : i.t('{p} is choosing a trump card', { p: seatName(trump.bidder) })}</p>
      </div>
    );
  }

  if (trump.revealed && trump.revealedCard) {
    const how = trump.revealedHow === 'mandatory' ? i.t('Revealed before the last trick')
      : trump.revealedHow === 'voluntary' ? i.t('Revealed by {p}', { p: seatName(trump.bidder) })
      : trump.revealedBy === view.seat ? i.t('Shown at your request') : i.t('Shown at {p}’s request', { p: seatName(trump.revealedBy!) });
    const s = trump.revealedCard.suit;
    return (
      <div className="seal-box revealed">
        <CardFace card={trump.revealedCard} size="sm" className="broken" />
        <div>
          <p className={`trump-suit ${isRed(s) ? 'red' : ''}`}>{SUIT_SYMBOL[s]} {i.t('{suit} are trumps', { suit: i.suit(s) })}</p>
          <p className="muted">{how}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`seal-box sealed ${mine ? 'mine' : ''}`}>
      {view.myReserved ? (
        <div className="seal-peek" title={i.t('Only you can see this card')}>
          <CardFace card={view.myReserved} size="sm" />
          <span className="wax" aria-hidden>{SUIT_SYMBOL[view.myReserved.suit]}</span>
        </div>
      ) : (
        <div className="seal-card" aria-label={i.t('Hidden trump card')}><span className="wax" aria-hidden>?</span></div>
      )}
      <div>
        <p className="trump-suit">{view.myReserved ? i.t('Your trump: {suit}', { suit: i.suit(view.myReserved.suit) }) : i.t('Trump is hidden')}</p>
        <p className="muted">{mine ? i.t('Only you can see this card') : i.t('Reserved by {p}', { p: seatName(trump.bidder) })}</p>
        {view.canRevealVoluntarily && <button className="btn small brass" onClick={onReveal}>{i.t('Reveal trump and play one')}</button>}
        {view.canRequestReveal && <button className="btn small brass" onClick={onRequest}>{i.t('Ask to see trump')}</button>}
      </div>
    </div>
  );
}
