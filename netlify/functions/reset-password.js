// Netlify Function: reset-password
// Valida o e-mail (whitelist OU superadmin/admin) e gera um link de recuperação via Supabase Admin API.
// Não depende de SMTP — o link é retornado diretamente ao cliente.

const SUPABASE_URL = 'https://cvwwucxjrpsfoxarsipr.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2d3d1Y3hqcnBzZm94YXJzaXByIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTMwMjEzOCwiZXhwIjoyMDkwODc4MTM4fQ.M6ZGpySPaj1ecL9rXS3q9UM4FnfD6Cz3eA0tFWqHi4c';
const REDIRECT_TO = 'https://grupomedcof.org/nova-senha.html';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const NOT_FOUND = {
  statusCode: 200,
  headers: CORS,
  body: JSON.stringify({ ok: true, message: 'Se este e-mail estiver cadastrado no sistema, o link será gerado.' })
};

exports.handler = async (event) => {
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

  try {
    // 1. Buscar usuário no Supabase Auth
    const authResp = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`,
      { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } }
    );
    const authData = await authResp.json();
    const authUser = (authData.users || []).find(u => u.email === email);

    if (!authUser) return NOT_FOUND;

    // 2. Verificar autorização:
    //    - superadmin / admin → acesso direto (não estão na whitelist)
    //    - coordenador → deve estar na whitelist e estar ativo
    const role = authUser.user_metadata?.role || '';
    const isAdmin = role === 'superadmin' || role === 'admin';

    if (!isAdmin) {
      const wlResp = await fetch(
        `${SUPABASE_URL}/rest/v1/usuarios_autorizados?email=eq.${encodeURIComponent(email)}&ativo=eq.true&select=email`,
        { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } }
      );
      if (!wlResp.ok) {
        return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Erro interno ao verificar cadastro.' }) };
      }
      const wlData = await wlResp.json();
      if (!Array.isArray(wlData) || wlData.length === 0) return NOT_FOUND;
    }

    // 3. Gerar link de recuperação via Admin API (não precisa de SMTP)
    const linkResp = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/generate_link`,
      {
        method: 'POST',
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          type: 'recovery',
          email,
          options: { redirect_to: REDIRECT_TO }
        })
      }
    );

    if (!linkResp.ok) {
      const err = await linkResp.json();
      console.error('Erro generate_link:', err);
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Erro ao gerar link de recuperação.' }) };
    }

    const { action_link } = await linkResp.json();

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ ok: true, link: action_link })
    };

  } catch (err) {
    console.error('reset-password error:', err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Erro interno: ' + err.message }) };
  }
};
