// Netlify Function: reset-password — adapter fino (Clean Architecture)
// Lógica: server/application/usecases/resetPasswordUsecase.js

const { corsResetPassword } = require('./server/presentation/http/corsPresets');
const { executeResetPassword } = require('./server/application/usecases/resetPasswordUsecase');

exports.handler = async (event) => {
  const CORS = corsResetPassword;
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
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'JSON inválido' }) };
  }

  const email = (body.email || '').toLowerCase().trim();
  if (!email || !email.includes('@')) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'E-mail inválido.' }) };
  }

  return executeResetPassword({ email, corsHeaders: CORS });
};
