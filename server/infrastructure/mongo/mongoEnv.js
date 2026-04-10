/**
 * Configuração MongoDB (Atlas) para Netlify Functions.
 */

const DEFAULT_DB = 'medcof_b2b';

/**
 * @returns {{ uri: string | null, databaseName: string }}
 */
function getMongoEnv() {
  const uri = (process.env.MONGODB_URI || '').trim() || null;
  const databaseName = (process.env.MONGODB_DATABASE || DEFAULT_DB).trim() || DEFAULT_DB;
  return { uri, databaseName };
}

module.exports = { getMongoEnv, DEFAULT_DB };
