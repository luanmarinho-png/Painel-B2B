/**
 * URL assinada de upload (Supabase Storage) para foto de perfil admin/superadmin.
 * Caminho: `{userId}/avatar.jpg` em bucket público dedicado.
 */

const { createClient } = require('@supabase/supabase-js');
const { getSupabaseEnv } = require('../../infrastructure/config/supabaseEnv');
const { corsAdminProxy } = require('../../presentation/http/corsPresets');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} bucket
 * @returns {Promise<{ ok: true } | { ok: false, message: string }>}
 */
async function ensureAvatarBucket(supabase, bucket) {
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

  return { ok: false, message: msg || 'Falha ao criar bucket de avatares' };
}

/**
 * @param {{ userId: string, rawPayload: Record<string, unknown> }} params
 * @returns {Promise<{ statusCode: number, headers: Record<string, string>, body: string }>}
 */
async function executeAdminAvatarSignedUpload({ userId, rawPayload }) {
  const CORS = corsAdminProxy;
  const uid = userId && UUID_RE.test(String(userId)) ? String(userId) : '';

  if (!uid) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: 'Identificação de usuário inválida' })
    };
  }

  const extRaw = rawPayload && rawPayload.ext != null ? String(rawPayload.ext).toLowerCase().replace(/^\./, '') : 'jpg';
  const ext = extRaw === 'jpeg' ? 'jpg' : extRaw;
  if (!['jpg', 'png', 'webp'].includes(ext)) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: 'Extensão permitida: jpg, png ou webp' })
    };
  }

  const objectPath = `${uid}/avatar.${ext}`;
  const bucket = (process.env.SUPABASE_ADMIN_AVATARS_BUCKET || 'admin-avatars').trim();

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

  const ensured = await ensureAvatarBucket(supabase, bucket);
  if (!ensured.ok) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({
        error: ensured.message,
        hint: 'Confira Storage no Supabase ou defina SUPABASE_ADMIN_AVATARS_BUCKET.'
      })
    };
  }

  const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(objectPath, { upsert: true });

  if (error) {
    const msg = String(error.message || '');
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: msg || 'Falha ao criar URL de upload' })
    };
  }

  const { data: pub } = supabase.storage.from(bucket).getPublicUrl(objectPath);
  const contentType =
    ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';

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
      contentType
    })
  };
}

module.exports = { executeAdminAvatarSignedUpload };
