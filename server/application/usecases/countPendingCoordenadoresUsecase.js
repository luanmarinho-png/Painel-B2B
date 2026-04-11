/**
 * Conta coordenadores com access_approved === false, agrupados por instituição (slug).
 */

const { getSupabaseEnv } = require('../../infrastructure/config/supabaseEnv');

/**
 * @param {object} params
 * @param {Record<string, string>} params.corsHeaders
 * @returns {Promise<{ statusCode: number, headers: Record<string, string>, body: string }>}
 */
async function executeCountPendingCoordenadores({ corsHeaders }) {
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
        body: JSON.stringify({ error: 'Erro ao listar usuários' })
      };
    }

    const data = await authResp.json();
    /** @type {Record<string, number>} */
    const counts = {};
    let preCadastroCount = 0;

    for (const u of data.users || []) {
      const m = u.user_metadata || {};
      if (m.role === 'pendente') {
        preCadastroCount++;
        continue;
      }
      if (m.role !== 'coordenador') continue;
      if (m.access_approved !== false) continue;
      const slug = String(m.instituicao || '').trim();
      if (!slug) continue;
      counts[slug] = (counts[slug] || 0) + 1;
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ counts, preCadastroCount })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Erro interno: ' + err.message })
    };
  }
}

module.exports = { executeCountPendingCoordenadores };
