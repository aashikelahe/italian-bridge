import type { CSSProperties } from 'react';
import type { Card as CardT } from '../../engine/types';
import { SUIT_SYMBOL, isRed } from '../../engine/cards';
import { useI18n } from '../i18n';

interface Props {
  card: CardT;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  style?: CSSProperties;
}

/** A face-up playing card. Hearts/Diamonds red, Spades/Clubs black. */
export function CardFace({ card, size = 'md', className = '', style }: Props) {
  const i = useI18n();
  const red = isRed(card.suit);
  return (
    <div className={`card face ${size} ${red ? 'red' : 'black'} ${className}`} style={style} role="img" aria-label={i.cardName(card)}>
      <span className="idx tl"><b>{card.rank}</b><i>{SUIT_SYMBOL[card.suit]}</i></span>
      <span className="pip" aria-hidden>{SUIT_SYMBOL[card.suit]}</span>
      <span className="idx br" aria-hidden><b>{card.rank}</b><i>{SUIT_SYMBOL[card.suit]}</i></span>
    </div>
  );
}

export function CardBack({ size = 'md', className = '', style }: { size?: 'xs' | 'sm' | 'md' | 'lg'; className?: string; style?: CSSProperties }) {
  return <div className={`card back ${size} ${className}`} style={style} aria-hidden />;
}
