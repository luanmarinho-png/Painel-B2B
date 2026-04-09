// Netlify Function: create-user
// Cria usuário no Supabase Auth e insere na tabela usuarios_autorizados
// Usa service_role key no servidor — nunca exposta no frontend

const SUPABASE_URL = 'https://cvwwucxjrpsfoxarsipr.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2d3d1Y3hqcnBzZm94YXJzaXByIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTMwMjEzOCwiZXhwIjoyMDkwODc4MTM4fQ.M6ZGpySPaj1ecL9rXS3q9UM4FnfD6Cz3eA0tFWqHi4c';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
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
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { email, nome, role, instituicao, senha } = body;

  if (!email || !nome || !role || !senha) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Campos obrigatórios: email, nome, role, senha' }) };
  }
  if (role === 'coordenador' && !instituicao) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Coordenador precisa de uma instituição vinculada.' }) };
  }

  try {
    // 1. Criar usuário no Supabase Auth
    const authResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email,
        password: senha,
        email_confirm: true,
        user_metadata: { role, instituicao, nome, must_change_password: true }
      })
    });

    const authData = await authResp.json();

    if (!authResp.ok) {
      if (authData.msg && authData.msg.includes('already been registered')) {
        const listResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, {
          headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` }
        });
        const listData = await listResp.json();
        const existingUser = listData.users?.[0];
        if (existingUser) {
          await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${existingUser.id}`, {
            method: 'PUT',
            headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_metadata: { role, instituicao, nome, must_change_password: true } })
          });
        }
      } else {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: authData.msg || authData.error_description || 'Erro ao criar usuário no Auth' }) };
      }
    }

    // 2. Inserir na whitelist
    const whitelistResp = await fetch(`${SUPABASE_URL}/rest/v1/usuarios_autorizados`, {
      method: 'POST',
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=representation'
      },
      body: JSON.stringify({ email, nome, instituicao, role, ativo: true })
    });

    let whitelistData;
    try { whitelistData = await whitelistResp.json(); } catch(_) { whitelistData = []; }

    if (!whitelistResp.ok) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Usuário criado no Auth mas erro na whitelist: ' + JSON.stringify(whitelistData) }) };
    }

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true, message: `Usuário ${email} criado com sucesso!` }) };

  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Erro interno: ' + err.message }) };
  }
};
