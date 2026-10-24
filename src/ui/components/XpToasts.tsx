import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { onXp, unlocksAt, nextUnlock, type XpEvent } from '../progress';
import { playVictory } from '../sound';

const THEME_NAMES: Record<string, string> = { emerald: 'Emerald', royal: 'Royal blue', crimson: 'Crimson', midnight: 'Midnight', sunset: 'Sunset', galaxy: 'Galaxy' };

/** "+10 XP" notes after each round, and a celebration when you reach a new level. */
export function XpToasts({ onOpenStyles }: { onOpenStyles?: () => void }) {
  const i = useI18n();
  const [toast, setToast] = useState<(XpEvent & { id: number }) | null>(null);
  const [levelUp, setLevelUp] = useState<number | null>(null);
  useEffect(() => onXp((e) => {
    setToast({ ...e, id: Date.now() });
    if (e.levelAfter > e.levelBefore) window.setTimeout(() => { setLevelUp(e.levelAfter); playVictory(); }, 1200);
  }), []);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const unlocked = levelUp ? collectUnlocks(levelUp) : null;
  const next = levelUp ? nextUnlock(levelUp) : null;
  return (
    <>
      {toast && (
        <div key={toast.id} className="xp-toast" role="status">
          <b>+{i.num(toast.gained)} XP</b>
          <span>{toast.reasons.map((r) => i.t(r)).join(' · ')}</span>
        </div>
      )}
      {levelUp && (
        <div className="levelup-veil" role="dialog" aria-modal="true" aria-label={i.t('Level {n}', { n: levelUp })} onClick={() => setLevelUp(null)}>
          <div className="levelup glass" onClick={(e) => e.stopPropagation()}>
            <div className="lu-burst" aria-hidden>⭐</div>
            <small>{i.t('Level up!')}</small>
            <strong className="lu-level">{i.t('Level {n}', { n: i.num(levelUp) })}</strong>
            {unlocked && (unlocked.faces.length > 0 || unlocked.tables.length > 0) ? (
              <div className="lu-unlocks">
                <p>{i.t('New unlocked:')}</p>
                <ul>
                  {unlocked.faces.map((f) => <li key={f}>🃏 {i.t('{x} cards', { x: i.t(f) })}</li>)}
                  {unlocked.tables.map((t) => <li key={t}>🟢 {i.t('{x} table', { x: i.t(THEME_NAMES[t] ?? t) })}</li>)}
                </ul>
              </div>
            ) : next ? (
              <p className="muted">{i.t('Next unlock at level {n}.', { n: i.num(next.level) })}</p>
            ) : null}
            <div className="row-gap center">
              {onOpenStyles && unlocked && (unlocked.faces.length > 0 || unlocked.tables.length > 0) && (
                <button className="btn brass" onClick={() => { setLevelUp(null); onOpenStyles(); }}>{i.t('Try it now')}</button>
              )}
              <button className="btn ghost" onClick={() => setLevelUp(null)}>{i.t('Nice!')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function collectUnlocks(level: number) {
  return unlocksAt(level);
}
