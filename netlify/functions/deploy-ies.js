// ═══════════════════════════════════════════════════════════════════
//  Netlify Function: deploy-ies  (v10 — preserva functions + registra IES)
//  Deploy incremental de arquivos estáticos via Netlify API.
//  Inclui SHAs das functions e faz upsert da IES na tabela `instituicoes`.
// ═══════════════════════════════════════════════════════════════════

const crypto = require('crypto');

const NETLIFY_TOKEN  = process.env.NETLIFY_TOKEN;
const SITE_ID        = process.env.NETLIFY_SITE_ID;
const API            = 'https://api.netlify.com/api/v1';
const SUPABASE_URL   = 'https://cvwwucxjrpsfoxarsipr.supabase.co';
const SUPABASE_KEY   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2d3d1Y3hqcnBzZm94YXJzaXByIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTMwMjEzOCwiZXhwIjoyMDkwODc4MTM4fQ.M6ZGpySPaj1ecL9rXS3q9UM4FnfD6Cz3eA0tFWqHi4c';

// SHAs dos bundles das Netlify Functions (gerados pelo CLI com esbuild).
// Atualizar sempre que uma function for modificada e redeploy via CLI for feito.
const FN_SHAS = {
  'create-user':    '0c0011637ff6aaeccf4c40a33789c1a0fc458600f7db90fae772b21cb3d8d272',
  'delete-user':    'a6c417792ea45343c919da296ddfefc7e95f2834a2f63a5a98dc35c9780bbb99',
  'deploy-ies':     'c87e92140a7a5cd65b251fc9d43cac9efffb1f6e32b618df13e1281d0b57e7f1',
  'update-user':    'a98ce2957a65bc0ffb25d38c1a847f755ff398685ca451d6d1744d1ac7d75014',
  'reset-password': '099fe139874e4847b39773dfa069156346cada081090dc5ebc784fcb18cc0f3e',
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
        const upsertResp = await fetch(
          `${SUPABASE_URL}/rest/v1/instituicoes?on_conflict=slug`,
          {
            method:  'POST',
            headers: {
              'apikey':       SUPABASE_KEY,
              'Authorization': `Bearer ${SUPABASE_KEY}`,
              'Content-Type':  'application/json',
              'Prefer':        'resolution=merge-duplicates',
            },
            body: JSON.stringify({
              slug:   slugDetected,
              path:   `/${slugDetected}/`,
              ativo:  true,
              wip:    wip === true ? true : false,
              ...(nome   ? { nome }   : {}),
              ...(cidade ? { cidade } : {}),
              ...(stripe ? { stripe } : {}),
            }),
          }
        );
        iesRegistered = upsertResp.ok;
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
