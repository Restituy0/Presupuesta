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
    if (!top.length) return [];
    const ids = top.map(p => p.id);
    // Una sola consulta para los gastos de todos los períodos del historial,
    // en vez de una consulta por período (evita N+1 llamadas a Supabase).
    const { data: gastos, error } = await sb.from('gastos').select('periodo_id,tipo,monto').eq('user_id', uid).in('periodo_id', ids);
    if (error) throw error;
    return top.map(p => {
      const t = { necesidad: 0, libre: 0, ahorro: 0 };
      (gastos || []).filter(g => g.periodo_id === p.id).forEach(g => { t[g.tipo] = (t[g.tipo] || 0) + Number(g.monto); });
      return { ...p, totales: t };
    });
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

  // ── CATEGORÍAS PERSONALIZADAS ──────────────────────────────
  async function listCategorias() {
    const { data, error } = await sb.from('categorias').select('*').eq('user_id', uid).order('nombre');
    if (error) throw error;
    return data || [];
  }
  async function createCategoria(fields) {
    const payload = { ...fields, user_id: uid };
    const { data, error } = await sb.from('categorias').insert(payload).select().single();
    if (error) throw error;
    return data;
  }
  async function updateCategoria(id, fields) {
    const { data, error } = await sb.from('categorias').update(fields).eq('id', id).eq('user_id', uid).select().single();
    if (error) throw error;
    return data;
  }
  async function deleteCategoria(id) {
    const { error } = await sb.from('categorias').delete().eq('id', id).eq('user_id', uid);
    if (error) throw error;
  }

  // ── GASTOS RECURRENTES (plantillas) ────────────────────────
  async function listRecurrentes() {
    const { data, error } = await sb.from('gastos_recurrentes').select('*').eq('user_id', uid).eq('activo', true).order('nombre');
    if (error) throw error;
    return data || [];
  }
  async function createRecurrente(fields) {
    const payload = { ...fields, user_id: uid };
    const { data, error } = await sb.from('gastos_recurrentes').insert(payload).select().single();
    if (error) throw error;
    return data;
  }
  async function updateRecurrente(id, fields) {
    const { data, error } = await sb.from('gastos_recurrentes').update(fields).eq('id', id).eq('user_id', uid).select().single();
    if (error) throw error;
    return data;
  }
  async function deleteRecurrente(id) {
    const { error } = await sb.from('gastos_recurrentes').delete().eq('id', id).eq('user_id', uid);
    if (error) throw error;
  }

  // ── BÚSQUEDA / FILTRO AVANZADO (todos los gastos del usuario) ─
  async function searchGastos({ texto, desde, hasta, tipo, periodoId, categoriaId } = {}) {
    let q = sb.from('gastos').select('*, periodos(label,fecha_inicio)').eq('user_id', uid);
    if (texto) q = q.or(`nombre.ilike.%${texto}%,nota.ilike.%${texto}%`);
    if (desde) q = q.gte('fecha', desde);
    if (hasta) q = q.lte('fecha', hasta);
    if (tipo) q = q.eq('tipo', tipo);
    if (periodoId) q = q.eq('periodo_id', periodoId);
    if (categoriaId) q = q.eq('categoria_id', categoriaId);
    q = q.order('fecha', { ascending: false }).limit(200);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  return {
    setUser, getUser,
    getConfig, upsertConfig,
    listPeriodos, getPeriodo, createPeriodo, updatePeriodo, deletePeriodo, cerrarPeriodo,
    listGastos, createGasto, updateGasto, deleteGasto,
    getResumen, applyQueuedItem,
    listCategorias, createCategoria, updateCategoria, deleteCategoria,
    listRecurrentes, createRecurrente, updateRecurrente, deleteRecurrente,
    searchGastos,
  };
})();
