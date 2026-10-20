# Put Italian Bridge online

The game is one small Node.js app. It serves the game page and runs the online rooms.
Anyone with the link can play: no accounts, nothing to install.

You need two free accounts: **GitHub** (stores the code) and **Render** (runs it).
It takes about 15 minutes the first time.

---

## 1. Put the code on GitHub

1. Sign in at <https://github.com>.
2. Click **+** (top right) → **New repository**.
   - Name: `italian-bridge`
   - Choose **Public** or **Private** (either works).
   - Leave everything else as it is → **Create repository**.
3. On the new, empty repository page click **uploading an existing file**.
4. Unzip `italian-bridge-source.zip` on your computer. Open the `italian-bridge` folder and
   **drag everything inside it** (the folders `src`, `server`, `scripts`, `tests`, `docs`
   and all the files such as `package.json`, `render.yaml`, `index.html`) into the upload box.
   Do not upload a `node_modules` folder if you have one.
5. Click **Commit changes**.

Check: the repository's main page should list `package.json` and `render.yaml` at the top level
(not inside another `italian-bridge` folder).

## 2. Run it on Render

1. Go to <https://render.com> → **Get Started** → sign up **with GitHub**.
2. In the Render dashboard click **New** → **Blueprint**.
3. Connect your GitHub account if asked, and pick the `italian-bridge` repository.
4. Render reads `render.yaml` and shows one free web service called `italian-bridge`. Click **Apply** / **Deploy**.
5. Wait 3–5 minutes for the first build. When it says **Live**, your address is shown at the top,
   for example `https://italian-bridge-xxxx.onrender.com`.

(If you prefer not to use the Blueprint: **New → Web Service**, pick the repository, then set
Build command `npm install --include=dev && npm run build`, Start command `npm start`, Instance type **Free**.)

## 3. Play with friends

1. Open your Render address. Choose **Play online with friends**.
2. Type your name → choose the table → **Create room**.
3. Click **Copy invite link** and send it on WhatsApp / Messenger. (Or just tell them the 5-letter code.)
4. Friends open the link, type their name, press **Join**, and pick a seat.
5. Chat in the lobby. When everyone is seated, press **Start game**. Empty seats are played by the computer.

## Good to know (free plan)

* **First visit after a quiet spell is slow.** The free server sleeps after 15 minutes with no players and
  takes about a minute to wake up. The game shows "Connecting…" and joins by itself. Open the link a minute
  before you want to play.
* **During a game it stays awake.** Card play keeps it running.
* **Someone's internet drops?** They reopen the link (or reload) and are put straight back in their seat.
  If they are away more than 45 seconds on their turn, the computer plays for them until they return.
* **Server restarts end running games.** On the free plan nothing is saved to disk, so if Render restarts the
  server (for example when you upload a new version) any game in progress is lost. Create a new room.
* The free plan includes 750 hours a month, enough for one always-on game server.

## Updating the game later

Upload the changed files to the same GitHub repository (**Add file → Upload files**, then **Commit**).
Render rebuilds and goes live again on its own in a few minutes.

## The copy on aashik.xyz

The website has a copy of the game at `https://aashik.xyz/italian-bridge/` (linked from the Games page).
It uses the game server at `https://italian-bridge-ln1u.onrender.com` (set in the page's
`<meta name="ib-server">` tag), so online rooms work there too.
To rebuild that copy after game changes: `IB_SERVER_URL=https://italian-bridge-ln1u.onrender.com npm run build:website`
and copy `dist-website/index.html` to `italian-bridge/index.html` in the website repository.

## Optional: use your own domain

To use an address like `bridge.aashik.xyz`: in Render open the service → **Settings → Custom Domains → Add**,
then add the CNAME record Render shows at your domain's DNS provider.

---

## Alternative: play on your home Wi-Fi from your own PC (no hosting)

1. Install **Node.js LTS** from <https://nodejs.org>.
2. Unzip the project. Open a terminal in the `italian-bridge` folder
   (Windows: open the folder, type `cmd` in the address bar, press Enter).
3. Run, one at a time:
   ```
   npm install
   npm run build
   npm start
   ```
4. Find your PC's local address: on Windows run `ipconfig` and look for **IPv4 Address**, e.g. `192.168.0.105`.
5. Friends on the same Wi-Fi open `http://192.168.0.105:3000`. Allow Node.js through the Windows firewall if asked.

This only works for people on your network, and only while your PC is on and the terminal window stays open.

## For developers

* `npm run dev` + `npm run dev:server` – live development (the page proxies `/ws` to the server on port 3000).
* `npm test` – rules, scoring, simulated rounds and server room tests.
* `PORT` sets the port; `DATA_FILE=/path/rooms.json` keeps rooms across restarts on hosts with a disk.
* `VITE_SERVER_URL` (build time) lets the page live on a different site from the server, e.g. a static page on
  aashik.xyz talking to `wss://italian-bridge-xxxx.onrender.com`.
