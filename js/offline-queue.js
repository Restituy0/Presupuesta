// ═══════════════════════════════════════════════════════════════
// COLA OFFLINE — Guarda cambios cuando no hay internet y los
// sincroniza automáticamente al reconectar.
// ═══════════════════════════════════════════════════════════════

const OfflineQueue = (() => {
  const DB_NAME = 'presupuesta-offline';
  const STORE = 'pending';
  let db = null;
  let syncing = false;
  const listeners = [];

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE)) {
          d.createObjectStore(STORE, { keyPath: 'qid', autoIncrement: true });
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

  return { enqueue, getAll, remove, count, onChange, flush, isSyncing: () => syncing };
})();
