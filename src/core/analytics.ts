// Thin analytics bridge. Pushes to GTM's dataLayer when the host page has one;
// otherwise a no-op. Keeps the game free of third-party scripts by default.

type Params = Record<string, string | number | boolean>;

interface DataLayerWindow {
  dataLayer?: Array<Record<string, unknown>>;
  gtag?: (...args: unknown[]) => void;
}

export function track(event: string, params: Params = {}): void {
  const w = window as unknown as DataLayerWindow;
  const name = `pacman_${event}`;
  try {
    if (typeof w.gtag === 'function') w.gtag('event', name, params);
    else if (Array.isArray(w.dataLayer)) w.dataLayer.push({ event: name, ...params });
  } catch {
    /* analytics must never break the game */
  }
  if (import.meta.env.DEV) console.debug('[track]', name, params);
}
