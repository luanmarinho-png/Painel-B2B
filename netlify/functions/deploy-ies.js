// ═══════════════════════════════════════════════════════════════════
//  Netlify Function: deploy-ies  (v10 — preserva functions + registra IES)
//  Deploy incremental de arquivos estáticos via Netlify API.
//  Inclui SHAs das functions e faz upsert da IES na tabela `instituicoes`.
// ═══════════════════════════════════════════════════════════════════

const crypto = require('crypto');

const NETLIFY_TOKEN  = process.env.NETLIFY_TOKEN;
const SITE_ID        = process.env.NETLIFY_SITE_ID;
const API            = 'https://api.netlify.com/api/v1';
const { getSupabaseEnv } = require('./server/infrastructure/config/supabaseEnv');
const { isMongoDataBackend } = require('./server/infrastructure/mongo/isMongoData');
const { executePostgrestMongo } = require('./server/infrastructure/mongo/postgrestMongoAdapter');
const { url: SUPABASE_URL, serviceRoleKey: SUPABASE_KEY } = getSupabaseEnv();

// SHAs SHA256 dos zips de cada function (mesma regra do deploy-safe.py: zip com um único .js).
// Não incluir deploy-ies aqui: o hash do bundle não pode ser embutido no próprio ficheiro sem inconsistência;
// essa function segue a versão já publicada no deploy base até um deploy completo (Git/CLI/deploy-safe).
// Atualizar estes quatro sempre que alterar create/update/delete/reset-password.
const FN_SHAS = {
  'create-user':    '8d840131471e66a4ade904f3eae569c8e111e6f03c81485a48cf562156958e2b',
  'delete-user':    'e1cc9a4ee63438890ad785aea53e4d92dfaf4d92d9b7fc873f1f7c863bfdf236',
  'update-user':    'e2220a019b31fc0cc7d4deaa24a006e18ccf7b9b228aef6895df289f0f3fe01d',
  'reset-password': '0656b558ca8e6ab4ce44dc6347bd63aed9afbf9b717f5e6d5fea3e731a109c8f',
};

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const ok  = b        => ({ statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
const err = (m, c=500) => ({ statusCode: c,   headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: m }) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')    return err('Method not allowed', 405);

  if (!NETLIFY_TOKEN || !SITE_ID) {
    return err('Configure NETLIFY_TOKEN e NETLIFY_SITE_ID em Netlify → Site Settings → Environment Variables.');
  }

  let files, slugBody, wip, nome, cidade, stripe;
  try   { ({ files, slug: slugBody, wip, nome, cidade, stripe } = JSON.parse(event.body)); }
  catch { return err('JSON inválido no body', 400); }
  if (!files || typeof files !== 'object' || Object.keys(files).length === 0) {
    return err('Campo "files" obrigatório: { "path": "base64" }', 400);
  }

  try {
    // ── 1. base64 → Buffer + SHA1 ────────────────────────────────
    const pathToSha   = {};
    const shaToBuffer = {};
    for (const [raw, b64] of Object.entries(files)) {
      const p   = raw.startsWith('/') ? raw : '/' + raw;
      const buf = Buffer.from(b64, 'base64');
      const sha = crypto.createHash('sha1').update(buf).digest('hex');
      pathToSha[p]     = sha;
      shaToBuffer[sha] = buf;
    }

    // ── 2. Buscar o deploy mais recente em estado "ready" com ≥100 arquivos ──
    const deploysResp = await fetch(`${API}/sites/${SITE_ID}/deploys?per_page=20`, {
      headers: { Authorization: `Bearer ${NETLIFY_TOKEN}` },
    });
    if (!deploysResp.ok) throw new Error(`Deploys: ${deploysResp.status}`);
    const allDeploys = await deploysResp.json();

    let baseDeploy = null;
    for (const d of allDeploys) {
      if (d.state !== 'ready') continue;
      const fr = await fetch(`${API}/deploys/${d.id}/files`, {
        headers: { Authorization: `Bearer ${NETLIFY_TOKEN}` },
      });
      if (!fr.ok) continue;
      const deployFiles = await fr.json();
      if (deployFiles.length >= 100) {
        baseDeploy = { id: d.id, files: deployFiles };
        break;
      }
    }

    // ── 3. Mesclar arquivos existentes + novos ────────────────────
    const mergedFiles = { ...pathToSha };
    if (baseDeploy) {
      for (const f of baseDeploy.files) {
        if (!mergedFiles[f.id]) mergedFiles[f.id] = f.sha;
      }
    }

    // ── 4. Criar novo deploy com arquivos + functions ─────────────
    const createResp = await fetch(`${API}/sites/${SITE_ID}/deploys`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${NETLIFY_TOKEN}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ files: mergedFiles, functions: FN_SHAS, draft: false }),
    });
    if (!createResp.ok) {
      const txt = await createResp.text();
      throw new Error(`Criar deploy: ${createResp.status} — ${txt}`);
    }
    const deploy = await createResp.json();

    // ── 5. Upload de arquivos requeridos ──────────────────────────
    const required = deploy.required || [];
    if (required.length > 0) {
      await Promise.all(required.map(async (sha) => {
        const buf = shaToBuffer[sha];
        if (!buf) return;
        const p = Object.keys(pathToSha).find(k => pathToSha[k] === sha);
        if (!p) return;
        const up = await fetch(`${API}/deploys/${deploy.id}/files${p}`, {
          method:  'PUT',
          headers: { Authorization: `Bearer ${NETLIFY_TOKEN}`, 'Content-Type': 'application/octet-stream' },
          body:    buf,
        });
        if (!up.ok) throw new Error(`Upload ${p}: ${up.status}`);
      }));
    }

    // ── 6. Registrar IES na tabela `instituicoes` do Supabase ────────
    // Detectar slug a partir dos caminhos dos arquivos (ex: /unit/index.html → "unit")
    const slugDetected = slugBody || (() => {
      const slugs = new Set(
        Object.keys(pathToSha)
          .map(p => p.split('/').filter(Boolean)[0])
          .filter(Boolean)
      );
      return slugs.size === 1 ? [...slugs][0] : null;
    })();

    let iesRegistered = false;
    if (slugDetected) {
      try {
        const row = {
          slug: slugDetected,
          path: `/${slugDetected}/`,
          ativo: true,
          wip: wip === true ? true : false,
          ...(nome ? { nome } : {}),
          ...(cidade ? { cidade } : {}),
          ...(stripe ? { stripe } : {})
        };
        if (isMongoDataBackend()) {
          const mr = await executePostgrestMongo({
            table: 'instituicoes?on_conflict=slug',
            query: '',
            method: 'POST',
            body: row,
            prefer: 'return=representation,resolution=merge-duplicates',
            range: null,
            maskSensitive: false
          });
          iesRegistered = mr.statusCode >= 200 && mr.statusCode < 300;
        } else {
          const upsertResp = await fetch(`${SUPABASE_URL}/rest/v1/instituicoes?on_conflict=slug`, {
            method: 'POST',
            headers: {
              apikey: SUPABASE_KEY,
              Authorization: `Bearer ${SUPABASE_KEY}`,
              'Content-Type': 'application/json',
              Prefer: 'resolution=merge-duplicates'
            },
            body: JSON.stringify(row)
          });
          iesRegistered = upsertResp.ok;
        }
      } catch (_) { /* não bloquear o deploy se o upsert falhar */ }
    }

    return ok({
      success:        true,
      deploy_id:      deploy.id,
      state:          deploy.state,
      url:            deploy.ssl_url || deploy.url,
      files_new:      Object.keys(pathToSha).length,
      files_total:    Object.keys(mergedFiles).length,
      files_uploaded: required.length,
      ies_slug:       slugDetected,
      ies_registered: iesRegistered,
    });

  } catch (e) {
    return err(e.message);
  }
};
