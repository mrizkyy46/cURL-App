import { buildUrl, splitUrl } from './parser.js';

export const HISTORY_KEY = 'curl-workbench.history.v1';
export const HISTORY_LIMIT = 50;
export const HISTORY_MAX_CHARACTERS = 1_000_000;

// Copy only known fields. Keep disabled rows and original query encoding intact.
function snapshotRequest(request) {
  if (!request || typeof request.baseUrl !== 'string' || !/^[A-Z]+$/.test(request.method) ||
      !['none', 'raw', 'form'].includes(request.bodyMode) || typeof request.body !== 'string') {
    throw new Error('Enter a valid request before saving to history.');
  }
  const copyRows = (rows, query = false) => {
    if (!Array.isArray(rows)) throw new Error('Invalid request fields.');
    return rows.map(row => {
      if (!row || typeof row.key !== 'string' || typeof row.value !== 'string' || typeof row.enabled !== 'boolean') throw new Error('Invalid request field.');
      const result = { key: row.key, value: row.value, enabled: row.enabled };
      if (query && ['raw', 'originalKey', 'originalValue'].every(key => typeof row[key] === 'string')) {
        for (const key of ['raw', 'originalKey', 'originalValue']) result[key] = row[key];
      }
      return result;
    });
  };
  const result = {
    method: request.method,
    baseUrl: request.baseUrl,
    params: copyRows(request.params, true),
    headers: copyRows(request.headers),
    bodyMode: request.bodyMode,
    body: request.body,
    warnings: Array.isArray(request.warnings) ? request.warnings.filter(value => typeof value === 'string') : [],
  };
  try { splitUrl(buildUrl(result)); } catch { throw new Error('Enter a valid HTTP(S) URL before saving to history.'); }
  return result;
}

/** Store browser-local snapshots; importing this module never touches storage. */
export function createHistoryStore(getStorage = () => window.localStorage) {
  function list() {
    let raw;
    try { raw = getStorage().getItem(HISTORY_KEY); }
    catch { throw new Error('History is unavailable. Allow browser storage to save requests.'); }
    if (raw === null) return [];
    try {
      if (raw.length > HISTORY_MAX_CHARACTERS) throw new Error('Too large');
      const data = JSON.parse(raw);
      if (data.version !== 1 || !Array.isArray(data.entries) || data.entries.length > HISTORY_LIMIT) throw new Error('Invalid history');
      const ids = new Set();
      return data.entries.map(entry => {
        if (!entry || typeof entry.id !== 'string' || !entry.id || entry.id.length > 128 || ids.has(entry.id) ||
            !Number.isFinite(entry.savedAt) || Number.isNaN(new Date(entry.savedAt).getTime())) throw new Error('Invalid entry');
        ids.add(entry.id);
        return { id: entry.id, savedAt: entry.savedAt, request: snapshotRequest(entry.request) };
      });
    } catch { throw new Error('Saved history is unreadable. Use Clear history to reset it.'); }
  }

  function write(entries) {
    try { getStorage().setItem(HISTORY_KEY, JSON.stringify({ version: 1, entries })); }
    catch { throw new Error('History could not be saved. Browser storage may be full or blocked.'); }
    return entries;
  }

  return {
    list,
    save(request) {
      const snapshot = snapshotRequest(request);
      const signature = JSON.stringify(snapshot);
      const entry = { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`, savedAt: Date.now(), request: snapshot };
      const encode = entries => JSON.stringify({ version: 1, entries });
      if (encode([entry]).length > HISTORY_MAX_CHARACTERS) throw new Error('This request is too large to save to history.');
      const entries = [entry, ...list().filter(item => JSON.stringify(item.request) !== signature)].slice(0, HISTORY_LIMIT);
      while (encode(entries).length > HISTORY_MAX_CHARACTERS) entries.pop();
      return write(entries);
    },
    remove(id) { return write(list().filter(entry => entry.id !== id)); },
    clear() {
      try { getStorage().removeItem(HISTORY_KEY); }
      catch { throw new Error('History could not be cleared. Browser storage may be blocked.'); }
      return [];
    },
  };
}
