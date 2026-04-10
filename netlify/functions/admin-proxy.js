// Netlify Function: admin-proxy — adapter fino (Clean Architecture)
// Lógica: server/application/usecases/adminProxyUsecase.js

const { corsAdminProxy } = require('./server/presentation/http/corsPresets');
const { executeAdminProxy } = require('./server/application/usecases/adminProxyUsecase');

exports.handler = async (event) => {
  const CORS = corsAdminProxy;
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  return executeAdminProxy({ authHeader, rawBody: event.body || '{}' });
};
