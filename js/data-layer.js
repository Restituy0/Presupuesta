// ═══════════════════════════════════════════════════════════════
// CAPA DE DATOS — Reemplaza al objeto `api` que hablaba con el
// servidor local. Habla con Supabase; si falla por falta de
// conexión, encola el cambio para sincronizar después.
// ═══════════════════════════════════════════════════════════════

const Data = (() => {
  let uid = null; // user id de la sesión activa

  function setUser(userId) { uid = userId; }
  function getUser() { return uid; }

  function isOffline(err) {
    return !navigator.onLine || (err && (err.message?.includes('fetch') || err.message?.includes('network')));
  }

  // ── CONFIG ──────────────────────────────────────────────────
  async function getConfig() {
    const { data, error } = await sb.from('config').select('*').eq('user_id', uid).maybeSingle();
    if (error) throw error;
    return data || { user_id: uid, moneda: 'RD$', pais: 'DO', periodo_activo: null };
  }
  async function upsertConfig(fields) {
    const payload = { user_id: uid, ...fields, updated_at: new Date().toISOString() };
    try {
      const { error } = await sb.from('config').upsert(payload);
      if (error) throw error;
    } catch (e) {
      if (isOffline(e)) { await OfflineQueue.enqueue('update', 'config', payload); return; }
      throw e;
    }
  }

  // ── PERÍODOS ────────────────────────────────────────────────
  async function listPeriodos() {
    const { data, error } = await sb.from('periodos').select('*').eq('user_id', uid).order('fecha_inicio', { ascending: false });
    if (error) throw error;
    return data || [];
  }
  async function getPeriodo(id) {
    const { data, error } = await sb.from('periodos').select('*').eq('id', id).eq('user_id', uid).maybeSingle();
    if (error) throw error;
    return data;
  }
  async function createPeriodo(fields) {
    const payload = { ...fields, user_id: uid };
    try {
      const { data, error } = await sb.from('periodos').insert(payload).select().single();
      if (error) throw error;
      return data;
    } catch (e) {
      if (isOffline(e)) {
        const localId = -Date.now(); // id negativo temporal hasta sincronizar
        const local = { ...payload, id: localId, _pending: true };
        await OfflineQueue.enqueue('insert', 'periodos', local);
        return local;
      }
      throw e;
    }
  }
  async function updatePeriodo(id, fields) {
    try {
      const { data, error } = await sb.from('periodos').update(fields).eq('id', id).eq('user_id', uid).select().single();
      if (error) throw error;
      return data;
    } catch (e) {
      if (isOffline(e)) { await OfflineQueue.enqueue('update', 'periodos', { id, ...fields }); return { id, ...fields }; }
      throw e;
    }
  }
  async function deletePeriodo(id) {
    try {
      const { error } = await sb.from('periodos').delete().eq('id', id).eq('user_id', uid);
      if (error) throw error;
    } catch (e) {
      if (isOffline(e)) { await OfflineQueue.enqueue('delete', 'periodos', { id }); return; }
      throw e;
    }
  }
  async function cerrarPeriodo(id, resumen) {
    return updatePeriodo(id, { estado: 'cerrado', resumen_cierre: resumen });
  }

  // ── GASTOS ──────────────────────────────────────────────────
  async function listGastos(periodoId) {
    const { data, error } = await sb.from('gastos').select('*').eq('periodo_id', periodoId).eq('user_id', uid).order('creado_en', { ascending: true });
    if (error) throw error;
    return data || [];
  }
  async function createGasto(fields) {
    const payload = { ...fields, user_id: uid };
    try {
      const { data, error } = await sb.from('gastos').insert(payload).select().single();
      if (error) throw error;
      return data;
    } catch (e) {
      if (isOffline(e)) {
        const localId = -Date.now();
        const local = { ...payload, id: localId, _pending: true };
        await OfflineQueue.enqueue('insert', 'gastos', local);
        return local;
      }
      throw e;
    }
  }
  async function updateGasto(id, fields) {
    try {
      const { data, error } = await sb.from('gastos').update(fields).eq('id', id).eq('user_id', uid).select().single();
      if (error) throw error;
      return data;
    } catch (e) {
      if (isOffline(e)) { await OfflineQueue.enqueue('update', 'gastos', { id, ...fields }); return { id, ...fields }; }
      throw e;
    }
  }
  async function deleteGasto(id) {
    try {
      const { error } = await sb.from('gastos').delete().eq('id', id).eq('user_id', uid);
      if (error) throw error;
    } catch (e) {
      if (isOffline(e)) { await OfflineQueue.enqueue('delete', 'gastos', { id }); return; }
      throw e;
    }
  }

  // ── RESUMEN (historial) ────────────────────────────────────
  async function getResumen() {
    const periodos = await listPeriodos();
    const top = periodos.slice(0, 15);
    const out = [];
    for (const p of top) {
      const gastos = await listGastos(p.id);
      const t = { necesidad: 0, libre: 0, ahorro: 0 };
      gastos.forEach(g => { t[g.tipo] = (t[g.tipo] || 0) + Number(g.monto); });
      out.push({ ...p, totales: t });
    }
    return out;
  }

  // ── SINCRONIZACIÓN: aplica un item encolado contra Supabase ──
  async function applyQueuedItem(op, table, payload) {
    if (table === 'config') {
      const { error } = await sb.from('config').upsert(payload);
      if (error) throw error;
      return;
    }
    if (op === 'insert') {
      const { id, _pending, ...rest } = payload;
      const { error } = await sb.from(table).insert(rest);
      if (error) throw error;
    } else if (op === 'update') {
      const { id, ...fields } = payload;
      if (id < 0) return; // era una fila creada offline que aún no tiene id real; se omite
      const { error } = await sb.from(table).update(fields).eq('id', id).eq('user_id', uid);
      if (error) throw error;
    } else if (op === 'delete') {
      const { id } = payload;
      if (id < 0) return;
      const { error } = await sb.from(table).delete().eq('id', id).eq('user_id', uid);
      if (error) throw error;
    }
  }

  return {
    setUser, getUser,
    getConfig, upsertConfig,
    listPeriodos, getPeriodo, createPeriodo, updatePeriodo, deletePeriodo, cerrarPeriodo,
    listGastos, createGasto, updateGasto, deleteGasto,
    getResumen, applyQueuedItem,
  };
})();
