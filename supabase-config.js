// ═══════════════════════════════════════════════════
//  MedCof B2B — Supabase Config (compartilhado)
//  Inclua este arquivo em todas as páginas protegidas
// ═══════════════════════════════════════════════════

const SUPABASE_URL = 'https://cvwwucxjrpsfoxarsipr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2d3d1Y3hqcnBzZm94YXJzaXByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMDIxMzgsImV4cCI6MjA5MDg3ODEzOH0.GdpReqo9giSC607JQge8HA9CmZWi-2TcVggU4jCwZhI';

// Inicializa o cliente Supabase (requer CDN carregado antes)
function getSupabaseClient() {
  if (window._supabaseClient) return window._supabaseClient;
  window._supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return window._supabaseClient;
}

// Verifica se o usuário está autenticado; redireciona se não estiver
async function requireAuth(redirectTo = '/admin.html') {
  const sb = getSupabaseClient();
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    window.location.href = redirectTo;
    return null;
  }
  return session;
}

// Verifica se o usuário tem role de admin ou superadmin
async function requireAdmin(redirectTo = '/admin.html') {
  const session = await requireAuth(redirectTo);
  if (!session) return null;
  const role = session.user.user_metadata?.role;
  if (role !== 'admin' && role !== 'superadmin') {
    window.location.href = redirectTo;
    return null;
  }
  return session;
}

// Verifica se o e-mail do usuário está na whitelist da instituição
async function checkWhitelist(email, instituicao) {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('usuarios_autorizados')
    .select('email, nome, ativo')
    .eq('email', email.toLowerCase().trim())
    .eq('instituicao', instituicao)
    .eq('ativo', true)
    .single();
  if (error || !data) return false;
  return true;
}

// Logout universal
async function medcofLogout(redirectTo = '/admin.html') {
  const sb = getSupabaseClient();
  await sb.auth.signOut();
  sessionStorage.clear();
  window.location.href = redirectTo;
}
