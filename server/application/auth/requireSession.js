/**
 * Exige sessão JWT válida (qualquer usuário autenticado).
 */

const { getSupabaseEnv } = require('../../infrastructure/config/supabaseEnv');
const { fetchAuthUser } = require('../../infrastructure/supabase/fetchAuthUser');

/**
 * @param {string | undefined} authHeader
 * @param {Record<string, string>} corsHeaders
 * @returns {Promise<
 *   | { ok: true, user: object }
 *   | { ok: false, response: { statusCode: number, headers: Record<string, string>, body: string } }
 * >}
 */
async function requireSession(authHeader, corsHeaders) {
  const userToken = (authHeader || '').replace(/^Bearer\s+/i, '');
  if (!userToken) {
    return {
      ok: false,
      response: {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Token não fornecido' })
      }
    };
  }

  const env = getSupabaseEnv();
  const session = await fetchAuthUser(env.url, env.anonKey, userToken, 'Token inválido ou expirado');
  if (!session.ok) {
    return {
      ok: false,
      response: {
        statusCode: session.status,
        headers: corsHeaders,
        body: JSON.stringify({ error: session.error })
      }
    };
  }

  return { ok: true, user: session.user };
}

module.exports = { requireSession };
