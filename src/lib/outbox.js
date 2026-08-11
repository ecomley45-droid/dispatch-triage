// Offline outbox — queues writes that failed due to network loss and replays
// them when the connection returns. Each entry is persisted in IndexedDB so it
// survives page reloads and app restarts.
//
// Entry types:
//   { type: 'note',              entity_type, entity_id, caption }
//   { type: 'upload_and_attach', entity_type, entity_id, b64, filename,
//                                contentType, caption, localUrl }

import { api } from './api.js';

const DB_NAME = 'dispatch-outbox';
const STORE = 'queue';

let _db = null;
function openDb() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror = (e) => reject(e.target.error);
  });
}

export async function enqueue(item) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).add({ ...item, queuedAt: Date.now() });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dequeue(id) {
  const db = await openDb();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = resolve;
  });
}

export async function getAll() {
  try {
    const db = await openDb();
    return new Promise((resolve) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  } catch { return []; }
}

export async function getForEntity(entityType, entityId) {
  const all = await getAll();
  return all.filter((i) => i.entity_type === entityType && i.entity_id === entityId);
}

// Replay all queued items in order. Stops on network failure so we don't
// partially sync. Fires 'outbox-synced' on window when at least one item lands.
export async function sync() {
  const items = await getAll();
  if (!items.length) return;
  let synced = 0;
  for (const item of items) {
    try {
      if (item.type === 'note') {
        await api.post('/attachments', {
          entity_type: item.entity_type,
          entity_id: item.entity_id,
          kind: 'note',
          url: '',
          caption: item.caption,
        });
      } else if (item.type === 'upload_and_attach') {
        const { url } = await api.post('/uploads', {
          filename: item.filename,
          contentType: item.contentType,
          data: item.b64,
        });
        await api.post('/attachments', {
          entity_type: item.entity_type,
          entity_id: item.entity_id,
          kind: 'photo',
          url,
          caption: item.caption || '',
        });
      }
      await dequeue(item.id);
      synced++;
    } catch {
      break;
    }
  }
  if (synced > 0) window.dispatchEvent(new CustomEvent('outbox-synced'));
}

window.addEventListener('online', () => sync().catch(() => {}));
