// Netlify Function: delete-user — adapter fino (Clean Architecture)
// Lógica: server/application/usecases/deleteUserUsecase.js
// Requer sessão admin/superadmin (mesmo fluxo das demais funções de gestão).

const { corsAdminJson } = require('../../server/presentation/http/corsPresets');
const { requireAdminSession } = require('../../server/application/auth/requireAdminSession');
const { executeDeleteUser } = require('../../server/application/usecases/deleteUserUsecase');

exports.handler = async (event) => {
  const CORS = corsAdminJson;
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const session = await requireAdminSession(authHeader, CORS);
  if (!session.ok) return session.response;

  return executeDeleteUser({ body, corsHeaders: CORS });
};
