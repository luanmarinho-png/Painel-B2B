/**
 * Lista usuários do Auth (visão resumida) com filtro opcional por email.
 */

const { getSupabaseEnv } = require('../../infrastructure/config/supabaseEnv');

/**
 * @param {object} params
 * @param {string} [params.emailFilter]
 * @param {Record<string, string>} params.corsHeaders
 * @returns {Promise<{ statusCode: number, headers: Record<string, string>, body: string }>}
 */
async function executeListAuthUsers({ emailFilter, corsHeaders }) {
  const env = getSupabaseEnv();
  const { url: SUPABASE_URL, serviceRoleKey: SERVICE_KEY } = env;

  try {
    const authResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
    });

    if (!authResp.ok) {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Erro ao buscar users' })
      };
    }

    const data = await authResp.json();
    let users = (data.users || []).map((u) => ({
      email: u.email,
      id: u.id,
      role: u.user_metadata?.role || '',
      instituicao: u.user_metadata?.instituicao || '',
      nome: u.user_metadata?.nome || '',
      access_approved: u.user_metadata?.access_approved,
      instituicoes_responsavel: u.user_metadata?.instituicoes_responsavel || [],
      created_at: u.created_at
    }));

    if (emailFilter) {
      users = users.filter((u) => u.email === emailFilter);
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ users })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Erro interno: ' + err.message })
    };
  }
}

module.exports = { executeListAuthUsers };
