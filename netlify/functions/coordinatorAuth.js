/**
 * Validação JWT Supabase para coordenadores (e admin) — compartilhada entre funções Netlify.
 */

const { getSupabaseEnv } = require('./server/infrastructure/config/supabaseEnv');

const { url: SUPABASE_URL, anonKey: ANON_KEY } = getSupabaseEnv();

/**
 * Valida JWT do usuário e permissão (coordenador da IES ou admin).
 * @param {string} userToken
 * @param {string} iesSlug
 * @returns {Promise<{ ok: boolean, role?: string, userId?: string, error?: string, status?: number }>}
 */
async function validateCoordinatorAccess(userToken, iesSlug) {
  if (!userToken) {
    return {
      ok: false,
      status: 401,
      error: 'Para usar o Cofbot ao lado dos dados da sua instituição, entre no painel com seu usuário MedCof.'
    };
  }

  try {
    const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${userToken}`
      }
    });

    if (!userResp.ok) {
      return {
        ok: false,
        status: 401,
        error: 'Sua sessão MedCof encerrou. Faça login de novo no painel para continuar acompanhando sua turma.'
      };
    }

    const user = await userResp.json().catch(() => null);
    if (!user || typeof user !== 'object') {
      return {
        ok: false,
        status: 401,
        error: 'Não conseguimos confirmar seu acesso. Atualize a página e entre novamente no painel.'
      };
    }

    const meta = user.user_metadata || {};
    const role = meta.role;
    const inst = (meta.instituicao || '').trim();

    if (role === 'coordenador' && meta.access_approved === false) {
      return {
        ok: false,
        status: 403,
        error: 'Seu acesso ao painel ainda não foi liberado pelo administrador.'
      };
    }

    const userId = user.id ? String(user.id) : '';
    const email = user.email ? String(user.email).trim() : '';

    if (role === 'admin' || role === 'superadmin') {
      return { ok: true, role: role === 'superadmin' ? 'superadmin' : 'admin', userId, email };
    }

    if (role === 'coordenador' && iesSlug && inst === iesSlug) {
      return { ok: true, role: 'coordenador', userId, email };
    }

    return {
      ok: false,
      status: 403,
      error:
        'O Cofbot acompanha coordenadores autorizados neste painel MedCof — use o mesmo acesso da sua instituição.'
    };
  } catch (e) {
    console.error('[coordinatorAuth] validateCoordinatorAccess', e);
    return {
      ok: false,
      status: 503,
      error: 'Não conseguimos validar seu acesso agora. Confira sua conexão e tente de novo em instantes.'
    };
  }
}

module.exports = { validateCoordinatorAccess };
