/**
 * Remove usuário do Supabase Auth e da tabela usuarios_autorizados.
 */

const { getSupabaseEnv } = require('../../infrastructure/config/supabaseEnv');

/**
 * @param {object} params
 * @param {object} params.body
 * @param {Record<string, string>} params.corsHeaders
 * @returns {Promise<{ statusCode: number, headers: Record<string, string>, body: string }>}
 */
async function executeDeleteUser({ body, corsHeaders }) {
  const { email } = body;
  if (!email) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Campo email é obrigatório' })
    };
  }

  const env = getSupabaseEnv();
  const { url: SUPABASE_URL, serviceRoleKey: SERVICE_KEY } = env;

  try {
    const listResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`, {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`
      }
    });

    const listData = await listResp.json();
    const user = (listData.users || []).find((u) => u.email === email);

    if (user) {
      const deleteAuthResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
        method: 'DELETE',
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`
        }
      });

      if (!deleteAuthResp.ok) {
        const errData = await deleteAuthResp.json();
        console.error('Erro ao deletar do Auth:', errData);
      }
    }

    const deleteWhitelistResp = await fetch(
      `${SUPABASE_URL}/rest/v1/usuarios_autorizados?email=eq.${encodeURIComponent(email)}`,
      {
        method: 'DELETE',
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          Prefer: 'return=representation'
        }
      }
    );

    if (!deleteWhitelistResp.ok) {
      const errData = await deleteWhitelistResp.json();
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Erro ao remover da whitelist: ' + JSON.stringify(errData) })
      };
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ success: true, message: `Usuário ${email} removido com sucesso.` })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Erro interno: ' + err.message })
    };
  }
}

module.exports = { executeDeleteUser };
