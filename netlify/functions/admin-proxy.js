// Netlify Function: admin-proxy
// Proxy seguro para operações admin no Supabase
// Valida JWT do usuário → verifica role admin/superadmin → executa com service_role
// NUNCA expõe a service_role key no frontend

const SUPABASE_URL = 'https://cvwwucxjrpsfoxarsipr.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2d3d1Y3hqcnBzZm94YXJzaXByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMDIxMzgsImV4cCI6MjA5MDg3ODEzOH0.GdpReqo9giSC607JQge8HA9CmZWi-2TcVggU4jCwZhI';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2d3d1Y3hqcnBzZm94YXJzaXByIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTMwMjEzOCwiZXhwIjoyMDkwODc4MTM4fQ.M6ZGpySPaj1ecL9rXS3q9UM4FnfD6Cz3eA0tFWqHi4c';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

// Tabelas permitidas (whitelist — impede acesso a tabelas arbitrárias)
const ALLOWED_TABLES = new Set([
  'alunos_master', 'excluidos_master', 'usuarios_autorizados',
  'simulado_respostas', 'simulados_banco', 'simulados_envios',
  'instituicoes', 'dashboard_engajamento', 'atividades_contrato',
  'alunos_faltantes_simulado', 'avisos'
]);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // 1. Extrair e validar JWT do usuário
  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const userToken = authHeader.replace(/^Bearer\s+/i, '');

  if (!userToken) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Token não fornecido' }) };
  }

  try {
    // 2. Validar token com Supabase Auth (verifica se é válido e pega user_metadata)
    const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'apikey': ANON_KEY,
        'Authorization': `Bearer ${userToken}`
      }
    });

    if (!userResp.ok) {
      return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Token inválido ou expirado' }) };
    }

    const user = await userResp.json();
    const role = user.user_metadata?.role;

    // 3. Verificar permissão (apenas admin e superadmin)
    if (role !== 'admin' && role !== 'superadmin') {
      return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'Acesso negado — apenas admin/superadmin' }) };
    }

    // 4. Parsear request
    let payload;
    try {
      payload = JSON.parse(event.body);
    } catch {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'JSON inválido' }) };
    }

    const { table, method, query, body, prefer } = payload;

    if (!table) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Campo table obrigatório' }) };
    }

    // 5. Validar tabela (whitelist)
    const tableName = table.split('?')[0].split('/')[0];
    if (!ALLOWED_TABLES.has(tableName)) {
      return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: `Tabela "${tableName}" não permitida` }) };
    }

    // 6. Executar operação com service_role
    const httpMethod = (method || 'GET').toUpperCase();
    const url = `${SUPABASE_URL}/rest/v1/${table}${query ? (table.includes('?') ? '&' : '?') + query : ''}`;

    const headers = {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json'
    };

    // Repassar Prefer header se fornecido
    if (prefer) {
      headers['Prefer'] = prefer;
    } else if (httpMethod === 'POST') {
      headers['Prefer'] = 'return=representation,resolution=merge-duplicates';
    } else if (httpMethod === 'GET') {
      // GET padrão — sem Prefer especial
    } else {
      headers['Prefer'] = 'return=representation';
    }

    const fetchOpts = { method: httpMethod, headers };
    if (body && httpMethod !== 'GET') {
      fetchOpts.body = JSON.stringify(body);
    }

    const supaResp = await fetch(url, fetchOpts);
    const supaBody = await supaResp.text();

    // 7. Repassar response headers importantes
    const respHeaders = {
      ...CORS,
      'Content-Type': 'application/json'
    };
    const contentRange = supaResp.headers.get('Content-Range');
    if (contentRange) respHeaders['Content-Range'] = contentRange;

    return {
      statusCode: supaResp.status,
      headers: respHeaders,
      body: supaBody
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'Erro interno: ' + err.message })
    };
  }
};
