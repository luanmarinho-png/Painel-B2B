/**
 * Netlify Function: assistente do coordenador (OpenAI) com validação de sessão Supabase.
 * A chave OPENAI_API_KEY existe apenas no ambiente do Netlify (nunca no browser).
 */

const SUPABASE_URL = 'https://cvwwucxjrpsfoxarsipr.supabase.co';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2d3d1Y3hqcnBzZm94YXJzaXByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMDIxMzgsImV4cCI6MjA5MDg3ODEzOH0.GdpReqo9giSC607JQge8HA9CmZWi-2TcVggU4jCwZhI';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  // Não exigir Authorization: Netlify trata Bearer como Netlify Identity e rejeita JWT do Supabase ("valid issuer").
  'Access-Control-Allow-Headers': 'Content-Type'
};

const MAX_CONTEXT_CHARS = 18000;
const MAX_USER_MESSAGES = 12;

/**
 * Chaves secretas da OpenAI começam com "sk-". Se colar anon JWT do Supabase (eyJ...) a API responde:
 * "Your authentication token is not from a valid issuer."
 * @param {string | undefined} key
 * @returns {boolean}
 */
function isPlausibleOpenAiSecretKey(key) {
  if (!key || typeof key !== 'string') return false;
  return key.trim().startsWith('sk-');
}

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
    const hasKey = !!(process.env.OPENAI_API_KEY || process.env.openai_api_key);
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        name: 'coordenador-chat',
        openaiKeyConfigured: hasKey
      })
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
      body: JSON.stringify({
        error:
          'OPENAI_API_KEY não chegou na function. No Netlify: Site → Environment variables → edite OPENAI_API_KEY e marque o escopo Functions (ou “All scopes”). Só “Builds” não injeta nas serverless functions. Depois faça um novo deploy. Teste: GET /.netlify/functions/coordenador-chat deve mostrar openaiKeyConfigured:true.'
      })
    };
  }
  if (!isPlausibleOpenAiSecretKey(apiKey)) {
    return {
      statusCode: 503,
      headers: CORS,
      body: JSON.stringify({
        error:
          'OPENAI_API_KEY incorreta: use uma chave secreta da OpenAI (começa com sk-), criada em https://platform.openai.com/api-keys . Não use chave do Supabase nem JWT.'
      })
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'JSON inválido' }) };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const fromBody =
    typeof payload.supabase_access_token === 'string' ? payload.supabase_access_token.trim() : '';
  const userToken =
    fromBody || authHeader.replace(/^Bearer\s+/i, '').trim();
  delete payload.supabase_access_token;

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

  const systemPrompt = `Você é um mentor pedagógico do painel MedCof para coordenadores de IES (medicina), com foco na preparação para a prova ENAMED e no acompanhamento da turma.
Regras:
- Responda em português do Brasil, tom profissional, acolhedor e objetivo.
- Use APENAS os dados do JSON "contextoDaTela" abaixo para falar de alunos, notas, turmas ou engajamento. Se algo não estiver no contexto, diga que não há esse dado na tela e sugira onde encontrar (Engajamento, Período detalhado, Simulados).
- Não invente nomes de alunos nem números que não apareçam no contexto.
- Meta operacional MedCof: cerca de 20 questões por dia na plataforma é a referência de engajamento ideal — use quando "questoesDia" ou orientacaoMedCof estiver no contexto; não invente valores.
- Quando houver dados de simulado e de engajamento no contexto (ou na conversa), ajude a correlacionar desempenho em simulados com hábitos de estudo/engajamento, sem afirmar causalidade estatística.
- Priorize: (1) alunos ou temas com pior desempenho, (2) dispersão e médias, (3) ações práticas para reuniões e acompanhamento.
- Não revele detalhes técnicos de implementação nem mencione "prompt" ou "API".

Você DEVE responder em JSON válido (objeto) com exatamente estas chaves:
- "reply": string, resposta principal ao coordenador (pode usar parágrafos curtos).
- "follow_up_questions": array de 2 a 3 strings, perguntas curtas que o coordenador pode clicar para continuar o diálogo (relacionadas à resposta e ao contexto).
- "insight": string opcional, uma linha com um insight acionável (ou string vazia se não couber).

contextoDaTela (JSON):
${contextStr || '{}'}`;

  const openaiBody = {
    model: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
    messages: [{ role: 'system', content: systemPrompt }, ...safeMessages],
    max_tokens: 1400,
    temperature: 0.35,
    response_format: { type: 'json_object' }
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
    let errMsg = data?.error?.message || data?.error || 'Erro OpenAI';
    if (String(errMsg).includes('valid issuer')) {
      errMsg =
        'Chave da OpenAI inválida (a API espera sk-..., não um JWT). Ajuste OPENAI_API_KEY no Netlify com uma secret key de https://platform.openai.com/api-keys';
    }
    return {
      statusCode: 502,
      headers: CORS,
      body: JSON.stringify({ error: String(errMsg).slice(0, 500) })
    };
  }

  const rawContent = data?.choices?.[0]?.message?.content?.trim() || '';
  const parsed = parseAssistantPayload(rawContent);
  if (!parsed.reply) {
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: 'Resposta vazia da IA' }) };
  }

  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reply: parsed.reply,
      follow_up_questions: parsed.follow_up_questions,
      insight: parsed.insight || undefined
    })
  };
};

/**
 * Extrai reply, follow-ups e insight do JSON do modelo; fallback para texto puro.
 * @param {string} raw
 * @returns {{ reply: string, follow_up_questions: string[], insight: string }}
 */
function parseAssistantPayload(raw) {
  const s = String(raw || '').trim();
  if (!s) return { reply: '', follow_up_questions: [], insight: '' };
  let jsonStr = s;
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(s);
  if (fence) jsonStr = fence[1].trim();
  try {
    const o = JSON.parse(jsonStr);
    const reply = typeof o.reply === 'string' ? o.reply.trim() : '';
    const follow = Array.isArray(o.follow_up_questions)
      ? o.follow_up_questions
          .filter((x) => typeof x === 'string' && x.trim())
          .slice(0, 5)
          .map((x) => x.trim())
      : [];
    const insight = typeof o.insight === 'string' ? o.insight.trim().slice(0, 400) : '';
    if (reply) return { reply, follow_up_questions: follow, insight };
  } catch (_) {
    /* fallback abaixo */
  }
  return { reply: s, follow_up_questions: [], insight: '' };
}
