/**
 * Persiste um evento de auditoria das ações via admin-proxy (Mongo ou Supabase, conforme DATA_BACKEND).
 */

const { getSupabaseEnv } = require('../../infrastructure/config/supabaseEnv');
const { getMongoEnv } = require('../../infrastructure/mongo/mongoEnv');
const { getDb } = require('../../infrastructure/mongo/postgrestMongoAdapter');

const QUERY_PREVIEW_MAX = 1200;

/**
 * @param {unknown} body
 * @returns {string[] | undefined}
 */
function extractBodyKeys(body) {
  if (body == null) return undefined;
  if (typeof body === 'object' && !Array.isArray(body)) {
    return Object.keys(/** @type {Record<string, unknown>} */ (body)).slice(0, 48);
  }
  if (Array.isArray(body)) {
    return [`array_length:${body.length}`];
  }
  return undefined;
}

/**
 * @param {string | undefined} q
 * @returns {string}
 */
function truncateQuery(q) {
  const s = String(q || '');
  if (s.length <= QUERY_PREVIEW_MAX) return s;
  return `${s.slice(0, QUERY_PREVIEW_MAX)}…`;
}

/**
 * @param {object} params
 * @param {object} params.user
 * @param {string} params.role
 * @param {string} params.resourceTable
 * @param {string} params.httpMethod
 * @param {string} [params.query]
 * @param {unknown} [params.body]
 * @param {number} params.statusCode
 * @param {boolean} params.responseOk
 * @param {string} [params.errorSummary]
 * @param {string} [params.clientIp]
 * @param {string} [params.userAgent]
 * @returns {Promise<void>}
 */
async function appendAdminAuditLog({
  user,
  role,
  resourceTable,
  httpMethod,
  query,
  body,
  statusCode,
  responseOk,
  errorSummary,
  clientIp,
  userAgent
}) {
  const createdAt = new Date();
  const doc = {
    created_at: createdAt,
    actor_user_id: user && typeof user.id === 'string' ? user.id : String(user?.id ?? ''),
    actor_email: typeof user?.email === 'string' ? user.email : null,
    admin_role: role || null,
    resource_table: resourceTable,
    http_method: httpMethod,
    query_preview: truncateQuery(query),
    status_code: statusCode,
    response_ok: responseOk,
    error_summary: errorSummary ? String(errorSummary).slice(0, 500) : null,
    body_keys: extractBodyKeys(body),
    client_ip: clientIp ? String(clientIp).slice(0, 64) : null,
    user_agent: userAgent ? String(userAgent).slice(0, 256) : null
  };

  if (process.env.DATA_BACKEND === 'mongo') {
    const { uri } = getMongoEnv();
    if (!uri) return;
    const db = await getDb();
    await db.collection('admin_audit_log').insertOne(doc);
    return;
  }

  const env = getSupabaseEnv();
  const row = {
    created_at: createdAt.toISOString(),
    actor_user_id: doc.actor_user_id,
    actor_email: doc.actor_email,
    admin_role: doc.admin_role,
    resource_table: doc.resource_table,
    http_method: doc.http_method,
    query_preview: doc.query_preview,
    status_code: doc.status_code,
    response_ok: doc.response_ok,
    error_summary: doc.error_summary,
    body_keys: doc.body_keys,
    client_ip: doc.client_ip,
    user_agent: doc.user_agent
  };

  const resp = await fetch(`${env.url}/rest/v1/admin_audit_log`, {
    method: 'POST',
    headers: {
      apikey: env.serviceRoleKey,
      Authorization: `Bearer ${env.serviceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify(row)
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`admin_audit_log insert failed: ${resp.status} ${t.slice(0, 200)}`);
  }
}

module.exports = { appendAdminAuditLog, extractBodyKeys, truncateQuery };
