import { useRef, useState } from 'react';
import { HANDLE_RE, normalizeHandle } from '../../online/protocol';
import { myToken, setMyToken } from '../../online/net';
import { storage, type Settings } from '../storage';
import { useI18n } from '../i18n';
import { Face, PRESET_AVATARS, colorFor, levelOf, photoToDataUrl, picFromAvatar, saveProfile, useProfile } from '../profile';
import { cleanName } from '../../online/protocol';
import { XP, nextUnlock } from '../progress';
import { forgot, register, resetPassword, setEmail, signIn, signOut, syncAccount, useAccount, type Account, type LocalProfile } from '../../online/account';

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
  const next = nextUnlock(lv.level);
  const pct = Math.round(((lv.xp - lv.from) / Math.max(1, lv.to - lv.from)) * 100);
  const displayName = cleanName(name) || i.t('Your name');

  const save = () => {
    const h = normalizeHandle(handle);
    if (h && !HANDLE_RE.test(h)) { setMsg({ ok: false, text: i.t('Player IDs use 3–16 letters, numbers or _.') }); return; }
    const n = cleanName(name);
    onSave({ ...settings, onlineNick: n, playerName: n || settings.playerName });
    saveProfile({ handle: h, avatar });
    setHandle(h);
    void syncAccount({ name: n, avatar });
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
            {next && <small className="pc-next">🔓 {i.t('Level {n} unlocks {x}', { n: i.num(next.level), x: [...next.faces.map((f) => i.t('{x} cards', { x: i.t(f) })), ...next.tables.map((t) => i.t('{x} table', { x: i.t(t[0].toUpperCase() + t.slice(1)) }))].join(', ') })}</small>}
          </div>
          <div className="pc-stats">
            <span><b>{i.num(stats.matchesPlayed)}</b>{i.t('Matches')}</span>
            <span><b>{i.num(stats.matchesWon)}</b>{i.t('Wins')}</span>
            <span><b>{i.num(stats.contractsMade)}</b>{i.t('Bids made')}</span>
          </div>
        </div>
      </section>
      <details className="glass form-card xp-how">
        <summary>{i.t('How to earn XP')}</summary>
        <ul>
          <li><b>+{XP.matchWon + XP.matchPlayed}</b> {i.t('Win a match')}</li>
          <li><b>+{XP.matchPlayed}</b> {i.t('Finish a match')}</li>
          <li><b>+{XP.bonusMade}</b> {i.t('Make a Bonus (10 or more) bid')}</li>
          <li><b>+{XP.roundWon}</b> {i.t('Win a round')}</li>
          <li><b>+{XP.roundLost}</b> {i.t('Play a round')}</li>
        </ul>
        <p className="muted">{i.t('Higher levels unlock new card styles and tables. Online and offline games both count.')}</p>
      </details>

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

      <AccountCard
        profile={{ name: cleanName(name), avatar }}
        onAdopt={(a) => {
          const n = cleanName(a.name) || cleanName(name);
          setName(n); setHandle(a.login); setAvatar(a.avatar);
          onSave({ ...settings, onlineNick: n, playerName: n || settings.playerName });
          saveProfile({ handle: a.login, avatar: a.avatar });
        }}
      />

      <details className="glass form-card">
        <summary>{i.t('Login code (without an account)')}</summary>
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
      </details>
    </div>
  );
}

/** Sign up / sign in so the same player works on every device. */
function AccountCard({ profile, onAdopt }: { profile: LocalProfile; onAdopt: (a: Account) => void }) {
  const i = useI18n();
  const acc = useAccount();
  const prof = useProfile();
  const [tab, setTab] = useState<'new' | 'in' | 'forgot'>('new');
  const [login, setLogin] = useState(prof.handle);
  const [id, setId] = useState('');
  const [email, setEmailText] = useState('');
  const [pass, setPass] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async (f: () => Promise<Account | string | true>, okText: string) => {
    setBusy(true); setMsg(null);
    const r = await f();
    setBusy(false);
    if (typeof r === 'string') { setMsg({ ok: false, text: i.t(r) }); return; }
    if (r !== true) onAdopt(r);
    setPass(''); setMsg({ ok: true, text: i.t(okText) });
  };

  if (acc) {
    return (
      <section className="glass form-card account-card">
        <h2>🔐 {i.t('Your account')}</h2>
        <p className="acct-who">{i.t('Signed in as')} <b>@{acc.login}</b>{acc.email ? <> · {acc.email}</> : null}</p>
        <p className="muted">{i.t('Your name, picture, level and XP are saved to your account. Sign in with the same player ID on any phone or computer to keep playing as you.')}</p>
        <form className="row-gap" onSubmit={(e) => { e.preventDefault(); void run(() => setEmail(email.trim()), 'Email saved. You can use it to reset your password.'); }}>
          <input className="code-input wide" type="email" value={email} onChange={(e) => setEmailText(e.target.value)} placeholder={acc.email ? i.t('Change email') : i.t('Add an email (for a forgotten password)')} aria-label={i.t('Email')} />
          <button className="btn small" type="submit" disabled={busy || !email.includes('@')}>{i.t('Save email')}</button>
        </form>
        <div className="row-gap">
          <button className="btn ghost small" disabled={busy} onClick={() => void run(async () => (await syncAccount()) ?? 'Please sign in again.', 'Saved to your account.')}>⟳ {i.t('Save now')}</button>
          <button className="btn ghost small" onClick={() => { void signOut(); setMsg(null); }}>{i.t('Sign out')}</button>
        </div>
        {msg && <p className={msg.ok ? 'form-ok' : 'form-error'} role="status">{msg.text}</p>}
      </section>
    );
  }

  return (
    <section className="glass form-card account-card">
      <h2>🔐 {i.t('Account: play on any device')}</h2>
      <p className="muted">{i.t('Create an account with a player ID and password. On a new phone or computer, sign in and your player comes back — name, picture, level and XP.')}</p>
      <div className="seg-opts" role="tablist">
        <label className={tab === 'new' ? 'on' : ''}><input type="radio" checked={tab === 'new'} onChange={() => { setTab('new'); setMsg(null); }} />{i.t('Create account')}</label>
        <label className={tab !== 'new' ? 'on' : ''}><input type="radio" checked={tab !== 'new'} onChange={() => { setTab('in'); setMsg(null); }} />{i.t('Sign in')}</label>
      </div>
      {tab === 'new' && (
        <form className="acct-form" onSubmit={(e) => { e.preventDefault(); void run(() => register(normalizeHandle(login), email.trim(), pass, profile), 'Account created. You are signed in.'); }}>
          <label className="field"><span>{i.t('Player ID')}</span>
            <div className="handle-input"><span>@</span><input id="acct-login" value={login} maxLength={17} onChange={(e) => setLogin(normalizeHandle(e.target.value))} placeholder="ashik_07" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" /></div>
          </label>
          <label className="field"><span>{i.t('Email (optional, to reset a forgotten password)')}</span><input id="acct-email" type="email" value={email} onChange={(e) => setEmailText(e.target.value)} placeholder="you@example.com" autoComplete="email" /></label>
          <label className="field"><span>{i.t('Password')}</span><input id="acct-pass" type="password" value={pass} onChange={(e) => setPass(e.target.value)} minLength={6} autoComplete="new-password" placeholder={i.t('At least 6 characters')} /></label>
          <button className="btn brass" type="submit" disabled={busy || !HANDLE_RE.test(normalizeHandle(login)) || pass.length < 6}>{busy ? '…' : i.t('Create account')}</button>
        </form>
      )}
      {tab === 'in' && (
        <form className="acct-form" onSubmit={(e) => { e.preventDefault(); void run(() => signIn(id.trim(), pass), 'Signed in. Welcome back!'); }}>
          <label className="field"><span>{i.t('Player ID or email')}</span><input id="acct-id" value={id} onChange={(e) => setId(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" /></label>
          <label className="field"><span>{i.t('Password')}</span><input id="acct-pass-in" type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" /></label>
          <div className="row-gap">
            <button className="btn brass" type="submit" disabled={busy || !id.trim() || !pass}>{busy ? '…' : i.t('Sign in')}</button>
            <button className="link-btn" type="button" onClick={() => { setTab('forgot'); setMsg(null); setCodeSent(false); }}>{i.t('Forgot password?')}</button>
          </div>
        </form>
      )}
      {tab === 'forgot' && (
        <form className="acct-form" onSubmit={(e) => {
          e.preventDefault();
          if (!codeSent) void run(async () => { const r = await forgot(id.trim()); if (r === true) setCodeSent(true); return r; }, 'If that account has an email, a 6-digit code is on its way. Check your inbox (and spam).');
          else void run(() => resetPassword(id.trim(), code, pass), 'Password changed. You are signed in.');
        }}>
          <label className="field"><span>{i.t('Player ID or email')}</span><input id="acct-id-f" value={id} onChange={(e) => setId(e.target.value)} autoCapitalize="none" disabled={codeSent} /></label>
          {codeSent && <>
            <label className="field"><span>{i.t('Code from the email')}</span><input id="acct-code" inputMode="numeric" value={code} maxLength={7} onChange={(e) => setCode(e.target.value)} placeholder="123456" autoComplete="one-time-code" /></label>
            <label className="field"><span>{i.t('New password')}</span><input id="acct-newpass" type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" /></label>
          </>}
          <div className="row-gap">
            <button className="btn brass" type="submit" disabled={busy || !id.trim() || (codeSent && (code.replace(/\D/g, '').length !== 6 || pass.length < 6))}>{busy ? '…' : codeSent ? i.t('Change password') : i.t('Email me a code')}</button>
            <button className="link-btn" type="button" onClick={() => { setTab('in'); setMsg(null); }}>{i.t('Back to sign in')}</button>
          </div>
        </form>
      )}
      {msg && <p className={msg.ok ? 'form-ok' : 'form-error'} role="status">{msg.text}</p>}
    </section>
  );
}
