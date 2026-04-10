// Netlify Function: create-user — adapter fino (Clean Architecture)
// Lógica: server/application/usecases/createUserUsecase.js

const { corsAdminJson } = require('./server/presentation/http/corsPresets');
const { requireAdminSession } = require('./server/application/auth/requireAdminSession');
const { executeCreateUser } = require('./server/application/usecases/createUserUsecase');

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

  return executeCreateUser({ callerRole: session.callerRole, body, corsHeaders: CORS });
};
