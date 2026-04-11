// Netlify Function: register-pre-cadastro — pré-cadastro após login Google (sessão obrigatória)

const { corsAdminJson } = require('./server/presentation/http/corsPresets');
const { requireSession } = require('./server/application/auth/requireSession');
const { executeRegisterPreCadastro } = require('./server/application/usecases/registerPreCadastroUsecase');

exports.handler = async (event) => {
  const CORS = corsAdminJson;
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const session = await requireSession(authHeader, CORS);
  if (!session.ok) return session.response;

  return executeRegisterPreCadastro({ user: session.user, corsHeaders: CORS });
};
