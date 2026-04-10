/**
 * Configuração Supabase para Functions (URL + chaves).
 * Prioriza variáveis de ambiente do Netlify; fallback preserva deploy atual.
 */

const DEFAULT_URL = 'https://cvwwucxjrpsfoxarsipr.supabase.co';
const DEFAULT_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2d3d1Y3hqcnBzZm94YXJzaXByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMDIxMzgsImV4cCI6MjA5MDg3ODEzOH0.GdpReqo9giSC607JQge8HA9CmZWi-2TcVggU4jCwZhI';
const DEFAULT_SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2d3d1Y3hqcnBzZm94YXJzaXByIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTMwMjEzOCwiZXhwIjoyMDkwODc4MTM4fQ.M6ZGpySPaj1ecL9rXS3q9UM4FnfD6Cz3eA0tFWqHi4c';

/**
 * @returns {{ url: string, anonKey: string, serviceRoleKey: string }}
 */
function getSupabaseEnv() {
  return {
    url: process.env.SUPABASE_URL || DEFAULT_URL,
    anonKey: process.env.SUPABASE_ANON_KEY || DEFAULT_ANON,
    serviceRoleKey:
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_KEY || DEFAULT_SERVICE
  };
}

module.exports = { getSupabaseEnv };
