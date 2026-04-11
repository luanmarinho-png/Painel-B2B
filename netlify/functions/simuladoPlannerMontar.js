/**
 * Montagem do plano premoldado: slots com tema + dificuldade cruzando histórico IES e banco aprovado.
 */

const crypto = require('crypto');

/** @typedef {{ grande_area: string, questoes: number }} DistRow */
/** @typedef {{ id?: string, codigo_questao?: string, grande_area?: string, tema?: string, dificuldade?: string, prioridade?: string }} QRow */
/** @typedef {{ ordem: number, grande_area: string, tema: string, dificuldade: string, codigo_questao: string | null, questao_id: string | null, motivo: string, fraco_ies: boolean, peso_enamed: string }} PlanSlot */

/**
 * @param {string} s
 */
function normKey(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * @param {string} raw
 * @returns {'facil'|'media'|'dificil'}
 */
function normDificuldade(raw) {
  const t = normKey(raw);
  if (t === 'facil' || t === 'fácil' || t === 'easy') return 'facil';
  if (t === 'dificil' || t === 'difícil' || t === 'hard') return 'dificil';
  return 'media';
}

/**
 * @param {string} raw
 * @returns {number}
 */
function prioridadeScore(raw) {
  const t = normKey(raw);
  if (t.includes('vermelh') || t.includes('alta')) return 4;
  if (t.includes('diamante')) return 5;
  if (t.includes('amarel') || t.includes('media') || t.includes('média')) return 3;
  if (t.includes('verde') || t.includes('baixa')) return 2;
  return 1;
}

/**
 * Mulberry32 PRNG
 * @param {number} a
 */
function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @template T
 * @param {T[]} arr
 * @param {() => number} rnd
 */
function shuffle(arr, rnd) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Curva padrão: 25% fácil, 50% média, 25% difícil.
 * @param {number} n
 */
function difficultyTargets(n) {
  if (n <= 0) return { facil: 0, media: 0, dificil: 0 };
  let nF = Math.round(n * 0.25);
  let nM = Math.round(n * 0.5);
  let nD = n - nF - nM;
  if (nD < 0) {
    nM += nD;
    nD = 0;
  }
  const sum = nF + nM + nD;
  if (sum < n) nM += n - sum;
  else if (sum > n) nM -= sum - n;
  return { facil: nF, media: nM, dificil: nD };
}

/**
 * @param {number} n
 * @param {number} seed
 */
function buildDifficultySequence(n, seed) {
  const { facil, media, dificil } = difficultyTargets(n);
  const seq = [
    ...Array(facil).fill('facil'),
    ...Array(media).fill('media'),
    ...Array(dificil).fill('dificil')
  ];
  const rnd = mulberry32(seed);
  return shuffle(seq, rnd);
}

/**
 * @param {DistRow[]} dist
 * @returns {{ area: string, n: number }[]}
 */
function expandSlotsPerArea(dist) {
  const out = [];
  for (const row of dist) {
    const area = String(row.grande_area || row.area || '').trim();
    const n = Math.max(0, parseInt(String(row.questoes ?? row.qty ?? 0), 10) || 0);
    if (!area || n <= 0) continue;
    for (let i = 0; i < n; i++) out.push({ area, slotInArea: i });
  }
  return out;
}

/**
 * @param {any[]} suggested
 * @returns {Map<string, { tema: string, pct: number }[]>}
 */
function weakTemasByArea(suggested) {
  /** @type {Map<string, Map<string, number>>} */
  const m = new Map();
  for (const s of suggested || []) {
    const a = String(s.grande_area || '—').trim() || '—';
    const tema = String(s.tema || '').trim();
    if (!tema) continue;
    const pct = Number(s.pct_acerto_ies);
    const ak = normKey(a);
    if (!m.has(ak)) m.set(ak, new Map());
    const inner = m.get(ak);
    if (!inner.has(tema)) inner.set(tema, pct);
  }
  const out = new Map();
  for (const [ak, tm] of m) {
    const list = Array.from(tm.entries())
      .map(([tema, pct]) => ({ tema, pct }))
      .sort((x, y) => x.pct - y.pct);
    out.set(ak, list);
  }
  return out;
}

/**
 * @param {string} areaNorm
 * @param {Map<string, QRow[]>} questionsByAreaNorm
 */
function poolForArea(areaNorm, questionsByAreaNorm) {
  return questionsByAreaNorm.get(areaNorm) || [];
}

/**
 * @param {QRow[]} pool
 * @param {'facil'|'media'|'dificil'} want
 */
function pickWithRelax(pool, want) {
  const order = [want, want === 'media' ? 'facil' : 'media', want === 'facil' ? 'media' : 'dificil', 'facil', 'media', 'dificil'];
  const seen = new Set();
  for (const d of order) {
    if (seen.has(d)) continue;
    seen.add(d);
    const rows = pool.filter((q) => normDificuldade(q.dificuldade) === d);
    if (rows.length) return { q: rows[0], usedDif: d };
  }
  if (pool.length) return { q: pool[0], usedDif: normDificuldade(pool[0].dificuldade) };
  return { q: null, usedDif: want };
}

/**
 * @param {string[]} recentTemas
 */
function recentSet(recentTemas) {
  return new Set((recentTemas || []).map(normKey));
}

/**
 * @param {DistRow[]} dist
 * @param {any[]} suggested
 * @param {QRow[]} allQuestions
 * @param {string[]} recentTemasList
 * @param {number} seed
 * @returns {{ slots: PlanSlot[], avisos: string[] }}
 */
function montarPlano({ dist, suggested, allQuestions, recentTemasList, seed }) {
  const avisos = [];
  const expanded = expandSlotsPerArea(dist);
  if (expanded.length === 0) {
    avisos.push('Informe ao menos uma grande área com quantidade de questões maior que zero.');
    return { slots: [], avisos };
  }

  /** @type {Map<string, QRow[]>} */
  const questionsByAreaNorm = new Map();
  for (const q of allQuestions) {
    const a = normKey(q.grande_area || '');
    if (!a) continue;
    if (!questionsByAreaNorm.has(a)) questionsByAreaNorm.set(a, []);
    questionsByAreaNorm.get(a).push(q);
  }

  const weakMap = weakTemasByArea(suggested);
  const recent = recentSet(recentTemasList);
  const rnd = mulberry32(seed);

  const seqDif = buildDifficultySequence(expanded.length, seed);

  /** @type {PlanSlot[]} */
  const slots = [];
  let ordem = 1;

  for (let i = 0; i < expanded.length; i++) {
    const { area } = expanded[i];
    const areaNorm = normKey(area);
    const targetDif = /** @type {'facil'|'media'|'dificil'} */ (seqDif[i] || 'media');
    let pool = poolForArea(areaNorm, questionsByAreaNorm);

    if (!pool.length) {
      const alt = Array.from(questionsByAreaNorm.keys()).find(
        (k) => normKey(k) === areaNorm || normKey(k).includes(areaNorm) || areaNorm.includes(normKey(k))
      );
      if (alt) pool = questionsByAreaNorm.get(alt) || [];
    }
    if (!pool.length) {
      avisos.push(
        `Não há questões aprovadas no banco para a grande área "${area}". Cadastre ou aprove questões para esta área.`
      );
      slots.push({
        ordem: ordem++,
        grande_area: area,
        tema: '—',
        dificuldade: targetDif,
        codigo_questao: null,
        questao_id: null,
        motivo: 'Sem candidatos no banco para esta área.',
        fraco_ies: false,
        peso_enamed: '—'
      });
      continue;
    }

    const weakList = weakMap.get(areaNorm) || [];

    const temasCandidates = new Map();
    for (const w of weakList) {
      temasCandidates.set(normKey(w.tema), { tema: w.tema, weak: true, pct: w.pct, enamed: 0 });
    }
    for (const q of pool) {
      const tk = normKey(q.tema);
      if (!tk) continue;
      const sc = prioridadeScore(q.prioridade);
      if (!temasCandidates.has(tk)) {
        temasCandidates.set(tk, {
          tema: q.tema,
          weak: false,
          pct: 100,
          enamed: sc
        });
      } else {
        const cur = temasCandidates.get(tk);
        cur.enamed = Math.max(cur.enamed || 0, sc);
      }
    }

    let sortedTemas = Array.from(temasCandidates.values()).sort((a, b) => {
      if (a.weak !== b.weak) return a.weak ? -1 : 1;
      if (a.pct !== b.pct) return a.pct - b.pct;
      return (b.enamed || 0) - (a.enamed || 0);
    });

    sortedTemas = sortedTemas.sort((a, b) => {
      const ar = recent.has(normKey(a.tema)) ? 1 : 0;
      const br = recent.has(normKey(b.tema)) ? 1 : 0;
      if (ar !== br) return ar - br;
      return 0;
    });

    /** @type {QRow | null} */
    let picked = null;
    /** @type {'facil'|'media'|'dificil'} */
    let usedDif = targetDif;
    let fraco = false;
    let chosenTema = '';

    for (const cand of sortedTemas) {
      const temaPool = pool.filter((q) => normKey(q.tema) === normKey(cand.tema));
      if (!temaPool.length) continue;
      const rel = pickWithRelax(temaPool, targetDif);
      if (rel.q) {
        picked = rel.q;
        usedDif = /** @type {'facil'|'media'|'dificil'} */ (rel.usedDif);
        fraco = !!cand.weak;
        chosenTema = cand.tema;
        if (usedDif !== targetDif) {
          avisos.push(
            `Q${ordem}: dificuldade ajustada de "${targetDif}" para "${usedDif}" por disponibilidade no banco.`
          );
        }
        break;
      }
    }

    if (!picked) {
      const rel = pickWithRelax(pool, targetDif);
      picked = rel.q;
      usedDif = /** @type {'facil'|'media'|'dificil'} */ (rel.usedDif);
      fraco = false;
      chosenTema = picked ? picked.tema : '';
      if (picked && usedDif !== targetDif) {
        avisos.push(`Q${ordem}: dificuldade ajustada para "${usedDif}".`);
      }
    }

    if (!picked) {
      avisos.push(`Q${ordem}: não foi possível selecionar questão para "${area}".`);
      slots.push({
        ordem: ordem++,
        grande_area: area,
        tema: '—',
        dificuldade: targetDif,
        codigo_questao: null,
        questao_id: null,
        motivo: 'Sem questão disponível após tentativas.',
        fraco_ies: false,
        peso_enamed: '—'
      });
      continue;
    }

    const prioLabel = picked.prioridade || 'verde';
    slots.push({
      ordem: ordem++,
      grande_area: area,
      tema: picked.tema || chosenTema,
      dificuldade: usedDif,
      codigo_questao: picked.codigo_questao || null,
      questao_id: picked.id ? String(picked.id) : null,
      motivo: fraco
        ? 'Tema com menor desempenho no histórico da IES nesta área.'
        : 'Tema alinhado ao banco MedCof (prioridade / cobertura).',
      fraco_ies: fraco,
      peso_enamed: prioLabel
    });
  }

  return { slots, avisos };
}

/**
 * @param {{ tema: string, dificuldade: string }[]} slots
 * @param {DistRow[]} dist
 */
function computePlanHash(slots, dist) {
  const h = crypto.createHash('sha256');
  h.update(JSON.stringify({ dist, slots: slots.map((s) => ({ t: s.tema, d: s.dificuldade, a: s.grande_area })) }));
  return h.digest('hex');
}

/**
 * @param {PlanSlot[]} slots
 */
function computeTemasChave(slots) {
  const u = new Set();
  for (const s of slots) {
    if (s.tema && s.tema !== '—') u.add(normKey(s.tema));
  }
  return Array.from(u).sort().join('|');
}

module.exports = {
  montarPlano,
  computePlanHash,
  computeTemasChave,
  normKey,
  normDificuldade
};
