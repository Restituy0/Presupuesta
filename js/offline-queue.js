// ═══════════════════════════════════════════════════════════════
// COLA OFFLINE — Guarda cambios cuando no hay internet y los
// sincroniza automáticamente al reconectar.
//
// Además mantiene una CACHÉ LOCAL (object store separado) con la
// última copia conocida de períodos, gastos, categorías y config,
// para que la app pueda arrancar y mostrar datos incluso sin
// conexión desde el primer momento, no solo cuando se pierde la
// conexión a mitad de uso.
// ═══════════════════════════════════════════════════════════════

const OfflineQueue = (() => {
  const DB_NAME = 'presupuesta-offline';
  const STORE = 'pending';
  const CACHE_STORE = 'cache';
  let db = null;
  let syncing = false;
  const listeners = [];

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE)) {
          d.createObjectStore(STORE, { keyPath: 'qid', autoIncrement: true });
        }
        if (!d.objectStoreNames.contains(CACHE_STORE)) {
          d.createObjectStore(CACHE_STORE, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => { db = req.result; resolve(db); };
      req.onerror = () => reject(req.error);
    });
  }

  // op: 'insert' | 'update' | 'delete'
  // table: 'periodos' | 'gastos' | 'config'
  async function enqueue(op, table, payload) {
    if (!db) await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const item = { op, table, payload, ts: Date.now() };
      const req = store.add(item);
      req.onsuccess = () => { resolve(req.result); notify(); };
      req.onerror = () => reject(req.error);
    });
  }

  async function getAll() {
    if (!db) await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function remove(qid) {
    if (!db) await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const req = tx.objectStore(STORE).delete(qid);
      req.onsuccess = () => { resolve(); notify(); };
      req.onerror = () => reject(req.error);
    });
  }

  async function count() {
    const all = await getAll();
    return all.length;
  }

  function onChange(fn) { listeners.push(fn); }
  function notify() { count().then(n => listeners.forEach(fn => fn(n))); }

  // Intenta aplicar cada item pendiente, en orden, contra Supabase.
  // Si uno falla, detiene el lote (probablemente seguimos sin internet).
  async function flush(applyFn) {
    if (syncing || !navigator.onLine) return;
    syncing = true;
    try {
      const items = await getAll();
      items.sort((a, b) => a.ts - b.ts);
      for (const item of items) {
        try {
          await applyFn(item.op, item.table, item.payload);
          await remove(item.qid);
        } catch (e) {
          console.warn('Sync pausado, item falló:', e.message);
          break; // detenemos el lote; se reintenta en el próximo flush
        }
      }
    } finally {
      syncing = false;
      notify();
    }
  }

  // ── CACHÉ LOCAL (snapshot de datos para arranque offline) ──────────────
  async function cacheSet(key, value) {
    if (!db) await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CACHE_STORE, 'readwrite');
      const req = tx.objectStore(CACHE_STORE).put({ key, value, ts: Date.now() });
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }
  async function cacheGet(key) {
    if (!db) await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CACHE_STORE, 'readonly');
      const req = tx.objectStore(CACHE_STORE).get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : null);
      req.onerror = () => reject(req.error);
    });
  }
  async function cacheTimestamp(key) {
    if (!db) await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CACHE_STORE, 'readonly');
      const req = tx.objectStore(CACHE_STORE).get(key);
      req.onsuccess = () => resolve(req.result ? req.result.ts : null);
      req.onerror = () => reject(req.error);
    });
  }

  return { enqueue, getAll, remove, count, onChange, flush, isSyncing: () => syncing, cacheSet, cacheGet, cacheTimestamp };
})();
