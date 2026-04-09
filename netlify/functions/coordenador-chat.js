/**
 * Netlify Function: assistente do coordenador (OpenAI) com validação de sessão Supabase.
 * A chave OPENAI_API_KEY existe apenas no ambiente do Netlify (nunca no browser).
 */

const SUPABASE_URL = 'https://cvwwucxjrpsfoxarsipr.supabase.co';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2d3d1Y3hqcnBzZm94YXJzaXByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMDIxMzgsImV4cCI6MjA5MDg3ODEzOH0.GdpReqo9giSC607JQge8HA9CmZWi-2TcVggU4jCwZhI';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

const MAX_CONTEXT_CHARS = 18000;
const MAX_USER_MESSAGES = 12;

/**
 * Valida JWT do usuário e permissão (coordenador da IES ou admin).
 * @param {string} userToken
 * @param {string} iesSlug
 * @returns {Promise<{ ok: boolean, error?: string, status?: number }>}
 */
async function validateCoordinatorAccess(userToken, iesSlug) {
  if (!userToken) {
    return { ok: false, status: 401, error: 'Token não fornecido' };
  }

  const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${userToken}`
    }
  });

  if (!userResp.ok) {
    return { ok: false, status: 401, error: 'Sessão inválida ou expirada' };
  }

  const user = await userResp.json();
  const meta = user.user_metadata || {};
  const role = meta.role;
  const inst = (meta.instituicao || '').trim();

  if (role === 'admin' || role === 'superadmin') {
    return { ok: true };
  }

  if (role === 'coordenador' && iesSlug && inst === iesSlug) {
    return { ok: true };
  }

  return { ok: false, status: 403, error: 'Acesso negado — apenas coordenadores autenticados' };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  if (event.httpMethod === 'GET') {
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, name: 'coordenador-chat' })
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey = process.env.OPENAI_API_KEY || process.env.openai_api_key;
  if (!apiKey) {
    return {
      statusCode: 503,
      headers: CORS,
      body: JSON.stringify({ error: 'Assistente indisponível: configure OPENAI_API_KEY no Netlify.' })
    };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const userToken = authHeader.replace(/^Bearer\s+/i, '');

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'JSON inválido' }) };
  }

  const { messages, context: clientContext, ies_slug: iesSlug } = payload;
  if (!Array.isArray(messages) || !messages.length) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'messages é obrigatório' }) };
  }

  const slug = typeof iesSlug === 'string' ? iesSlug.trim() : '';
  const access = await validateCoordinatorAccess(userToken, slug);
  if (!access.ok) {
    return {
      statusCode: access.status || 403,
      headers: CORS,
      body: JSON.stringify({ error: access.error || 'Acesso negado' })
    };
  }

  const safeMessages = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_USER_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.trim().slice(0, 12000) }));

  if (!safeMessages.length) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Nenhuma mensagem válida' }) };
  }

  let contextStr = '';
  try {
    contextStr =
      typeof clientContext === 'object' && clientContext !== null
        ? JSON.stringify(clientContext)
        : String(clientContext || '');
  } catch {
    contextStr = '';
  }
  if (contextStr.length > MAX_CONTEXT_CHARS) {
    contextStr = contextStr.slice(0, MAX_CONTEXT_CHARS) + '\n...[contexto truncado]';
  }

  const systemPrompt = `Você é o assistente pedagógico do painel MedCof para coordenadores de IES (medicina).
Regras:
- Responda em português do Brasil, tom profissional e objetivo.
- Use APENAS os dados fornecidos no JSON "contextoDaTela" abaixo para falar de alunos, notas, turmas ou engajamento. Se algo não estiver no contexto, diga que não há esse dado na tela e sugira onde o coordenador pode encontrar no painel (Engajamento, Período detalhado, Simulados).
- Não invente nomes de alunos nem números que não apareçam no contexto.
- Para insights, priorize: (1) alunos ou temas com pior desempenho, (2) dispersão e médias, (3) ações práticas para reuniões com a turma.
- Não revele detalhes técnicos de implementação nem mencione "prompt" ou "API".

contextoDaTela (JSON):
${contextStr || '{}'}`;

  const openaiBody = {
    model: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
    messages: [{ role: 'system', content: systemPrompt }, ...safeMessages],
    max_tokens: 1100,
    temperature: 0.35
  };

  let openaiRes;
  try {
    openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(openaiBody)
    });
  } catch (e) {
    return {
      statusCode: 502,
      headers: CORS,
      body: JSON.stringify({ error: 'Falha ao contatar o serviço de IA' })
    };
  }

  const data = await openaiRes.json().catch(() => ({}));
  if (!openaiRes.ok) {
    const errMsg = data?.error?.message || data?.error || 'Erro OpenAI';
    return {
      statusCode: 502,
      headers: CORS,
      body: JSON.stringify({ error: String(errMsg).slice(0, 500) })
    };
  }

  const reply = data?.choices?.[0]?.message?.content?.trim() || '';
  if (!reply) {
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: 'Resposta vazia da IA' }) };
  }

  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reply })
  };
};
