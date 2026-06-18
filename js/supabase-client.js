// ═══════════════════════════════════════════════════════════════
// CLIENTE SUPABASE — Configuración del proyecto
// ═══════════════════════════════════════════════════════════════
// La anon key es pública por diseño: vive en el navegador de cada
// usuario y está protegida por las políticas RLS en la base de datos,
// no por mantenerla en secreto.

const SUPABASE_URL = 'https://goyfjkpuhkmxaenbckih.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_375SfVY6qWdmv4bBTMY6Kw_7oxh8jw9';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  }
});
