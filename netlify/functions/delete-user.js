// Netlify Function: delete-user
// Remove usuário do Supabase Auth e da tabela usuarios_autorizados
// Usa service_role key no servidor — nunca exposta no frontend

const SUPABASE_URL = 'https://cvwwucxjrpsfoxarsipr.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2d3d1Y3hqcnBzZm94YXJzaXByIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTMwMjEzOCwiZXhwIjoyMDkwODc4MTM4fQ.M6ZGpySPaj1ecL9rXS3q9UM4FnfD6Cz3eA0tFWqHi4c';

exports.handler = async (event) => {
  // Tratar preflight CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      },
      body: ''
    };
  }

  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { email } = body;
  if (!email) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Campo email é obrigatório' }) };
  }

  try {
    // 1. Buscar o user_id pelo email no Supabase Auth
    const listResp = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`,
      {
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`
        }
      }
    );

    const listData = await listResp.json();
    const user = (listData.users || []).find(u => u.email === email);

    // 2. Deletar do Supabase Auth (se existir)
    if (user) {
      const deleteAuthResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
        method: 'DELETE',
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`
        }
      });

      if (!deleteAuthResp.ok) {
        const errData = await deleteAuthResp.json();
        console.error('Erro ao deletar do Auth:', errData);
        // Continua mesmo com erro no Auth para limpar a whitelist
      }
    }

    // 3. Deletar da tabela usuarios_autorizados (whitelist)
    const deleteWhitelistResp = await fetch(
      `${SUPABASE_URL}/rest/v1/usuarios_autorizados?email=eq.${encodeURIComponent(email)}`,
      {
        method: 'DELETE',
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Prefer': 'return=representation'
        }
      }
    );

    if (!deleteWhitelistResp.ok) {
      const errData = await deleteWhitelistResp.json();
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Erro ao remover da whitelist: ' + JSON.stringify(errData) }) };
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ success: true, message: `Usuário ${email} removido com sucesso.` })
    };

  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Erro interno: ' + err.message }) };
  }
};
