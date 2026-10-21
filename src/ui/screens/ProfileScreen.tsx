import { useRef, useState } from 'react';
import { HANDLE_RE, normalizeHandle } from '../../online/protocol';
import { myToken, setMyToken } from '../../online/net';
import { storage, type Settings } from '../storage';
import { useI18n } from '../i18n';
import { Face, PRESET_AVATARS, colorFor, levelOf, photoToDataUrl, picFromAvatar, saveProfile, useProfile } from '../profile';
import { cleanName } from '../../online/protocol';

/** Your player card: name, player ID, photo or avatar, level, and the login code for other devices. */
export function ProfileScreen({ settings, onSave, onBack }: { settings: Settings; onSave: (s: Settings) => void; onBack: () => void }) {
  const i = useI18n();
  const profile = useProfile();
  const [name, setName] = useState(settings.onlineNick || (settings.playerName !== 'You' ? settings.playerName : ''));
  const [handle, setHandle] = useState(profile.handle);
  const [avatar, setAvatar] = useState<string | null>(profile.avatar);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [code, setCode] = useState('');
  const [showCode, setShowCode] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const stats = storage.loadStats();
  const lv = levelOf(stats);
  const pct = Math.round(((lv.xp - lv.from) / Math.max(1, lv.to - lv.from)) * 100);
  const displayName = cleanName(name) || i.t('Your name');

  const save = () => {
    const h = normalizeHandle(handle);
    if (h && !HANDLE_RE.test(h)) { setMsg({ ok: false, text: i.t('Player IDs use 3–16 letters, numbers or _.') }); return; }
    const n = cleanName(name);
    onSave({ ...settings, onlineNick: n, playerName: n || settings.playerName });
    saveProfile({ handle: h, avatar });
    setHandle(h);
    setMsg({ ok: true, text: i.t('Saved. Your player card is shown to everyone at online tables.') });
  };

  const pickPhoto = async (f: File | undefined) => {
    if (!f) return;
    try { setAvatar(await photoToDataUrl(f)); setMsg(null); } catch { setMsg({ ok: false, text: i.t('That photo could not be used. Try another one.') }); }
  };

  return (
    <div className="page profile-page">
      <header className="page-head"><button className="btn ghost small" onClick={onBack}>{i.t('Back')}</button><h1>{i.t('Your player card')}</h1></header>

      <section className="player-card glass">
        <div className="pc-face">
          <Face pic={picFromAvatar(avatar)} name={displayName} color={colorFor(displayName)} className="xl" />
          <span className="pc-level" title={i.t('Level')}>{i.num(lv.level)}</span>
        </div>
        <div className="pc-info">
          <strong className="pc-name">{displayName}</strong>
          <span className="pc-handle">{handle ? `@${normalizeHandle(handle)}` : i.t('No player ID yet')}</span>
          <div className="xp" aria-label={i.t('Level {n}', { n: lv.level })}>
            <div className="xp-bar"><span style={{ width: `${pct}%` }} /></div>
            <small>{i.t('Level {n}', { n: lv.level })} · {i.num(lv.xp)} / {i.num(lv.to)} XP</small>
          </div>
          <div className="pc-stats">
            <span><b>{i.num(stats.matchesPlayed)}</b>{i.t('Matches')}</span>
            <span><b>{i.num(stats.matchesWon)}</b>{i.t('Wins')}</span>
            <span><b>{i.num(stats.contractsMade)}</b>{i.t('Bids made')}</span>
          </div>
        </div>
      </section>

      <section className="glass form-card">
        <label className="field">
          <span>{i.t('Name')}</span>
          <input id="profile-name" value={name} maxLength={16} onChange={(e) => setName(e.target.value)} placeholder={i.t('Your name')} />
        </label>
        <label className="field">
          <span>{i.t('Player ID')}</span>
          <div className="handle-input"><span>@</span><input id="profile-handle" value={handle} maxLength={17} onChange={(e) => setHandle(normalizeHandle(e.target.value))} placeholder="ashik_07" autoCapitalize="none" autoCorrect="off" spellCheck={false} /></div>
          <small className="muted">{i.t('3–16 letters, numbers or _. Friends see it at the table. Each ID belongs to one player.')}</small>
        </label>

        <div className="field">
          <span>{i.t('Picture')}</span>
          <div className="row-gap">
            <button className="btn brass small" type="button" onClick={() => file.current?.click()}>{i.t('Upload a photo')}</button>
            {avatar && <button className="btn ghost small" type="button" onClick={() => setAvatar(null)}>{i.t('Remove picture')}</button>}
            <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { void pickPhoto(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
          <div className="avatar-grid" role="radiogroup" aria-label={i.t('Or choose an avatar')}>
            {PRESET_AVATARS.map((e) => (
              <button key={e} type="button" role="radio" aria-checked={avatar === `e:${e}`} className={`avatar-pick ${avatar === `e:${e}` ? 'on' : ''}`} onClick={() => setAvatar(`e:${e}`)}>{e}</button>
            ))}
          </div>
        </div>
        <div className="row end"><button className="btn brass big" onClick={save}>{i.t('Save')}</button></div>
        {msg && <p className={msg.ok ? 'form-ok' : 'form-error'} role="status">{msg.text}</p>}
      </section>

      <section className="glass form-card">
        <h2>{i.t('Play on another device')}</h2>
        <p className="muted">{i.t('Your login code moves your player ID, picture and seat to another phone or computer. Keep it secret — anyone with it can play as you.')}</p>
        <div className="row-gap">
          <button className="btn ghost small" onClick={() => setShowCode((v) => !v)}>{showCode ? i.t('Hide my code') : i.t('Show my code')}</button>
          {showCode && <code className="login-code">{myToken()}</code>}
          {showCode && <button className="btn ghost small" onClick={() => void navigator.clipboard?.writeText(myToken())}>{i.t('Copy')}</button>}
        </div>
        <form className="row-gap" onSubmit={(e) => {
          e.preventDefault();
          if (!setMyToken(code)) { setMsg({ ok: false, text: i.t('That code does not look right.') }); return; }
          setCode('');
          setMsg({ ok: true, text: i.t('Done. This device now plays as that player. Set the same player ID and picture here too.') });
        }}>
          <input className="code-input wide" value={code} onChange={(e) => setCode(e.target.value)} placeholder={i.t('Paste a login code')} aria-label={i.t('Paste a login code')} />
          <button className="btn small" type="submit" disabled={code.trim().length < 16}>{i.t('Use this code')}</button>
        </form>
      </section>
    </div>
  );
}
