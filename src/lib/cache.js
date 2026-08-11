// Workspace-partitioned IndexedDB cache for GET API responses.
// Key: `${workspace}:${path}` — prevents data leaking across workspaces on a
// shared device. Entries expire after 24 h so stale data doesn't linger.

const DB_NAME = 'dispatch-api-cache';
const STORE = 'responses';
const VERSION = 1;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

let _db = null;
function openDb() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = (e) => e.target.result.createObjectStore(STORE);
    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror = (e) => reject(e.target.error);
  });
}

export async function cacheGet(key) {
  try {
    const db = await openDb();
    return new Promise((resolve) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => {
        const entry = req.result;
        if (!entry || Date.now() - entry.ts > MAX_AGE_MS) return resolve(null);
        resolve(entry.data);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function cachePut(key, data) {
  try {
    const db = await openDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ data, ts: Date.now() }, key);
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  } catch {
    // Non-fatal — offline reads still work from prior puts.
  }
}
