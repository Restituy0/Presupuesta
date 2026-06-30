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

  // ── CACHÉ OFFLINE-FIRST ─────────────────────────────────────
  // Las claves se prefijan con el user id para que la caché de una
  // cuenta nunca se confunda con la de otra en el mismo dispositivo.
  function cacheKey(name) { return `${uid}:${name}`; }
  async function cacheWrite(name, value) {
    try { await OfflineQueue.cacheSet(cacheKey(name), value); } catch (e) { /* no crítico */ }
  }
  async function cacheRead(name) {
    try { return await OfflineQueue.cacheGet(cacheKey(name)); } catch (e) { return null; }
  }
  // Ejecuta fn (llamada de red); si falla por estar offline, devuelve la
  // última copia cacheada en su lugar. Si fn funciona, refresca la caché.
  async function withCache(name, fn, fallback) {
    try {
      const result = await fn();
      cacheWrite(name, result); // no se espera, no debe bloquear la respuesta
      return result;
    } catch (e) {
      if (isOffline(e)) {
        const cached = await cacheRead(name);
        if (cached !== null) return cached;
        return fallback;
      }
      throw e;
    }
  }
  async function cacheTimestamp(name) {
    try { return await OfflineQueue.cacheTimestamp(cacheKey(name)); } catch (e) { return null; }
  }

  // ── CONFIG ──────────────────────────────────────────────────
  async function getConfig() {
    return withCache('config', async () => {
      const { data, error } = await sb.from('config').select('*').eq('user_id', uid).maybeSingle();
      if (error) throw error;
      return data || { user_id: uid, moneda: 'RD$', pais: 'DO', periodo_activo: null };
    }, { user_id: uid, moneda: 'RD$', pais: 'DO', periodo_activo: null });
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
    return withCache('periodos', async () => {
      const { data, error } = await sb.from('periodos').select('*').eq('user_id', uid).order('fecha_inicio', { ascending: false });
      if (error) throw error;
      return data || [];
    }, []);
  }
  async function getPeriodo(id) {
    // Se apoya en la caché de la lista completa de períodos (ya
    // namespaceada por usuario) en vez de mantener una caché propia
    // por id individual, evitando duplicar la lógica de caché.
    try {
      const { data, error } = await sb.from('periodos').select('*').eq('id', id).eq('user_id', uid).maybeSingle();
      if (error) throw error;
      return data;
    } catch (e) {
      if (isOffline(e)) {
        const cached = await cacheRead('periodos');
        return (cached || []).find(p => p.id === id) || null;
      }
      throw e;
    }
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
        const list = (await cacheRead('periodos')) || [];
        list.unshift(local);
        await cacheWrite('periodos', list);
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
      if (isOffline(e)) {
        await OfflineQueue.enqueue('update', 'periodos', { id, ...fields });
        const list = (await cacheRead('periodos')) || [];
        const idx = list.findIndex(p => p.id === id);
        if (idx !== -1) { list[idx] = { ...list[idx], ...fields }; await cacheWrite('periodos', list); }
        return { id, ...fields };
      }
      throw e;
    }
  }
  async function deletePeriodo(id) {
    try {
      const { error } = await sb.from('periodos').delete().eq('id', id).eq('user_id', uid);
      if (error) throw error;
    } catch (e) {
      if (isOffline(e)) {
        await OfflineQueue.enqueue('delete', 'periodos', { id });
        const list = (await cacheRead('periodos')) || [];
        await cacheWrite('periodos', list.filter(p => p.id !== id));
        return;
      }
      throw e;
    }
  }
  async function cerrarPeriodo(id, resumen) {
    return updatePeriodo(id, { estado: 'cerrado', resumen_cierre: resumen });
  }

  // ── GASTOS ──────────────────────────────────────────────────
  async function listGastos(periodoId) {
    return withCache(`gastos:${periodoId}`, async () => {
      const { data, error } = await sb.from('gastos').select('*').eq('periodo_id', periodoId).eq('user_id', uid).order('creado_en', { ascending: true });
      if (error) throw error;
      return data || [];
    }, []);
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
        await cacheAppendGasto(local);
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
      if (isOffline(e)) {
        await OfflineQueue.enqueue('update', 'gastos', { id, ...fields });
        await cacheUpdateGasto(id, fields);
        return { id, ...fields };
      }
      throw e;
    }
  }
  async function deleteGasto(id) {
    try {
      const { error } = await sb.from('gastos').delete().eq('id', id).eq('user_id', uid);
      if (error) throw error;
    } catch (e) {
      if (isOffline(e)) {
        await OfflineQueue.enqueue('delete', 'gastos', { id });
        await cacheRemoveGasto(id);
        return;
      }
      throw e;
    }
  }

  // ── Helpers para mantener la caché de gastos consistente cuando
  //    una escritura cae en modo offline (sin esperar respuesta real
  //    del servidor). Buscan en todas las cachés "gastos:*" del
  //    usuario porque no siempre se conoce el periodo_id de antemano.
  async function cacheAppendGasto(gasto) {
    const key = `gastos:${gasto.periodo_id}`;
    const list = (await cacheRead(key)) || [];
    list.push(gasto);
    await cacheWrite(key, list);
  }
  async function cacheUpdateGasto(id, fields) {
    const periodos = (await cacheRead('periodos')) || [];
    for (const p of periodos) {
      const key = `gastos:${p.id}`;
      const list = await cacheRead(key);
      if (!list) continue;
      const idx = list.findIndex(g => g.id === id);
      if (idx !== -1) { list[idx] = { ...list[idx], ...fields }; await cacheWrite(key, list); break; }
    }
  }
  async function cacheRemoveGasto(id) {
    const periodos = (await cacheRead('periodos')) || [];
    for (const p of periodos) {
      const key = `gastos:${p.id}`;
      const list = await cacheRead(key);
      if (!list) continue;
      const filtered = list.filter(g => g.id !== id);
      if (filtered.length !== list.length) { await cacheWrite(key, filtered); break; }
    }
  }

  // ── RESUMEN (historial) ────────────────────────────────────
  async function getResumen() {
    const periodos = await listPeriodos();
    const top = periodos.slice(0, 15);
    if (!top.length) return [];
    const ids = top.map(p => p.id);
    try {
      // Una sola consulta para los gastos de todos los períodos del historial,
      // en vez de una consulta por período (evita N+1 llamadas a Supabase).
      const { data: gastos, error } = await sb.from('gastos').select('periodo_id,tipo,monto').eq('user_id', uid).in('periodo_id', ids);
      if (error) throw error;
      const result = top.map(p => {
        const t = { necesidad: 0, libre: 0, ahorro: 0 };
        (gastos || []).filter(g => g.periodo_id === p.id).forEach(g => { t[g.tipo] = (t[g.tipo] || 0) + Number(g.monto); });
        return { ...p, totales: t };
      });
      cacheWrite('resumen', result);
      return result;
    } catch (e) {
      if (isOffline(e)) {
        // Reconstruimos los totales a partir de las cachés individuales
        // de gastos por período, que ya se guardan al visitar cada uno.
        const out = [];
        for (const p of top) {
          const list = (await cacheRead(`gastos:${p.id}`)) || [];
          const t = { necesidad: 0, libre: 0, ahorro: 0 };
          list.forEach(g => { t[g.tipo] = (t[g.tipo] || 0) + Number(g.monto); });
          out.push({ ...p, totales: t });
        }
        return out;
      }
      throw e;
    }
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
    return withCache('categorias', async () => {
      const { data, error } = await sb.from('categorias').select('*').eq('user_id', uid).order('nombre');
      if (error) throw error;
      return data || [];
    }, []);
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
    return withCache('recurrentes', async () => {
      const { data, error } = await sb.from('gastos_recurrentes').select('*').eq('user_id', uid).eq('activo', true).order('nombre');
      if (error) throw error;
      return data || [];
    }, []);
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
    searchGastos, cacheTimestamp,
  };
})();
