/**
 * Netlify Function: Cofbot — mentor ENAMED + contexto Supabase por IES (OpenAI + validação Supabase).
 *
 * Variáveis de ambiente (Netlify → Site → Environment variables → escopo Functions):
 * - OPENAI_API_KEY (obrigatória): chave secreta sk-... da OpenAI.
 * - SUPABASE_SERVICE_ROLE_KEY (recomendada): service_role do Supabase — usada só no servidor para
 *   resumir dashboard_engajamento e amostra de alunos_master da IES; sem ela o chat usa só contextoDaTela.
 * - COFBOT_KNOWLEDGE_SNIPPET (opcional): texto fixo (ex.: referências ENAMED, conceito 5) até ~6k caracteres.
 * - OPENAI_CHAT_MODEL (opcional): padrão gpt-4o-mini.
 * - COFBOT_OPENAI_TIMEOUT_MS (opcional): timeout da chamada OpenAI em ms (padrão 52000, máx. 58000).
 */

const { getSupabaseEnv } = require('./server/infrastructure/config/supabaseEnv');
const { isMongoDataBackend } = require('./server/infrastructure/mongo/isMongoData');
const { executePostgrestMongo } = require('./server/infrastructure/mongo/postgrestMongoAdapter');
const { validateCoordinatorAccess } = require('./coordinatorAuth');
const { url: SUPABASE_URL, anonKey: ANON_KEY } = getSupabaseEnv();

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  // Não exigir Authorization: Netlify trata Bearer como Netlify Identity e rejeita JWT do Supabase ("valid issuer").
  'Access-Control-Allow-Headers': 'Content-Type'
};

/** Tamanho máximo do JSON contextoDaTela (browser). */
const MAX_CONTEXT_CHARS = 14000;
/** Tamanho máximo do bloco dadosSupabaseIES após serialização. */
const MAX_SUPABASE_CONTEXT_CHARS = 7000;
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
 * Remove padrões de CPF e campos sensíveis do texto de contexto antes do envio ao modelo.
 * @param {string} s
 * @returns {string}
 */
function redactSensitiveContextString(s) {
  let t = String(s || '');
  t = t.replace(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[omitido]');
  try {
    const o = JSON.parse(t);
    const drop = /^(cpf|documento|rg|email|telefone|phone|tel|senha|password)$/i;
    const walk = (v) => {
      if (v == null) return v;
      if (Array.isArray(v)) return v.map(walk);
      if (typeof v === 'object') {
        const out = {};
        for (const [k, val] of Object.entries(v)) {
          if (drop.test(k)) continue;
          out[k] = walk(val);
        }
        return out;
      }
      if (typeof v === 'string') return v.replace(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[omitido]');
      return v;
    };
    return JSON.stringify(walk(o));
  } catch {
    return t;
  }
}

/**
 * Traduz mensagens técnicas da OpenAI para o tom MedCof (claro para o coordenador).
 * @param {string} raw
 * @returns {string}
 */
function friendlyOpenAiApiError(raw) {
  const s = String(raw || '').toLowerCase();
  if (s.includes('rate limit') || s.includes('too many requests')) {
    return 'O Cofbot está com alta demanda no momento. Aguarde um instante e envie de novo — estamos com você.';
  }
  if (s.includes('insufficient_quota') || s.includes('billing hard limit')) {
    return 'Cofbot está temporariamente indisponível. Fale com o time MedCof para retomarmos o suporte à sua instituição.';
  }
  if (s.includes('invalid_api_key') || s.includes('incorrect api key')) {
    return 'Cofbot não pôde ser ativado. O time MedCof vai ajustar a configuração técnica.';
  }
  if (s.includes('context_length') || s.includes('maximum context')) {
    return 'Sua pergunta ou os dados da tela ficaram extensos demais. Tente ser mais objetivo ou atualize a página.';
  }
  return String(raw).slice(0, 500);
}

/**
 * Resume uma linha dashboard_engajamento para o prompt (sem payload completo).
 * @param {{ payload?: object, updated_at?: string }} row
 * @returns {Record<string, unknown>}
 */
function summarizeDashboardEngajamentoRow(row) {
  const updated_at = row.updated_at || null;
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  const allData = payload.allData;
  if (!Array.isArray(allData) || !allData.length) {
    return { updated_at, periodos: 0, alunosNomesUnicos: 0, nota: 'sem allData no payload' };
  }
  const uniq = new Set();
  allData.forEach((entry) => {
    (entry.alunos || entry.data || []).forEach((a) => {
      if (a && a.nome) uniq.add(String(a.nome).trim().toLowerCase());
    });
  });
  return {
    updated_at,
    periodos: allData.length,
    alunosNomesUnicos: uniq.size
  };
}

/**
 * Busca resumo Supabase da IES (engajamento + cadastro) com service_role — só após JWT válido.
 * @param {string} slug
 * @param {string} institutionName nome da IES no painel (ajuda filtro instituicao em alunos_master)
 * @returns {Promise<Record<string, unknown>>}
 */
async function fetchCofbotIesData(slug, institutionName) {
  if (isMongoDataBackend()) {
    /** @type {Record<string, unknown>} */
    const out = { disponivel: true, ies_slug: slug };
    try {
      const eng = await executePostgrestMongo({
        table: 'dashboard_engajamento',
        query: `select=payload,updated_at&ies_slug=eq.${encodeURIComponent(slug)}&limit=1`,
        method: 'GET',
        body: null,
        prefer: null,
        range: null,
        maskSensitive: false
      });
      if (eng.statusCode === 200 && eng.body) {
        const rows = JSON.parse(eng.body);
        const row = Array.isArray(rows) ? rows[0] : null;
        if (row) out.engajamentoResumo = summarizeDashboardEngajamentoRow(row);
      } else {
        out.erroEngajamento = `http_${eng.statusCode}`;
      }
    } catch (e) {
      out.erroEngajamento = String(e && e.message ? e.message : e);
    }
    try {
      const name = (institutionName || '').trim();
      let q = `select=nome,turma,codigo_aluno,instituicao&limit=500`;
      if (name && name !== slug) {
        q += `&or=(instituicao.eq.${encodeURIComponent(slug)},instituicao.eq.${encodeURIComponent(name)})`;
      } else {
        q += `&instituicao=eq.${encodeURIComponent(slug)}`;
      }
      const al = await executePostgrestMongo({
        table: 'alunos_master',
        query: q,
        method: 'GET',
        body: null,
        prefer: null,
        range: null,
        maskSensitive: false
      });
      if (al.statusCode === 200 && al.body) {
        const rows = JSON.parse(al.body);
        const list = Array.isArray(rows) ? rows : [];
        out.cadastroAlunos = { totalRetornado: list.length, amostra: list.slice(0, 120) };
      } else {
        out.erroAlunos = `http_${al.statusCode}`;
      }
    } catch (e) {
      out.erroAlunos = String(e && e.message ? e.message : e);
    }
    return out;
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!serviceKey || !slug) {
    return { disponivel: false, motivo: serviceKey ? 'slug_vazio' : 'SUPABASE_SERVICE_ROLE_KEY não configurada' };
  }

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json'
  };

  const fetchEngajamento = async () => {
    /** @type {Record<string, unknown>} */
    const partial = {};
    try {
      const u = `${SUPABASE_URL}/rest/v1/dashboard_engajamento?select=payload,updated_at&ies_slug=eq.${encodeURIComponent(
        slug
      )}&limit=1`;
      const r = await fetch(u, { headers });
      if (r.ok) {
        const rows = await r.json();
        const row = rows[0];
        if (row) partial.engajamentoResumo = summarizeDashboardEngajamentoRow(row);
      } else {
        partial.erroEngajamento = `http_${r.status}`;
      }
    } catch (e) {
      partial.erroEngajamento = String(e && e.message ? e.message : e);
    }
    return partial;
  };

  const fetchAlunos = async () => {
    /** @type {Record<string, unknown>} */
    const partial = {};
    try {
      const name = (institutionName || '').trim();
      let url = `${SUPABASE_URL}/rest/v1/alunos_master?select=nome,turma,codigo_aluno,instituicao&limit=500`;
      if (name && name !== slug) {
        url += `&or=(instituicao.eq.${encodeURIComponent(slug)},instituicao.eq.${encodeURIComponent(name)})`;
      } else {
        url += `&instituicao=eq.${encodeURIComponent(slug)}`;
      }
      const r2 = await fetch(url, { headers });
      if (r2.ok) {
        const rows = await r2.json();
        const list = Array.isArray(rows) ? rows : [];
        partial.cadastroAlunos = {
          totalRetornado: list.length,
          amostra: list.slice(0, 120)
        };
      } else {
        partial.erroAlunos = `http_${r2.status}`;
      }
    } catch (e) {
      partial.erroAlunos = String(e && e.message ? e.message : e);
    }
    return partial;
  };

  const [e1, e2] = await Promise.all([fetchEngajamento(), fetchAlunos()]);
  return {
    disponivel: true,
    ies_slug: slug,
    ...e1,
    ...e2
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  if (event.httpMethod === 'GET') {
    const hasKey = !!(process.env.OPENAI_API_KEY || process.env.openai_api_key);
    const hasServiceRole = !!(
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
    );
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        name: 'coordenador-chat',
        openaiKeyConfigured: hasKey,
        supabaseServiceRoleConfigured: hasServiceRole
      })
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: CORS,
      body: JSON.stringify({ error: 'Esta operação não está disponível por aqui.' })
    };
  }

  try {
  const apiKey = process.env.OPENAI_API_KEY || process.env.openai_api_key;
  if (!apiKey) {
    return {
      statusCode: 503,
      headers: CORS,
      body: JSON.stringify({
        error:
          'Cofbot ainda não foi habilitado neste ambiente. O time MedCof cuida da integração no deploy — se precisar, fale conosco pelo canal de suporte.'
      })
    };
  }
  if (!isPlausibleOpenAiSecretKey(apiKey)) {
    return {
      statusCode: 503,
      headers: CORS,
      body: JSON.stringify({
        error:
          'A integração do Cofbot precisa de um ajuste técnico no servidor. O time MedCof corrige isso na configuração do painel.'
      })
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({
        error: 'Algo saiu do esperado ao enviar sua mensagem. Atualize a página e tente outra vez.'
      })
    };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const fromBody =
    typeof payload.supabase_access_token === 'string' ? payload.supabase_access_token.trim() : '';
  const userToken =
    fromBody || authHeader.replace(/^Bearer\s+/i, '').trim();
  delete payload.supabase_access_token;

  const { messages, context: clientContext, ies_slug: iesSlug } = payload;
  if (!Array.isArray(messages) || !messages.length) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({
        error: 'Escreva uma pergunta para o Cofbot — ele usa o que você vê no painel para orientar sua gestão.'
      })
    };
  }

  const slug = typeof iesSlug === 'string' ? iesSlug.trim() : '';
  const access = await validateCoordinatorAccess(userToken, slug);
  if (!access.ok) {
    return {
      statusCode: access.status || 403,
      headers: CORS,
      body: JSON.stringify({
        error:
          access.error ||
          'Não foi possível liberar o Cofbot neste acesso. Confirme que está no painel correto da sua instituição.'
      })
    };
  }

  const institutionName =
    clientContext &&
    typeof clientContext === 'object' &&
    clientContext.institution &&
    typeof clientContext.institution.name === 'string'
      ? clientContext.institution.name.trim()
      : '';

  /** @type {Record<string, unknown>} */
  let dadosSupabaseIES = { disponivel: false, motivo: 'não carregado' };
  try {
    dadosSupabaseIES = await fetchCofbotIesData(slug, institutionName);
  } catch (e) {
    dadosSupabaseIES = { disponivel: false, erro: String(e && e.message ? e.message : e) };
  }

  const safeMessages = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_USER_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.trim().slice(0, 12000) }));

  if (!safeMessages.length) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({
        error: 'Envie sua dúvida em texto para o Cofbot analisar com base na tela atual.'
      })
    };
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

  contextStr = redactSensitiveContextString(contextStr);

  let supabaseStr = '';
  try {
    supabaseStr = JSON.stringify(dadosSupabaseIES);
  } catch {
    supabaseStr = '{}';
  }
  supabaseStr = redactSensitiveContextString(supabaseStr);
  if (supabaseStr.length > MAX_SUPABASE_CONTEXT_CHARS) {
    supabaseStr = supabaseStr.slice(0, MAX_SUPABASE_CONTEXT_CHARS) + '\n...[dadosSupabase truncado]';
  }

  const iesAutorizada = slug;
  const papelUsuario = access.role || 'desconhecido';
  const regraAdmin =
    papelUsuario === 'admin' || papelUsuario === 'superadmin'
      ? '- Você está atendendo APENAS a IES identificada por ies_slug autorizado abaixo. Não compare com outras instituições nem use dados de outras IES.\n'
      : '';

  const systemPrompt = `Você é o Cofbot: mentor especializado na prova ENAMED e no uso da plataforma MedCof para cursos de medicina.
Papel:
- Ajude coordenadores a relacionar hábitos de estudo na MedCof (volume de questões, consistência, simulados) com caminhos para melhorar desempenho da turma rumo à proficiência e ao bom desempenho institucional no ENAMED.
- Explique de forma prática como a rotina na plataforma pode apoiar metas como elevar proficiência média e fortalecer indicadores institucionais (ex.: conceito 5 no ENAMED), SEM inventar cortes oficiais, datas de prova ou regras do INEP — quando precisar de número oficial, diga que o coordenador deve confirmar na fonte INEP ou use apenas o que estiver em "conhecimentoFixo" abaixo.
- Conecte sempre que fizer sentido: meta operacional MedCof (~20 questões/dia como referência de engajamento), desempenho em simulados e leitura por período — sem afirmar causalidade estatística onde não houver dado.

Regras de dados e escopo:
- Use SOMENTE os JSONs "contextoDaTela" e "dadosSupabaseIES" abaixo, todos referentes à IES com ies_slug="${iesAutorizada}". Não fale de outra instituição.
${regraAdmin}- Se um dado não existir nesses JSONs, diga que não há na base enviada e sugira telas do painel (Engajamento, Período detalhado, Simulados) quando útil.
- NUNCA solicite, infira nem mencione dados pessoais sensíveis (CPF, documento, e-mail, telefone, endereço, senha). Se pedirem, recuse educadamente e use apenas nome/turma/código (se existir) e métricas agregadas.
- Não invente nomes de alunos nem números que não apareçam nos JSONs.
- Não revele detalhes técnicos de implementação nem mencione "prompt" ou "API".

Responda em português do Brasil, no tom MedCof: profissional, acolhedor e objetivo, como no painel institucional da sua parceria com a plataforma.

Você DEVE responder em JSON válido (objeto) com exatamente estas chaves:
- "reply": string, resposta principal ao coordenador (pode usar parágrafos curtos).
- "follow_up_questions": array de 2 a 3 strings, perguntas curtas que o coordenador pode clicar para continuar o diálogo (relacionadas à resposta e ao contexto).
- "insight": string opcional, uma linha com um insight acionável (ou string vazia se não couber).

contextoDaTela (JSON — o que o coordenador está vendo agora):
${contextStr || '{}'}

dadosSupabaseIES (JSON — resumo da mesma IES no servidor; pode estar parcial se houver erro de leitura):
${supabaseStr || '{}'}
${process.env.COFBOT_KNOWLEDGE_SNIPPET ? `\nconhecimentoFixo (texto operacional ENAMED/MedCof — não substitui os JSONs acima):\n${String(process.env.COFBOT_KNOWLEDGE_SNIPPET).slice(0, 6000)}` : ''}`;

  const rawTimeout = Number(process.env.COFBOT_OPENAI_TIMEOUT_MS);
  const openaiTimeoutMs = Number.isFinite(rawTimeout)
    ? Math.min(Math.max(rawTimeout, 15000), 58000)
    : 52000;
  const openaiSignal =
    typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(openaiTimeoutMs)
      : undefined;

  const openaiBody = {
    model: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
    messages: [{ role: 'system', content: systemPrompt }, ...safeMessages],
    max_tokens: 1000,
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
      body: JSON.stringify(openaiBody),
      signal: openaiSignal
    });
  } catch (e) {
    const aborted =
      e &&
      (e.name === 'AbortError' ||
        e.name === 'TimeoutError' ||
        (typeof e.code === 'string' && e.code === 'ABORT_ERR'));
    return {
      statusCode: aborted ? 504 : 502,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: aborted
          ? 'A resposta do Cofbot levou mais tempo que o esperado. Tente uma pergunta mais direta ou envie de novo em instantes.'
          : 'Não conseguimos conectar ao Cofbot agora. Confira sua internet e tente novamente — estamos por aqui.'
      })
    };
  }

  const data = await openaiRes.json().catch(() => ({}));
  if (!openaiRes.ok) {
    let errMsg = data?.error?.message || data?.error || 'Erro OpenAI';
    if (String(errMsg).includes('valid issuer')) {
      errMsg = 'A configuração técnica do Cofbot precisa de um ajuste no time MedCof.';
    } else {
      errMsg = friendlyOpenAiApiError(errMsg);
    }
    return {
      statusCode: 502,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: errMsg })
    };
  }

  const rawContent = data?.choices?.[0]?.message?.content?.trim() || '';
  const parsed = parseAssistantPayload(rawContent);
  if (!parsed.reply) {
    return {
      statusCode: 502,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error:
          'O Cofbot não conseguiu montar uma resposta agora. Reformule a pergunta ou envie de novo — vamos tentar juntos.'
      })
    };
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
  } catch (e) {
    console.error('[coordenador-chat] handler', e);
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error:
          'Encontramos uma instabilidade por aqui. Tente novamente em instantes — se persistir, o time MedCof ajuda pelo canal de suporte.'
      })
    };
  }
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

/*
 * Verificação manual sugerida após deploy:
 * - GET /.netlify/functions/coordenador-chat → openaiKeyConfigured e supabaseServiceRoleConfigured.
 * - POST com JWT de coordenador: ies_slug deve coincidir com user_metadata.instituicao (senão 403).
 * - POST com admin: qualquer ies_slug da URL do painel; respostas devem citar só essa IES.
 */
