const active = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).get('diagnostic') === 'reads';

// Keep a diagnostic session when moving between Guardies and diagnostics.html.
// This is deliberately opt-in: regular users never read or write this key.
const storageKey = 'guardies.readDiagnostics.v1';

function readStoredState() {
  if (!active) return null;
  try {
    const stored = window.sessionStorage.getItem(storageKey);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

const storedState = readStoredState();

const state = {
  network: storedState?.network && typeof storedState.network === 'object' ? storedState.network : {},
  cache: storedState?.cache && typeof storedState.cache === 'object' ? storedState.cache : {},
  calls: storedState?.calls && typeof storedState.calls === 'object' ? storedState.calls : {},
  log: Array.isArray(storedState?.log) ? storedState.log.slice(-200) : [],
};

function record(category, reads, note = '', fromCache = false) {
  if (!active) return;
  const bucket = fromCache ? 'cache' : 'network';
  state[bucket][category] = (state[bucket][category] || 0) + reads;
  state.calls[category] = (state.calls[category] || 0) + 1;
  state.log.push({ ts: Date.now(), category, reads, fromCache, note });
  // eslint-disable-next-line no-console
  console.debug(`[reads] ${category} +${reads}${fromCache ? ' (cache)' : ''}${note ? ` · ${note}` : ''}`);
  publish();
}

function publish() {
  const totalNetwork = Object.values(state.network).reduce((sum, n) => sum + n, 0);
  const totalCache = Object.values(state.cache).reduce((sum, n) => sum + n, 0);
  const categories = new Set([
    ...Object.keys(state.network),
    ...Object.keys(state.cache),
  ]);
  window.__guardiesDiagnostics = {
    active,
    network: { ...state.network },
    cache: { ...state.cache },
    calls: { ...state.calls },
    totalNetwork,
    totalCache,
    log: state.log.slice(),
    summary() {
      if (!active) {
        // eslint-disable-next-line no-console
        console.warn('[guardies:reads] Diagnòstic inactiu. Recarrega amb ?diagnostic=reads a l’URL.');
        return;
      }
      const rows = Array.from(categories).map((cat) => ({
        category: cat,
        network: state.network[cat] || 0,
        cache: state.cache[cat] || 0,
        calls: state.calls[cat] || 0,
      }));
      rows.sort((a, b) => b.network - a.network);
      // eslint-disable-next-line no-console
      console.table(rows);
      // eslint-disable-next-line no-console
      console.log(`Network reads (facturable): ${totalNetwork} | Cache reads: ${totalCache}`);
    },
    reset() {
      Object.keys(state.network).forEach((k) => { state.network[k] = 0; });
      Object.keys(state.cache).forEach((k) => { state.cache[k] = 0; });
      Object.keys(state.calls).forEach((k) => { state.calls[k] = 0; });
      state.log.length = 0;
      publish();
    },
  };

  if (active) {
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify({
        network: state.network,
        cache: state.cache,
        calls: state.calls,
        log: state.log.slice(-200),
      }));
    } catch {
      // Diagnostics must never interfere with the application if storage is unavailable.
    }
  }
}

publish();

if (active) {
  // eslint-disable-next-line no-console
  console.info(
    '[guardies:reads] Diagnòstic activat. '
    + 'Usa window.__guardiesDiagnostics.summary() per veure el resum.',
  );
}

export function trackReads(category, reads, note = '', fromCache = false) {
  record(category, reads, note, fromCache);
}

export const isDiagnosticActive = active;
