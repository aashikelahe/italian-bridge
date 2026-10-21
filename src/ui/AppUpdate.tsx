/**
 * Android app only: when the app opens (or comes back to the front), check aashik.xyz for a newer
 * version and offer to download it. A version below `minVersionCode` must update to keep playing
 * (used when the rules or the online protocol change).
 */
import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { useI18n } from './i18n';

export interface RemoteVersion {
  versionCode: number;
  versionName: string;
  minVersionCode?: number;
  apk: string;
  sizeMB?: number;
  notes?: { en?: string; bn?: string };
}

function meta(name: string): string {
  return document.querySelector(`meta[name="${name}"]`)?.getAttribute('content')?.trim() ?? '';
}

export function isNativeApp(): boolean {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
}

/** This app's own version, baked in at build time. */
export function appVersion(): { code: number; name: string } | null {
  const [code, name] = meta('ib-app-version').split('|');
  return code ? { code: Number(code), name: name ?? '' } : null;
}

async function fetchLatest(): Promise<RemoteVersion | null> {
  const url = meta('ib-update-url');
  if (!url) return null;
  try {
    const r = await fetch(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const v = (await r.json()) as RemoteVersion;
    if (!v || typeof v.versionCode !== 'number' || !v.apk) return null;
    return { ...v, apk: new URL(v.apk, url).toString() };
  } catch {
    return null;
  }
}

async function openDownload(url: string) {
  try {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url });
  } catch {
    window.open(url, '_system');
  }
}

export function AppUpdate() {
  const i = useI18n();
  const [latest, setLatest] = useState<RemoteVersion | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const mine = appVersion();

  useEffect(() => {
    let test = false;
    try { test = localStorage.getItem('ib.updateTest') === '1'; } catch { /* ignore */ }
    if ((!isNativeApp() && !test) || !mine) return;
    let last = 0;
    const check = () => {
      if (Date.now() - last < 60_000) return;
      last = Date.now();
      void fetchLatest().then((v) => { if (v && v.versionCode > mine.code) { setLatest(v); setDismissed(false); } });
    };
    check();
    let remove: (() => void) | null = null;
    void import('@capacitor/app').then(({ App }) => App.addListener('resume', check)).then((h) => { remove = () => void h.remove(); }).catch(() => undefined);
    return () => remove?.();
  }, []);

  if (!latest || !mine || latest.versionCode <= mine.code) return null;
  const required = (latest.minVersionCode ?? 0) > mine.code;
  if (dismissed && !required) return null;
  const notes = (i.lang === 'bn' ? latest.notes?.bn : latest.notes?.en) ?? latest.notes?.en ?? '';
  return (
    <div className="update-veil" role="dialog" aria-modal="true" aria-label={i.t('Update available')}>
      <div className="update-card glass">
        <div className="update-icon" aria-hidden>⬆️</div>
        <h2>{required ? i.t('Update required') : i.t('Update available')}</h2>
        <p className="muted">{i.t('Version {v} is ready (you have {m}).', { v: latest.versionName, m: mine.name })}</p>
        {notes && <p className="update-notes">{notes}</p>}
        {required && <p>{i.t('This version is needed to keep playing online with everyone.')}</p>}
        <div className="row-gap update-actions">
          <button className="btn brass big" onClick={() => void openDownload(latest.apk)}>
            {i.t('Update now')}{latest.sizeMB ? ` · ${i.num(latest.sizeMB)} MB` : ''}
          </button>
          {!required && <button className="btn ghost" onClick={() => setDismissed(true)}>{i.t('Later')}</button>}
        </div>
        <p className="muted small">{i.t('The new version downloads, then tap it and choose Install. Your games, player card and settings are kept.')}</p>
      </div>
    </div>
  );
}
