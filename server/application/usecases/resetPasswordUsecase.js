/**
 * Gera link de recuperação via Admin API (sem SMTP).
 */

const { getSupabaseEnv } = require('../../infrastructure/config/supabaseEnv');
const { isMongoDataBackend } = require('../../infrastructure/mongo/isMongoData');
const { executePostgrestMongo } = require('../../infrastructure/mongo/postgrestMongoAdapter');

const REDIRECT_TO = process.env.PASSWORD_RESET_REDIRECT_URL || 'https://grupomedcof.org/nova-senha.html';

const NOT_FOUND_BODY = JSON.stringify({
  ok: true,
  message: 'Se este e-mail estiver cadastrado no sistema, o link será gerado.'
});

/**
 * @param {object} params
 * @param {string} params.email
 * @param {Record<string, string>} params.corsHeaders
 * @returns {Promise<{ statusCode: number, headers: Record<string, string>, body: string }>}
 */
async function executeResetPassword({ email, corsHeaders }) {
  const env = getSupabaseEnv();
  const { url: SUPABASE_URL, serviceRoleKey: SERVICE_KEY } = env;

  const notFoundResponse = {
    statusCode: 200,
    headers: corsHeaders,
    body: NOT_FOUND_BODY
  };

  try {
    const authResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
    });
    const authData = await authResp.json();
    const authUser = (authData.users || []).find((u) => u.email === email);

    if (!authUser) return notFoundResponse;

    const role = authUser.user_metadata?.role || '';
    const isAdmin = role === 'superadmin' || role === 'admin';

    if (!isAdmin) {
      let wlData = [];
      if (isMongoDataBackend()) {
        const mr = await executePostgrestMongo({
          table: 'usuarios_autorizados',
          query: `select=email&email=eq.${encodeURIComponent(email)}&ativo=eq.true`,
          method: 'GET',
          body: null,
          prefer: null,
          range: null,
          maskSensitive: false
        });
        if (mr.statusCode !== 200) {
          return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Erro interno ao verificar cadastro.' })
          };
        }
        try {
          wlData = JSON.parse(mr.body || '[]');
        } catch {
          wlData = [];
        }
      } else {
        const wlResp = await fetch(
          `${SUPABASE_URL}/rest/v1/usuarios_autorizados?email=eq.${encodeURIComponent(email)}&ativo=eq.true&select=email`,
          { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
        );
        if (!wlResp.ok) {
          return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Erro interno ao verificar cadastro.' })
          };
        }
        wlData = await wlResp.json();
      }
      if (!Array.isArray(wlData) || wlData.length === 0) return notFoundResponse;
    }

    const linkResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'recovery',
        email,
        options: { redirect_to: REDIRECT_TO }
      })
    });

    if (!linkResp.ok) {
      const err = await linkResp.json();
      console.error('Erro generate_link:', err);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Erro ao gerar link de recuperação.' })
      };
    }

    const { action_link } = await linkResp.json();

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ ok: true, link: action_link })
    };
  } catch (err) {
    console.error('reset-password error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Erro interno: ' + err.message })
    };
  }
}

module.exports = { executeResetPassword };
