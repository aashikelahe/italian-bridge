import { cardFromId } from '../../engine/cards';
import { CardBack, CardFace } from './Card';
import { CARD_BACKS, CARD_FACES, TABLE_THEMES, THEME_LEVEL, storage, type Settings, type TableTheme } from '../storage';
import { levelOf } from '../profile';
import { useI18n } from '../i18n';

const THEME_NAME: Record<TableTheme, string> = { emerald: 'Emerald', royal: 'Royal blue', crimson: 'Crimson', midnight: 'Midnight', sunset: 'Sunset', galaxy: 'Galaxy' };
const BACK_NAME: Record<string, string> = { ruby: 'Ruby', navy: 'Navy', gold: 'Gold', carbon: 'Carbon' };

/** Your current player level (from this device's statistics). */
export const myLevel = () => levelOf(storage.loadStats()).level;

/** Card faces, card backs and table colours. Some unlock as your level grows. */
export function StylePicker({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
  const i = useI18n();
  const lv = myLevel();
  const lock = (need: number) => (need > lv ? <span className="lock-badge">🔒 {i.t('Level {n}', { n: need })}</span> : null);
  return (
    <div className="style-picker">
      <p className="muted sp-level">{i.t('Your level: {n}. Play matches to unlock more styles.', { n: lv })}</p>
      <h3>{i.t('Card faces')}</h3>
      <div className="sp-grid faces">
        {CARD_FACES.map((f) => {
          const locked = f.level > lv;
          return (
            <button key={f.id} type="button" className={`sp-item face-${f.id} ${settings.cardFace === f.id ? 'on' : ''} ${locked ? 'locked' : ''}`}
              disabled={locked} aria-pressed={settings.cardFace === f.id} onClick={() => onChange({ ...settings, cardFace: f.id })}>
              <span className="sp-cards"><CardFace card={cardFromId('AS')} size="sm" className="sp-card" /><CardFace card={cardFromId('KH')} size="sm" className="sp-card" /></span>
              <span className="sp-name">{i.t(f.name)}</span>
              {lock(f.level)}
            </button>
          );
        })}
      </div>
      <h3>{i.t('Table colour')}</h3>
      <div className="sp-grid themes">
        {TABLE_THEMES.map((t) => {
          const locked = THEME_LEVEL[t] > lv;
          return (
            <button key={t} type="button" className={`sp-item theme-swatch sw-${t} ${settings.theme === t ? 'on' : ''} ${locked ? 'locked' : ''}`}
              disabled={locked} aria-pressed={settings.theme === t} onClick={() => onChange({ ...settings, theme: t })}>
              <span className="sw" aria-hidden />
              <span className="sp-name">{i.t(THEME_NAME[t])}</span>
              {lock(THEME_LEVEL[t])}
            </button>
          );
        })}
      </div>
      <h3>{i.t('Card backs')}</h3>
      <div className="sp-grid backs">
        {CARD_BACKS.map((b) => (
          <button key={b} type="button" className={`sp-item back-${b} ${settings.cardBack === b ? 'on' : ''}`} aria-pressed={settings.cardBack === b} onClick={() => onChange({ ...settings, cardBack: b })}>
            <span className="sp-cards"><CardBack size="sm" /></span>
            <span className="sp-name">{i.t(BACK_NAME[b])}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
