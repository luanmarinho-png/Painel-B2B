// Netlify Function: admin-health — status operacional (apenas superadmin)

const { corsAdminJson } = require('./server/presentation/http/corsPresets');
const { requireSuperadminSession } = require('./server/application/auth/requireSuperadminSession');
const { executeAdminHealth } = require('./server/application/usecases/adminHealthUsecase');

exports.handler = async (event) => {
  const CORS = corsAdminJson;
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const session = await requireSuperadminSession(authHeader, CORS);
  if (!session.ok) return session.response;

  const payload = await executeAdminHealth();
  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  };
};
