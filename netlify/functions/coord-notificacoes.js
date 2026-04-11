/**
 * Coordenadores: marcar avisos (notificacoes_admin) como lidos — JWT validado, PATCH via service_role / Mongo.
 */

const { getSupabaseEnv } = require('./server/infrastructure/config/supabaseEnv');
const { isMongoDataBackend } = require('./server/infrastructure/mongo/isMongoData');
const { executePostgrestMongo } = require('./server/infrastructure/mongo/postgrestMongoAdapter');
const { validateCoordinatorAccess } = require('./coordinatorAuth');

const { url: SUPABASE_URL } = getSupabaseEnv();
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
function normalizeLidoPor(raw) {
  if (Array.isArray(raw)) return raw.map(String);
  if (raw == null || raw === '') return [];
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (t.startsWith('[')) {
      try {
        const p = JSON.parse(t);
        return Array.isArray(p) ? p.map(String) : [];
      } catch {
        return [];
      }
    }
    return [];
  }
  if (typeof raw === 'object') return Object.values(/** @type {Record<string, unknown>} */ (raw)).map(String);
  return [];
}

/**
 * @param {string} tableQuery
 * @returns {Promise<unknown[]>}
 */
async function restSelectRows(tableQuery) {
  if (isMongoDataBackend()) {
    const mr = await executePostgrestMongo({
      table: tableQuery,
      query: '',
      method: 'GET',
      body: null,
      prefer: null,
      range: null,
      maskSensitive: false
    });
    try {
      const rows = JSON.parse(mr.body || '[]');
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }
  if (!SERVICE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY não configurada');
  }
  const url = `${SUPABASE_URL}/rest/v1/${tableQuery}`;
  const r = await fetch(url, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json'
    }
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(t || `Select ${r.status}`);
  }
  return r.json();
}

/**
 * @param {string} id
 * @param {string[]} lidoPor
 * @returns {Promise<boolean>}
 */
async function patchLidoPor(id, lidoPor) {
  if (isMongoDataBackend()) {
    const mr = await executePostgrestMongo({
      table: `notificacoes_admin?id=eq.${encodeURIComponent(id)}`,
      query: '',
      method: 'PATCH',
      body: { lido_por: lidoPor },
      prefer: 'return=minimal',
      range: null,
      maskSensitive: false
    });
    return mr.statusCode >= 200 && mr.statusCode < 300;
  }
  if (!SERVICE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY não configurada');
  }
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/notificacoes_admin?id=eq.${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({ lido_por: lidoPor })
    }
  );
  return r.ok;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'JSON inválido' })
    };
  }

  const userToken = body.supabase_access_token || '';
  const iesSlug = String(body.ies_slug || '').trim();
  const action = String(body.action || '').trim();
  const notifId = body.notifId != null ? String(body.notifId).trim() : '';

  const access = await validateCoordinatorAccess(userToken, iesSlug);
  if (!access.ok) {
    return {
      statusCode: access.status || 403,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: access.error || 'Acesso negado' })
    };
  }

  const userEmail = access.email || '';
  if (!userEmail) {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'E-mail do usuário não disponível para marcar leitura.' })
    };
  }

  try {
    if (action === 'markRead') {
      if (!notifId) {
        return {
          statusCode: 400,
          headers: { ...CORS, 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'notifId obrigatório' })
        };
      }
      const rows = await restSelectRows(
        `notificacoes_admin?id=eq.${encodeURIComponent(notifId)}&select=id,lido_por,destinatarios,tipo&limit=1`
      );
      const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
      if (!row) {
        return {
          statusCode: 404,
          headers: { ...CORS, 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Aviso não encontrado' })
        };
      }
      if (String(row.destinatarios || '') !== 'all' || String(row.tipo || '') !== 'manual') {
        return {
          statusCode: 403,
          headers: { ...CORS, 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Aviso não disponível neste painel' })
        };
      }
      const merged = [...normalizeLidoPor(row.lido_por)];
      if (merged.includes(userEmail)) {
        return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
      }
      merged.push(userEmail);
      const ok = await patchLidoPor(notifId, merged);
      if (!ok) {
        return {
          statusCode: 500,
          headers: { ...CORS, 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Falha ao atualizar aviso' })
        };
      }
      return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
    }

    if (action === 'markAllRead') {
      const rows = await restSelectRows(
        'notificacoes_admin?destinatarios=eq.all&tipo=eq.manual&select=id,lido_por&order=created_at.desc&limit=50'
      );
      if (!Array.isArray(rows)) {
        return {
          statusCode: 500,
          headers: { ...CORS, 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Lista inválida' })
        };
      }
      const unread = rows.filter((n) => !normalizeLidoPor(n.lido_por).includes(userEmail));
      for (const n of unread) {
        const id = String(n.id);
        const merged = [...normalizeLidoPor(n.lido_por), userEmail];
        const ok = await patchLidoPor(id, merged);
        if (!ok) {
          return {
            statusCode: 500,
            headers: { ...CORS, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Falha ao limpar avisos' })
          };
        }
      }
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, cleared: unread.length })
      };
    }

    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'action inválida' })
    };
  } catch (e) {
    console.error('[coord-notificacoes]', e);
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: String(e && e.message ? e.message : e) })
    };
  }
};
