// Netlify Function: admin-export — CSV (apenas superadmin)

const { corsAdminExport } = require('./server/presentation/http/corsPresets');
const { requireSuperadminSession } = require('./server/application/auth/requireSuperadminSession');
const { executeAdminExport } = require('./server/application/usecases/adminExportUsecase');

exports.handler = async (event) => {
  const CORS = corsAdminExport;
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

  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const session = await requireSuperadminSession(authHeader, CORS);
  if (!session.ok) return session.response;

  let payload = {};
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'JSON inválido' })
    };
  }

  const forwardedFor =
    event.headers['x-forwarded-for'] || event.headers['X-Forwarded-For'] || '';
  const clientIp = String(forwardedFor)
    .split(',')[0]
    .trim() || undefined;
  const userAgent = event.headers['user-agent'] || event.headers['User-Agent'] || undefined;

  const result = await executeAdminExport({
    user: session.user,
    role: session.callerRole,
    table: payload.table,
    query: typeof payload.query === 'string' ? payload.query : '',
    clientIp,
    userAgent
  });

  if (!result.ok) {
    return {
      statusCode: result.statusCode,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: result.error })
    };
  }

  const filename = result.filename.replace(/"/g, '');
  return {
    statusCode: 200,
    headers: {
      ...CORS,
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Export-Row-Count': String(result.rowCount)
    },
    body: result.body
  };
};
