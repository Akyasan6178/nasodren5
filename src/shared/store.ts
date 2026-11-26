// Veri katmanı (tarayıcı bağlantıları). Mantık store-core.ts içindedir.
// Mod, derleme sırasında VITE_VERI_MODU ile seçilir: "yerel" = sunucusuz statik mod; aksi hâlde sunucu modu.
import { createStore, resolveMode, type KeyValueStorage } from './store-core';

export * from './store-core';

export const DATA_MODE = resolveMode(import.meta.env.VITE_VERI_MODU);

const browserStorage = (get: () => Storage): KeyValueStorage | null => {
  try { return get(); } catch { return null; }
};

const store = createStore({
  mode: DATA_MODE,
  fetch: (url, init) => fetch(url, init as RequestInit),
  storage: DATA_MODE === 'yerel' ? browserStorage(() => localStorage) : null,
  session: browserStorage(() => sessionStorage),
  seedUrl: `${import.meta.env.BASE_URL}data/varsayilan-sorular.json`,
});

export const {
  detectMode, startGame, setAdminKey, clearAdminKey, hasAdminKey,
  loadAdmin, saveQuestion, deleteQuestion, replaceAll, saveSettings, resetStats,
} = store;
