/**
 * Cria usuário no Supabase Auth e insere em usuarios_autorizados.
 */

const { getSupabaseEnv } = require('../../infrastructure/config/supabaseEnv');
const { isMongoDataBackend } = require('../../infrastructure/mongo/isMongoData');
const { executePostgrestMongo } = require('../../infrastructure/mongo/postgrestMongoAdapter');
const { isSuperadmin } = require('../../domain/userRoles');

/**
 * @param {object} params
 * @param {string} params.callerRole
 * @param {object} params.body
 * @param {Record<string, string>} params.corsHeaders
 * @returns {Promise<{ statusCode: number, headers: Record<string, string>, body: string }>}
 */
async function executeCreateUser({ callerRole, body, corsHeaders }) {
  const { email, nome, role, instituicao, senha } = body;
  /** @type {boolean} Coordenador pendente até admin liberar; admin/superadmin sempre liberados. */
  const accessApproved = role === 'coordenador' ? body.access_approved !== false : true;

  if (role === 'admin' && !isSuperadmin(callerRole)) {
    return {
      statusCode: 403,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Apenas superadmin pode atribuir a função admin.' })
    };
  }

  if (!email || !nome || !role || !senha) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Campos obrigatórios: email, nome, role, senha' })
    };
  }
  if (role === 'coordenador' && !instituicao) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Coordenador precisa de uma instituição vinculada.' })
    };
  }

  const env = getSupabaseEnv();
  const { url: SUPABASE_URL, serviceRoleKey: SERVICE_KEY } = env;

  try {
    const authResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email,
        password: senha,
        email_confirm: true,
        user_metadata: { role, instituicao, nome, must_change_password: true, access_approved: accessApproved }
      })
    });

    const authData = await authResp.json();

    if (!authResp.ok) {
      if (authData.msg && authData.msg.includes('already been registered')) {
        const listResp = await fetch(
          `${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
          {
            headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
          }
        );
        const listData = await listResp.json();
        const existingUser = listData.users?.[0];
        if (existingUser) {
          await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${existingUser.id}`, {
            method: 'PUT',
            headers: {
              apikey: SERVICE_KEY,
              Authorization: `Bearer ${SERVICE_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              user_metadata: {
                ...(existingUser.user_metadata || {}),
                role,
                instituicao,
                nome,
                must_change_password: true,
                access_approved: accessApproved
              }
            })
          });
        }
      } else {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({
            error: authData.msg || authData.error_description || 'Erro ao criar usuário no Auth'
          })
        };
      }
    }

    let whitelistOk = false;
    /** @type {unknown} */
    let whitelistData = [];
    if (isMongoDataBackend()) {
      const mr = await executePostgrestMongo({
        table: 'usuarios_autorizados?on_conflict=email,instituicao',
        query: '',
        method: 'POST',
        body: { email, nome, instituicao, role, ativo: true },
        prefer: 'return=representation,resolution=merge-duplicates',
        range: null,
        maskSensitive: false
      });
      whitelistOk = mr.statusCode >= 200 && mr.statusCode < 300;
      try {
        const parsed = JSON.parse(mr.body || '[]');
        whitelistData = Array.isArray(parsed) ? parsed : [parsed];
      } catch (_) {
        whitelistData = [];
      }
    } else {
      const whitelistResp = await fetch(`${SUPABASE_URL}/rest/v1/usuarios_autorizados?on_conflict=email,instituicao`, {
        method: 'POST',
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=representation'
        },
        body: JSON.stringify({ email, nome, instituicao, role, ativo: true })
      });
      whitelistOk = whitelistResp.ok;
      try {
        whitelistData = await whitelistResp.json();
      } catch (_) {
        whitelistData = [];
      }
    }

    if (!whitelistOk) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'Usuário criado no Auth mas erro na whitelist: ' + JSON.stringify(whitelistData)
        })
      };
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ success: true, message: `Usuário ${email} criado com sucesso!` })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Erro interno: ' + err.message })
    };
  }
}

module.exports = { executeCreateUser };
