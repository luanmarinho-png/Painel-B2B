// Netlify Function: list-auth-users — adapter fino (Clean Architecture)
// Lógica: server/application/usecases/listAuthUsersUsecase.js

const { corsAdminJson } = require('../../server/presentation/http/corsPresets');
const { requireAdminSession } = require('../../server/application/auth/requireAdminSession');
const { executeListAuthUsers } = require('../../server/application/usecases/listAuthUsersUsecase');

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

  let params = {};
  try {
    params = JSON.parse(event.body || '{}');
  } catch {
    params = {};
  }
  const { email } = params;

  return executeListAuthUsers({ emailFilter: email, corsHeaders: CORS });
};
