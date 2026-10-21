import { useState } from 'react';
import type { RuleConfig } from '../../engine/types';
import { MATCH_TARGETS, DEFAULT_RULES } from '../../engine/config';
import { cardFromId } from '../../engine/cards';
import { CardFace, CardBack } from '../components/Card';
import { storage, EMPTY_STATS, type Settings } from '../storage';
import { useI18n } from '../i18n';
import { Face, colorFor, levelOf, picFromAvatar, useProfile } from '../profile';
import { StylePicker } from '../components/StylePicker';

export function MainMenu({ hasSave, onNew, onResume, onGo, onOnline, onToggleLang, settings }: { hasSave: boolean; onNew: () => void; onResume: () => void; onGo: (s: 'rules' | 'settings' | 'stats' | 'profile') => void; onOnline: () => void; onToggleLang: () => void; settings: Settings }) {
  const i = useI18n();
  const profile = useProfile();
  const lv = levelOf(storage.loadStats());
  const name = settings.onlineNick || (settings.playerName !== 'You' ? settings.playerName : '') || i.t('Set up your player card');
  return (
    <div className="menu">
      <div className="menu-brand">
        <div className="menu-hero" aria-hidden>
          <CardFace card={cardFromId('AS')} size="lg" className="h1" />
          <CardBack size="lg" className="h2 sealed-hero" />
          <CardFace card={cardFromId('KH')} size="lg" className="h3" />
        </div>
        <h1>{i.t('Italian Bridge')}</h1>
        <p className="lede">{i.t('Bid, hide a trump, and take your tricks. Four players, one deck, thirteen tricks a round.')}</p>
      </div>
      <div className="menu-side">
        <button className="profile-chip glass" onClick={() => onGo('profile')}>
          <Face pic={picFromAvatar(profile.avatar) ?? (settings.onlineNick || settings.playerName !== 'You' ? null : { emoji: '👤' })} name={name} color={colorFor(name)} />
          <span className="pc-text"><b>{name}</b><small>{profile.handle ? `@${profile.handle}` : i.t('Create your player ID')} · {i.t('Level {n}', { n: lv.level })}</small></span>
        </button>
        <nav className="menu-actions">
          {hasSave && <button className="btn brass big" onClick={onResume}>{i.t('Resume game')}</button>}
          <button className={`btn big ${hasSave ? 'ghost' : 'brass'}`} onClick={onNew}>🃏 {i.t('Play against the computer')}</button>
          <button className="btn big ghost" onClick={onOnline}>👥 {i.t('Play online with friends')}</button>
          <div className="menu-links">
            <button className="btn ghost" onClick={() => onGo('rules')}>📖 {i.t('Game rules')}</button>
            <button className="btn ghost" onClick={() => onGo('settings')}>⚙️ {i.t('Settings')}</button>
            <button className="btn ghost" onClick={() => onGo('stats')}>📊 {i.t('Statistics')}</button>
            <button className="btn ghost" onClick={onToggleLang}>🌐 {i.lang === 'bn' ? 'English' : 'বাংলা'}</button>
          </div>
        </nav>
      </div>
    </div>
  );
}

function Segmented<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const i = useI18n();
  return (
    <fieldset className="seg">
      <legend>{i.t(label)}</legend>
      <div className="seg-opts">
        {options.map((o) => (
          <label key={String(o.value)} className={value === o.value ? 'on' : ''}>
            <input type="radio" checked={value === o.value} onChange={() => onChange(o.value)} />
            {i.t(o.label)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function SetupScreen({ settings, onStart, onBack }: { settings: Settings; onStart: (s: Settings) => void; onBack: () => void }) {
  const i = useI18n();
  const [s, setS] = useState(settings);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });
  const setRule = <K extends keyof RuleConfig>(k: K, v: RuleConfig[K]) => setS({ ...s, rules: { ...s.rules, [k]: v } });
  return (
    <div className="page setup">
      <header className="page-head">
        <button className="btn ghost small" onClick={onBack}>{i.t('Back')}</button>
        <h1>{i.t('New game')}</h1>
      </header>
      <form className="setup-form" onSubmit={(e) => { e.preventDefault(); onStart(s); }}>
        <label className="field">
          <span>{i.t('Your name')}</span>
          <input id="player-name" value={s.playerName} maxLength={16} onChange={(e) => set('playerName', e.target.value)} />
        </label>
        <Segmented label="Mode" value={s.mode} onChange={(v) => set('mode', v)} options={[{ value: 'team', label: 'Two teams' }, { value: 'individual', label: 'Individual' }]} />
        {s.mode === 'team' && (
          <Segmented label="Table" value={s.tableType} onChange={(v) => set('tableType', v)} options={[{ value: 'regular', label: 'Regular' }, { value: 'friends', label: 'Friends (emoji throwing)' }]} />
        )}
        {s.mode === 'team' && (
          <div className="teams-setup">
            <label className="field"><span>{i.t('Team with {p} and Nadia (across from you)', { p: s.playerName || i.t('you') })}</span>
              <input id="team-x" value={s.teamNames.X} maxLength={20} onChange={(e) => set('teamNames', { ...s.teamNames, X: e.target.value })} /></label>
            <label className="field"><span>{i.t('Team with Rafi and Tanvir (on your sides)')}</span>
              <input id="team-y" value={s.teamNames.Y} maxLength={20} onChange={(e) => set('teamNames', { ...s.teamNames, Y: e.target.value })} /></label>
          </div>
        )}
        <Segmented label="Opponent skill" value={s.difficulty} onChange={(v) => set('difficulty', v)} options={[{ value: 'easy', label: 'Easy' }, { value: 'normal', label: 'Normal' }, { value: 'hard', label: 'Hard' }]} />
        <Segmented label="Play to" value={s.matchTarget} onChange={(v) => set('matchTarget', v)} options={MATCH_TARGETS.map((t) => ({ value: t, label: t === 30 ? '30 points' : '50 points' }))} />
        <Segmented label="Animation" value={s.anim} onChange={(v) => set('anim', v)} options={[{ value: 'normal', label: 'Normal' }, { value: 'fast', label: 'Fast' }, { value: 'reduced', label: 'Reduced motion' }]} />

        <details className="advanced">
          <summary>{i.t('House rules')}</summary>
          <p className="muted">{i.t('These cover points the core rules leave open. Defaults are marked.')}</p>
          <Segmented label="Next trick is led by" value={s.rules.nextTrickLeader} onChange={(v) => setRule('nextTrickLeader', v)} options={[{ value: 'winner', label: 'The winner (default)' }, { value: 'afterWinner', label: 'Player after the winner' }]} />
          <Segmented label="Team scoring" value={s.rules.teamScoring} onChange={(v) => setRule('teamScoring', v)} options={[{ value: 'teamContract', label: 'Team-wise: bid team vs 5 (default)' }, { value: 'sumOfPlayers', label: 'Add up each partner’s own score' }]} />
          <Segmented label="Bidding" value={s.rules.biddingStyle} onChange={(v) => setRule('biddingStyle', v)} options={[{ value: 'singleRound', label: 'Each player bids once (default)' }, { value: 'auction', label: 'Auction until all but one pass' }]} />
          <Segmented label="When everyone passes" value={s.rules.allPass} onChange={(v) => setRule('allPass', v)} options={[{ value: 'forceDealerSeven', label: 'Dealer must call 7 (default)' }, { value: 'forceFirstBidderSeven', label: 'First bidder must call 7' }, { value: 'redeal', label: 'Redeal' }]} />
          <Segmented label="Reshuffle call (no A, K, Q or J in the first five cards)" value={s.rules.reshuffleCall} onChange={(v) => setRule('reshuffleCall', v)} options={[{ value: 'firstHand', label: 'First hand only (default)' }, { value: 'anyPlayer', label: 'Any player on their turn' }, { value: 'off', label: 'Not allowed' }]} />
          <Segmented label="Bidder may reveal the trump" value={s.rules.voluntaryReveal} onChange={(v) => setRule('voluntaryReveal', v)} options={[{ value: 'whenVoid', label: 'Only when they can’t follow suit, and must play it (default)' }, { value: 'anyTurn', label: 'On any of their turns' }]} />
          <Segmented label="Shuffle between boards" value={s.rules.shuffleStyle} onChange={(v) => setRule('shuffleStyle', v)} options={[{ value: 'realistic', label: 'Stack the tricks, shuffle by hand (default)' }, { value: 'full', label: 'Full random shuffle' }]} />
          <Segmented label="Dealing" value={s.rules.dealStyle} onChange={(v) => setRule('dealStyle', v)} options={[{ value: 'packets', label: 'In packets of 5, 4, 4 (default)' }, { value: 'oneAtATime', label: 'One card at a time' }]} />
          <Segmented label="Trump cards beat other suits" value={s.rules.trumpEffect} onChange={(v) => setRule('trumpEffect', v)} options={[{ value: 'afterReveal', label: 'Only after the reveal (default)' }, { value: 'always', label: 'Always, even while hidden' }]} />
          <Segmented label="A player who was outbid scores as" value={s.rules.outbidPlayersScoreAs} onChange={(v) => setRule('outbidPlayersScoreAs', v)} options={[{ value: 'pass', label: 'A pass, needs 5 (default)' }, { value: 'ownHighestBid', label: 'Their own highest bid' }]} />
          <Segmented label="Partner of the bidder may ask to see trump" value={s.rules.partnerMayRequestReveal ? 'y' : 'n'} onChange={(v) => setRule('partnerMayRequestReveal', v === 'y')} options={[{ value: 'y', label: 'Yes (default)' }, { value: 'n', label: 'No, opponents only' }]} />
          <Segmented label="First trick is led by" value={s.rules.firstLeader} onChange={(v) => setRule('firstLeader', v)} options={[{ value: 'nextAfterBidder', label: 'Player after the bidder (default)' }, { value: 'bidder', label: 'The bidder' }, { value: 'nextAfterDealer', label: 'Player after the dealer' }]} />
          <Segmented label="Bidding starts with" value={s.rules.firstBidder} onChange={(v) => setRule('firstBidder', v)} options={[{ value: 'nextAfterDealer', label: 'Next player after the dealer (default)' }, { value: 'beforeDealer', label: 'Player before the dealer' }]} />
          <Segmented label="Who cuts" value={s.rules.cutter} onChange={(v) => setRule('cutter', v)} options={[{ value: 'beforeDealer', label: 'Player before the dealer (default)' }, { value: 'human', label: 'Always me' }]} />
          <Segmented label="Winning the match" value={s.rules.winCondition} onChange={(v) => setRule('winCondition', v)} options={[{ value: 'reachOrExceed', label: 'Reach or pass the target (default)' }, { value: 'exact', label: 'Hit the target exactly' }]} />
          <Segmented label="If the leaders tie" value={s.rules.tieRule} onChange={(v) => setRule('tieRule', v)} options={[{ value: 'playOn', label: 'Play another round (default)' }, { value: 'shared', label: 'Share the win' }]} />
          <button type="button" className="btn ghost small" onClick={() => setS({ ...s, rules: DEFAULT_RULES })}>{i.t('Restore default rules')}</button>
        </details>

        <div className="row end">
          <button type="submit" className="btn brass big">{i.t('Start game')}</button>
        </div>
      </form>
    </div>
  );
}

export function SettingsScreen({ settings, onSave, onBack }: { settings: Settings; onSave: (s: Settings) => void; onBack: () => void }) {
  const i = useI18n();
  const [s, setS] = useState(settings);
  const update = (n: Settings) => { setS(n); onSave(n); };
  return (
    <div className="page">
      <header className="page-head"><button className="btn ghost small" onClick={onBack}>{i.t('Back')}</button><h1>{i.t('Settings')}</h1></header>
      <div className="setup-form">
        <Segmented label="Language" value={s.lang} onChange={(v) => update({ ...s, lang: v })} options={[{ value: 'en', label: 'English' }, { value: 'bn', label: 'বাংলা' }]} />
        <Segmented label="Animation" value={s.anim} onChange={(v) => update({ ...s, anim: v })} options={[{ value: 'normal', label: 'Normal' }, { value: 'fast', label: 'Fast' }, { value: 'reduced', label: 'Reduced motion' }]} />
        <Segmented label="Sort my hand" value={s.sort} onChange={(v) => update({ ...s, sort: v })} options={[{ value: 'suitThenRank', label: 'By suit' }, { value: 'rankThenSuit', label: 'By rank' }]} />
        <Segmented label="Sound effects" value={s.sound ? 'on' : 'off'} onChange={(v) => update({ ...s, sound: v === 'on' })} options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} />
        <Segmented label="Vibration" value={s.haptics ? 'on' : 'off'} onChange={(v) => update({ ...s, haptics: v === 'on' })} options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} />
        <Segmented label="Developer mode (shows every hand — for testing only)" value={s.devMode ? 'on' : 'off'} onChange={(v) => update({ ...s, devMode: v === 'on' })} options={[{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }]} />
        <details className="advanced looks">
          <summary>{i.t('Card style and table')}</summary>
          <StylePicker settings={s} onChange={update} />
        </details>
        <p className="muted">{i.t('Settings are saved on this device.')}</p>
      </div>
    </div>
  );
}

export function StatsScreen({ onBack }: { onBack: () => void }) {
  const i = useI18n();
  const [st, setSt] = useState(storage.loadStats());
  const pct = (a: number, b: number) => (b ? `${i.num(Math.round((a / b) * 100))}%` : '—');
  const rows: [string, string][] = [
    [i.t('Matches played'), i.num(st.matchesPlayed)],
    [i.t('Matches won'), `${i.num(st.matchesWon)} (${pct(st.matchesWon, st.matchesPlayed)})`],
    [i.t('Rounds played'), i.num(st.roundsPlayed)],
    [i.t('Your side’s bids made'), `${i.t('{a} of {b}', { a: st.contractsMade, b: st.contractsBid })} (${pct(st.contractsMade, st.contractsBid)})`],
    [i.t('Defending rounds won'), `${i.t('{a} of {b}', { a: st.passesMade, b: st.passesTotal })} (${pct(st.passesMade, st.passesTotal)})`],
    [i.t('Best final total'), st.bestTotal == null ? '—' : i.num(st.bestTotal)],
  ];
  return (
    <div className="page">
      <header className="page-head"><button className="btn ghost small" onClick={onBack}>{i.t('Back')}</button><h1>{i.t('Statistics')}</h1></header>
      <dl className="stats">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      <button className="btn ghost small" onClick={() => { storage.saveStats(EMPTY_STATS); setSt(EMPTY_STATS); }}>{i.t('Reset statistics')}</button>
    </div>
  );
}

export function RulesScreen({ onBack }: { onBack: () => void }) {
  const i = useI18n();
  return (
    <div className="page rules">
      <header className="page-head"><button className="btn ghost small" onClick={onBack}>{i.t('Back')}</button><h1>{i.t('How to play')}</h1></header>
      {i.lang === 'bn' ? <RulesBn /> : <RulesEn />}
    </div>
  );
}

function RulesEn() {
  return (
    <article>
      <h2>The deal</h2>
      <p>Four players, one 52-card deck. Aces are high: A K Q J 10 9 8 7 6 5 4 3 2. After the shuffle and cut, everyone gets a packet of five cards. From the second board on, the dealer stacks the previous board’s tricks and shuffles them by hand — sometimes lightly, sometimes thoroughly — so hands can come out lumpy.</p>
      <h2>Bidding</h2>
      <p>Looking only at those five cards, each player in turn — starting after the dealer — bids how many of the 13 tricks they will take, 7 (“Small”), 8, 9 or 10 (“Bonus”), or passes. Everyone gets one turn, and each bid must be higher than the last. The highest bid wins. If nobody bids, the dealer must call 7.</p>
      <p>If the first hand’s five cards have no Ace, King, Queen or Jack, they may call for a reshuffle before bidding; they then become the dealer.</p>
      <h2>The hidden trump</h2>
      <p>The winning bidder picks one of their five cards and places it face down. Its suit is trump. Nobody else knows it. Then everyone receives four more cards, and then four more: 13 cards each, with the bidder’s reserved card counting as one of theirs.</p>
      <p><b>Bonus call.</b> After the second deal (nine cards each), everyone gets one more turn, starting after the dealer: call the Bonus (10), or say no. Once someone calls 10, the next players may only go higher — 11, 12 or 13 — and a 13 ends it at once. The highest caller plays for that number: if they are not the bidder, the bidder takes the hidden card back and the caller picks a new trump card. A made Bonus scores 13 (11 → 14, 12 → 15, 13 → 16); a missed one loses the number called.</p>
      <p>The trump stays hidden until someone needs it. A player who cannot follow the led suit may ask to see it — and must then play a trump if they have one. The bidder may reveal it only when they cannot follow the led suit, and must then play a trump card (any one). If it is still hidden after 12 tricks it is revealed automatically before the last trick.</p>
      <p>Until the trump is revealed, it has no power: a card of the trump suit played before the reveal is just an off-suit card.</p>
      <h2>Playing tricks</h2>
      <p>The player after the bidder leads first. You must follow the led suit if you can. The highest trump (played after the reveal) wins the trick; otherwise the highest card of the led suit wins. The winner takes the four cards and leads the next trick.</p>
      <h2>Scoring</h2>
      <p>Bid N and take at least N tricks: +N. Take fewer: −N. Extra tricks earn nothing more. The 10 (Bonus) call pays 13 when made and costs 10 when missed. If you passed, you need 5 tricks: +5 if you get them, −5 if not.</p>
      <p>In the team game, partners sit opposite each other and everything is team-wise. Partners may outbid each other. The team holding the highest bid needs that many tricks together; the other team needs 5 together. Each team scores plus or minus its target; there are no individual points. The first side to reach the target (30 or 50) after a round wins. Scores can go below zero.</p>
      <h2>Friends table</h2>
      <p>In a team game you can choose a Friends table: tap 😜 or a player’s name plate to throw an emoji at their face — love, laughs, tomatoes and worse. In Bangla, a Friends table uses the everyday card names.</p>
    </article>
  );
}

function RulesBn() {
  return (
    <article lang="bn">
      <h2>তাস বাটা</h2>
      <p>চারজন খেলোয়াড়, ৫২টি তাসের এক প্যাকেট। টেক্কা সবচেয়ে বড়: টেক্কা, রাজা, রানী, গোলাম, ১০, ৯ … ২। শাফল আর কাটার পর প্রত্যেকে একসাথে পাঁচটি করে তাস পায়। দ্বিতীয় দান থেকে আগের দানের পিঠগুলো একটার ওপর একটা রেখে হাতে শাফল করা হয় — কখনো হালকা, কখনো ভালো করে — তাই একই রঙের তাস একসাথে আসতে পারে।</p>
      <h2>ডাক</h2>
      <p>শুধু ওই পাঁচটি তাস দেখে, বাটার পরের জন থেকে শুরু করে প্রত্যেকে একবার করে ডাকে — ১৩টি পিঠের মধ্যে কয়টি নেবে, ৭ (“ছোট”), ৮, ৯ অথবা ১০ (“বোনাস”) — অথবা পাস দেয়। প্রত্যেক ডাক আগের ডাকের চেয়ে বড় হতে হবে। সবচেয়ে বড় ডাক জেতে। কেউ না ডাকলে যে বেটেছে তাকে ৭ ডাকতে হবে।</p>
      <p>প্রথম হাতের পাঁচ তাসে টেক্কা, রাজা, রানী বা গোলাম না থাকলে সে ডাকের আগে আবার শাফলের দাবি করতে পারে; তখন সে-ই বাটবে।</p>
      <h2>লুকানো রং (তুরুপ)</h2>
      <p>সবচেয়ে বড় ডাক যে দেয়, সে তার পাঁচ তাসের একটি উল্টো করে আলাদা রাখে। ওই তাসের রং-ই তুরুপ। আর কেউ জানে না। তারপর সবাই আরও চারটি, আবার চারটি তাস পায় — প্রত্যেকের ১৩টি, ডাকদাতার আলাদা রাখা তাসসহ।</p>
      <p><b>বোনাস ডাক।</b> দ্বিতীয় দফায় তাস পাওয়ার পর (প্রত্যেকের নয়টি) বাটার পরের জন থেকে সবাই আরেকবার সুযোগ পায়: বোনাস (১০) ডাকবে, নাকি না। কেউ ১০ ডাকলে পরের জনদের আরও বড় ডাকতে হবে — ১১, ১২ বা ১৩; ১৩ ডাকলে সাথে সাথে শেষ। সবচেয়ে বড় ডাকদাতা ওই সংখ্যার জন্য খেলে: সে আগের ডাকদাতা না হলে আগের ডাকদাতা লুকানো তাস ফেরত নেয়, আর নতুন ডাকদাতা নতুন রঙের তাস বাছে। বোনাস পূরণ হলে ১৩ (১১ → ১৪, ১২ → ১৫, ১৩ → ১৬); না হলে ডাকা সংখ্যা কাটা যায়।</p>
      <p>কারো দরকার না হলে রং দেখানো হয় না। যে খেলা রঙের তাস দিতে পারে না, সে রং দেখাতে বলতে পারে — তখন তার হাতে তুরুপ থাকলে তুরুপ দিতেই হবে। ডাকদাতা নিজে রং দেখাতে পারে শুধু তখন, যখন সে খেলা রঙের তাস দিতে পারে না — আর তখন তাকে একটা তুরুপ খেলতে হবে (যেকোনোটি)। ১২টি পিঠের পরও রং লুকানো থাকলে শেষ পিঠের আগে নিজে থেকেই দেখানো হয়।</p>
      <p>রং দেখানোর আগে তুরুপের কোনো জোর নেই: তখন তুরুপের রঙের তাস দিলে সেটা সাধারণ অন্য রঙের তাসের মতোই।</p>
      <h2>পিঠ খেলা</h2>
      <p>ডাকদাতার পরের জন প্রথম তাস দেয়। খেলা রঙের তাস থাকলে সেটাই দিতে হবে। রং দেখানোর পর দেওয়া সবচেয়ে বড় তুরুপ পিঠ জেতে; না থাকলে খেলা রঙের সবচেয়ে বড় তাস জেতে। যে জেতে সে চারটি তাস নেয় আর পরের পিঠে প্রথম তাস দেয়।</p>
      <h2>পয়েন্ট</h2>
      <p>N ডেকে কমপক্ষে N পিঠ নিলে +N, কম নিলে −N। বেশি পিঠে বাড়তি পয়েন্ট নেই। ১০ (বোনাস) ডেকে ১০টি পিঠ নিলে +১৩, না নিলে −১০। পাস দিলে ৫টি পিঠ লাগবে: পেলে +৫, না পেলে −৫।</p>
      <p>দলের খেলায় সঙ্গীরা মুখোমুখি বসে, সবকিছু দলগতভাবে। সঙ্গীও সঙ্গীর ওপর ডাকতে পারে। যে দলের ডাক সবচেয়ে বড়, তাদের দুজনে মিলে ততগুলো পিঠ নিতে হবে; অন্য দলকে মিলে ৫টি। দল তার লক্ষ্যের সমান পয়েন্ট পায় বা হারায়; আলাদা কারো পয়েন্ট নেই। কোনো দান শেষে যে আগে লক্ষ্যে (৩০ বা ৫০) পৌঁছায় সে জেতে। পয়েন্ট শূন্যের নিচেও যেতে পারে।</p>
      <h2>বন্ধুদের টেবিল</h2>
      <p>দলের খেলায় “বন্ধুদের টেবিল” বেছে নিলে 😜 বা কারো নামের ঘরে চাপ দিয়ে তার মুখে ইমোজি ছুড়তে পারবেন — ভালোবাসা, হাসি, টমেটো আর আরও খারাপ কিছু। বাংলায় বন্ধুদের টেবিলে তাসের কথ্য নাম ব্যবহার হয় (এক্কা, সাহেব, বিবি; ইস্কাবন, ভালোবাসা, ইঁট, চিড়া)।</p>
    </article>
  );
}
