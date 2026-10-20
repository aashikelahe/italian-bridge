import { useState } from 'react';
import type { Difficulty, GameState } from '../engine/types';
import { createMatch } from '../engine/game';
import { secureRng } from '../engine/rng';
import { storage, type Settings } from './storage';
import { setSoundEnabled } from './sound';
import { GameScreen } from './screens/GameScreen';
import { MainMenu, RulesScreen, SettingsScreen, SetupScreen, StatsScreen } from './screens/MenuScreens';
import { OnlineScreen } from './screens/Online';
import { I18nProvider } from './i18n';
import { normalizeCode } from '../online/protocol';

type Screen = 'menu' | 'setup' | 'game' | 'rules' | 'settings' | 'stats' | 'online';

export const AI_NAMES = { A: 'Nadia', B: 'Rafi', D: 'Tanvir' } as const;

function newGameState(s: Settings): GameState {
  return createMatch({
    mode: s.mode,
    matchTarget: s.matchTarget,
    rules: s.rules,
    teamNames: s.teamNames,
    rng: secureRng(),
    players: {
      A: { name: AI_NAMES.A, type: 'ai' },
      B: { name: AI_NAMES.B, type: 'ai' },
      C: { name: s.playerName.trim() || 'You', type: 'human' },
      D: { name: AI_NAMES.D, type: 'ai' },
    },
  });
}

/** An invite link looks like https://your-site/?room=K7QXM */
function inviteFromUrl(): string | null {
  try {
    const code = normalizeCode(new URLSearchParams(location.search).get('room') ?? '');
    return code.length >= 4 ? code : null;
  } catch { return null; }
}

/** Was this browser in an online room when the page was last closed? */
function wasInRoom(): boolean {
  try { return !!localStorage.getItem('ib.currentRoom'); } catch { return false; }
}

export function App() {
  const [invite] = useState(inviteFromUrl);
  const [screen, setScreen] = useState<Screen>(() => (invite || wasInRoom() ? 'online' : 'menu'));
  const [settings, setSettingsState] = useState<Settings>(() => storage.loadSettings());
  const [game, setGame] = useState<{ state: GameState; difficulty: Difficulty; friends: boolean } | null>(null);
  const [hasSave, setHasSave] = useState(() => !!storage.loadGame());
  setSoundEnabled(settings.sound);

  const saveSettings = (s: Settings) => { setSettingsState(s); storage.saveSettings(s); };
  const toggleLang = () => saveSettings({ ...settings, lang: settings.lang === 'bn' ? 'en' : 'bn' });
  const toggleSound = () => saveSettings({ ...settings, sound: !settings.sound });

  const start = (s: Settings) => {
    saveSettings(s);
    const state = newGameState(s);
    const friends = s.mode === 'team' && s.tableType === 'friends';
    storage.saveGame({ state, difficulty: s.difficulty, friends, savedAt: Date.now() });
    setGame({ state, difficulty: s.difficulty, friends });
    setScreen('game');
  };

  const exitToMenu = () => { setHasSave(!!storage.loadGame()); setScreen('menu'); };

  let body: JSX.Element | null;
  switch (screen) {
    case 'game':
      body = game ? (
        <GameScreen
          key={game.state.gameId}
          initial={game.state}
          difficulty={game.difficulty}
          friends={game.friends}
          settings={settings}
          onExit={exitToMenu}
          onNewGame={() => setScreen('setup')}
          onToggleLang={toggleLang}
          onToggleSound={toggleSound}
        />
      ) : null;
      break;
    case 'online':
      body = <OnlineScreen settings={settings} saveSettings={saveSettings} onBack={() => setScreen('menu')} onToggleLang={toggleLang} onToggleSound={toggleSound} inviteCode={invite} />;
      break;
    case 'setup':
      body = <SetupScreen settings={settings} onStart={start} onBack={() => setScreen('menu')} />;
      break;
    case 'rules':
      body = <RulesScreen onBack={() => setScreen('menu')} />;
      break;
    case 'settings':
      body = <SettingsScreen settings={settings} onSave={saveSettings} onBack={() => setScreen('menu')} />;
      break;
    case 'stats':
      body = <StatsScreen onBack={() => setScreen('menu')} />;
      break;
    default:
      body = (
        <MainMenu
          hasSave={hasSave}
          onNew={() => setScreen('setup')}
          onOnline={() => setScreen('online')}
          onToggleLang={toggleLang}
          onResume={() => {
            const g = storage.loadGame();
            if (g) { setGame({ state: g.state, difficulty: g.difficulty, friends: !!g.friends }); setScreen('game'); }
          }}
          onGo={setScreen}
        />
      );
  }
  return <I18nProvider lang={settings.lang} friends={false}><div className={`app lang-${settings.lang}`}>{body}</div></I18nProvider>;
}
