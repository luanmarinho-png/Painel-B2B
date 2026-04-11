/**
 * Planejamento de simulado — priorização de temas e % por grande área (sem expor IDs de questões).
 *
 * POST JSON:
 * - supabase_access_token (ou Authorization Bearer)
 * - ies_slug
 * Agrega rankings válidos do banco: simulados **Tendências** e **Personalizado** com resultado processado.
 */

const { getSupabaseEnv } = require('./server/infrastructure/config/supabaseEnv');
const { isMongoDataBackend } = require('./server/infrastructure/mongo/isMongoData');
const { executePostgrestMongo } = require('./server/infrastructure/mongo/postgrestMongoAdapter');
const { validateCoordinatorAccess } = require('./coordinatorAuth');
const { montarPlano, computePlanHash, computeTemasChave } = require('./simuladoPlannerMontar');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const RANKINGS_LIMIT = 2000;
const REF_BATCH_SIZE = 25;

/**
 * @param {string} table
 * @param {string} query sem "?"
 * @returns {Promise<any[]>}
 */
async function dataGet(table, query) {
  const qs = String(query || '').replace(/^\?/, '');
  if (isMongoDataBackend()) {
    const r = await executePostgrestMongo({
      table,
      query: qs,
      method: 'GET',
      body: null,
      prefer: null,
      range: null,
      maskSensitive: false
    });
    if (r.statusCode !== 200) {
      throw new Error(`Leitura ${table}: HTTP ${r.statusCode}`);
    }
    return JSON.parse(r.body || '[]');
  }
  const env = getSupabaseEnv();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY não configurada');
  }
  const url = `${env.url}/rest/v1/${table}?${qs}`;
  const res = await fetch(url, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json'
    }
  });
  if (!res.ok) {
    throw new Error(`Leitura ${table}: HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * @param {string} table
 * @param {Record<string, unknown>} row
 * @returns {Promise<void>}
 */
async function dataPost(table, row) {
  if (isMongoDataBackend()) {
    const r = await executePostgrestMongo({
      table,
      query: '',
      method: 'POST',
      body: row,
      prefer: 'return=minimal',
      range: null,
      maskSensitive: false
    });
    if (r.statusCode !== 201 && r.statusCode !== 200) {
      throw new Error(`Insert ${table}: HTTP ${r.statusCode}`);
    }
    return;
  }
  const env = getSupabaseEnv();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY não configurada');
  }
  const res = await fetch(`${env.url}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify(row)
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Insert ${table}: HTTP ${res.status} ${t.slice(0, 200)}`);
  }
}

/**
 * @param {string} slug
 * @param {string[]} areaKeys
 * @returns {Promise<any[]>}
 */
async function fetchApprovedQuestionsForAreas(areaKeys) {
  const uniq = [...new Set((areaKeys || []).map((a) => String(a || '').trim()).filter(Boolean))];
  if (!uniq.length) return [];
  const inList = uniq.map((a) => encodeURIComponent(a)).join(',');
  try {
    const rows = await dataGet(
      'simulados_questoes',
      `status=eq.aprovada&grande_area=in.(${inList})&select=id,codigo_questao,grande_area,tema,dificuldade,prioridade&limit=10000`
    );
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    console.error('[simulado-planner] questoes', e);
    return [];
  }
}

/**
 * @param {string} slug
 * @returns {Promise<string[]>}
 */
async function fetchRecentMentorTemas(slug) {
  try {
    const rows = await dataGet(
      'mentor_planner_eventos',
      `ies_slug=eq.${encodeURIComponent(slug)}&order=created_at.desc&limit=50&select=temas_chave`
    );
    const out = [];
    for (const r of Array.isArray(rows) ? rows : []) {
      const t = r.temas_chave || '';
      if (t) out.push(...String(t).split('|').filter(Boolean));
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * @param {object} p
 * @returns {Promise<void>}
 */
async function logMentorEvent(p) {
  try {
    await dataPost('mentor_planner_eventos', {
      ies_slug: p.slug,
      user_id: p.userId || '',
      tipo: p.tipo,
      plan_hash: p.planHash || '',
      contagem_slots: p.contagemSlots || 0,
      areas_json: p.areasJson || [],
      temas_chave: p.temasChave || ''
    });
  } catch (e) {
    console.warn('[simulado-planner] mentor_planner_eventos', e && e.message);
  }
}

/**
 * Busca linhas de detalhe para vários simulado_ref em lotes.
 * @param {string} slug
 * @param {string[]} refs
 * @returns {Promise<any[]>}
 */
async function fetchDetailRowsForRefs(slug, refs) {
  const all = [];
  for (let i = 0; i < refs.length; i += REF_BATCH_SIZE) {
    const chunk = refs.slice(i, i + REF_BATCH_SIZE);
    const inList = chunk.map((r) => encodeURIComponent(r)).join(',');
    const rows = await dataGet(
      'simulado_respostas',
      `ies_slug=eq.${encodeURIComponent(slug)}&simulado_ref=in.(${inList})&select=simulado_ref,aluno_nome,respostas&limit=5000`
    );
    if (Array.isArray(rows)) all.push(...rows);
  }
  return all;
}

/**
 * @param {string} raw
 * @returns {'tendencias'|'personalizado'}
 */
function normalizeSimTipo(raw) {
  const t = String(raw || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (t === 'tendencias' || t === 'tendencia') return 'tendencias';
  return 'personalizado';
}

/**
 * @param {string} ref
 * @returns {string|null}
 */
function refExtractId8(ref) {
  const s = String(ref || '');
  const m1 = s.match(/_tendencias_([a-f0-9]{8})$/i);
  if (m1) return m1[1].toLowerCase();
  const m2 = s.match(/_([a-f0-9]{8})$/i);
  return m2 ? m2[1].toLowerCase() : null;
}

/**
 * @param {string} slug
 * @returns {Promise<{ tipoById8: Map<string, string>, validRefs: Set<string> } | null>}
 */
async function loadSimBancoContext(slug) {
  let sims;
  try {
    sims = await dataGet('simulados_banco', 'select=id,tipo,instituicoes_destino');
  } catch {
    return null;
  }
  const tipoById8 = new Map();
  const validRefs = new Set();
  if (!Array.isArray(sims)) return null;
  for (const s of sims) {
    let dest = s.instituicoes_destino;
    if (!Array.isArray(dest)) {
      try {
        dest = JSON.parse(dest || '[]');
      } catch {
        dest = [];
      }
    }
    if (dest.length && !dest.includes(slug)) continue;
    const id8 = String(s.id || '')
      .slice(0, 8)
      .toLowerCase();
    if (!id8) continue;
    tipoById8.set(id8, normalizeSimTipo(s.tipo));
    validRefs.add(`bq_${slug}_${id8}`);
    validRefs.add(`bq_${slug}_tendencias_${id8}`);
  }
  return { tipoById8, validRefs };
}

/**
 * @param {string} ref
 * @param {Map<string, string>} tipoById8
 */
function refIsTendencias(ref, tipoById8) {
  if (!ref || !tipoById8.size) return false;
  const id8 = refExtractId8(ref);
  if (!id8) return false;
  return (tipoById8.get(id8) || '') === 'tendencias';
}

/**
 * @param {any[]} rows
 */
function dedupeRankingsByRef(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const ref = r.simulado_ref || '';
    if (!ref || seen.has(ref)) continue;
    seen.add(ref);
    out.push(r);
  }
  return out;
}

/**
 * @param {any[]} rows same simulado_ref
 * @returns {{ temaStats: Map<string, { tema: string, area: string, acertos: number, total: number }> }}
 */
function analyzeSimuladoRows(rows) {
  /** @type {Map<string, { tema: string, area: string, acertos: number, total: number }>} */
  const temaStats = new Map();

  let meta = null;
  const alunos = [];
  for (const r of rows) {
    const name = r.aluno_nome || '';
    const data = r.respostas || {};
    if (name === '__META__') meta = data;
    else if (name.startsWith('__BATCH_') && Array.isArray(data.alunos)) {
      alunos.push(...data.alunos);
    }
  }

  const questions = (meta && meta.questions) || [];

  if (questions.length && alunos.length) {
    questions.forEach((q, i) => {
      if (!q.tema || q.anulada) return;
      const tema = q.tema;
      const area = q.area || '—';
      const key = `${area}|||${tema}`;
      if (!temaStats.has(key)) temaStats.set(key, { tema, area, acertos: 0, total: 0 });
      const agg = temaStats.get(key);
      alunos.forEach((a) => {
        if (!a.resps || a.resps.length <= i || !a.resps[i]) return;
        agg.total++;
        if (String(a.resps[i]).toUpperCase() === String(q.gab || '').toUpperCase()) agg.acertos++;
      });
    });
  }

  return { temaStats };
}

/**
 * Agrega histórico de simulados (Tendências + Personalizado) para temas e áreas.
 * @param {string} slug
 * @param {{ tipoById8: Map<string, string>, validRefs: Set<string> } | null} simCtx
 * @returns {Promise<{ suggested: any[], areasDesempenho: any[], resumoTemasFrageis: any[], refsTitles: any[], nTend: number, nPers: number, allRefs: string[] }>}
 */
async function runPlannerAggregation(slug, simCtx) {
  const empty = {
    suggested: [],
    areasDesempenho: [],
    resumoTemasFrageis: [],
    refsTitles: [],
    nTend: 0,
    nPers: 0,
    allRefs: []
  };
  if (!simCtx) return empty;

  let rankingsRaw;
  try {
    rankingsRaw = await dataGet(
      'simulado_respostas',
      `ies_slug=eq.${encodeURIComponent(slug)}&aluno_nome=eq.__RANKING__&select=simulado_ref,respostas,created_at&order=created_at.desc&limit=${RANKINGS_LIMIT}`
    );
  } catch (e) {
    console.error('[simulado-planner] rankings montar', e);
    return empty;
  }

  const rankings = dedupeRankingsByRef(Array.isArray(rankingsRaw) ? rankingsRaw : []);
  /** @type {string[]} */
  const allRefs = [];
  for (const r of rankings) {
    const ref = r.simulado_ref || '';
    if (!ref || !simCtx.validRefs.has(ref)) continue;
    allRefs.push(ref);
  }

  if (allRefs.length === 0) return empty;

  let detailRows;
  try {
    detailRows = await fetchDetailRowsForRefs(slug, allRefs);
  } catch (e) {
    console.error('[simulado-planner] detail montar', e);
    return { ...empty, allRefs };
  }

  const byRef = new Map();
  for (const row of Array.isArray(detailRows) ? detailRows : []) {
    const ref = row.simulado_ref;
    if (!byRef.has(ref)) byRef.set(ref, []);
    byRef.get(ref).push(row);
  }

  /** @type {Map<string, { tema: string, area: string, acertos: number, total: number }>} */
  const merged = new Map();
  const refsTitles = [];
  let nTend = 0;
  let nPers = 0;

  for (const ref of allRefs) {
    const rows = byRef.get(ref) || [];
    const { temaStats } = analyzeSimuladoRows(rows);

    const isT = refIsTendencias(ref, simCtx.tipoById8);
    if (isT) nTend++;
    else nPers++;

    let titulo = ref;
    const rankRow = rankings.find((x) => x.simulado_ref === ref);
    if (rankRow && rankRow.respostas && rankRow.respostas.simulado_titulo) {
      titulo = rankRow.respostas.simulado_titulo;
    }
    refsTitles.push({ ref, titulo, tipo: isT ? 'tendencias' : 'personalizado' });

    for (const [key, v] of temaStats) {
      if (!merged.has(key)) merged.set(key, { ...v });
      else {
        const m = merged.get(key);
        m.acertos += v.acertos;
        m.total += v.total;
      }
    }
  }

  const suggested = [];
  for (const [, v] of merged) {
    const pct = v.total > 0 ? Math.round((v.acertos / v.total) * 1000) / 10 : 0;
    suggested.push({
      prioridade: 0,
      grande_area: v.area,
      tema: v.tema,
      pct_acerto_ies: pct,
      amostras_resposta: v.total,
      motivo: `${pct}% de acerto agregado da turma neste tema (${v.total} resposta(s) no histórico: ${nTend} simulado(s) Tendências e ${nPers} Personalizado).`
    });
  }
  suggested.sort((a, b) => a.pct_acerto_ies - b.pct_acerto_ies);
  suggested.forEach((row, i) => {
    row.prioridade = i + 1;
  });

  const resumoTemasFrageis = suggested.slice(0, 8).map((t) => ({
    grande_area: t.grande_area,
    tema: t.tema,
    pct_acerto_ies: t.pct_acerto_ies,
    amostras_resposta: t.amostras_resposta
  }));

  /** @type {Map<string, { acertos: number, total: number }>} */
  const byArea = new Map();
  for (const [, v] of merged) {
    const a = (v.area || '—').trim() || '—';
    if (!byArea.has(a)) byArea.set(a, { acertos: 0, total: 0 });
    const agg = byArea.get(a);
    agg.acertos += v.acertos;
    agg.total += v.total;
  }
  const areasDesempenho = Array.from(byArea.entries())
    .map(([grande_area, s]) => ({
      grande_area,
      pct_acerto_ies: s.total > 0 ? Math.round((s.acertos / s.total) * 1000) / 10 : 0,
      amostras_resposta: s.total
    }))
    .sort((x, y) => x.pct_acerto_ies - y.pct_acerto_ies);

  return {
    suggested,
    areasDesempenho,
    resumoTemasFrageis,
    refsTitles,
    nTend,
    nPers,
    allRefs
  };
}

/**
 * @param {object} payload
 * @param {string} slug
 * @param {{ userId?: string }} access
 * @returns {Promise<{ statusCode: number, headers: object, body: string }>}
 */
async function handleMontar(payload, slug, access) {
  const rawDist = payload.distribuicao;
  if (!Array.isArray(rawDist) || rawDist.length === 0) {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'distribuicao deve ser um array não vazio.' })
    };
  }

  /** @type {{ grande_area: string, questoes: number }[]} */
  const distribuicao = [];
  for (const row of rawDist) {
    const grande_area = String(row.grande_area || row.area || '').trim();
    const questoes = Math.max(0, parseInt(String(row.questoes ?? 0), 10) || 0);
    if (grande_area && questoes > 0) distribuicao.push({ grande_area, questoes });
  }

  if (!distribuicao.length) {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Informe ao menos uma área com quantidade de questões.' })
    };
  }

  const seed =
    typeof payload.seed === 'number' && Number.isFinite(payload.seed)
      ? Math.floor(payload.seed)
      : Math.floor(Date.now() % 2147483647);

  const simCtx = await loadSimBancoContext(slug);
  const agg = await runPlannerAggregation(slug, simCtx);

  const areaKeys = distribuicao.map((d) => d.grande_area);
  let questions = await fetchApprovedQuestionsForAreas(areaKeys);
  if (!questions.length) {
    try {
      questions = await dataGet(
        'simulados_questoes',
        'status=eq.aprovada&select=id,codigo_questao,grande_area,tema,dificuldade,prioridade&limit=12000'
      );
      questions = Array.isArray(questions) ? questions : [];
    } catch (e) {
      console.error('[simulado-planner] questoes fallback', e);
      questions = [];
    }
  }

  const recentTemas = await fetchRecentMentorTemas(slug);

  const { slots, avisos: avisosMontar } = montarPlano({
    dist: distribuicao,
    suggested: agg.suggested,
    allQuestions: questions,
    recentTemasList: recentTemas,
    seed
  });

  const planHash = computePlanHash(slots, distribuicao);
  const temasChave = computeTemasChave(slots);

  await logMentorEvent({
    slug,
    userId: access.userId || '',
    tipo: 'montar',
    planHash,
    contagemSlots: slots.length,
    areasJson: distribuicao,
    temasChave
  });

  const planoPremoldado = {
    slots,
    totalQuestoes: slots.length,
    seed,
    plan_hash: planHash
  };

  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ok: true,
      pilot: true,
      planoPremoldado,
      suggestedThemes: agg.suggested.slice(0, 40),
      areasDesempenho: agg.areasDesempenho,
      resumoTemasFrageis: agg.resumoTemasFrageis,
      mensagemApoioCoordenador:
        'A MedCof acompanha o desempenho da sua instituição ao longo do tempo. Sabemos onde a turma mais precisa de reforço — e esse histórico é cruzado com o banco de questões aprovadas para montar o plano.',
      avisos: avisosMontar,
      meta: {
        slug,
        totalSimulados: agg.allRefs.length,
        totalSimuladosTendencias: agg.nTend,
        totalSimuladosPersonalizado: agg.nPers,
        refsAnalisados: agg.refsTitles
      }
    })
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  if (event.httpMethod === 'GET') {
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, name: 'simulado-planner', pilot: true })
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'JSON inválido' })
    };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const fromBody =
    typeof payload.supabase_access_token === 'string' ? payload.supabase_access_token.trim() : '';
  const userToken = fromBody || authHeader.replace(/^Bearer\s+/i, '').trim();
  const slug = typeof payload.ies_slug === 'string' ? payload.ies_slug.trim() : '';

  if (!slug) {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'ies_slug obrigatório' })
    };
  }

  const access = await validateCoordinatorAccess(userToken, slug);
  if (!access.ok) {
    return {
      statusCode: access.status || 403,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: access.error || 'Acesso negado' })
    };
  }

  try {
    const action =
      payload.action === 'export_xlsx'
        ? 'export_xlsx'
        : payload.action === 'montar'
          ? 'montar'
          : 'resumo';

    if (action === 'export_xlsx') {
      await logMentorEvent({
        slug,
        userId: access.userId || '',
        tipo: 'export_xlsx',
        planHash: typeof payload.plan_hash === 'string' ? payload.plan_hash : '',
        contagemSlots: parseInt(String(payload.contagem_slots || '0'), 10) || 0,
        areasJson: payload.areas_json || [],
        temasChave: typeof payload.temas_chave === 'string' ? payload.temas_chave : ''
      });
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true })
      };
    }

    if (action === 'montar') {
      return handleMontar(payload, slug, access);
    }

    const simCtx = await loadSimBancoContext(slug);
    if (!simCtx) {
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ok: true,
          pilot: true,
          warning: 'Contexto do banco de simulados indisponível.',
          suggestedThemes: [],
          areasDesempenho: [],
          mensagemApoioCoordenador:
            'Quando o histórico estiver disponível, mostraremos aqui o que mais precisa de atenção na sua turma — com transparência e apoio da MedCof.',
          resumoTemasFrageis: [],
          meta: {
            slug,
            totalSimuladosPersonalizado: 0,
            todosSimuladosConsiderados: true,
            refsAnalisados: []
          }
        })
      };
    }

    let rankingsRaw;
    try {
      rankingsRaw = await dataGet(
        'simulado_respostas',
        `ies_slug=eq.${encodeURIComponent(slug)}&aluno_nome=eq.__RANKING__&select=simulado_ref,respostas,created_at&order=created_at.desc&limit=${RANKINGS_LIMIT}`
      );
    } catch (e) {
      console.error('[simulado-planner] rankings', e);
      return {
        statusCode: 502,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Não foi possível carregar o histórico de simulados.' })
      };
    }

    const rankings = dedupeRankingsByRef(Array.isArray(rankingsRaw) ? rankingsRaw : []);
    /** @type {string[]} */
    const allRefs = [];
    for (const r of rankings) {
      const ref = r.simulado_ref || '';
      if (!ref || !simCtx.validRefs.has(ref)) continue;
      allRefs.push(ref);
    }

    if (allRefs.length === 0) {
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ok: true,
          pilot: true,
          warning:
            'Nenhum simulado com resultado processado encontrado para esta IES. Após processar resultados, volte aqui.',
          suggestedThemes: [],
          areasDesempenho: [],
          mensagemApoioCoordenador:
            'Quando houver simulados processados (Tendências e/ou Personalizado), este painel mostrará um resumo do que a turma mais precisa reforçar — e deixará claro que a MedCof usa esse histórico para apoiar a coordenação.',
          resumoTemasFrageis: [],
          meta: {
            slug,
            totalSimulados: 0,
            totalSimuladosTendencias: 0,
            totalSimuladosPersonalizado: 0,
            todosSimuladosConsiderados: true,
            refsAnalisados: []
          }
        })
      };
    }

    let detailRows;
    try {
      detailRows = await fetchDetailRowsForRefs(slug, allRefs);
    } catch (e) {
      console.error('[simulado-planner] detail', e);
      return {
        statusCode: 502,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Não foi possível carregar detalhes dos simulados.' })
      };
    }

    const byRef = new Map();
    for (const row of Array.isArray(detailRows) ? detailRows : []) {
      const ref = row.simulado_ref;
      if (!byRef.has(ref)) byRef.set(ref, []);
      byRef.get(ref).push(row);
    }

    /** @type {Map<string, { tema: string, area: string, acertos: number, total: number }>} */
    const merged = new Map();
    /** @type {{ ref: string, titulo: string, tipo: 'tendencias'|'personalizado' }[]} */
    const refsTitles = [];
    let nTend = 0;
    let nPers = 0;

    for (const ref of allRefs) {
      const rows = byRef.get(ref) || [];
      const { temaStats } = analyzeSimuladoRows(rows);

      const isT = refIsTendencias(ref, simCtx.tipoById8);
      if (isT) nTend++;
      else nPers++;

      let titulo = ref;
      const rankRow = rankings.find((x) => x.simulado_ref === ref);
      if (rankRow && rankRow.respostas && rankRow.respostas.simulado_titulo) {
        titulo = rankRow.respostas.simulado_titulo;
      }
      refsTitles.push({ ref, titulo, tipo: isT ? 'tendencias' : 'personalizado' });

      for (const [key, v] of temaStats) {
        if (!merged.has(key)) merged.set(key, { ...v });
        else {
          const m = merged.get(key);
          m.acertos += v.acertos;
          m.total += v.total;
        }
      }
    }

    const suggested = [];
    for (const [, v] of merged) {
      const pct = v.total > 0 ? Math.round((v.acertos / v.total) * 1000) / 10 : 0;
      suggested.push({
        prioridade: 0,
        grande_area: v.area,
        tema: v.tema,
        pct_acerto_ies: pct,
        amostras_resposta: v.total,
        motivo: `${pct}% de acerto agregado da turma neste tema (${v.total} resposta(s) no histórico: ${nTend} simulado(s) Tendências e ${nPers} Personalizado).`
      });
    }
    suggested.sort((a, b) => a.pct_acerto_ies - b.pct_acerto_ies);
    suggested.forEach((row, i) => {
      row.prioridade = i + 1;
    });

    const resumoTemasFrageis = suggested.slice(0, 8).map((t) => ({
      grande_area: t.grande_area,
      tema: t.tema,
      pct_acerto_ies: t.pct_acerto_ies,
      amostras_resposta: t.amostras_resposta
    }));

    /** @type {Map<string, { acertos: number, total: number }>} */
    const byArea = new Map();
    for (const [, v] of merged) {
      const a = (v.area || '—').trim() || '—';
      if (!byArea.has(a)) byArea.set(a, { acertos: 0, total: 0 });
      const agg = byArea.get(a);
      agg.acertos += v.acertos;
      agg.total += v.total;
    }
    const areasDesempenho = Array.from(byArea.entries())
      .map(([grande_area, s]) => ({
        grande_area,
        pct_acerto_ies:
          s.total > 0 ? Math.round((s.acertos / s.total) * 1000) / 10 : 0,
        amostras_resposta: s.total
      }))
      .sort((x, y) => x.pct_acerto_ies - y.pct_acerto_ies);

    const mensagemApoioCoordenador =
      'A MedCof acompanha o desempenho da sua instituição ao longo do tempo. Sabemos onde a turma mais precisa de reforço — e esse histórico (simulados Tendências e Personalizado já realizados) é levado em conta nas leituras abaixo, para você organizar o próximo simulado com informação, não no escuro.';

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        pilot: true,
        nota:
          'Leituras por tema e por grande área usam todo o histórico de simulados Tendências e Personalizado. Monte abaixo a distribuição que fizer sentido para a sua instituição; o detalhamento de itens do banco segue com o fluxo administrativo MedCof.',
        mensagemApoioCoordenador,
        resumoTemasFrageis,
        areasDesempenho,
        suggestedThemes: suggested.slice(0, 40),
        meta: {
          slug,
          totalSimulados: allRefs.length,
          totalSimuladosTendencias: nTend,
          totalSimuladosPersonalizado: nPers,
          todosSimuladosConsiderados: true,
          refsAnalisados: refsTitles
        }
      })
    };
  } catch (e) {
    console.error('[simulado-planner]', e);
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: e && e.message ? String(e.message) : 'Erro interno ao montar o planejamento.'
      })
    };
  }
};
