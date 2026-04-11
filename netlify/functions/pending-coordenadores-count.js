// Netlify Function: pending-coordenadores-count — adapter fino (Clean Architecture)
// Lógica: server/application/usecases/countPendingCoordenadoresUsecase.js

const { corsAdminJson } = require('./server/presentation/http/corsPresets');
const { requireAdminSession } = require('./server/application/auth/requireAdminSession');
const { executeCountPendingCoordenadores } = require('./server/application/usecases/countPendingCoordenadoresUsecase');

exports.handler = async (event) => {
  const CORS = corsAdminJson;
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const session = await requireAdminSession(authHeader, CORS);
  if (!session.ok) return session.response;

  return executeCountPendingCoordenadores({ corsHeaders: CORS });
};
