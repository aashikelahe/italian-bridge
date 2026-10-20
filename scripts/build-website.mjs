// Build a single-file copy of the game for a plain website (e.g. aashik.xyz/italian-bridge/).
//   IB_SERVER_URL=https://italian-bridge-xxxx.onrender.com node scripts/build-website.mjs
// Computer play always works. Online play uses the game server at IB_SERVER_URL (leave it empty to turn it off).
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const server = (process.env.IB_SERVER_URL ?? '').trim();
execSync('npx vite build --mode single', { stdio: 'inherit' });
let html = readFileSync('dist-single/index.html', 'utf8');
const meta = `<meta name="ib-server" content="${server.replace(/"/g, '')}" />`;
html = html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    ${meta}`);
mkdirSync('dist-website', { recursive: true });
writeFileSync('dist-website/index.html', html);
console.log(`dist-website/index.html written (${Math.round(html.length / 1024)} KB), server: ${server || 'none (online play off)'}`);
