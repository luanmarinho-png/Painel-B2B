/**
 * Status operacional para superadmin: backend de dados, pings e metadados de deploy.
 */

const { getSupabaseEnv } = require('../../infrastructure/config/supabaseEnv');
const { getMongoEnv } = require('../../infrastructure/mongo/mongoEnv');
const { getDb } = require('../../infrastructure/mongo/postgrestMongoAdapter');

/**
 * @returns {Promise<{ configured: boolean, ok: boolean, latencyMs?: number, detail?: string }>}
 */
async function pingMongo() {
  const { uri } = getMongoEnv();
  if (!uri) {
    return { configured: false, ok: false, detail: 'MONGODB_URI não definida' };
  }
  const t0 = Date.now();
  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    return { configured: true, ok: true, latencyMs: Date.now() - t0 };
  } catch (err) {
    const msg = err && typeof err.message === 'string' ? err.message : String(err);
    return { configured: true, ok: false, latencyMs: Date.now() - t0, detail: msg };
  }
}

/**
 * @returns {Promise<{ ok: boolean, status?: number, latencyMs: number, detail?: string }>}
 */
async function pingSupabaseAuth() {
  const env = getSupabaseEnv();
  const t0 = Date.now();
  try {
    const r = await fetch(`${env.url}/auth/v1/health`, {
      headers: { apikey: env.anonKey }
    });
    return { ok: r.ok, status: r.status, latencyMs: Date.now() - t0 };
  } catch (err) {
    const msg = err && typeof err.message === 'string' ? err.message : String(err);
    return { ok: false, latencyMs: Date.now() - t0, detail: msg };
  }
}

/**
 * @returns {Promise<Record<string, unknown>>}
 */
async function executeAdminHealth() {
  const [mongo, supabaseAuth] = await Promise.all([pingMongo(), pingSupabaseAuth()]);
  return {
    dataBackend: process.env.DATA_BACKEND || 'supabase',
    mongo,
    supabaseAuth,
    deploy: {
      context: process.env.CONTEXT || null,
      deployId: process.env.DEPLOY_ID || null,
      commitRef: process.env.COMMIT_REF || null
    },
    node: process.version,
    serverTime: new Date().toISOString()
  };
}

module.exports = { executeAdminHealth };
