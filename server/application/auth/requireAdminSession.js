/**
 * Exige sessão JWT válida com role admin ou superadmin.
 */

const { getSupabaseEnv } = require('../../infrastructure/config/supabaseEnv');
const { fetchAuthUser } = require('../../infrastructure/supabase/fetchAuthUser');
const { isPrivilegedAdmin } = require('../../domain/userRoles');

/**
 * @param {string | undefined} authHeader
 * @param {Record<string, string>} corsHeaders
 * @returns {Promise<
 *   | { ok: true, callerRole: string, user: object }
 *   | { ok: false, response: { statusCode: number, headers: Record<string, string>, body: string } }
 * >}
 */
async function requireAdminSession(authHeader, corsHeaders) {
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
  let session;
  try {
    session = await fetchAuthUser(env.url, env.anonKey, userToken);
  } catch {
    return {
      ok: false,
      response: {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Falha ao validar sessão' })
      }
    };
  }

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

  const role = session.user.user_metadata?.role;
  if (!isPrivilegedAdmin(role)) {
    return {
      ok: false,
      response: {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Acesso negado' })
      }
    };
  }

  return { ok: true, callerRole: role, user: session.user };
}

module.exports = { requireAdminSession };
