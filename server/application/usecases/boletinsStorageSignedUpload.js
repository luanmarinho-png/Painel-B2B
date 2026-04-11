/**
 * Gera URL assinada de upload (Supabase Storage) para o ZIP de boletins.
 * Bucket deve existir; recomenda-se bucket público para leitura do link no painel do coordenador.
 */

const { createClient } = require('@supabase/supabase-js');
const { getSupabaseEnv } = require('../../infrastructure/config/supabaseEnv');
const { corsAdminProxy } = require('../../presentation/http/corsPresets');

/**
 * @param {{ rawPayload: Record<string, unknown> }} params
 * @returns {Promise<{ statusCode: number, headers: Record<string, string>, body: string }>}
 */
async function executeBoletinsStorageSignedUpload({ rawPayload }) {
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
  const partIndexRaw = rawPayload.partIndex != null ? parseInt(String(rawPayload.partIndex), 10) : NaN;
  const totalPartsRaw = rawPayload.totalParts != null ? parseInt(String(rawPayload.totalParts), 10) : NaN;
  const partIndex = Number.isFinite(partIndexRaw) && partIndexRaw >= 1 ? partIndexRaw : 1;
  const totalParts = Number.isFinite(totalPartsRaw) && totalPartsRaw >= 1 ? totalPartsRaw : 1;
  const objectPath =
    totalParts <= 1
      ? `${safeSlug}/${safeRef}/boletins.zip`
      : `${safeSlug}/${safeRef}/boletins_part${partIndex}.zip`;
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

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUploadUrl(objectPath, { upsert: true });

  if (error) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({
        error: error.message || 'Falha ao criar URL de upload',
        hint:
          'No Supabase: Storage → crie o bucket "' +
          bucket +
          '" (leitura pública se o painel for anônimo). Variável opcional: SUPABASE_BOLETINS_BUCKET.'
      })
    };
  }

  const { data: pub } = supabase.storage.from(bucket).getPublicUrl(objectPath);

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({
      signedUrl: data.signedUrl,
      token: data.token,
      path: data.path,
      publicUrl: pub.publicUrl,
      bucket,
      objectPath,
      partIndex,
      totalParts
    })
  };
}

module.exports = { executeBoletinsStorageSignedUpload };
