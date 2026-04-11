/**
 * Exportação CSV (superadmin): paginação no mesmo estilo PostgREST do admin-proxy.
 */

const { getSupabaseEnv } = require('../../infrastructure/config/supabaseEnv');
const { getMongoEnv } = require('../../infrastructure/mongo/mongoEnv');
const { executePostgrestMongo } = require('../../infrastructure/mongo/postgrestMongoAdapter');
const { appendAdminAuditLog } = require('./appendAdminAuditLog');

const EXPORT_TABLES = new Set([
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
  'contratos_ies',
  'alunos_faltantes_simulado',
  'avisos',
  'notificacoes_admin',
  'admin_audit_log'
]);

const PAGE = 500;
const MAX_ROWS = 50000;

/**
 * @param {string} qs
 * @returns {string}
 */
function stripLimitOffset(qs) {
  return String(qs || '')
    .split('&')
    .filter((p) => p && !/^limit=/i.test(p) && !/^offset=/i.test(p))
    .join('&');
}

/**
 * @param {string} userQuery
 * @param {number} offset
 * @returns {string}
 */
function buildPageQuery(userQuery, offset) {
  const base = stripLimitOffset(userQuery);
  const page = `limit=${PAGE}&offset=${offset}`;
  if (!base) return page;
  return `${base}&${page}`;
}

/**
 * @param {unknown} v
 * @returns {string}
 */
function cellValue(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/**
 * @param {unknown} val
 * @returns {string}
 */
function escapeCsvCell(val) {
  const s = cellValue(val);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * @param {Record<string, unknown>[]} rows
 * @returns {string}
 */
function rowsToCsv(rows) {
  if (!rows.length) {
    return '\uFEFFinfo\nNenhum registro encontrado com os filtros atuais.\n';
  }
  const keySet = new Set();
  rows.forEach((r) => {
    if (r && typeof r === 'object') Object.keys(r).forEach((k) => keySet.add(k));
  });
  const keys = [...keySet].sort();
  const lines = [keys.map((k) => escapeCsvCell(k)).join(',')];
  for (const row of rows) {
    lines.push(keys.map((k) => escapeCsvCell(row[k])).join(','));
  }
  return `\uFEFF${lines.join('\n')}\n`;
}

/**
 * @param {string} tableName
 * @param {string} userQuery
 * @param {number} offset
 * @returns {Promise<Record<string, unknown>[]>}
 */
async function fetchPage(tableName, userQuery, offset) {
  const q = buildPageQuery(userQuery, offset);
  if (process.env.DATA_BACKEND === 'mongo') {
    const { uri } = getMongoEnv();
    if (!uri) throw new Error('DATA_BACKEND=mongo mas MONGODB_URI não está configurada');
    const r = await executePostgrestMongo({
      table: tableName,
      query: q,
      method: 'GET',
      maskSensitive: false
    });
    if (r.statusCode !== 200) {
      throw new Error((r.body && r.body.slice(0, 400)) || `HTTP ${r.statusCode}`);
    }
    const data = JSON.parse(r.body || '[]');
    return Array.isArray(data) ? data : [data];
  }

  const env = getSupabaseEnv();
  const url = `${env.url}/rest/v1/${tableName}?${q}`;
  const r = await fetch(url, {
    headers: {
      apikey: env.serviceRoleKey,
      Authorization: `Bearer ${env.serviceRoleKey}`,
      'Content-Type': 'application/json'
    }
  });
  const text = await r.text();
  if (!r.ok) throw new Error(text.slice(0, 400));
  const data = JSON.parse(text || '[]');
  return Array.isArray(data) ? data : [data];
}

/**
 * @param {object} params
 * @param {object} params.user
 * @param {string} params.role
 * @param {string} params.table
 * @param {string} [params.query]
 * @param {string} [params.clientIp]
 * @param {string} [params.userAgent]
 * @returns {Promise<
 *   | { ok: true, statusCode: number, filename: string, body: string, rowCount: number }
 *   | { ok: false, statusCode: number, error: string }
 * >}
 */
async function executeAdminExport({ user, role, table, query, clientIp, userAgent }) {
  const tableName = String(table || '')
    .split('?')[0]
    .split('/')[0]
    .trim();
  if (!EXPORT_TABLES.has(tableName)) {
    return { ok: false, statusCode: 403, error: `Tabela "${tableName}" não permitida para exportação` };
  }

  const userQuery = stripLimitOffset(
    String(query || '')
      .split(/[\n\r]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .join('&')
  );

  /** @type {Record<string, unknown>[]} */
  const rows = [];
  let offset = 0;

  try {
    while (rows.length < MAX_ROWS) {
      const batch = await fetchPage(tableName, userQuery, offset);
      if (!batch.length) break;
      rows.push(...batch);
      if (batch.length < PAGE) break;
      offset += PAGE;
    }
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    try {
      await appendAdminAuditLog({
        user,
        role,
        resourceTable: tableName,
        httpMethod: 'EXPORT',
        query: `export=csv&${userQuery}`.slice(0, 1200),
        body: null,
        statusCode: 500,
        responseOk: false,
        errorSummary: msg.slice(0, 500),
        clientIp,
        userAgent
      });
    } catch (e) {
      console.error('[admin export audit]', e.message || e);
    }
    return { ok: false, statusCode: 500, error: msg };
  }

  const csv = rowsToCsv(rows);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '_');
  const safeName = `${tableName.replace(/[^a-zA-Z0-9_-]/g, '_')}_${stamp}.csv`;

  try {
    await appendAdminAuditLog({
      user,
      role,
      resourceTable: tableName,
      httpMethod: 'EXPORT',
      query: (`export=csv&rows=${rows.length}&${userQuery}`).slice(0, 1200),
      body: null,
      statusCode: 200,
      responseOk: true,
      errorSummary: undefined,
      clientIp,
      userAgent
    });
  } catch (e) {
    console.error('[admin export audit]', e.message || e);
  }

  return {
    ok: true,
    statusCode: 200,
    filename: safeName,
    body: csv,
    rowCount: rows.length
  };
}

module.exports = { executeAdminExport, EXPORT_TABLES };
