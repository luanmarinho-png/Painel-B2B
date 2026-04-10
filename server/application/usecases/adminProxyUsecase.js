/**
 * Proxy seguro: operações REST Supabase com service_role após validar admin/superadmin.
 */

const { getSupabaseEnv } = require('../../infrastructure/config/supabaseEnv');
const { getMongoEnv } = require('../../infrastructure/mongo/mongoEnv');
const { executePostgrestMongo } = require('../../infrastructure/mongo/postgrestMongoAdapter');
const { fetchAuthUser } = require('../../infrastructure/supabase/fetchAuthUser');
const { isPrivilegedAdmin, isSuperadmin } = require('../../domain/userRoles');
const { corsAdminProxy } = require('../../presentation/http/corsPresets');

const ALLOWED_TABLES = new Set([
  'alunos_master',
  'excluidos_master',
  'usuarios_autorizados',
  'simulado_respostas',
  'simulados_banco',
  'simulados_envios',
  'simulados_questoes',
  'instituicoes',
  'dashboard_engajamento',
  'atividades_contrato',
  'alunos_faltantes_simulado',
  'avisos'
]);

/**
 * @param {unknown} val
 * @returns {string}
 */
function maskCpfField(val) {
  const d = String(val ?? '').replace(/\D/g, '');
  if (d.length !== 11) return val == null || val === '' ? '' : String(val);
  return `${d.slice(0, 3)}.***.***-**`;
}

/**
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>}
 */
function maskCpfInObject(row) {
  const out = { ...row };
  if (Object.prototype.hasOwnProperty.call(out, 'cpf')) {
    out.cpf = maskCpfField(out.cpf);
  }
  return out;
}

/**
 * @param {unknown} data
 * @returns {unknown}
 */
function maskCpfInJson(data) {
  if (Array.isArray(data)) {
    return data.map((row) => (row && typeof row === 'object' ? maskCpfInObject(row) : row));
  }
  if (data && typeof data === 'object') return maskCpfInObject(data);
  return data;
}

/**
 * @param {object} params
 * @param {string} params.authHeader
 * @param {string} params.rawBody
 * @returns {Promise<{ statusCode: number, headers: Record<string, string>, body: string }>}
 */
async function executeAdminProxy({ authHeader, rawBody }) {
  const CORS = corsAdminProxy;

  const userToken = (authHeader || '').replace(/^Bearer\s+/i, '');
  if (!userToken) {
    return {
      statusCode: 401,
      headers: CORS,
      body: JSON.stringify({ error: 'Token não fornecido' })
    };
  }

  const env = getSupabaseEnv();
  const session = await fetchAuthUser(
    env.url,
    env.anonKey,
    userToken,
    'Token inválido ou expirado'
  );
  if (!session.ok) {
    return {
      statusCode: 401,
      headers: CORS,
      body: JSON.stringify({ error: session.error })
    };
  }

  const role = session.user.user_metadata?.role;
  if (!isPrivilegedAdmin(role)) {
    return {
      statusCode: 403,
      headers: CORS,
      body: JSON.stringify({ error: 'Acesso negado — apenas admin/superadmin' })
    };
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: 'JSON inválido' })
    };
  }

  const { table, method, query, body, prefer, range, requireSuperadmin, maskSensitive } = payload;

  if (requireSuperadmin === true && !isSuperadmin(role)) {
    return {
      statusCode: 403,
      headers: CORS,
      body: JSON.stringify({ error: 'Apenas superadmin pode executar esta operação' })
    };
  }

  if (!table) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: 'Campo table obrigatório' })
    };
  }

  const tableName = table.split('?')[0].split('/')[0];
  if (!ALLOWED_TABLES.has(tableName)) {
    return {
      statusCode: 403,
      headers: CORS,
      body: JSON.stringify({ error: `Tabela "${tableName}" não permitida` })
    };
  }

  const httpMethod = (method || 'GET').toUpperCase();

  if (process.env.DATA_BACKEND === 'mongo') {
    const { uri: mongoUri } = getMongoEnv();
    if (!mongoUri) {
      return {
        statusCode: 503,
        headers: CORS,
        body: JSON.stringify({ error: 'DATA_BACKEND=mongo mas MONGODB_URI não está configurada' })
      };
    }
    try {
      const mongoResp = await executePostgrestMongo({
        table,
        query: query || '',
        method: httpMethod,
        body,
        prefer,
        range,
        maskSensitive
      });
      return {
        statusCode: mongoResp.statusCode,
        headers: { ...CORS, ...mongoResp.headers },
        body: mongoResp.body
      };
    } catch (err) {
      return {
        statusCode: 500,
        headers: CORS,
        body: JSON.stringify({ error: 'MongoDB: ' + (err && err.message ? err.message : String(err)) })
      };
    }
  }

  const { url: SUPABASE_URL, serviceRoleKey: SERVICE_KEY } = env;
  const url = `${SUPABASE_URL}/rest/v1/${table}${query ? (table.includes('?') ? '&' : '?') + query : ''}`;

  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json'
  };

  if (prefer) {
    headers.Prefer = prefer;
  } else if (httpMethod === 'POST') {
    headers.Prefer = 'return=representation,resolution=merge-duplicates';
  } else if (httpMethod !== 'GET') {
    headers.Prefer = 'return=representation';
  }

  if (range && httpMethod === 'GET') {
    headers.Range = range;
  }

  const fetchOpts = { method: httpMethod, headers };
  if (body && httpMethod !== 'GET') {
    fetchOpts.body = JSON.stringify(body);
  }

  try {
    const supaResp = await fetch(url, fetchOpts);
    let supaBody = await supaResp.text();

    if (maskSensitive === true && httpMethod === 'GET' && supaResp.ok && supaBody) {
      try {
        const parsed = JSON.parse(supaBody);
        supaBody = JSON.stringify(maskCpfInJson(parsed));
      } catch (_) {
        /* corpo não-JSON */
      }
    }

    const respHeaders = {
      ...CORS,
      'Content-Type': 'application/json'
    };
    const contentRange = supaResp.headers.get('Content-Range');
    if (contentRange) respHeaders['Content-Range'] = contentRange;

    return {
      statusCode: supaResp.status,
      headers: respHeaders,
      body: supaBody
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'Erro interno: ' + err.message })
    };
  }
}

module.exports = { executeAdminProxy };
