// Build the game for the Android app (Capacitor): one HTML file in dist-app/, with the online
// server address and this app's version baked in. Then `npx cap sync android` copies it into the app.
//   IB_SERVER_URL=https://italian-bridge-ln1u.onrender.com node scripts/build-app.mjs
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const server = (process.env.IB_SERVER_URL ?? 'https://italian-bridge-ln1u.onrender.com').trim();
const updates = (process.env.IB_UPDATE_URL ?? 'https://aashik.xyz/italian-bridge/app/version.json').trim();
const v = JSON.parse(readFileSync('app-version.json', 'utf8'));
execSync('npx vite build --mode single', { stdio: 'inherit' });
let html = readFileSync('dist-single/index.html', 'utf8');
const metas = [
  `<meta name="ib-server" content="${server.replace(/"/g, '')}" />`,
  `<meta name="ib-app-version" content="${Number(v.versionCode)}|${String(v.versionName).replace(/"/g, '')}" />`,
  `<meta name="ib-update-url" content="${updates.replace(/"/g, '')}" />`,
].join('\n    ');
html = html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    ${metas}`);
mkdirSync('dist-app', { recursive: true });
writeFileSync('dist-app/index.html', html);
console.log(`dist-app/index.html written (${Math.round(html.length / 1024)} KB), app ${v.versionName} (${v.versionCode}), server ${server}`);
