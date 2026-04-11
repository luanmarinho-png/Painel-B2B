/**
 * Remove todos os objetos do Storage na pasta `{slug}/{simRef}/` do bucket de boletins.
 * Usa service role (mesmo bucket que boletinsStorageSignedUpload).
 */

const { createClient } = require('@supabase/supabase-js');
const { getSupabaseEnv } = require('../../infrastructure/config/supabaseEnv');
const { corsAdminProxy } = require('../../presentation/http/corsPresets');

/**
 * @param {{ rawPayload: Record<string, unknown> }} params
 * @returns {Promise<{ statusCode: number, headers: Record<string, string>, body: string }>}
 */
async function executeBoletinsStorageDeleteObjects({ rawPayload }) {
  const CORS = corsAdminProxy;
  const slug = rawPayload && rawPayload.slug != null ? String(rawPayload.slug).trim() : '';
  const simRef = rawPayload && rawPayload.simRef != null ? String(rawPayload.simRef).trim() : '';

  if (!slug || !simRef) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: 'Campos slug e simRef são obrigatórios' })
    };
  }

  const safeSlug = slug.replace(/[^a-z0-9_-]/gi, '').slice(0, 64) || 'ies';
  const safeRef = simRef.replace(/[^a-z0-9_-]/gi, '').slice(0, 96) || 'sim';
  const folderPath = `${safeSlug}/${safeRef}`;
  const bucket = (process.env.SUPABASE_BOLETINS_BUCKET || 'boletins-simulados').trim();

  const env = getSupabaseEnv();
  if (!env.serviceRoleKey) {
    return {
      statusCode: 503,
      headers: CORS,
      body: JSON.stringify({ error: 'SUPABASE_SERVICE_ROLE_KEY não configurada' })
    };
  }

  const supabase = createClient(env.url, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: files, error: listErr } = await supabase.storage.from(bucket).list(folderPath, {
    limit: 1000,
    offset: 0,
    sortBy: { column: 'name', order: 'asc' }
  });

  if (listErr) {
    const msg = String(listErr.message || 'Falha ao listar arquivos');
    const benign = /not found|does not exist|404|bucket/i.test(msg);
    if (benign) {
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({ deleted: 0, paths: [], bucket, folderPath, skipped: true, reason: msg })
      };
    }
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: msg })
    };
  }

  if (!files || files.length === 0) {
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ deleted: 0, paths: [], bucket, folderPath })
    };
  }

  const paths = files
    .filter((f) => f && f.name && !f.name.endsWith('/'))
    .map((f) => `${folderPath}/${f.name}`);

  if (!paths.length) {
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ deleted: 0, paths: [], bucket, folderPath })
    };
  }

  const { error: remErr } = await supabase.storage.from(bucket).remove(paths);

  if (remErr) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: String(remErr.message || 'Falha ao remover arquivos') })
    };
  }

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({
      deleted: paths.length,
      paths,
      bucket,
      folderPath
    })
  };
}

module.exports = { executeBoletinsStorageDeleteObjects };
