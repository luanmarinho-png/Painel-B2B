// Netlify Function: update-user
// Atualiza role, instituicao e ativo na whitelist E no user_metadata do Supabase Auth
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
  // Tratar preflight CORS
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

  const { email, role, instituicao, ativo, nome, password, instituicoes_responsavel } = body;

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

    if (user) {
      // 2. Atualizar user_metadata no Supabase Auth
      const updateResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
        method: 'PUT',
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          user_metadata: {
            ...user.user_metadata,
            role: role !== undefined ? role : user.user_metadata?.role,
            instituicao: instituicao !== undefined ? instituicao : user.user_metadata?.instituicao,
            nome: nome !== undefined ? nome : user.user_metadata?.nome,
            instituicoes_responsavel: instituicoes_responsavel !== undefined ? instituicoes_responsavel : user.user_metadata?.instituicoes_responsavel
          },
          // Se inativo, banir o usuário no Auth também
          ...(ativo === false ? { ban_duration: '876600h' } : { ban_duration: 'none' }),
          // Redefinir senha se fornecida
          ...(password ? { password } : {})
        })
      });

      if (!updateResp.ok) {
        const errData = await updateResp.json();
        console.error('Erro ao atualizar Auth:', errData);
        // Se a senha falhou, retornar erro ao frontend
        if (password && errData.msg) {
          return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Erro ao atualizar senha: ' + errData.msg }) };
        }
      }
    }

    // 3. Atualizar na tabela usuarios_autorizados (whitelist)
    const updateFields = {};
    if (role !== undefined) updateFields.role = role;
    if (instituicao !== undefined) updateFields.instituicao = instituicao;
    if (ativo !== undefined) updateFields.ativo = ativo;
    if (nome !== undefined) updateFields.nome = nome;

    // Campos básicos
    const whitelistResp = await fetch(
      `${SUPABASE_URL}/rest/v1/usuarios_autorizados?email=eq.${encodeURIComponent(email)}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(updateFields)
      }
    );

    let whitelistData;
    try { whitelistData = await whitelistResp.json(); } catch(_) { whitelistData = []; }

    if (!whitelistResp.ok) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Erro na whitelist: ' + JSON.stringify(whitelistData) }) };
    }

    // instituicoes_responsavel — campo opcional (pode não existir na tabela ainda)
    if (instituicoes_responsavel !== undefined) {
      try {
        await fetch(
          `${SUPABASE_URL}/rest/v1/usuarios_autorizados?email=eq.${encodeURIComponent(email)}`,
          {
            method: 'PATCH',
            headers: {
              'apikey': SERVICE_KEY,
              'Authorization': `Bearer ${SERVICE_KEY}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal'
            },
            body: JSON.stringify({ instituicoes_responsavel })
          }
        );
      } catch(_) { /* coluna pode não existir — ignorar */ }
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ success: true, message: `Usuário ${email} atualizado com sucesso!` })
    };

  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Erro interno: ' + err.message }) };
  }
};
