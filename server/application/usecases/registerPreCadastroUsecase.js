/**
 * Pré-cadastro pós-login Google: define role pendente, whitelist e notificação para admins.
 */

const { getSupabaseEnv } = require('../../infrastructure/config/supabaseEnv');
const { isMongoDataBackend } = require('../../infrastructure/mongo/isMongoData');
const { executePostgrestMongo } = require('../../infrastructure/mongo/postgrestMongoAdapter');

const PLACEHOLDER_INST = '_pre_cadastro';

/**
 * @param {object} user
 * @returns {boolean}
 */
function isGoogleUser(user) {
  const am = user.app_metadata || {};
  if (am.provider === 'google') return true;
  const ids = user.identities || [];
  return Array.isArray(ids) && ids.some((i) => i && i.provider === 'google');
}

/**
 * @param {object} params
 * @param {object} params.user
 * @param {Record<string, string>} params.corsHeaders
 * @returns {Promise<{ statusCode: number, headers: Record<string, string>, body: string }>}
 */
async function executeRegisterPreCadastro({ user, corsHeaders }) {
  if (!isGoogleUser(user)) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ ok: false, error: 'not_google', message: 'Pré-cadastro automático só está disponível após login com Google.' })
    };
  }

  const meta = user.user_metadata || {};
  const role = meta.role || '';
  const instituicao = String(meta.instituicao || '').trim();

  if (role === 'superadmin' || role === 'admin') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ ok: true, state: 'skipped' })
    };
  }

  if (role === 'pendente') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ ok: true, state: 'already_pending' })
    };
  }

  if (role === 'coordenador' && instituicao) {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ ok: true, state: 'skipped' })
    };
  }

  const env = getSupabaseEnv();
  const { url: SUPABASE_URL, serviceRoleKey: SERVICE_KEY } = env;
  const email = user.email;
  const userId = user.id;
  if (!email || !userId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ ok: false, error: 'missing_user' })
    };
  }

  const nome =
    meta.nome ||
    meta.full_name ||
    meta.name ||
    String(email).split('@')[0] ||
    'Usuário';

  try {
    const updateResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: 'PUT',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        user_metadata: {
          ...meta,
          role: 'pendente',
          instituicao: PLACEHOLDER_INST,
          nome,
          access_approved: false
        }
      })
    });

    if (!updateResp.ok) {
      const errData = await updateResp.json().catch(() => ({}));
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          ok: false,
          error: 'auth_update_failed',
          message: errData.msg || errData.error_description || 'Falha ao atualizar perfil'
        })
      };
    }

    const whitelistRow = {
      email,
      nome,
      role: 'pendente',
      instituicao: PLACEHOLDER_INST,
      ativo: true
    };

    if (isMongoDataBackend()) {
      const mr = await executePostgrestMongo({
        table: 'usuarios_autorizados?on_conflict=email,instituicao',
        query: '',
        method: 'POST',
        body: whitelistRow,
        prefer: 'return=minimal,resolution=merge-duplicates',
        range: null,
        maskSensitive: false
      });
      if (mr.statusCode < 200 || mr.statusCode >= 300) {
        const mrPatch = await executePostgrestMongo({
          table: `usuarios_autorizados?email=eq.${encodeURIComponent(email)}&instituicao=eq.${encodeURIComponent(PLACEHOLDER_INST)}`,
          query: '',
          method: 'PATCH',
          body: { nome, role: 'pendente', ativo: true },
          prefer: 'return=minimal',
          range: null,
          maskSensitive: false
        });
        if (mrPatch.statusCode < 200 || mrPatch.statusCode >= 300) {
          console.warn('[register-pre-cadastro] whitelist merge warning', mr.statusCode, mrPatch.statusCode);
        }
      }
    } else {
      const wlResp = await fetch(
        `${SUPABASE_URL}/rest/v1/usuarios_autorizados?on_conflict=email,instituicao`,
        {
          method: 'POST',
          headers: {
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates,return=minimal'
          },
          body: JSON.stringify(whitelistRow)
        }
      );
      if (!wlResp.ok) {
        await fetch(
          `${SUPABASE_URL}/rest/v1/usuarios_autorizados?email=eq.${encodeURIComponent(email)}&instituicao=eq.${encodeURIComponent(PLACEHOLDER_INST)}`,
          {
            method: 'PATCH',
            headers: {
              apikey: SERVICE_KEY,
              Authorization: `Bearer ${SERVICE_KEY}`,
              'Content-Type': 'application/json',
              Prefer: 'return=minimal'
            },
            body: JSON.stringify({ nome, role: 'pendente', ativo: true })
          }
        );
      }
    }

    const mensagem = `Aprovar cadastro — defina a IES no painel Usuários. E-mail: ${email} | id: ${userId}`;
    let hasDup = false;

    if (isMongoDataBackend()) {
      const listMr = await executePostgrestMongo({
        table: 'notificacoes_admin?select=id,mensagem&tipo=eq.pre_cadastro&limit=200',
        query: '',
        method: 'GET',
        body: null,
        prefer: null,
        range: null,
        maskSensitive: false
      });
      try {
        const rows = JSON.parse(listMr.body || '[]');
        if (Array.isArray(rows)) {
          hasDup = rows.some((r) => String(r.mensagem || '').includes(userId));
        }
      } catch (_) {
        hasDup = false;
      }
    } else {
      const listN = await fetch(
        `${SUPABASE_URL}/rest/v1/notificacoes_admin?tipo=eq.pre_cadastro&select=id,mensagem&limit=200`,
        { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
      );
      if (listN.ok) {
        const rows = await listN.json();
        if (Array.isArray(rows)) {
          hasDup = rows.some((r) => String(r.mensagem || '').includes(userId));
        }
      }
    }

    if (!hasDup) {
      const notif = {
        tipo: 'pre_cadastro',
        titulo: 'Aprovar cadastro',
        mensagem,
        prioridade: 'warn',
        criado_por: 'sistema',
        created_at: new Date().toISOString(),
        destinatarios: 'all',
        lido_por: []
      };

      if (isMongoDataBackend()) {
        await executePostgrestMongo({
          table: 'notificacoes_admin',
          query: '',
          method: 'POST',
          body: notif,
          prefer: 'return=minimal',
          range: null,
          maskSensitive: false
        });
      } else {
        await fetch(`${SUPABASE_URL}/rest/v1/notificacoes_admin`, {
          method: 'POST',
          headers: {
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal'
          },
          body: JSON.stringify(notif)
        });
      }
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ ok: true, state: 'registered' })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err) })
    };
  }
}

module.exports = { executeRegisterPreCadastro, PLACEHOLDER_INST };
