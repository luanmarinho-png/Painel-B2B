/**
 * Atualiza whitelist e user_metadata no Supabase Auth.
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
async function executeUpdateUser({ callerRole, body, corsHeaders }) {
  const { email, role, instituicao, ativo, nome, password, instituicoes_responsavel } = body;

  if (!email) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Campo email é obrigatório' })
    };
  }

  if (role !== undefined && role === 'admin' && !isSuperadmin(callerRole)) {
    return {
      statusCode: 403,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Apenas superadmin pode atribuir a função admin.' })
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
      const updateResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
        method: 'PUT',
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          user_metadata: {
            ...user.user_metadata,
            role: role !== undefined ? role : user.user_metadata?.role,
            instituicao: instituicao !== undefined ? instituicao : user.user_metadata?.instituicao,
            nome: nome !== undefined ? nome : user.user_metadata?.nome,
            instituicoes_responsavel:
              instituicoes_responsavel !== undefined
                ? instituicoes_responsavel
                : user.user_metadata?.instituicoes_responsavel
          },
          ...(ativo === false ? { ban_duration: '876600h' } : { ban_duration: 'none' }),
          ...(password ? { password } : {})
        })
      });

      if (!updateResp.ok) {
        const errData = await updateResp.json();
        console.error('Erro ao atualizar Auth:', errData);
        if (password && errData.msg) {
          return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Erro ao atualizar senha: ' + errData.msg })
          };
        }
      }
    }

    const updateFields = {};
    if (role !== undefined) updateFields.role = role;
    if (instituicao !== undefined) updateFields.instituicao = instituicao;
    if (ativo !== undefined) updateFields.ativo = ativo;
    if (nome !== undefined) updateFields.nome = nome;

    const mongoPatch = { ...updateFields };
    if (instituicoes_responsavel !== undefined) mongoPatch.instituicoes_responsavel = instituicoes_responsavel;

    let whitelistOk = false;
    /** @type {unknown} */
    let whitelistData = [];
    if (isMongoDataBackend()) {
      const mr = await executePostgrestMongo({
        table: `usuarios_autorizados?email=eq.${encodeURIComponent(email)}`,
        query: '',
        method: 'PATCH',
        body: mongoPatch,
        prefer: 'return=representation',
        range: null,
        maskSensitive: false
      });
      whitelistOk = mr.statusCode >= 200 && mr.statusCode < 300;
      try {
        whitelistData = JSON.parse(mr.body || '[]');
      } catch (_) {
        whitelistData = [];
      }
    } else {
      const whitelistResp = await fetch(
        `${SUPABASE_URL}/rest/v1/usuarios_autorizados?email=eq.${encodeURIComponent(email)}`,
        {
          method: 'PATCH',
          headers: {
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation'
          },
          body: JSON.stringify(updateFields)
        }
      );
      whitelistOk = whitelistResp.ok;
      try {
        whitelistData = await whitelistResp.json();
      } catch (_) {
        whitelistData = [];
      }
      if (instituicoes_responsavel !== undefined) {
        try {
          await fetch(`${SUPABASE_URL}/rest/v1/usuarios_autorizados?email=eq.${encodeURIComponent(email)}`, {
            method: 'PATCH',
            headers: {
              apikey: SERVICE_KEY,
              Authorization: `Bearer ${SERVICE_KEY}`,
              'Content-Type': 'application/json',
              Prefer: 'return=minimal'
            },
            body: JSON.stringify({ instituicoes_responsavel })
          });
        } catch (_) {
          /* coluna pode não existir */
        }
      }
    }

    if (!whitelistOk) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Erro na whitelist: ' + JSON.stringify(whitelistData) })
      };
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ success: true, message: `Usuário ${email} atualizado com sucesso!` })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Erro interno: ' + err.message })
    };
  }
}

module.exports = { executeUpdateUser };
