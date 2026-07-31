import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteJson, ensureDir } from './utils.js';
import { appendDiagnostic, normalizeError } from './runtime-diagnostics.js';

export function createJsonStore(file, collectionName) {
  ensureDir(path.dirname(file));
  let state = { [collectionName]: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed[collectionName] && typeof parsed[collectionName] === 'object') {
      state = parsed;
    } else {
      throw Object.assign(new Error(`Collezione ${collectionName} mancante o non valida.`), { code: 'store_schema_invalid' });
    }
  } catch (error) {
    if (fs.existsSync(file)) {
      const backup = `${file}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      try { fs.copyFileSync(file, backup); } catch {}
      appendDiagnostic('json_store_reinitialized', {
        file,
        collection: collectionName,
        corrupt_backup: backup,
        error: normalizeError(error)
      });
    }
    atomicWriteJson(file, state);
  }

  const persist = () => {
    try {
      atomicWriteJson(file, state);
    } catch (error) {
      appendDiagnostic('json_store_persist_failed', {
        file,
        collection: collectionName,
        item_count: Object.keys(state[collectionName] || {}).length,
        error: normalizeError(error)
      });
      throw error;
    }
  };

  return {
    create(value) { state[collectionName][value.id] = value; persist(); return value; },
    get(id) { return state[collectionName][id] || null; },
    update(id, patch) {
      if (!state[collectionName][id]) return null;
      state[collectionName][id] = { ...state[collectionName][id], ...patch, updated_at: new Date().toISOString() };
      persist();
      return state[collectionName][id];
    },
    list({ limit = 50 } = {}) {
      return Object.values(state[collectionName]).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, limit);
    },
    delete(id) { if (!state[collectionName][id]) return false; delete state[collectionName][id]; persist(); return true; }
  };
}
