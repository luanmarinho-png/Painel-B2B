// Netlify Function: list-auth-users
// Lista usuários do Supabase Auth com validação de permissão
// Retorna apenas dados necessários (email, metadata), sem dados sensíveis

const SUPABASE_URL = 'https://cvwwucxjrpsfoxarsipr.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2d3d1Y3hqcnBzZm94YXJzaXByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMDIxMzgsImV4cCI6MjA5MDg3ODEzOH0.GdpReqo9giSC607JQge8HA9CmZWi-2TcVggU4jCwZhI';
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

  // 1. Validar JWT
  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const userToken = authHeader.replace(/^Bearer\s+/i, '');

  if (!userToken) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Token não fornecido' }) };
  }

  try {
    const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': ANON_KEY, 'Authorization': `Bearer ${userToken}` }
    });

    if (!userResp.ok) {
      return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Token inválido' }) };
    }

    const user = await userResp.json();
    const role = user.user_metadata?.role;

    if (role !== 'admin' && role !== 'superadmin') {
      return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'Acesso negado' }) };
    }

    // 2. Buscar parâmetros
    let params = {};
    try { params = JSON.parse(event.body || '{}'); } catch { params = {}; }
    const { email } = params; // filtro opcional por email

    // 3. Buscar users do Auth (com service_role)
    let url = `${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`;
    const authResp = await fetch(url, {
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` }
    });

    if (!authResp.ok) {
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Erro ao buscar users' }) };
    }

    const data = await authResp.json();
    let users = (data.users || []).map(u => ({
      email: u.email,
      id: u.id,
      role: u.user_metadata?.role || '',
      instituicao: u.user_metadata?.instituicao || '',
      nome: u.user_metadata?.nome || '',
      instituicoes_responsavel: u.user_metadata?.instituicoes_responsavel || [],
      created_at: u.created_at
    }));

    // Filtrar por email se fornecido
    if (email) {
      users = users.filter(u => u.email === email);
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ users })
    };

  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Erro interno: ' + err.message }) };
  }
};
