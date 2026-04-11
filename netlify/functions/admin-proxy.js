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
  const forwardedFor =
    event.headers['x-forwarded-for'] || event.headers['X-Forwarded-For'] || '';
  const userAgent = event.headers['user-agent'] || event.headers['User-Agent'] || '';
  return executeAdminProxy({
    authHeader,
    rawBody: event.body || '{}',
    requestMeta: { forwardedFor, userAgent }
  });
};
