/**
 * Leituras públicas (equivalente ao REST Supabase com anon key) via servidor.
 * Com DATA_BACKEND=mongo lê o Atlas; senão repassa ao PostgREST com anon.
 * Whitelist rígida — mesmas tabelas que o front já expunha via anon.
 */

const { getSupabaseEnv } = require('./server/infrastructure/config/supabaseEnv');
const { getMongoEnv } = require('./server/infrastructure/mongo/mongoEnv');
const { executePostgrestMongo } = require('./server/infrastructure/mongo/postgrestMongoAdapter');

const ALLOWED_TABLES = new Set([
  'instituicoes',
  'dashboard_engajamento',
  'simulados_banco',
  'simulado_respostas',
  'simulados_envios',
  'simulados_questoes',
  'avisos',
  'atividades_contrato',
  'contratos_ies',
  'notificacoes_admin',
  'medcof_app_config'
]);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

/**
 * @param {string} table
 * @returns {string}
 */
function tableName(table) {
  return String(table || '')
    .split('?')[0]
    .split('/')[0]
    .trim();
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'JSON inválido' })
    };
  }

  const { table, query } = payload;
  if (!table) {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Campo table obrigatório' })
    };
  }

  const name = tableName(table);
  if (!ALLOWED_TABLES.has(name)) {
    return {
      statusCode: 403,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: `Tabela "${name}" não permitida neste proxy` })
    };
  }

  try {
    if (process.env.DATA_BACKEND === 'mongo' && getMongoEnv().uri) {
      const mongoResp = await executePostgrestMongo({
        table,
        query: query || '',
        method: 'GET',
        body: null,
        prefer: null,
        range: null,
        maskSensitive: false
      });
      return {
        statusCode: mongoResp.statusCode,
        headers: { ...CORS, ...mongoResp.headers },
        body: mongoResp.body
      };
    }

    const env = getSupabaseEnv();
    const q = query || '';
    const url = `${env.url}/rest/v1/${table}${q ? (String(table).includes('?') ? '&' : '?') + q : ''}`;
    const supa = await fetch(url, {
      headers: {
        apikey: env.anonKey,
        Authorization: `Bearer ${env.anonKey}`,
        'Content-Type': 'application/json'
      }
    });
    const text = await supa.text();
    const headers = { ...CORS, 'Content-Type': supa.headers.get('Content-Type') || 'application/json' };
    const cr = supa.headers.get('Content-Range');
    if (cr) headers['Content-Range'] = cr;
    return { statusCode: supa.status, headers, body: text };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: String(e && e.message ? e.message : e) })
    };
  }
};
