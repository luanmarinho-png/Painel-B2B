/**
 * Gera URL assinada de upload (Supabase Storage) para o ZIP de boletins.
 * O bucket é criado automaticamente (público) se ainda não existir, para evitar 404 em upload/download.
 */

const { createClient } = require('@supabase/supabase-js');
const { getSupabaseEnv } = require('../../infrastructure/config/supabaseEnv');
const { corsAdminProxy } = require('../../presentation/http/corsPresets');

/**
 * Garante que o bucket de boletins existe (criação idempotente com service role).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} bucket
 * @returns {Promise<{ ok: true } | { ok: false, message: string }>}
 */
async function ensureBoletinsBucket(supabase, bucket) {
  const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
  if (listErr) {
    return { ok: false, message: String(listErr.message || 'Falha ao listar buckets') };
  }
  if (buckets?.some((b) => b.name === bucket)) {
    return { ok: true };
  }

  const { error: createErr } = await supabase.storage.createBucket(bucket, {
    public: true
  });
  if (!createErr) {
    return { ok: true };
  }

  const msg = String(createErr.message || '');
  const code = createErr.statusCode ?? createErr.status;
  const duplicate =
    code === 409 ||
    code === '409' ||
    /already exists|duplicate|já existe/i.test(msg);
  if (duplicate) {
    return { ok: true };
  }

  return { ok: false, message: msg || 'Falha ao criar bucket de boletins' };
}

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

  const ensured = await ensureBoletinsBucket(supabase, bucket);
  if (!ensured.ok) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({
        error: ensured.message,
        hint:
          'Confira SUPABASE_SERVICE_ROLE_KEY e permissões de Storage no projeto. Opcional: SUPABASE_BOLETINS_BUCKET se o nome do bucket for outro.'
      })
    };
  }

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUploadUrl(objectPath, { upsert: true });

  if (error) {
    const msg = String(error.message || '');
    const code = error.statusCode ?? error.status;
    const bucketMissing =
      /bucket not found/i.test(msg) || code === 404 || code === '404';
    let supabaseHost = '';
    try {
      supabaseHost = new URL(env.url).host;
    } catch (_) {
      supabaseHost = '';
    }
    return {
      statusCode: bucketMissing ? 404 : 500,
      headers: CORS,
      body: JSON.stringify({
        error: bucketMissing
          ? `Bucket Storage "${bucket}" não existe neste projeto Supabase.`
          : msg || 'Falha ao criar URL de upload',
        hint: bucketMissing
          ? `Se você já vê arquivos no Storage, o problema costuma ser: (1) projeto diferente — confira se o Dashboard está no mesmo projeto que a Netlify (SUPABASE_URL); (2) nome do bucket diferente — na barra lateral do Storage o nome deve ser exatamente "${bucket}" ou ajuste SUPABASE_BOLETINS_BUCKET na Netlify. (3) Crie "${bucket}" neste projeto se ainda não existir. Links públicos no painel: bucket público ou políticas de leitura.`
          : 'No Supabase: Storage → crie o bucket "' +
            bucket +
            '" (leitura pública se o painel for anônimo). Variável opcional: SUPABASE_BOLETINS_BUCKET.',
        debug: bucketMissing ? { bucket, supabaseHost: supabaseHost || env.url } : undefined
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
