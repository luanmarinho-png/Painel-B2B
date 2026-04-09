const MONTH_INDEX = {
  janeiro: 0,
  fevereiro: 1,
  marco: 2,
  "março": 2,
  abril: 3,
  maio: 4,
  junho: 5,
  julho: 6,
  agosto: 7,
  setembro: 8,
  outubro: 9,
  novembro: 10,
  dezembro: 11
};

const ACCESS_STATE_KEY = "medcof_panel_access";
const INSTITUTION_SESSION_KEY = "medcof_panel_institution";
const INSTITUTION_THEME_CLASS_PREFIX = "theme-";
const PAGE_SIZE = 25;

const INSTITUTION_DATASETS = window.INSTITUTION_DATASETS || {};
const DEFAULT_INSTITUTION_KEY = window.DEFAULT_INSTITUTION_KEY || Object.keys(INSTITUTION_DATASETS)[0] || "unicet";
const CURRENT_INSTITUTION_KEY = getStoredInstitutionKey();
const CURRENT_INSTITUTION = INSTITUTION_DATASETS[CURRENT_INSTITUTION_KEY] || INSTITUTION_DATASETS[DEFAULT_INSTITUTION_KEY] || {
  key: DEFAULT_INSTITUTION_KEY,
  institutionName: "Instituição",
  brandTitle: "Instituição × MedCof",
  institutionInitials: "MC",
  institutionLogoSrc: "",
  allData: window.ALL_DATA || [],
  resultsData: window.RESULTS_DATA || [],
  benchmark: window.INSTITUTION_BENCHMARK || {}
};
// ── Dados iniciais (fallback estático do dashboard-data.js) ──
let CURRENT_ALL_DATA = CURRENT_INSTITUTION.allData || [];
let CURRENT_RESULTS_DATA = [];
let CURRENT_BENCHMARK = {};

// ── Supabase config (anon key — read-only) ──
const _SUPA_ENGAJAMENTO_URL = "https://cvwwucxjrpsfoxarsipr.supabase.co/rest/v1";
const _SUPA_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2d3d1Y3hqcnBzZm94YXJzaXByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMDIxMzgsImV4cCI6MjA5MDg3ODEzOH0.GdpReqo9giSC607JQge8HA9CmZWi-2TcVggU4jCwZhI";

// ── Funções de cálculo reutilizáveis (chamadas na init e no refresh) ──
function _buildAllDashboards(allData) {
  const periods = allData
    .map((entry) => {
      const meta = parseSheetMeta(entry.sheet || entry.periodo, entry.dateStart, entry.dateEnd);
      const data = entry.data || entry.alunos || [];
      return { ...entry, data, meta, summary: buildPeriodSummary(data, meta.days) };
    })
    .sort((a, b) => b.meta.endDate - a.meta.endDate);

  const monthly = buildMonthlyDashboard(periods);
  const accumulated = buildAccumulatedDashboard(monthly);

  const turmaMap = {};
  const normTurma = (t) => {
    let s = (t || "").replace(/\s*per[ií]odo\s*/i, "").replace(/\u00b0/g, "\u00ba").trim();
    if (/^\d+$/.test(s)) s += "\u00ba";
    return s;
  };
  allData.forEach((entry) => {
    (entry.alunos || entry.data || []).forEach((a) => {
      if (a.nome && a.turma) {
        const key = a.nome.trim().toLowerCase();
        if (!turmaMap[key]) turmaMap[key] = normTurma(a.turma);
      }
    });
  });

  return { periods, monthly, accumulated, turmaMap };
}

// ── Inicialização síncrona com dados estáticos (fallback) ──
let _dashboards = _buildAllDashboards(CURRENT_ALL_DATA);
let PERIODS = _dashboards.periods;
let MONTHLY_DASHBOARD = _dashboards.monthly;
let ACCUMULATED_DASHBOARD = _dashboards.accumulated;
let TURMA_BY_NAME = _dashboards.turmaMap;

const periodState = {
  currentIndex: 0,
  filteredRows: [],
  currentPage: 1,
  activeTurmaFilter: "all"
};

const engagementState = {
  filteredRows: []
};

let exportSelections = PERIODS.map(() => true);

// ── Fetch assíncrono do Supabase (chamado no DOMContentLoaded) ──
async function _loadEngajamentoFromSupabase() {
  const slug = CURRENT_INSTITUTION?.key || CURRENT_INSTITUTION_KEY || DEFAULT_INSTITUTION_KEY || "";
  if (!slug) return null;
  try {
    const url = `${_SUPA_ENGAJAMENTO_URL}/dashboard_engajamento?select=payload,updated_at&ies_slug=eq.${encodeURIComponent(slug)}&limit=1`;
    const resp = await fetch(url, {
      headers: { 'apikey': _SUPA_ANON_KEY, 'Authorization': `Bearer ${_SUPA_ANON_KEY}` }
    });
    if (!resp.ok) return null;
    const rows = await resp.json();
    const payload = rows[0]?.payload;
    const allData = payload?.allData;
    if (!Array.isArray(allData) || !allData.length) return null;
    return { allData, updatedAt: payload?.updated_at || rows[0]?.updated_at };
  } catch(e) { console.warn("Supabase engajamento fetch:", e); return null; }
}

// ── Refresh: recalcula dashboards e re-renderiza a página ──
function _refreshDashboardWithData(allData) {
  CURRENT_ALL_DATA = allData;
  CURRENT_INSTITUTION.allData = allData;
  _dashboards = _buildAllDashboards(allData);
  PERIODS = _dashboards.periods;
  MONTHLY_DASHBOARD = _dashboards.monthly;
  ACCUMULATED_DASHBOARD = _dashboards.accumulated;
  TURMA_BY_NAME = _dashboards.turmaMap;
  exportSelections = PERIODS.map(() => true);
  periodState.currentIndex = 0;
  periodState.filteredRows = [];
  periodState.currentPage = 1;
  periodState.activeTurmaFilter = "all";

  // Re-renderizar a página atual
  const page = document.body.dataset.page;
  if (page === "engagement") renderEngagementPage();
  if (page === "period") renderPeriodPage();
  if (page === "simulados") renderSimuladosPage();
}

window.addEventListener("DOMContentLoaded", async () => {
  applyInstitutionBranding();
  // ── Revelar body após tema aplicado (anti-flash) ──
  document.body.setAttribute('data-theme-ready', 'true');
  renderTurmaSwitcher();
  await mountAccessGate();
  const page = document.body.dataset.page;

  // ── Tentar carregar dados frescos do Supabase ──
  const hasStaticData = CURRENT_ALL_DATA.length > 0;
  if (hasStaticData) {
    // Renderiza imediatamente com dados estáticos (sem loading)
    if (page === "engagement") renderEngagementPage();
    if (page === "period") renderPeriodPage();
    if (page === "simulados") renderSimuladosPage();
    // Buscar atualização em background — se houver dados mais novos, re-renderiza
    _loadEngajamentoFromSupabase().then(result => {
      if (result && result.allData) {
        _refreshDashboardWithData(result.allData);
      }
    });
  } else {
    // Sem dados estáticos — mostrar loading e buscar do Supabase
    _showLoadingState();
    const result = await _loadEngajamentoFromSupabase();
    if (result && result.allData) {
      _refreshDashboardWithData(result.allData);
      _hideLoadingState();
    } else {
      _hideLoadingState();
      // Sem dados em nenhuma fonte — renderizar páginas vazias
      if (page === "engagement") renderEngagementPage();
      if (page === "period") renderPeriodPage();
      if (page === "simulados") renderSimuladosPage();
    }
  }

  if (sessionStorage.getItem(ACCESS_STATE_KEY) === "granted") {
    mountCoordenadorChat();
  }
});

function _showLoadingState() {
  const containers = ['engagementRanking', 'periodTable', 'periodCardGrid', 'summaryGrid'];
  containers.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:0.9rem"><div style="margin-bottom:8px">⏳</div>Carregando dados...</div>';
  });
}

function _hideLoadingState() {
  const containers = ['engagementRanking', 'periodTable', 'periodCardGrid', 'summaryGrid'];
  containers.forEach(id => {
    const el = document.getElementById(id);
    if (el && el.innerHTML.includes('Carregando dados')) el.innerHTML = '';
  });
}

function getStoredInstitutionKey() {
  return sessionStorage.getItem(INSTITUTION_SESSION_KEY) || DEFAULT_INSTITUTION_KEY;
}

function getInstitutionByPassword(password) {
  const normalized = (password || "").trim();
  return Object.values(INSTITUTION_DATASETS).find((institution) => institution.accessPassword === normalized);
}

function getInstitutionInitials(name) {
  const parts = (name || "MC")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) return "MC";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function applyInstitutionBranding() {
  const brandTitle = CURRENT_INSTITUTION.brandTitle || `${CURRENT_INSTITUTION.institutionName || "Instituição"} × MedCof`;
  const institutionName = CURRENT_INSTITUTION.institutionName || "Instituição";
  const initials = CURRENT_INSTITUTION.institutionInitials || getInstitutionInitials(institutionName);

  // ── Tema síncrono: aplicar cores ANTES do render (elimina flash) ──
  _applySyncThemeHex();

  applyInstitutionTheme();

  document.querySelectorAll("[data-institution-brand]").forEach((element) => {
    element.textContent = brandTitle;
  });

  document.querySelectorAll("[data-institution-initials]").forEach((element) => {
    element.textContent = initials;
  });

  const homeHeading = document.getElementById("homeBrandHeading");
  if (homeHeading) homeHeading.textContent = `Painel institucional ${brandTitle}`;

  // Preferir logoUrl (Supabase) sobre institutionLogoSrc (local)
  const logoSrc = CURRENT_INSTITUTION.logoUrl || CURRENT_INSTITUTION.institutionLogoSrc;

  const logoSlot = document.getElementById("institutionLogoSlot");
  if (logoSlot) {
    if (logoSrc) {
      logoSlot.innerHTML = `<img class="home-institution-logo" src="${logoSrc}" alt="Logo da ${institutionName}">`;
    } else {
      logoSlot.innerHTML = `<div class="home-institution-badge">${initials}</div>`;
    }
  }

  // Inject institution logo into topbar brand-mark when available
  const brandMark = document.querySelector(".brand-mark[data-institution-initials]");
  if (brandMark && logoSrc) {
    brandMark.innerHTML = `<img class="topbar-institution-logo" src="${logoSrc}" alt="${institutionName}">`;
    brandMark.classList.add("brand-mark-logo");
  }
}

/**
 * Aplica o tema de cores sincronamente a partir de themeHex no dashboard-data.js.
 * Reproduz o MESMO CSS que brand-loader.js injeta, mas sem esperar fetch do Supabase.
 * brand-loader.js continua como fallback para atualizações dinâmicas.
 */
function _applySyncThemeHex() {
  const hex = CURRENT_INSTITUTION.themeHex;
  if (!hex || hex.length < 7) return;
  // Não re-injetar se brand-loader já aplicou
  if (document.getElementById('brand-loader-theme')) return;
  if (document.getElementById('sync-theme')) return;

  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  const dark  = `rgb(${Math.round(r*.55)},${Math.round(g*.55)},${Math.round(b*.55)})`;
  const mid   = `rgb(${Math.round(r*.75)},${Math.round(g*.75)},${Math.round(b*.75)})`;
  const rgba  = (a) => `rgba(${r},${g},${b},${a})`;

  const css = `
/* Sync Theme — aplicado por shared.js (sem fetch) */
body {
  background:
    radial-gradient(circle at top left, ${rgba(0.12)}, transparent 30%),
    linear-gradient(180deg, ${rgba(0.06)} 0%, ${rgba(0.03)} 48%, ${rgba(0.08)} 100%)
    !important;
}
.topbar { border-bottom-color: ${rgba(0.18)} !important; box-shadow: 0 8px 28px ${rgba(0.06)} !important; }
.brand-mark:not(.brand-mark-logo), .nav-link.active, .roadmap-index {
  background: linear-gradient(135deg, ${dark} 0%, ${hex} 100%) !important;
  box-shadow: 0 12px 24px ${rgba(0.25)} !important; color: #ffffff !important;
}
.brand-mark.brand-mark-logo { background: #ffffff !important; box-shadow: 0 2px 8px ${rgba(0.10)} !important; }
.nav-link { border-color: ${rgba(0.22)} !important; }
.nav-link:hover { border-color: ${rgba(0.40)} !important; box-shadow: 0 8px 18px ${rgba(0.12)} !important; }
.hero-card.hero-strong {
  background: radial-gradient(circle at top right, rgba(255,255,255,0.18), transparent 34%),
    linear-gradient(135deg, ${dark} 0%, ${mid} 55%, ${hex} 100%) !important;
  box-shadow: 0 26px 52px ${rgba(0.28)} !important;
}
.section-kicker, .home-page-link, .cta-link, .kpi-card .kpi-value, .spotlight-name,
.spotlight-score, .export-icon-svg, .check-chip span { color: ${hex} !important; }
.kpi-card .kpi-icon { background: ${rgba(0.10)} !important; color: ${hex} !important; }
.home-page-card:hover { border-color: ${rgba(0.25)} !important; box-shadow: 0 24px 44px ${rgba(0.14)} !important; }
.home-logo-card.institution { background: #ffffff !important; border-color: ${rgba(0.18)} !important; }
.spotlight-card { border-color: ${rgba(0.15)} !important; }
.spotlight-card .spotlight-rank, .spotlight-card .spotlight-title { color: ${hex} !important; }
.period-selector.active { background: linear-gradient(135deg, ${dark} 0%, ${hex} 100%) !important; box-shadow: 0 18px 34px ${rgba(0.22)} !important; }
.period-selector:hover { border-color: ${rgba(0.35)} !important; }
.turma-btn { border-color: ${rgba(0.22)} !important; color: ${dark} !important; }
.turma-btn:hover { background: ${rgba(0.06)} !important; border-color: ${rgba(0.35)} !important; }
.turma-btn.active { background: linear-gradient(135deg, ${dark}, ${hex}) !important; color: #ffffff !important; border-color: transparent !important; box-shadow: 0 6px 16px ${rgba(0.25)} !important; }
.period-filter-btn.active, .sp-rank-filter-btn.active { background: ${hex} !important; color: #ffffff !important; border-color: ${hex} !important; }
.export-card { border-color: ${rgba(0.20)} !important; }
.btn-export { background: linear-gradient(135deg, ${dark} 0%, ${hex} 100%) !important; box-shadow: 0 12px 24px ${rgba(0.20)} !important; color: #ffffff !important; }
.btn-select-all { background: ${rgba(0.08)} !important; color: ${dark} !important; border-color: ${rgba(0.22)} !important; }
.check-chip input { accent-color: ${hex} !important; }
.table-wrap table th { background: ${rgba(0.06)} !important; color: ${dark} !important; }
.badge-alto { background: ${rgba(0.10)} !important; color: ${hex} !important; }
.access-btn { background: linear-gradient(135deg, ${dark}, ${hex}) !important; box-shadow: 0 12px 28px ${rgba(0.30)} !important; }
body { --green: ${hex} !important; --green-dark: ${dark} !important; --green-soft: ${rgba(0.08)} !important; --green-mid: ${mid} !important; --blue: ${hex} !important; --blue-soft: ${rgba(0.08)} !important; }
`;

  const style = document.createElement('style');
  style.id = 'sync-theme';
  style.textContent = css;
  document.head.appendChild(style);
}

function applyInstitutionTheme() {
  const body = document.body;
  if (!body) return;

  const existingThemeClasses = Object.values(INSTITUTION_DATASETS)
    .map((institution) => institution.themeClass)
    .filter(Boolean);

  existingThemeClasses.forEach((themeClass) => {
    if (themeClass.startsWith(INSTITUTION_THEME_CLASS_PREFIX)) {
      body.classList.remove(themeClass);
    }
  });

  body.dataset.institution = CURRENT_INSTITUTION.key || DEFAULT_INSTITUTION_KEY;

  if (CURRENT_INSTITUTION.themeClass) {
    body.classList.add(CURRENT_INSTITUTION.themeClass);
  }
}

function getMedcofAccessLogoMarkup() {
  return `
    <div class="access-brand-lockup">
      <img src="logo-novo-medcof.avif" alt="Logo do Grupo MedCof" class="access-medcof-logo-img" style="max-width:180px;max-height:120px;object-fit:contain;display:block;margin:0 auto">
      <div class="access-rocket" aria-hidden="true">🚀</div>
    </div>
  `;
}

function slugifyInstitutionName(name) {
  return (name || "instituicao")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseSheetMeta(sheetName, dateStart, dateEnd) {
  // Suportar formato novo (periodo + dateStart/dateEnd) e antigo (sheet name)
  if (dateStart && dateEnd) {
    const [sd, sm, sy] = dateStart.split("/").map(Number);
    const [ed, em, ey] = dateEnd.split("/").map(Number);
    const startDate = new Date(sy, sm - 1, sd);
    const endDate   = new Date(ey, em - 1, ed);
    return {
      type: "range",
      label: `${dateStart} a ${dateEnd}`,
      monthKey: `${sy}-${String(sm).padStart(2,'0')}`,
      startDate,
      endDate,
      days: Math.round((endDate - startDate) / 86400000) + 1
    };
  }
  const label = (sheetName || "").replace("Análise de uso - ", "").trim();
  const rangeMatch = label.match(/^(\d{2})(\d{2})\s+a\s+(\d{2})(\d{2})$/);
  if (rangeMatch) {
    const [, startDay, startMonth, endDay, endMonth] = rangeMatch;
    const startDate = new Date(2026, Number(startMonth) - 1, Number(startDay));
    const endDate = new Date(2026, Number(endMonth) - 1, Number(endDay));
    return {
      type: "range",
      label: `${startDay}/${startMonth}/26 a ${endDay}/${endMonth}/26`,
      monthKey: `2026-${startMonth}`,
      startDate,
      endDate,
      days: Math.round((endDate - startDate) / 86400000) + 1
    };
  }

  const monthMatch = label.match(/^([A-Za-zÀ-ÿ]+)(\d{4})$/);
  if (monthMatch) {
    const monthName = monthMatch[1];
    const year = Number(monthMatch[2]);
    const monthIdx = MONTH_INDEX[monthName.toLowerCase()];
    const startDate = new Date(year, monthIdx, 1);
    const endDate = new Date(year, monthIdx + 1, 0);
    return {
      type: "month",
      label: `${monthName}/${year}`,
      monthKey: `${year}-${String(monthIdx + 1).padStart(2, "0")}`,
      startDate,
      endDate,
      days: endDate.getDate()
    };
  }

  return {
    type: "generic",
    label,
    monthKey: label,
    startDate: new Date(),
    endDate: new Date(),
    days: 1
  };
}

function buildPeriodSummary(rows, days) {
  const safeDays = Math.max(days || 1, 1);
  const activeRows = rows.filter(isActiveRow);
  const totalQuestions = rows.reduce((sum, row) => sum + (row.questoes || 0), 0);
  const totalTempo = rows.reduce((sum, row) => sum + (row.tempo_min || 0), 0);
  const totalAulas = rows.reduce((sum, row) => sum + (row.aulas || 0), 0);
  const totalVideos = rows.reduce((sum, row) => sum + (row.videos || 0), 0);
  const totalSimulados = rows.reduce((sum, row) => sum + (row.simulados || 0), 0);
  const totalProvas = rows.reduce((sum, row) => sum + (row.provas || 0), 0);
  const totalLogins = rows.reduce((sum, row) => sum + (row.logins || 0), 0);
  const totalQuestAcertadas = rows.reduce((sum, row) => sum + (row.questoes_acertadas || 0), 0);
  const taxaAcertoMedia = totalQuestions > 0 ? (totalQuestAcertadas / totalQuestions * 100) : null;
  const topStudent = [...rows].sort((a, b) => (b.questoes - a.questoes) || (b.tempo_min - a.tempo_min))[0];
  return {
    safeDays,
    activeStudents: activeRows.length,
    totalQuestions,
    totalTempo,
    totalAulas,
    totalVideos,
    totalSimulados,
    totalProvas,
    totalLogins,
    totalQuestAcertadas,
    taxaAcertoMedia,
    avgQuestions: rows.length ? totalQuestions / rows.length : 0,
    avgQuestionsPerDay: totalQuestions / safeDays,
    avgTempo: rows.length ? totalTempo / rows.length : 0,
    topStudent
  };
}

function buildMonthlyDashboard(periods) {
  const monthMap = new Map();

  periods.forEach((period) => {
    const key = period.meta.monthKey;
    if (!monthMap.has(key)) {
      monthMap.set(key, {
        key,
        label: period.meta.type === "month" ? period.meta.label : (() => {
          const MONTH_NAMES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
          const [y, m] = key.split("-");
          return `${MONTH_NAMES[Number(m) - 1]}/${y}`;
        })(),
        days: 0,
        students: new Map()
      });
    }

    const bucket = monthMap.get(key);
    bucket.days += period.meta.days;

    period.data.forEach((row) => {
      if (!bucket.students.has(row.nome)) {
        bucket.students.set(row.nome, {
          nome: row.nome,
          turma: row.turma || null,
          tempo_min: 0,
          aulas: 0,
          videos: 0,
          simulados: 0,
          provas: 0,
          questoes: 0,
          questoes_acertadas: 0,
          flashcards: 0,
          logins: 0,
          media_login_semanal: 0,
          active: false
        });
      }

      const acc = bucket.students.get(row.nome);
      acc.tempo_min += row.tempo_min || 0;
      acc.aulas += row.aulas || 0;
      acc.videos += row.videos || 0;
      acc.simulados += row.simulados || 0;
      acc.provas += row.provas || 0;
      acc.questoes += row.questoes || 0;
      acc.questoes_acertadas += row.questoes_acertadas || 0;
      acc.flashcards += row.flashcards || 0;
      acc.logins += row.logins || 0;
      // media_login_semanal: média simples entre períodos (não soma)
      if (row.media_login_semanal) {
        acc._mlsCount = (acc._mlsCount || 0) + 1;
        acc._mlsSum = (acc._mlsSum || 0) + row.media_login_semanal;
        acc.media_login_semanal = acc._mlsSum / acc._mlsCount;
      }
      if (row.turma && !acc.turma) acc.turma = row.turma;
      acc.active = acc.active || isActiveRow(row);
    });
  });

  return Array.from(monthMap.values())
    .map((bucket) => {
      const students = Array.from(bucket.students.values());
      const totalQuestions = students.reduce((sum, student) => sum + student.questoes, 0);
      const totalTempo = students.reduce((sum, student) => sum + student.tempo_min, 0);
      const activeStudents = students.filter((student) => student.active).length;
      return {
        key: bucket.key,
        label: bucket.label,
        days: bucket.days,
        students,
        totalQuestions,
        totalTempo,
        activeStudents,
        avgQuestionsPerDay: bucket.days ? totalQuestions / bucket.days : 0
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

function buildAccumulatedDashboard(monthlyDashboard) {
  const studentMap = new Map();
  const totalDays = monthlyDashboard.reduce((sum, month) => sum + month.days, 0);

  monthlyDashboard.forEach((month) => {
    month.students.forEach((student) => {
      if (!studentMap.has(student.nome)) {
        studentMap.set(student.nome, {
          nome: student.nome,
          turma: student.turma || null,
          tempo_min: 0,
          aulas: 0,
          videos: 0,
          simulados: 0,
          provas: 0,
          questoes: 0,
          questoes_acertadas: 0,
          flashcards: 0,
          logins: 0,
          _mlsSum: 0,
          _mlsCount: 0,
          activeMonths: 0
        });
      }

      const acc = studentMap.get(student.nome);
      acc.tempo_min += student.tempo_min || 0;
      acc.aulas += student.aulas || 0;
      acc.videos += student.videos || 0;
      acc.simulados += student.simulados || 0;
      acc.provas += student.provas || 0;
      acc.questoes += student.questoes || 0;
      acc.questoes_acertadas += student.questoes_acertadas || 0;
      acc.flashcards += student.flashcards || 0;
      acc.logins += student.logins || 0;
      if (student.media_login_semanal) {
        acc._mlsSum += student.media_login_semanal;
        acc._mlsCount += 1;
      }
      if (student.turma && !acc.turma) acc.turma = student.turma;
      if (student.active) acc.activeMonths += 1;
    });
  });

  const ranking = Array.from(studentMap.values())
    .map((student) => {
      const questoesDia = totalDays ? student.questoes / totalDays : 0;
      const taxa_acerto = student.questoes > 0 && student.questoes_acertadas > 0
        ? parseFloat((student.questoes_acertadas / student.questoes * 100).toFixed(1))
        : null;
      const media_login_semanal = student._mlsCount > 0
        ? parseFloat((student._mlsSum / student._mlsCount).toFixed(2))
        : null;
      return {
        ...student,
        taxa_acerto,
        media_login_semanal,
        questoesDia,
        traction: getTractionBand(questoesDia)
      };
    })
    .sort((a, b) => (b.questoes - a.questoes) || (b.tempo_min - a.tempo_min) || a.nome.localeCompare(b.nome, "pt-BR"));

  return {
    ranking,
    totalStudents: ranking.length,
    totalQuestions: ranking.reduce((sum, student) => sum + student.questoes, 0),
    totalTempo: ranking.reduce((sum, student) => sum + student.tempo_min, 0),
    avgQuestionsPerDay: totalDays ? ranking.reduce((sum, student) => sum + student.questoes, 0) / totalDays : 0,
    highTractionCount: ranking.filter((student) => student.traction.key === "alta").length,
    moderateTractionCount: ranking.filter((student) => student.traction.key === "moderada").length,
    bestStudent: ranking[0]
  };
}

function getTractionBand(questoesDia) {
  if (questoesDia >= 20) return { key: "alta", label: "Engajamento alto", className: "badge-g" };
  if (questoesDia >= 10) return { key: "moderada", label: "Engajamento moderado", className: "badge-b" };
  return { key: "baixa", label: "Engajamento baixo", className: "badge-o" };
}

function getPeriodEngagement(totalQuestions, days) {
  const rate = totalQuestions / Math.max(days || 1, 1);
  if (rate >= 20) return { key: "alto", label: "Alto", className: "badge-g", rate };
  if (rate >= 10) return { key: "medio", label: "Médio", className: "badge-y", rate };
  return { key: "baixo", label: "Baixo", className: "badge-r", rate };
}

function renderEngagementPage() {
  // Injetar turma switcher inline no ranking
  const engTurmaSlot = document.getElementById("engagementTurmaSlot");
  if (engTurmaSlot) {
    const html = getTurmaSwitcherHTML();
    if (html) {
      engTurmaSlot.innerHTML = `<div class="turma-bar turma-bar-inline">${html}</div>`;
    }
  }

  const kpisRoot = document.getElementById("engagementKpis");
  const chartRoot = document.getElementById("engagementMonthlyChart");
  const insightsRoot = document.getElementById("engagementInsights");
  const spotlightRoot = document.getElementById("engagementSpotlight");
  const searchInput = document.getElementById("engagementSearchInput");
  const sortSelect = document.getElementById("engagementSortSelect");
  const levelSelect = document.getElementById("engagementLevelSelect");

  if (kpisRoot) {
    kpisRoot.innerHTML = [
      {
        value: ACCUMULATED_DASHBOARD.totalStudents,
        label: "Alunos no ciclo",
        meta: "base consolidada de outubro/2025 a março/2026"
      },
      {
        value: formatNumber(ACCUMULATED_DASHBOARD.totalQuestions),
        label: "Questões acumuladas",
        meta: `${formatDecimal(ACCUMULATED_DASHBOARD.avgQuestionsPerDay)} questões/dia no grupo`
      },
      {
        value: formatHours(ACCUMULATED_DASHBOARD.totalTempo),
        label: "Tempo acumulado",
        meta: "tempo oficial da base histórica"
      },
      {
        value: ACCUMULATED_DASHBOARD.highTractionCount,
        label: "Engajamento alto",
        meta: "20 ou mais questões/dia no ciclo"
      },
      {
        value: ACCUMULATED_DASHBOARD.moderateTractionCount,
        label: "Engajamento moderado",
        meta: "entre 10 e 19,9 questões/dia"
      }
    ].map(createKpiCard).join("");
  }

  if (chartRoot) chartRoot.innerHTML = createMonthlyProgressChartSVG(MONTHLY_DASHBOARD);

  if (insightsRoot) {
    const peakQuestionsMonth = [...MONTHLY_DASHBOARD].sort((a, b) => b.totalQuestions - a.totalQuestions)[0];
    const peakHoursMonth = [...MONTHLY_DASHBOARD].sort((a, b) => b.totalTempo - a.totalTempo)[0];
    const bestStudent = ACCUMULATED_DASHBOARD.bestStudent;
    insightsRoot.innerHTML = [
      {
        label: "Melhor destaque do ciclo",
        value: bestStudent ? formatNumber(bestStudent.questoes) : "0",
        meta: bestStudent ? `${bestStudent.nome} · ${formatDecimal(bestStudent.questoesDia)} q/dia` : "Sem dados"
      },
      {
        label: "Pico de questões",
        value: peakQuestionsMonth ? shortMonthLabel(peakQuestionsMonth.label) : "—",
        meta: peakQuestionsMonth ? `${formatNumber(peakQuestionsMonth.totalQuestions)} questões no mês` : "Sem dados"
      },
      {
        label: "Pico de acesso",
        value: peakHoursMonth ? shortMonthLabel(peakHoursMonth.label) : "—",
        meta: peakHoursMonth ? `${formatHours(peakHoursMonth.totalTempo)} no mês` : "Sem dados"
      }
    ].map(createSummaryCard).join("");
  }

  if (spotlightRoot) {
    const top3 = ACCUMULATED_DASHBOARD.ranking.slice(0, 3);
    const bottom3 = [...ACCUMULATED_DASHBOARD.ranking].slice(-3).reverse();
    spotlightRoot.innerHTML = `
      <div class="spotlight-card top">
        <div class="spotlight-title">Top 3 de engajamento</div>
        ${top3.map((student, index) => createSpotlightRow(student, index + 1)).join("")}
      </div>
      <div class="spotlight-card bottom">
        <div class="spotlight-title">Menor engajamento no ciclo</div>
        ${bottom3.map((student, index) => createSpotlightRow(student, ACCUMULATED_DASHBOARD.ranking.length - index)).join("")}
      </div>
    `;
  }

  if (searchInput) searchInput.addEventListener("input", applyEngagementFilters);
  if (sortSelect) sortSelect.addEventListener("change", applyEngagementFilters);
  if (levelSelect) levelSelect.addEventListener("change", applyEngagementFilters);

  applyEngagementFilters();
}

function applyEngagementFilters() {
  const search = (document.getElementById("engagementSearchInput")?.value || "").toLowerCase().trim();
  const level = document.getElementById("engagementLevelSelect")?.value || "";
  const sort = document.getElementById("engagementSortSelect")?.value || "questoes_desc";

  engagementState.filteredRows = ACCUMULATED_DASHBOARD.ranking.filter((student) => {
    if (search && !student.nome.toLowerCase().includes(search)) return false;
    if (level && student.traction.key !== level) return false;
    return true;
  });

  const sortParts = sort.split("_");
  const direction = sortParts.pop();
  const field = sortParts.join("_");
  engagementState.filteredRows.sort((a, b) => {
    if (field === "nome") {
      return direction === "asc"
        ? a.nome.localeCompare(b.nome, "pt-BR")
        : b.nome.localeCompare(a.nome, "pt-BR");
    }
    return direction === "asc" ? a[field] - b[field] : b[field] - a[field];
  });

  renderEngagementRanking();
}

function renderEngagementRanking() {
  const rankingRoot = document.getElementById("engagementRankingBody");
  const theadRoot = rankingRoot?.closest("table")?.querySelector("thead");
  const count = document.getElementById("engagementResultsCount");
  if (!rankingRoot) return;

  const all = ACCUMULATED_DASHBOARD.ranking;
  const hasTurma = all.some(s => s.turma) || Object.keys(TURMA_BY_NAME).length > 0;

  if (theadRoot) {
    theadRoot.innerHTML = `<tr>
      <th style="width:36px">#</th>
      <th>Aluno</th>
      ${hasTurma ? '<th class="num">Turma</th>' : ''}
      <th class="num">Questões</th>
      <th class="num">% Acerto</th>
      <th class="num">Vídeos</th>
      <th class="num">Aulas</th>
      <th class="num">Flashcards</th>
      <th class="num">Logins</th>
      <th class="num">Q/dia</th>
      <th class="num">Tempo</th>
      <th class="num">Meses</th>
      <th>Engajamento</th>
    </tr>`;
  }

  const fmt0 = v => (v > 0 ? formatNumber(v) : '—');

  rankingRoot.innerHTML = engagementState.filteredRows.map((student, index) => {
    const rowTurma = student.turma || TURMA_BY_NAME[student.nome.trim().toLowerCase()] || "—";
    const taxaAcerto = student.taxa_acerto != null
      ? student.taxa_acerto.toFixed(1) + '%'
      : student.questoes_acertadas && student.questoes > 0
        ? ((student.questoes_acertadas / student.questoes) * 100).toFixed(1) + '%'
        : '—';
    return `
    <tr>
      <td style="font-weight:800;color:${index < 3 ? "var(--green-dark)" : "#7a8b7a"}">${index + 1}</td>
      <td style="font-weight:${index < 3 ? "700" : "400"}">${student.nome}</td>
      ${hasTurma ? `<td class="num">${rowTurma}</td>` : ''}
      <td class="num">${formatNumber(student.questoes)}</td>
      <td class="num">${taxaAcerto}</td>
      <td class="num">${fmt0(student.videos)}</td>
      <td class="num">${fmt0(student.aulas)}</td>
      <td class="num">${fmt0(student.flashcards)}</td>
      <td class="num">${fmt0(student.logins)}</td>
      <td class="num">${formatDecimal(student.questoesDia)}</td>
      <td class="num">${formatHours(student.tempo_min)}</td>
      <td class="num">${student.activeMonths}</td>
      <td><span class="badge ${student.traction.className}">${student.traction.label}</span></td>
    </tr>`;
  }).join("");

  if (count) count.textContent = `${engagementState.filteredRows.length} aluno(s) no filtro`;
}

function _buildPeriodThead(hasTurma) {
  return `<tr>
    <th style="width:42px">#</th>
    <th>Aluno</th>
    ${hasTurma ? '<th class="num">Turma</th>' : ''}
    <th class="num">Tempo</th>
    <th class="num">Questões</th>
    <th class="num">% Acerto</th>
    <th class="num">Vídeos</th>
    <th class="num">Aulas</th>
    <th class="num">Flashcards</th>
    <th class="num">Logins</th>
    <th class="num" style="text-align:center">Engajamento</th>
  </tr>`;
}

function renderPeriodPage() {
  const thead = document.querySelector("#periodTableBody")?.closest("table")?.querySelector("thead");
  if (thead) {
    const hasTurma = Object.keys(TURMA_BY_NAME).length > 0 || CURRENT_ALL_DATA.some(e => (e.alunos||e.data||[]).some(a => a.turma));
    thead.innerHTML = _buildPeriodThead(hasTurma);
  }

  const selectorsRoot = document.getElementById("periodSelectorGrid");
  if (selectorsRoot) {
    selectorsRoot.innerHTML = PERIODS.map((period, index) => `
      <button class="period-selector${index === 0 ? " active" : ""}" data-period-index="${index}" type="button">
        <div class="period-label">${period.meta.label}</div>
      </button>
    `).join("");

    selectorsRoot.querySelectorAll("[data-period-index]").forEach((button) => {
      button.addEventListener("click", () => selectPeriod(Number(button.dataset.periodIndex)));
    });
  }

  const searchInput = document.getElementById("periodSearchInput");
  const sortSelect = document.getElementById("periodSortSelect");
  const tractionSelect = document.getElementById("periodTractionSelect");

  if (searchInput) searchInput.addEventListener("input", applyPeriodFilters);
  if (sortSelect) sortSelect.addEventListener("change", applyPeriodFilters);
  if (tractionSelect) tractionSelect.addEventListener("change", applyPeriodFilters);

  // Turma filter bar — UNIVASSOURAS (and any IES with resultsData containing turma field)
  const turmaFilterBar = document.getElementById("periodTurmaFilterBar");
  const hasTurmaData = Object.keys(TURMA_BY_NAME).length > 0;
  if (turmaFilterBar && hasTurmaData) {
    // Collect unique turma values in order
    const turmaOrder = ["\u00ba", "10\u00ba", "11\u00ba", "12\u00ba"].filter(
      (t) => Object.values(TURMA_BY_NAME).includes(t)
    );
    // Re-map to make sure we get the right values
    const allTurmas = [...new Set(Object.values(TURMA_BY_NAME))].sort((a, b) => {
      return parseInt(a) - parseInt(b);
    });

    turmaFilterBar.style.display = "flex";
    turmaFilterBar.innerHTML = `
      <div class="period-filter-wrap">
        <button class="period-filter-btn period-filter-all" data-turma="all">Todos</button>
        ${allTurmas.map((t) => {
          const pc = PERIODO_CONFIG_TURMA.find((p) => p.key === t);
          return `<button class="period-filter-btn" data-turma="${t}"
                    style="--p-color:${pc ? pc.color : "#555"};--p-bg:${pc ? pc.bg : "#f5f5f5"}">
                    <span class="period-filter-dot" style="background:${pc ? pc.color : "#555"}"></span>
                    ${t} período
                  </button>`;
        }).join("")}
      </div>
    `;

    turmaFilterBar.querySelectorAll("[data-turma]").forEach((btn) => {
      btn.addEventListener("click", () => {
        periodState.activeTurmaFilter = btn.dataset.turma;
        // Update active styles
        turmaFilterBar.querySelectorAll("[data-turma]").forEach((b) => {
          const isActive = b.dataset.turma === periodState.activeTurmaFilter;
          const pc = PERIODO_CONFIG_TURMA.find((p) => p.key === b.dataset.turma);
          b.style.background = isActive ? (pc ? pc.color : "var(--green-dark)") : "";
          b.style.color = isActive ? "#fff" : "";
          b.style.borderColor = isActive ? (pc ? pc.color : "var(--green-dark)") : "";
          if (b.dataset.turma === "all" && isActive) {
            b.style.background = "var(--green-dark)";
            b.style.borderColor = "var(--green-dark)";
          }
        });
        applyPeriodFilters();
      });
    });
  }

  renderExportPeriodOptions();
  selectPeriod(0);
}

// Turma color config (shared between period and results pages)
const PERIODO_CONFIG_TURMA = [
  { key: "6\u00ba",  color: "#c2185b", bg: "#fce4ec" },
  { key: "7\u00ba",  color: "#e65100", bg: "#fff3e0" },
  { key: "8\u00ba",  color: "#00838f", bg: "#e0f7fa" },
  { key: "9\u00ba",  color: "#b58600", bg: "#fff8e1" },
  { key: "10\u00ba", color: "#1a6e2e", bg: "#e6f4ea" },
  { key: "11\u00ba", color: "#1155cc", bg: "#e8f0fe" },
  { key: "12\u00ba", color: "#6a1a9a", bg: "#f3e8fd" },
];

function selectPeriod(index) {
  periodState.currentIndex = index;
  periodState.currentPage = 1;

  const period = PERIODS[index];
  document.querySelectorAll(".period-selector").forEach((element) => {
    element.classList.toggle("active", Number(element.dataset.periodIndex) === index);
  });

  const title = document.getElementById("periodSelectedLabel");
  const summary = document.getElementById("periodSelectedSummary");
  const kpisRoot = document.getElementById("periodKpis");
  const insightsRoot = document.getElementById("periodInsights");

  if (title) title.textContent = period.meta.label;
  if (summary) {
    summary.textContent = `Neste recorte, ${formatNumber(period.summary.activeStudents)} aluno(s) estiveram ativos. A média do grupo foi de ${formatDecimal(period.summary.avgQuestionsPerDay)} questões por dia.`;
  }

  const isUnisc = CURRENT_INSTITUTION.key.startsWith("unisc");
  const isCustomIES = !!CURRENT_INSTITUTION.allSimuladoScores; // UNISC, UNIVASSOURAS, etc.

  if (kpisRoot) {
    const kpis = [
      { value: period.summary.activeStudents, label: "Alunos ativos", meta: "participação no período selecionado" },
      { value: formatNumber(period.summary.totalQuestions), label: "Questões", meta: "volume total do período" },
      { value: formatHours(period.summary.totalTempo), label: "Tempo de uso", meta: "tempo histórico do recorte" },
      { value: Math.round(period.summary.avgQuestions), label: "Questões médias", meta: "por aluno na base" },
      ...(!isUnisc ? [{ value: Math.round(period.summary.totalAulas / Math.max(period.data.length, 1)), label: "Aulas médias", meta: "por aluno na base" }] : [])
    ];
    kpisRoot.innerHTML = kpis.map(createKpiCard).join("");
  }

  if (insightsRoot) {
    const insights = [
      {
        label: "Melhor desempenho do recorte",
        value: period.summary.topStudent ? formatNumber(period.summary.topStudent.questoes) : "0",
        meta: period.summary.topStudent ? `${period.summary.topStudent.nome} · ${formatHours(period.summary.topStudent.tempo_min)}` : "Sem dados"
      },
      {
        label: "Ritmo do grupo",
        value: formatDecimal(period.summary.avgQuestionsPerDay),
        meta: "questões por dia no recorte"
      },
      ...(!isCustomIES ? [{
        label: "Vídeos visualizados",
        value: formatNumber(period.summary.totalVideos),
        meta: "volume total do período"
      }] : [])
    ];
    insightsRoot.innerHTML = insights.map(createSummaryCard).join("");
  }

  applyPeriodFilters();
}

function applyPeriodFilters() {
  const period = PERIODS[periodState.currentIndex];
  const search = (document.getElementById("periodSearchInput")?.value || "").toLowerCase().trim();
  const traction = document.getElementById("periodTractionSelect")?.value || "";
  const sort = document.getElementById("periodSortSelect")?.value || "questoes_desc";
  const turmaFilter = periodState.activeTurmaFilter || "all";

  periodState.filteredRows = period.data
    .filter((row) => {
      const engagement = getPeriodEngagement(row.questoes, period.meta.days);
      if (search && !row.nome.toLowerCase().includes(search)) return false;
      if (traction && engagement.key !== traction) return false;
      // Turma filter via TURMA_BY_NAME lookup
      if (turmaFilter !== "all") {
        const rowTurma = TURMA_BY_NAME[row.nome.trim().toLowerCase()];
        if (rowTurma !== turmaFilter) return false;
      }
      return true;
    });

  const sortParts = sort.split("_");
  const direction = sortParts.pop();
  const field = sortParts.join("_");
  periodState.filteredRows.sort((a, b) => {
    if (field === "nome") {
      return direction === "asc"
        ? a.nome.localeCompare(b.nome, "pt-BR")
        : b.nome.localeCompare(a.nome, "pt-BR");
    }
    return direction === "asc" ? a[field] - b[field] : b[field] - a[field];
  });

  periodState.currentPage = 1;
  renderPeriodTable();
}

function renderPeriodTable() {
  const period = PERIODS[periodState.currentIndex];
  const body = document.getElementById("periodTableBody");
  const count = document.getElementById("periodResultsCount");
  const pagination = document.getElementById("periodPagination");
  const thead = body?.closest("table")?.querySelector("thead");
  if (!body) return;

  const hasTurmaData = Object.keys(TURMA_BY_NAME).length > 0 || period.data.some(r => r.turma);
  if (thead) thead.innerHTML = _buildPeriodThead(hasTurmaData);

  const fmt0 = v => (v > 0 ? formatNumber(v) : '—');

  const totalPages = Math.max(1, Math.ceil(periodState.filteredRows.length / PAGE_SIZE));
  const start = (periodState.currentPage - 1) * PAGE_SIZE;
  const pageRows = periodState.filteredRows.slice(start, start + PAGE_SIZE);

  body.innerHTML = pageRows.map((row, index) => {
    const engagement = getPeriodEngagement(row.questoes, period.meta.days);
    const rowTurma = row.turma || (hasTurmaData ? (TURMA_BY_NAME[row.nome.trim().toLowerCase()] || "—") : null);
    const pc = rowTurma && rowTurma !== "—" ? PERIODO_CONFIG_TURMA.find((p) => p.key === rowTurma) : null;
    const turmaCell = !hasTurmaData ? "" : pc
      ? `<td class="num"><span style="display:inline-flex;align-items:center;gap:4px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${pc.color};flex-shrink:0"></span>${rowTurma}</span></td>`
      : `<td class="num">${rowTurma || "—"}</td>`;
    const taxaAcerto = row.questoes_acertadas && row.questoes > 0
      ? ((row.questoes_acertadas / row.questoes) * 100).toFixed(1) + '%'
      : (row.taxa_acerto != null ? Number(row.taxa_acerto).toFixed(1) + '%' : '—');
    return `
      <tr>
        <td style="font-weight:700">${start + index + 1}</td>
        <td>${row.nome}</td>
        ${turmaCell}
        <td class="num">${formatHours(row.tempo_min)}</td>
        <td class="num">${formatNumber(row.questoes)}</td>
        <td class="num">${taxaAcerto}</td>
        <td class="num">${fmt0(row.videos)}</td>
        <td class="num">${formatNumber(row.aulas)}</td>
        <td class="num">${formatNumber(row.flashcards)}</td>
        <td class="num">${fmt0(row.logins)}</td>
        <td style="text-align:center"><span class="badge ${engagement.className}">${engagement.label}</span></td>
      </tr>
    `;
  }).join("");

  if (count) count.textContent = `${periodState.filteredRows.length} aluno(s) no filtro`;
  if (pagination) renderPagination(pagination, totalPages, periodState.currentPage, (nextPage) => {
    periodState.currentPage = nextPage;
    renderPeriodTable();
  });
}


// renderResultsPage removido — será refeita do zero

function renderExportPeriodOptions() {
  const wrap = document.getElementById("exportPeriodOptions");
  if (!wrap) return;

  wrap.innerHTML = PERIODS.map((period, index) => `
    <label class="check-chip">
      <input type="checkbox" ${exportSelections[index] ? "checked" : ""} onchange="updateExportSelection(${index}, this.checked)">
      <span>${period.meta.label}</span>
    </label>
  `).join("");

  updateExportHint();
}

function updateExportSelection(index, checked) {
  exportSelections[index] = checked;
  updateExportHint();
}

function toggleAllExportPeriods() {
  const shouldSelectAll = exportSelections.some((selected) => !selected);
  exportSelections = exportSelections.map(() => shouldSelectAll);
  renderExportPeriodOptions();
}

function updateExportHint() {
  const hint = document.getElementById("exportHint");
  if (!hint) return;

  const selectedCount = exportSelections.filter(Boolean).length;
  hint.textContent = selectedCount
    ? `${selectedCount} período(s) selecionado(s) para exportação.`
    : "Nenhum período selecionado.";
}

function downloadSelectedPeriods() {
  const selectedPeriods = PERIODS.filter((_, index) => exportSelections[index]);
  if (!selectedPeriods.length) {
    updateExportHint();
    return;
  }

  const csvHasTurma = selectedPeriods.flatMap(p => p.data).some(r => r.turma) || Object.keys(TURMA_BY_NAME).length > 0;

  const header = [
    "Periodo",
    "Aluno",
    ...(csvHasTurma ? ["Turma"] : []),
    "Tempo de uso",
    "Tempo (min)",
    "Questoes",
    "% Acerto",
    "Videos",
    "Aulas",
    "Flashcards",
    "Logins",
    "Questoes por dia",
    "Engajamento"
  ];

  const rows = selectedPeriods.flatMap((period) => period.data.map((row) => {
    const engagement = getPeriodEngagement(row.questoes, period.meta.days);
    const rowTurma = row.turma || TURMA_BY_NAME[row.nome?.trim().toLowerCase()] || "";
    const taxa = row.questoes_acertadas && row.questoes > 0
      ? ((row.questoes_acertadas / row.questoes) * 100).toFixed(1)
      : (row.taxa_acerto != null ? Number(row.taxa_acerto).toFixed(1) : "");
    return [
      period.meta.label,
      row.nome,
      ...(csvHasTurma ? [rowTurma] : []),
      formatHours(row.tempo_min),
      row.tempo_min,
      row.questoes,
      taxa,
      row.videos    || 0,
      row.aulas     || 0,
      row.flashcards|| 0,
      row.logins    || 0,
      formatDecimal(engagement.rate),
      engagement.label
    ];
  }));

  const csv = [header, ...rows]
    .map((cols) => cols.map((value) => `"${String(value).replace(/"/g, "\"\"")}"`).join(";"))
    .join("\n");

  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `analises_${slugifyInstitutionName(CURRENT_INSTITUTION.institutionName)}_medcof_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function changeInstitutionPanel() {
  sessionStorage.removeItem(ACCESS_STATE_KEY);
  sessionStorage.removeItem(INSTITUTION_SESSION_KEY);
  window.location.reload();
}

async function handleLogout() {
  try {
    const SUPABASE_URL = 'https://cvwwucxjrpsfoxarsipr.supabase.co';
    const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2d3d1Y3hqcnBzZm94YXJzaXByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMDIxMzgsImV4cCI6MjA5MDg3ODEzOH0.GdpReqo9giSC607JQge8HA9CmZWi-2TcVggU4jCwZhI';
    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    await supabase.auth.signOut();
  } catch(e) {}
  sessionStorage.clear();
  localStorage.clear();
  window.location.href = 'https://grupomedcof.org';
}

// ── Turma switcher ───────────────────────────────────────────
function getTurmaSwitcherHTML() {
  const inst = CURRENT_INSTITUTION;
  const hasTurmas = inst.turmas && inst.turmas.length > 0;
  const hasParent = !!inst.parentKey;
  if (!hasTurmas && !hasParent) return "";

  const parentKey = inst.parentKey || inst.key;
  const parentInst = INSTITUTION_DATASETS[parentKey];
  if (!parentInst || !parentInst.turmas) return "";

  return `
    <div class="turma-bar-inner">
      <span class="turma-bar-label">Turma</span>
      <button class="turma-btn${CURRENT_INSTITUTION_KEY === parentKey ? " active" : ""}"
              onclick="switchTurma('${parentKey}')">
        <span class="turma-btn-dot"></span>Todas
      </button>
      ${parentInst.turmas.map((tk) => {
        const td = INSTITUTION_DATASETS[tk];
        if (!td) return "";
        const lbl = td.turmaLabel || tk;
        const isActive = CURRENT_INSTITUTION_KEY === tk;
        return `<button class="turma-btn${isActive ? " active" : ""}"
                        onclick="switchTurma('${tk}')">
                  <span class="turma-btn-dot"></span>${lbl}
                </button>`;
      }).join("")}
    </div>
  `;
}

function renderTurmaSwitcher() {
  const html = getTurmaSwitcherHTML();
  if (!html) return;

  // Páginas que mostram a turma inline dentro das seções de ranking
  const page = document.body.dataset.page;
  const inlinePages = ["engagement"];
  if (inlinePages.includes(page)) return; // será injetado inline pelas respectivas funções de render

  // Demais páginas (Inicial, Período detalhado): barra no topo
  const bar = document.createElement("div");
  bar.className = "turma-bar";
  bar.innerHTML = html;

  const topbar = document.querySelector(".topbar");
  if (topbar && topbar.nextSibling) {
    topbar.parentNode.insertBefore(bar, topbar.nextSibling);
  } else if (topbar) {
    topbar.parentNode.appendChild(bar);
  }
}

function switchTurma(key) {
  if (!INSTITUTION_DATASETS[key]) return;
  sessionStorage.setItem(INSTITUTION_SESSION_KEY, key);
  window.location.reload();
}


// ══════════════════════════════════════════════════════════════════
// ██  PÁGINA SIMULADOS (hub unificado)                           ██
// ══════════════════════════════════════════════════════════════════
// Routing por hash:
//   (sem hash)        → Hub com 2 cards (Tendências / Personalizado)
//   #tendencias       → Grid de simulados tendências + evolução
//   #personalizado    → Grid de simulados personalizados + evolução
//   #sim=<ref>        → Detalhe de um simulado específico

const _SIM_SUPA = 'https://cvwwucxjrpsfoxarsipr.supabase.co/rest/v1';
const _SIM_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2d3d1Y3hqcnBzZm94YXJzaXByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMDIxMzgsImV4cCI6MjA5MDg3ODEzOH0.GdpReqo9giSC607JQge8HA9CmZWi-2TcVggU4jCwZhI';

// ── Cores de especialidade (idênticas ao boletim do aluno) ──
const _AREA_COLORS = {
  'ginecologia e obstetrícia':'#ec4899','ginecologia':'#ec4899','obstetrícia':'#ec4899',
  'cirurgia':'#2563eb','cirurgia geral':'#2563eb',
  'clínica médica':'#f97316',
  'pediatria':'#a855f7',
  'mfc':'#16a34a','medicina de família':'#16a34a','medicina da família':'#16a34a',
  'preventiva':'#16a34a','preventiva e social':'#16a34a','medicina preventiva':'#16a34a','saúde coletiva':'#16a34a',
  'saúde mental':'#eab308',
  'urgência e emergência':'#dc2626','emergência':'#dc2626'
};
function _areaColor(area) {
  if (!area) return '#78788c';
  const k = area.toLowerCase().trim();
  if (_AREA_COLORS[k]) return _AREA_COLORS[k];
  // Fallback: tenta primeira palavra
  for (const [key, val] of Object.entries(_AREA_COLORS)) {
    if (k.startsWith(key.split(' ')[0])) return val;
  }
  return '#78788c';
}

// ── Cor por faixa de desempenho ──
// < 49% = vermelho, 50-59% = amarelo, ≥ 60% = verde
function _faixaColor(pct) {
  if (pct >= 60) return '#16a34a';  // verde
  if (pct >= 50) return '#d97706';  // amarelo
  return '#dc2626';                 // vermelho
}
function _faixaLabel(pct) {
  if (pct >= 60) return 'Proficiente';
  if (pct >= 50) return 'Quase proficiente';
  return 'Atenção';
}

async function _simFetch(query) {
  const resp = await fetch(`${_SIM_SUPA}/simulado_respostas?${query}`, {
    headers: { apikey: _SIM_KEY, Authorization: `Bearer ${_SIM_KEY}` }
  });
  return resp.ok ? resp.json() : [];
}

// Cache de dados já carregados na sessão
const _simCache = {};

// ── Busca os simRefs válidos para uma IES cruzando com simulados_banco ──
// Retorna Set de refs como "bq_{slug}_{id8}" que realmente existem no banco de simulados
async function _validSimRefs(slug) {
  if (_simCache['_validRefs_' + slug]) return _simCache['_validRefs_' + slug];
  try {
    const resp = await fetch(`${_SIM_SUPA}/simulados_banco?instituicoes_destino=cs.["${slug}"]&select=id`, {
      headers: { apikey: _SIM_KEY, Authorization: `Bearer ${_SIM_KEY}` }
    });
    const sims = resp.ok ? await resp.json() : [];
    const refs = new Set(sims.map(s => `bq_${slug}_${s.id.slice(0, 8)}`));
    // Também aceitar refs de tendências
    sims.forEach(s => refs.add(`bq_${slug}_tendencias_${s.id.slice(0, 8)}`));
    _simCache['_validRefs_' + slug] = refs;
    return refs;
  } catch {
    return null; // fallback: não filtrar se falhar
  }
}


// ── CSS injetado uma vez ──
let _simStylesInjected = false;
function _injectSimStyles() {
  if (_simStylesInjected) return;
  _simStylesInjected = true;
  const s = document.createElement('style');
  s.textContent = `
    .sim-card{background:var(--bg-card);border:1.5px solid var(--border-subtle);border-radius:16px;overflow:hidden;transition:all 0.25s ease;text-decoration:none;display:flex;flex-direction:column}
    .sim-card:hover{border-color:var(--accent);transform:translateY(-3px);box-shadow:0 8px 30px rgba(0,0,0,0.1)}
    .sim-card-top{height:4px;width:100%}
    .sim-card-body{padding:24px 22px;flex:1;display:flex;flex-direction:column;gap:14px}
    .sim-card-tag{font-size:0.65rem;padding:3px 10px;border-radius:6px;font-weight:700;display:inline-block;width:fit-content}
    .sim-card-title{font-size:1rem;font-weight:800;color:var(--text);line-height:1.35}
    .sim-card-metrics{display:flex;gap:14px;flex-wrap:wrap;margin-top:auto}
    .sim-card-metric{flex:1;min-width:70px}
    .sim-card-metric-label{font-size:0.6rem;text-transform:uppercase;font-weight:700;letter-spacing:0.05em;color:var(--text-muted)}
    .sim-card-metric-value{font-size:1.35rem;font-weight:800;line-height:1.2;margin-top:2px}
    .sim-metric-card{background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:12px;padding:18px 20px;text-align:center;min-width:120px}
    .sim-metric-label{font-size:0.62rem;text-transform:uppercase;font-weight:700;letter-spacing:0.05em;color:var(--text-muted);margin-bottom:6px}
    .sim-metric-value{font-size:1.5rem;font-weight:800;color:var(--text);line-height:1.2}
    .sim-insight{display:flex;align-items:flex-start;gap:12px;padding:14px 18px;background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:12px;margin-bottom:10px}
    .sim-insight-icon{font-size:1.2rem;flex-shrink:0;margin-top:1px}
    .sim-insight-text{font-size:0.82rem;color:var(--text);line-height:1.5}
    .sim-insight-text strong{color:var(--text);font-weight:700}
    .sim-area-row{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border-subtle)}
    .sim-area-row:last-child{border-bottom:none}
    .sim-area-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
    .sim-area-name{font-size:0.82rem;font-weight:700;color:var(--text);min-width:180px}
    .sim-area-bar{flex:1;height:10px;background:var(--bg-elevated);border-radius:5px;overflow:hidden}
    .sim-area-fill{height:100%;border-radius:5px;transition:width 0.6s ease}
    .sim-area-pct{font-size:0.88rem;font-weight:800;min-width:55px;text-align:right}
    .sim-back{font-size:0.82rem;color:var(--text-muted);text-decoration:none;display:inline-flex;align-items:center;gap:5px;padding:6px 0;transition:color 0.2s}
    .sim-back:hover{color:var(--text)}
    .sim-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:20px;max-width:1100px;margin:0 auto}
    @media(max-width:700px){.sim-grid{grid-template-columns:1fr}.sim-area-name{min-width:100px}.sim-metric-value{font-size:1.2rem}}
  `;
  document.head.appendChild(s);
}

async function renderSimuladosPage() {
  _injectSimStyles();
  const root = document.getElementById("simuladosRoot");
  if (!root) return;

  const slug = location.pathname.split('/').filter(Boolean)[0];

  // ── Listener de hash para navegação interna ──
  const route = () => _simRoute(root, slug);
  window.addEventListener("hashchange", route);
  route();
}

async function _simRoute(root, slug) {
  const hash = location.hash.replace('#', '');
  if (!hash.startsWith("sim=")) {
    window.__MEDCOF_SIM_CHAT_CTX__ = null;
  }

  if (hash.startsWith('sim=')) {
    const ref = decodeURIComponent(hash.slice(4));
    root.innerHTML = `<div style="padding:48px 0;text-align:center;color:var(--text-muted)"><div class="spinner" style="margin:0 auto 12px;width:28px;height:28px;border:3px solid var(--border-subtle);border-top-color:var(--accent);border-radius:50%;animation:spin 0.8s linear infinite"></div>Carregando simulado...</div><style>@keyframes spin{to{transform:rotate(360deg)}}</style>`;
    await _renderSimuladoDetail(root, slug, ref);
  } else if (hash === 'tendencias' || hash === 'personalizado') {
    root.innerHTML = `<div style="padding:48px 0;text-align:center;color:var(--text-muted)"><div class="spinner" style="margin:0 auto 12px;width:28px;height:28px;border:3px solid var(--border-subtle);border-top-color:var(--accent);border-radius:50%;animation:spin 0.8s linear infinite"></div>Carregando simulados...</div><style>@keyframes spin{to{transform:rotate(360deg)}}</style>`;
    await _renderSimuladoGrid(root, slug, hash);
  } else {
    root.innerHTML = `<div style="padding:48px 0;text-align:center;color:var(--text-muted)"><div class="spinner" style="margin:0 auto 12px;width:28px;height:28px;border:3px solid var(--border-subtle);border-top-color:var(--accent);border-radius:50%;animation:spin 0.8s linear infinite"></div>Carregando...</div><style>@keyframes spin{to{transform:rotate(360deg)}}</style>`;
    await _renderSimuladoHub(root, slug);
  }
}

// ── HUB: 2 cards (Tendências / Personalizado) ──────────────────
async function _renderSimuladoHub(root, slug) {
  // Fetch __RANKING__ rows + validar contra simulados_banco (elimina fantasmas)
  const [allRankings, validRefs] = await Promise.all([
    _simFetch(`ies_slug=eq.${encodeURIComponent(slug)}&aluno_nome=eq.__RANKING__&select=simulado_ref,respostas&order=created_at.desc`),
    _validSimRefs(slug)
  ]);
  // Filtrar: só mostra simulados que existem em simulados_banco
  const rankings = validRefs
    ? allRankings.filter(r => validRefs.has(r.simulado_ref))
    : allRankings;

  let tendCount = 0, persCount = 0, tendLast = null, persLast = null, tendMedia = null, persMedia = null;
  rankings.forEach(r => {
    const ref = r.simulado_ref || '';
    const d = r.respostas || {};
    if (ref.includes('_tendencias_')) {
      tendCount++;
      if (!tendLast) { tendLast = d.simulado_titulo || ref; tendMedia = d.media_ies; }
    } else {
      persCount++;
      if (!persLast) { persLast = d.simulado_titulo || ref; persMedia = d.media_ies; }
    }
  });

  const fmt = (v) => v != null ? `${Number(v).toFixed(1)}%` : '—';
  const hubCard = (href, icon, title, sub, count, media, last, color, disabled) => `
    <a href="${href}" class="sim-card" style="${disabled ? 'opacity:0.5;pointer-events:none' : ''}">
      <div class="sim-card-top" style="background:${color}"></div>
      <div class="sim-card-body">
        <div style="display:flex;align-items:center;gap:14px">
          <div style="width:52px;height:52px;border-radius:14px;background:${color}12;display:flex;align-items:center;justify-content:center;font-size:1.6rem">${icon}</div>
          <div>
            <div style="font-size:1.1rem;font-weight:800;color:var(--text)">${title}</div>
            <div style="font-size:0.76rem;color:var(--text-muted)">${sub}</div>
          </div>
        </div>
        ${count > 0 ? `
          <div class="sim-card-metrics">
            <div class="sim-card-metric"><div class="sim-card-metric-label">Simulados</div><div class="sim-card-metric-value" style="color:var(--text)">${count}</div></div>
            <div class="sim-card-metric"><div class="sim-card-metric-label">Última média</div><div class="sim-card-metric-value" style="color:${color}">${fmt(media)}</div></div>
          </div>
          <div style="font-size:0.76rem;color:var(--text-muted)">Último: <strong>${last}</strong></div>
          <div style="margin-top:8px;font-size:0.78rem;font-weight:700;color:${color};display:flex;align-items:center;gap:4px">Ver resultados <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg></div>
        ` : `<div style="padding:20px 0;text-align:center"><div style="font-size:0.82rem;color:var(--text-muted);font-style:italic">Nenhum resultado processado ainda</div></div>`}
      </div>
    </a>`;

  root.innerHTML = `
    <section class="hero-card hero-strong">
      <div class="hero-kicker">Simulados</div>
      <h1>Análise de simulados</h1>
      <p class="hero-sub">Visualize resultados, evolução temporal e diagnósticos por área, tema e aluno.</p>
    </section>
    <section class="section-shell" style="margin-top:24px">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px;max-width:800px;margin:0 auto">
        ${hubCard('#tendencias','📊','Tendências','ENAMED e simulados nacionais',tendCount,tendMedia,tendLast,'#16a34a',tendCount===0)}
        ${hubCard('#personalizado','🎯','Personalizado','Simulados do banco de questões',persCount,persMedia,persLast,'#3b82f6',persCount===0)}
      </div>
    </section>`;
}

// ── GRID: lista de simulados de um tipo ─────────────────────────
async function _renderSimuladoGrid(root, slug, tipo) {
  // Fetch __RANKING__ rows + validar contra simulados_banco (elimina fantasmas)
  const [allRankings, validRefs] = await Promise.all([
    _simFetch(`ies_slug=eq.${encodeURIComponent(slug)}&aluno_nome=eq.__RANKING__&select=simulado_ref,respostas,created_at&order=created_at.desc`),
    _validSimRefs(slug)
  ]);
  const rankings = validRefs
    ? allRankings.filter(r => validRefs.has(r.simulado_ref))
    : allRankings;

  const isTend = tipo === 'tendencias';
  const filtered = rankings.filter(r => {
    const ref = r.simulado_ref || '';
    return isTend ? ref.includes('_tendencias_') : !ref.includes('_tendencias_');
  });

  const tipoLabel = isTend ? 'Tendências' : 'Personalizado';
  const tipoIcon = isTend ? '📊' : '🎯';
  const tipoColor = isTend ? '#16a34a' : '#3b82f6';
  const backSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>';

  if (filtered.length === 0) {
    root.innerHTML = `
      <div style="padding:20px 0"><a href="#" class="sim-back">${backSvg} Todos os simulados</a></div>
      <div class="empty-state" style="padding:48px 32px"><div class="empty-state-icon">${tipoIcon}</div><h2 class="empty-state-title">Nenhum simulado ${tipoLabel.toLowerCase()}</h2><p class="empty-state-desc">Os resultados aparecerão aqui após o processamento pelo administrador.</p></div>`;
    return;
  }

  const cards = filtered.map(r => {
    const d = r.respostas || {};
    const ref = r.simulado_ref;
    const titulo = d.simulado_titulo || ref;
    const media = d.media_ies;
    const mediaGeral = d.media_geral;
    const rankNac = d.ranking_nacional;
    const rankNacTotal = d.ranking_nacional_total;
    const date = r.created_at ? new Date(r.created_at).toLocaleDateString('pt-BR') : '';
    const mc = media != null ? _faixaColor(media) : 'var(--text-muted)';

    return `
      <a href="#sim=${encodeURIComponent(ref)}" class="sim-card">
        <div class="sim-card-top" style="background:${tipoColor}"></div>
        <div class="sim-card-body">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span class="sim-card-tag" style="background:${tipoColor}15;color:${tipoColor}">${tipoLabel}</span>
            <span style="font-size:0.72rem;color:var(--text-muted)">${date}</span>
          </div>
          <div class="sim-card-title">${titulo}</div>
          <div class="sim-card-metrics">
            <div class="sim-card-metric"><div class="sim-card-metric-label">Média IES</div><div class="sim-card-metric-value" style="color:${mc}">${media != null ? media.toFixed(1) + '%' : '—'}</div></div>
            ${isTend && mediaGeral != null ? `<div class="sim-card-metric"><div class="sim-card-metric-label">Média geral</div><div class="sim-card-metric-value" style="color:var(--text-muted)">${mediaGeral.toFixed(1)}%</div></div>` : ''}
            ${isTend && rankNac != null ? `<div class="sim-card-metric"><div class="sim-card-metric-label">Ranking</div><div class="sim-card-metric-value">${rankNac}<span style="font-size:0.7rem;font-weight:600;color:var(--text-muted)">/${rankNacTotal}</span></div></div>` : ''}
          </div>
        </div>
      </a>`;
  }).join('');

  root.innerHTML = `
    <div style="padding:20px 0"><a href="#" class="sim-back">${backSvg} Todos os simulados</a></div>
    <section class="hero-card hero-strong" style="margin-bottom:24px">
      <div class="hero-kicker" style="color:${tipoColor}">${tipoIcon} ${tipoLabel}</div>
      <h1>Simulados ${tipoLabel.toLowerCase()}</h1>
      <p class="hero-sub">${isTend ? 'Resultados dos simulados ENAMED com ranking nacional e regional.' : 'Resultados dos simulados do banco de questões com análise por área e tema.'}</p>
    </section>
    <section class="section-shell"><div class="sim-grid">${cards}</div></section>`;
}

// Race condition guard — cancela renderização anterior se o usuário navegar rápido
let _simDetailVersion = 0;

// ── DETALHE: análise completa de um simulado ──────────────────
async function _renderSimuladoDetail(root, slug, ref) {
  const myVersion = ++_simDetailVersion;
  const isTend = ref.includes('_tendencias_');
  const tipoLabel = isTend ? 'Tendências' : 'Personalizado';
  const tipoColor = isTend ? 'var(--green)' : 'var(--accent)';
  const backHash = isTend ? '#tendencias' : '#personalizado';

 try {
  // ── 1. Fetch all rows for this simulado (limit 500 to cover edge cases) ──
  const rows = await _simFetch(
    `ies_slug=eq.${encodeURIComponent(slug)}&simulado_ref=eq.${encodeURIComponent(ref)}&select=aluno_nome,respostas,created_at&limit=500`
  );
  // Race condition: se o usuário navegou para outro simulado durante o fetch, abortar
  if (myVersion !== _simDetailVersion) return;

  if (!rows.length) {
    window.__MEDCOF_SIM_CHAT_CTX__ = null;
    root.innerHTML = `
      <div style="padding:20px 0"><a href="${backHash}" style="font-size:0.82rem;color:var(--text-muted);text-decoration:none;display:inline-flex;align-items:center;gap:4px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg> Voltar</a></div>
      <div class="empty-state" style="padding:48px 32px"><div class="empty-state-icon">🔍</div><h2 class="empty-state-title">Simulado não encontrado</h2><p class="empty-state-desc">Os dados deste simulado podem ter sido removidos.</p></div>`;
    return;
  }

  // ── 2. Parse special rows ──
  let meta = null, ranking = null, persData = null;
  const alunos = [];

  rows.forEach(r => {
    const name = r.aluno_nome || '';
    const data = r.respostas || {};
    if (name === '__META__') { meta = data; }
    else if (name === '__RANKING__') { ranking = data; }
    else if (name === '__PERS_DATA__') { persData = data; }
    else if (name.startsWith('__BATCH_')) {
      if (Array.isArray(data.alunos)) alunos.push(...data.alunos);
    }
  });

  const questions = (meta && meta.questions) || [];
  const titulo = (ranking && ranking.simulado_titulo) || (meta && meta.titulo) || (persData && persData.titulo) || ref;
  // Fallback: se não há batches mas persData tem ranking, usar como alunos
  if (alunos.length === 0 && persData && Array.isArray(persData.ranking)) {
    persData.ranking.forEach(r => alunos.push({ nome: r.nome, nota: r.nota, turma: r.turma || '—' }));
  }
  const totalAlunos = alunos.length || (persData && persData.totalAlunos) || 0;
  const totalQuestoes = questions.length || (persData && persData.totalQuestoes) || 0;
  const anuladasInfo = (meta && meta.anuladas) || null;
  const anuladasCount = anuladasInfo ? (anuladasInfo.indices || []).length : 0;

  // ── 3. Compute statistics from alunos ──
  const notas = alunos.map(a => a.nota).filter(n => n != null).sort((a, b) => a - b);
  const mediaIES = ranking ? ranking.media_ies : (notas.length ? (notas.reduce((s, n) => s + n, 0) / notas.length) : null);
  const mediaGeral = ranking ? ranking.media_geral : null;
  const rankNac = ranking ? ranking.ranking_nacional : null;
  const rankNacTotal = ranking ? ranking.ranking_nacional_total : null;
  const rankReg = ranking ? ranking.ranking_regional : null;
  const rankRegTotal = ranking ? ranking.ranking_regional_total : null;
  const mediana = notas.length ? notas[Math.floor(notas.length / 2)] : null;
  const notaMax = notas.length ? notas[notas.length - 1] : null;
  const notaMin = notas.length ? notas[0] : null;

  // ── 4. Compute area stats from alunos ──
  const areaStats = {};
  alunos.forEach(a => {
    if (!a.areas) return;
    Object.entries(a.areas).forEach(([area, pct]) => {
      if (!areaStats[area]) areaStats[area] = { soma: 0, count: 0 };
      areaStats[area].soma += pct;
      areaStats[area].count++;
    });
  });
  let areaList = Object.entries(areaStats).map(([area, s]) => ({
    label: area,
    media: s.count > 0 ? s.soma / s.count : 0
  })).sort((a, b) => b.media - a.media);
  // Fallback: persData.areas se alunos não tinham areas individuais
  if (areaList.length === 0 && persData && Array.isArray(persData.areas)) {
    areaList = persData.areas.map(a => ({ label: a.label, media: a.pct_unisc || a.pct_ies || 0 })).sort((a, b) => b.media - a.media);
  }

  // ── 5. Compute tema stats from questions + alunos resps ──
  const temaStats = {};
  if (questions.length && alunos.length) {
    questions.forEach((q, i) => {
      if (!q.tema) return;
      if (q.anulada) return;
      const tema = q.tema;
      const area = q.area || '—';
      const key = `${area}|||${tema}`;
      if (!temaStats[key]) temaStats[key] = { tema, area, acertos: 0, total: 0 };
      alunos.forEach(a => {
        if (!a.resps || a.resps.length <= i || !a.resps[i]) return;
        temaStats[key].total++;
        if (a.resps[i].toUpperCase() === (q.gab || '').toUpperCase()) temaStats[key].acertos++;
      });
    });
  }
  const temaList = Object.values(temaStats).map(t => ({
    ...t, pct: t.total > 0 ? (t.acertos / t.total * 100) : 0
  })).sort((a, b) => a.pct - b.pct);

  // ── 6. Per-question stats ──
  const qStats = questions.map((q, i) => {
    let acertos = 0, total = 0;
    const distrib = {};
    alunos.forEach(a => {
      if (!a.resps || a.resps.length <= i || !a.resps[i]) return;
      const resp = a.resps[i].toUpperCase();
      total++;
      distrib[resp] = (distrib[resp] || 0) + 1;
      if (resp === (q.gab || '').toUpperCase()) acertos++;
    });
    return { idx: i, q, acertos, total, pct: total > 0 ? (acertos / total * 100) : 0, distrib };
  });

  // ── 7. Distribution histogram (buckets of 10pp) ──
  const buckets = Array.from({ length: 10 }, (_, i) => ({ label: `${i * 10}-${i * 10 + 10}`, count: 0, min: i * 10, max: i * 10 + 10 }));
  notas.forEach(n => {
    const idx = Math.min(Math.floor(n / 10), 9);
    buckets[idx].count++;
  });
  const maxBucket = Math.max(...buckets.map(b => b.count), 1);

  // ── 8. Sort alunos for ranking ──
  const alunosSorted = [...alunos].sort((a, b) => (b.nota || 0) - (a.nota || 0));

  // ── Helper: abreviar nome (Primeira letra + Sobrenome) ──
  // Formatar nome: "PATRICIA OLIVEIRA DA SILVA" → "Patricia Oliveira da Silva"
  const _fmtNome = (nome) => {
    if (!nome || nome.startsWith('CPF:')) return nome || '—';
    const lower = ['da','de','do','dos','das','e'];
    return nome.trim().split(/\s+/).map(p => {
      const l = p.toLowerCase();
      return lower.includes(l) ? l : l.charAt(0).toUpperCase() + l.slice(1);
    }).join(' ');
  };

  // ── Render ──
  const fmtPct = (v) => v != null ? Number(v).toFixed(1) + '%' : '—';

  // ── OVERVIEW ──
  let overviewMetrics = `
    <div class="sim-metric-card">
      <div class="sim-metric-label">Média IES</div>
      <div class="sim-metric-value" style="color:${mediaIES != null ? _faixaColor(mediaIES) : 'var(--text)'}">${fmtPct(mediaIES)}</div>
      ${mediaIES != null ? `<div style="font-size:0.62rem;font-weight:700;color:${_faixaColor(mediaIES)};margin-top:4px">${_faixaLabel(mediaIES)}</div>` : ''}
    </div>
    ${mediaGeral != null ? `<div class="sim-metric-card"><div class="sim-metric-label">Média Geral</div><div class="sim-metric-value" style="color:var(--text-muted)">${fmtPct(mediaGeral)}</div></div>` : ''}
    <div class="sim-metric-card"><div class="sim-metric-label">Alunos</div><div class="sim-metric-value">${totalAlunos}</div></div>
    <div class="sim-metric-card"><div class="sim-metric-label">Questões</div><div class="sim-metric-value">${totalQuestoes}${anuladasCount > 0 ? ` <span style="font-size:0.6rem;color:#d97706">(${anuladasCount} anul.)</span>` : ''}</div></div>
    ${mediana != null ? `<div class="sim-metric-card"><div class="sim-metric-label">Mediana</div><div class="sim-metric-value">${fmtPct(mediana)}</div></div>` : ''}
    ${notaMax != null ? `<div class="sim-metric-card"><div class="sim-metric-label">Maior nota</div><div class="sim-metric-value" style="color:#16a34a">${fmtPct(notaMax)}</div></div>` : ''}
    ${notaMin != null ? `<div class="sim-metric-card"><div class="sim-metric-label">Menor nota</div><div class="sim-metric-value" style="color:#dc2626">${fmtPct(notaMin)}</div></div>` : ''}
  `;

  // Rankings (tendências only)
  let rankingCards = '';
  if (isTend && rankNac != null) {
    rankingCards = `
      <div class="sim-metric-card">
        <div class="sim-metric-label">Ranking Nacional</div>
        <div class="sim-metric-value">${rankNac}<span style="font-size:0.7rem;font-weight:600;color:var(--text-muted)">/${rankNacTotal}</span></div>
      </div>
      ${rankReg != null ? `<div class="sim-metric-card"><div class="sim-metric-label">Ranking Regional</div><div class="sim-metric-value">${rankReg}<span style="font-size:0.7rem;font-weight:600;color:var(--text-muted)">/${rankRegTotal}</span></div></div>` : ''}
    `;
  }

  // ── DISTRIBUTION ──
  let distribHTML = '';
  if (notas.length > 0) {
    distribHTML = `
    <section class="section-shell" style="margin-top:24px">
      <h2 class="section-title">Distribuição de notas</h2>
      <div style="background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:12px;padding:24px">
        <div style="display:flex;align-items:flex-end;gap:4px;height:140px;padding-bottom:4px">
          ${buckets.map(b => {
            const h = maxBucket > 0 ? Math.max((b.count / maxBucket) * 100, b.count > 0 ? 8 : 2) : 2;
            const color = _faixaColor((b.min + b.max) / 2);
            return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%">
              <span style="font-size:0.65rem;font-weight:700;color:var(--text);margin-bottom:2px">${b.count > 0 ? b.count : ''}</span>
              <div style="width:100%;height:${h}%;background:${color};border-radius:4px 4px 0 0;opacity:${b.count > 0 ? 0.85 : 0.2};transition:all 0.3s"></div>
            </div>`;
          }).join('')}
        </div>
        <div style="display:flex;gap:4px;margin-top:4px">
          ${buckets.map(b => `<div style="flex:1;text-align:center;font-size:0.58rem;color:var(--text-muted);font-weight:600">${b.label}</div>`).join('')}
        </div>
        <div style="text-align:center;margin-top:4px;font-size:0.62rem;color:var(--text-muted)">Faixa de notas (%)</div>
      </div>
    </section>`;
  }

  // ── AREAS (com cores de especialidade do boletim) ──
  let areasHTML = '';
  if (areaList.length > 0) {
    areasHTML = `
    <section class="section-shell" style="margin-top:24px">
      <h2 class="section-title">Desempenho por área</h2>
      <div style="background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:16px;padding:24px 22px">
        ${areaList.map(a => {
          const ac = _areaColor(a.label);
          const fc = _faixaColor(a.media);
          return `<div class="sim-area-row">
            <div class="sim-area-dot" style="background:${ac}"></div>
            <div class="sim-area-name">${a.label}</div>
            <div class="sim-area-bar"><div class="sim-area-fill" style="width:${Math.max(a.media, 2)}%;background:${ac}"></div></div>
            <div class="sim-area-pct" style="color:${fc}">${a.media.toFixed(1)}%</div>
          </div>`;
        }).join('')}
      </div>
    </section>`;
  }

  // ── TEMAS (top 10 piores + top 10 melhores) ──
  let temasHTML = '';
  if (temaList.length > 0) {
    const half = Math.ceil(temaList.length / 2);
    const worst = temaList.slice(0, Math.min(10, half));
    const best = temaList.slice(-Math.min(10, half)).reverse();
    const temaRow = (t, type) => {
      const ac = _areaColor(t.area);
      const pctColor = type === 'worst' ? '#dc2626' : '#16a34a';
      return `<div style="display:flex;align-items:center;gap:10px;padding:11px 16px;border-bottom:1px solid var(--border-subtle)">
        <div style="flex:1;min-width:0">
          <div style="font-size:0.82rem;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t.tema}</div>
          <div style="font-size:0.68rem;color:var(--text-muted);margin-top:2px">${t.area}</div>
        </div>
        <div style="font-size:0.92rem;font-weight:800;color:${pctColor};min-width:52px;text-align:right">${t.pct.toFixed(1)}%</div>
      </div>`;
    };
    temasHTML = `
    <section class="section-shell" style="margin-top:24px">
      <h2 class="section-title">Desempenho por tema</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px">
        <div style="background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:16px;overflow:hidden">
          <div style="padding:14px 16px;font-size:0.8rem;font-weight:800;color:#dc2626;background:rgba(220,38,38,0.04);border-bottom:1.5px solid var(--border-subtle);display:flex;align-items:center;gap:8px">
            <span style="width:8px;height:8px;border-radius:50%;background:#dc2626"></span> Temas com menor acerto
          </div>
          ${worst.map(t => temaRow(t, 'worst')).join('')}
        </div>
        <div style="background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:16px;overflow:hidden">
          <div style="padding:14px 16px;font-size:0.8rem;font-weight:800;color:#16a34a;background:rgba(22,163,74,0.04);border-bottom:1.5px solid var(--border-subtle);display:flex;align-items:center;gap:8px">
            <span style="width:8px;height:8px;border-radius:50%;background:#16a34a"></span> Temas com maior acerto
          </div>
          ${best.map(t => temaRow(t, 'best')).join('')}
        </div>
      </div>
    </section>`;
  }

  // ── QUESTIONS (collapsible, sorted by % acerto) ──
  let questoesHTML = '';
  if (qStats.length > 0) {
    const sorted = [...qStats].sort((a, b) => a.pct - b.pct);
    const qRows = sorted.map(qs => {
      const q = qs.q;
      const c = _faixaColor(qs.pct);
      const anulTag = q.anulada ? '<span style="font-size:0.62rem;padding:1px 6px;border-radius:3px;background:rgba(234,179,8,0.15);color:#eab308;font-weight:700;margin-left:6px">ANULADA</span>' : '';
      // Distribution of answers
      const letters = ['A', 'B', 'C', 'D', 'E'];
      const distribHtml = letters.map(l => {
        const cnt = qs.distrib[l] || 0;
        const pctL = qs.total > 0 ? (cnt / qs.total * 100) : 0;
        const isGab = l === (q.gab || '').toUpperCase();
        return `<span style="display:inline-flex;align-items:center;gap:2px;font-size:0.68rem;padding:2px 6px;border-radius:4px;${isGab ? 'background:rgba(22,163,74,0.15);color:#16a34a;font-weight:800' : 'color:var(--text-muted)'}">${l}: ${pctL.toFixed(0)}%</span>`;
      }).join(' ');

      return `<tr style="border-bottom:1px solid var(--border-subtle)">
        <td style="padding:10px 12px;font-size:0.78rem;font-weight:700;color:var(--text);white-space:nowrap">Q${qs.idx + 1}${anulTag}</td>
        <td style="padding:10px 12px;font-size:0.72rem;color:var(--text-muted)">${q.area || '—'}</td>
        <td style="padding:10px 12px;font-size:0.72rem;color:var(--text-muted)">${q.tema || '—'}</td>
        <td style="padding:10px 12px;text-align:center"><span style="font-weight:800;color:#fff;background:#16a34a;padding:3px 10px;border-radius:6px;font-size:0.74rem;letter-spacing:0.05em">${(q.gab || '—').toUpperCase()}</span></td>
        <td style="padding:10px 12px;text-align:right"><span style="font-size:0.82rem;font-weight:800;color:${c}">${qs.pct.toFixed(1)}%</span></td>
        <td style="padding:10px 12px">${distribHtml}</td>
      </tr>`;
    }).join('');

    questoesHTML = `
    <section class="section-shell" style="margin-top:24px">
      <h2 class="section-title">Análise por questão <span style="font-size:0.72rem;font-weight:500;color:var(--text-muted)">(ordenado por % de acerto)</span></h2>
      <div style="background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:12px;overflow:auto">
        <table style="width:100%;border-collapse:collapse;min-width:700px">
          <thead><tr style="background:var(--bg-elevated);border-bottom:1.5px solid var(--border-subtle)">
            <th style="padding:10px 12px;text-align:left;font-size:0.68rem;text-transform:uppercase;font-weight:700;color:var(--text-muted);letter-spacing:0.04em">Questão</th>
            <th style="padding:10px 12px;text-align:left;font-size:0.68rem;text-transform:uppercase;font-weight:700;color:var(--text-muted);letter-spacing:0.04em">Área</th>
            <th style="padding:10px 12px;text-align:left;font-size:0.68rem;text-transform:uppercase;font-weight:700;color:var(--text-muted);letter-spacing:0.04em">Tema</th>
            <th style="padding:10px 12px;text-align:center;font-size:0.68rem;text-transform:uppercase;font-weight:700;color:var(--text-muted);letter-spacing:0.04em">Gabarito</th>
            <th style="padding:10px 12px;text-align:right;font-size:0.68rem;text-transform:uppercase;font-weight:700;color:var(--text-muted);letter-spacing:0.04em">% Acerto</th>
            <th style="padding:10px 12px;font-size:0.68rem;text-transform:uppercase;font-weight:700;color:var(--text-muted);letter-spacing:0.04em">Distribuição</th>
          </tr></thead>
          <tbody>${qRows}</tbody>
        </table>
      </div>
    </section>`;
  }

  // Engagement correlation: build lookup from ACCUMULATED_DASHBOARD
  // Normaliza nome removendo acentos para match robusto
  const _normNome = (n) => (n || '').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const _engMap = {};
  try {
    if (typeof ACCUMULATED_DASHBOARD !== 'undefined' && ACCUMULATED_DASHBOARD.ranking) {
      ACCUMULATED_DASHBOARD.ranking.forEach(s => {
        const key = _normNome(s.nome);
        if (key) _engMap[key] = { questoes: s.questoes || 0, tempo: s.tempo_min || 0, flashcards: s.flashcards || 0, questoesDia: s.questoesDia || 0 };
      });
    }
  } catch(_e) {}

  // ── RANKING ALUNOS com correlação Engajamento x Nota ──
  let rankingHTML = '';
  if (alunosSorted.length > 0) {
    // Engajamento badge: >20 q/dia = alto (verde), >10 = moderado (azul), <10 = baixo (cinza)
    const _engBadge = (nome) => {
      const key = _normNome(nome);
      const eng = _engMap[key];
      if (!eng) return '<span style="font-size:0.68rem;color:var(--text-muted)">—</span>';
      const qDia = eng.questoesDia || 0;
      if (qDia >= 20) return `<span style="display:inline-flex;align-items:center;gap:4px;font-size:0.7rem;font-weight:700;color:#16a34a;background:rgba(22,163,74,0.1);padding:3px 10px;border-radius:6px"><span style="width:6px;height:6px;border-radius:50%;background:#16a34a"></span>${qDia.toFixed(0)} q/dia</span>`;
      if (qDia >= 10) return `<span style="display:inline-flex;align-items:center;gap:4px;font-size:0.7rem;font-weight:700;color:#d97706;background:rgba(217,119,6,0.1);padding:3px 10px;border-radius:6px"><span style="width:6px;height:6px;border-radius:50%;background:#d97706"></span>${qDia.toFixed(0)} q/dia</span>`;
      return `<span style="display:inline-flex;align-items:center;gap:4px;font-size:0.7rem;font-weight:700;color:var(--text-muted);background:var(--bg-elevated);padding:3px 10px;border-radius:6px"><span style="width:6px;height:6px;border-radius:50%;background:var(--text-muted)"></span>${qDia.toFixed(0)} q/dia</span>`;
    };

    const alunoRows = alunosSorted.map((a, i) => {
      const nc = _faixaColor(a.nota || 0);
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
      const nomeFmt = _fmtNome(a.nome);
      return `<tr style="border-bottom:1px solid var(--border-subtle)">
        <td style="padding:10px 14px;font-size:0.85rem;font-weight:700;text-align:center;color:var(--text)">${medal}</td>
        <td style="padding:10px 14px;font-size:0.82rem;font-weight:600;color:var(--text)">${nomeFmt}</td>
        <td style="padding:10px 14px;text-align:center">${_engBadge(a.nome)}</td>
        <td style="padding:10px 14px;text-align:right"><span style="font-size:0.9rem;font-weight:800;color:${nc}">${a.nota != null ? a.nota.toFixed(1) + '%' : '—'}</span></td>
      </tr>`;
    }).join('');

    // Stats de correlação
    let corrInsight = '';
    try {
      let engAlto = 0, engAltoNota = 0, engBaixo = 0, engBaixoNota = 0;
      alunosSorted.forEach(a => {
        const eng = _engMap[_normNome(a.nome)];
        if (eng && a.nota != null) {
          if ((eng.questoesDia || 0) >= 20) { engAlto++; engAltoNota += a.nota; }
          else { engBaixo++; engBaixoNota += a.nota; }
        }
      });
      if (engAlto > 0 && engBaixo > 0) {
        const mediaAlto = engAltoNota / engAlto;
        const mediaBaixo = engBaixoNota / engBaixo;
        const diff = mediaAlto - mediaBaixo;
        corrInsight = `<div style="margin-top:12px;padding:14px 18px;background:var(--bg-elevated);border-radius:10px;font-size:0.78rem;color:var(--text-muted);line-height:1.5">
          📊 <strong style="color:var(--text)">Correlação engajamento × nota:</strong> Alunos com <strong style="color:#16a34a">≥20 q/dia</strong> (${engAlto}) tiveram média de <strong style="color:#16a34a">${mediaAlto.toFixed(1)}%</strong>, enquanto os demais (${engBaixo}) ficaram em <strong style="color:${_faixaColor(mediaBaixo)}">${mediaBaixo.toFixed(1)}%</strong>${diff > 0 ? ` — diferença de <strong>${diff.toFixed(1)}pp</strong>` : ''}.
        </div>`;
      }
    } catch(_e) {}

    rankingHTML = `
    <section class="section-shell" style="margin-top:24px">
      <h2 class="section-title">Ranking de alunos</h2>
      <div style="background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:16px;overflow:auto">
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:var(--bg-elevated);border-bottom:1.5px solid var(--border-subtle)">
            <th style="padding:10px 14px;text-align:center;font-size:0.65rem;text-transform:uppercase;font-weight:700;color:var(--text-muted);width:50px">#</th>
            <th style="padding:10px 14px;text-align:left;font-size:0.65rem;text-transform:uppercase;font-weight:700;color:var(--text-muted)">Aluno</th>
            <th style="padding:10px 14px;text-align:center;font-size:0.65rem;text-transform:uppercase;font-weight:700;color:var(--text-muted)">Engajamento</th>
            <th style="padding:10px 14px;text-align:right;font-size:0.65rem;text-transform:uppercase;font-weight:700;color:var(--text-muted)">Nota</th>
          </tr></thead>
          <tbody>${alunoRows}</tbody>
        </table>
      </div>
      ${corrInsight}
    </section>`;
  }

  // ── INSIGHTS para o coordenador ──
  let insightsHTML = '';
  if (notas.length > 0 || areaList.length > 0) {
    const insights = [];

    // Insight 1: Média geral da turma
    if (mediaIES != null) {
      if (mediaIES < 50) insights.push({ icon: '🚨', text: `A média da turma ficou em <strong>${mediaIES.toFixed(1)}%</strong> — abaixo do limiar de proficiência (60%). É recomendável uma revisão geral dos conteúdos com ênfase nas áreas mais deficitárias.` });
      else if (mediaIES < 60) insights.push({ icon: '⚠️', text: `A média da turma ficou em <strong>${mediaIES.toFixed(1)}%</strong> — quase proficiente. Foque nas áreas com menor desempenho para ultrapassar o limiar de 60%.` });
      else insights.push({ icon: '✅', text: `A turma atingiu <strong>${mediaIES.toFixed(1)}%</strong> de média — acima do limiar de proficiência (60%). Continue trabalhando os temas com menor acerto para consolidar.` });
    }

    // Insight 2: Áreas críticas (< 40%)
    const areasCriticas = areaList.filter(a => a.media < 50);
    if (areasCriticas.length > 0) {
      insights.push({ icon: '🔴', text: `<strong>${areasCriticas.length} área(s) abaixo de 50%:</strong> ${areasCriticas.map(a => `${a.label} (${a.media.toFixed(1)}%)`).join(', ')}. Recomenda-se intervenção pedagógica prioritária nessas áreas.` });
    }

    // Insight 3: Áreas proficientes (>= 60%)
    const areasTop = areaList.filter(a => a.media >= 60);
    if (areasTop.length > 0) {
      insights.push({ icon: '🟢', text: `<strong>${areasTop.length} área(s) acima de 60%:</strong> ${areasTop.map(a => `${a.label} (${a.media.toFixed(1)}%)`).join(', ')}. A turma demonstrou proficiência nessas áreas.` });
    }

    // Insight 4: Dispersão
    if (notaMax != null && notaMin != null) {
      const amplitude = notaMax - notaMin;
      if (amplitude > 40) insights.push({ icon: '📊', text: `A amplitude de notas é de <strong>${amplitude.toFixed(0)}pp</strong> (${notaMin.toFixed(1)}% a ${notaMax.toFixed(1)}%). Há grande dispersão — considere monitoramento individualizado dos alunos na faixa inferior.` });
    }

    // Insight 5: Temas mais deficitários
    if (temaList.length > 0) {
      const worstTema = temaList[0];
      if (worstTema.pct < 30) insights.push({ icon: '📋', text: `O tema com pior desempenho foi <strong>${worstTema.tema}</strong> (${worstTema.area}) com apenas <strong>${worstTema.pct.toFixed(1)}%</strong> de acerto. É um forte candidato para revisão em aula.` });
    }

    // Insight 6: Comparação com média geral (tendências)
    if (isTend && mediaGeral != null && mediaIES != null) {
      const diff = mediaIES - mediaGeral;
      if (diff > 0) insights.push({ icon: '✅', text: `A turma ficou <strong>${diff.toFixed(1)}pp acima</strong> da média geral nacional (${mediaGeral.toFixed(1)}%). Bom desempenho comparativo.` });
      else if (diff < -5) insights.push({ icon: '⚠️', text: `A turma ficou <strong>${Math.abs(diff).toFixed(1)}pp abaixo</strong> da média geral nacional (${mediaGeral.toFixed(1)}%). Recomenda-se intensificar a preparação.` });
    }

    if (insights.length > 0) {
      insightsHTML = `
      <section class="section-shell" style="margin-top:24px">
        <h2 class="section-title">💡 Insights e recomendações</h2>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${insights.map(i => `<div class="sim-insight"><div class="sim-insight-icon">${i.icon}</div><div class="sim-insight-text">${i.text}</div></div>`).join('')}
        </div>
      </section>`;
    }
  }

  // ── LINK BOLETINS (section no final) ──
  const _linkBoletins = ranking ? ranking.link_boletins : null;

  const boletinsHTML = _linkBoletins ? `
    <section class="section-shell" style="margin-top:24px;margin-bottom:40px">
      <div style="background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:16px;padding:24px;display:flex;align-items:center;gap:16px;flex-wrap:wrap">
        <div style="width:48px;height:48px;border-radius:12px;background:rgba(22,163,74,0.1);display:flex;align-items:center;justify-content:center;font-size:1.4rem;flex-shrink:0">📥</div>
        <div style="flex:1;min-width:200px">
          <div style="font-size:0.95rem;font-weight:800;color:var(--text);margin-bottom:4px">Boletins disponíveis para download</div>
          <div style="font-size:0.78rem;color:var(--text-muted);line-height:1.5">Os boletins individuais de todos os alunos estão disponíveis para download via Google Drive.</div>
        </div>
        <a href="${_linkBoletins}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:6px;padding:10px 20px;background:#16a34a;border:none;border-radius:10px;color:#fff;font-size:0.82rem;font-weight:700;text-decoration:none;cursor:pointer;transition:all 0.2s;white-space:nowrap" onmouseover="this.style.background='#15803d'" onmouseout="this.style.background='#16a34a'"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Acessar boletins</a>
      </div>
    </section>` : `
    <section class="section-shell" style="margin-top:24px;margin-bottom:40px">
      <div style="background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:16px;padding:24px;display:flex;align-items:center;gap:16px;flex-wrap:wrap">
        <div style="width:48px;height:48px;border-radius:12px;background:rgba(59,130,246,0.1);display:flex;align-items:center;justify-content:center;font-size:1.4rem;flex-shrink:0">📄</div>
        <div style="flex:1;min-width:200px">
          <div style="font-size:0.95rem;font-weight:800;color:var(--text);margin-bottom:4px">Boletins individuais dos alunos</div>
          <div style="font-size:0.78rem;color:var(--text-muted);line-height:1.5">Os boletins ainda não foram disponibilizados para este simulado. Após a emissão pela central administrativa, o link de acesso será exibido aqui.</div>
        </div>
      </div>
    </section>`;

  // ── ASSEMBLE ──
  // ── Hero banner premium ──
  const backSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>';
  const accentHex = isTend ? '#16a34a' : '#3b82f6';

  // Metric pill
  const _pill = (label, value, color) => `
    <div style="flex:1;min-width:90px;text-align:center;padding:14px 8px;background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:12px">
      <div style="font-size:0.58rem;text-transform:uppercase;font-weight:700;letter-spacing:0.06em;color:var(--text-muted);margin-bottom:6px">${label}</div>
      <div style="font-size:1.35rem;font-weight:800;color:${color || 'var(--text)'};line-height:1.1">${value}</div>
    </div>`;

  let heroPills = '';
  heroPills += _pill('Média IES', fmtPct(mediaIES), mediaIES != null ? _faixaColor(mediaIES) : 'var(--text)');
  if (mediaGeral != null) heroPills += _pill('Média Geral', fmtPct(mediaGeral), 'var(--text-muted)');
  heroPills += _pill('Alunos', totalAlunos);
  heroPills += _pill('Questões', totalQuestoes);
  if (mediana != null) heroPills += _pill('Mediana', fmtPct(mediana));
  if (isTend && rankNac != null) heroPills += _pill('Ranking', `${rankNac}<span style="font-size:0.7rem;font-weight:600;color:var(--text-muted)">/${rankNacTotal}</span>`);

  // Gabarito link (stored in __RANKING__.respostas.link_gabarito)
  const linkGabarito = ranking ? ranking.link_gabarito : null;
  const _heroBtnStyle = `display:inline-flex;align-items:center;gap:6px;padding:8px 18px;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.2);border-radius:10px;color:#fff;font-size:0.78rem;font-weight:700;text-decoration:none;transition:all 0.2s;cursor:pointer`;
  const gabaritoBtn = linkGabarito ? `<a href="${linkGabarito}" target="_blank" rel="noopener" style="${_heroBtnStyle}" onmouseover="this.style.background='rgba(255,255,255,0.2)'" onmouseout="this.style.background='rgba(255,255,255,0.12)'"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>Ver gabarito</a>` : '';

  // Boletins link (stored in __RANKING__.respostas.link_boletins)
  const _linkBol = ranking ? ranking.link_boletins : null;
  const boletinsBtn = _linkBol ? `<a href="${_linkBol}" target="_blank" rel="noopener" style="${_heroBtnStyle}" onmouseover="this.style.background='rgba(255,255,255,0.2)'" onmouseout="this.style.background='rgba(255,255,255,0.12)'"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Baixar boletins</a>` : '';

  window.__MEDCOF_SIM_CHAT_CTX__ = {
    ref,
    titulo,
    tipoSimulado: tipoLabel,
    totalAlunos,
    totalQuestoes,
    mediaIES: mediaIES != null ? Math.round(mediaIES * 10) / 10 : null,
    mediaGeral: mediaGeral != null ? Math.round(mediaGeral * 10) / 10 : null,
    mediana: mediana != null ? Math.round(mediana * 10) / 10 : null,
    notaMin: notaMin != null ? Math.round(notaMin * 10) / 10 : null,
    notaMax: notaMax != null ? Math.round(notaMax * 10) / 10 : null,
    rankingNacional:
      rankNac != null && rankNacTotal != null ? { posicao: rankNac, total: rankNacTotal } : null,
    rankingRegional:
      rankReg != null && rankRegTotal != null ? { posicao: rankReg, total: rankRegTotal } : null,
    areas: areaList.slice(0, 10).map((a) => ({ area: a.label, mediaPct: Math.round(a.media * 10) / 10 })),
    temasMaisFrageis: temaList.slice(0, 8).map((t) => ({
      tema: t.tema,
      area: t.area,
      pctAcertoTurma: Math.round(t.pct * 10) / 10
    })),
    amostraAlunos: alunos.slice(0, 40).map((a) => ({
      nome: a.nome,
      nota: a.nota != null ? Math.round(a.nota * 10) / 10 : null,
      turma: a.turma || null
    }))
  };

  root.innerHTML = `
    <div style="padding:20px 0">
      <a href="${backHash}" class="sim-back">${backSvg} Todos os ${tipoLabel.toLowerCase()}</a>
    </div>

    <section style="background:linear-gradient(135deg, #0f172a 0%, #1e293b 100%);border-radius:20px;padding:32px 30px 28px;margin-bottom:24px;position:relative;overflow:hidden">
      <div style="position:absolute;top:-30px;right:-30px;width:180px;height:180px;border-radius:50%;background:${accentHex};opacity:0.08;pointer-events:none"></div>
      <div style="position:absolute;bottom:-50px;left:30%;width:250px;height:120px;border-radius:50%;background:${accentHex};opacity:0.05;pointer-events:none"></div>
      <div style="position:relative;z-index:1">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;flex-wrap:wrap">
          <span style="font-size:0.68rem;padding:4px 14px;border-radius:8px;background:${accentHex};color:#fff;font-weight:700;letter-spacing:0.04em">${isTend ? '📊' : '🎯'} ${tipoLabel.toUpperCase()}</span>
          ${mediaIES != null ? `<span style="padding:4px 12px;border-radius:20px;font-size:0.62rem;font-weight:700;background:${_faixaColor(mediaIES)}20;color:${_faixaColor(mediaIES)};border:1px solid ${_faixaColor(mediaIES)}40">${_faixaLabel(mediaIES)}</span>` : ''}
          ${anuladasCount > 0 ? `<span style="padding:4px 10px;border-radius:20px;font-size:0.62rem;font-weight:700;background:rgba(217,119,6,0.15);color:#d97706">${anuladasCount} anulada(s)</span>` : ''}
        </div>
        <h1 style="font-size:1.7rem;font-weight:800;color:#fff;margin:0 0 8px;line-height:1.25">${titulo}</h1>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <p style="font-size:0.82rem;color:rgba(255,255,255,0.5);margin:0">${totalAlunos} alunos · ${totalQuestoes} questões${notaMax != null ? ` · Amplitude: ${fmtPct(notaMin)} — ${fmtPct(notaMax)}` : ''}</p>
          ${gabaritoBtn}
          ${boletinsBtn}
        </div>
      </div>
    </section>

    <section class="section-shell" style="margin-bottom:24px">
      <div style="display:flex;flex-wrap:wrap;gap:10px">
        ${heroPills}
      </div>
    </section>

    ${insightsHTML}
    ${distribHTML}
    ${areasHTML}
    ${temasHTML}
    ${questoesHTML}
    ${rankingHTML}
    ${boletinsHTML}
  `;

 } catch (err) {
    console.error('[SimDetail] Erro ao renderizar simulado:', err);
    if (myVersion !== _simDetailVersion) return; // race condition, ignore
    window.__MEDCOF_SIM_CHAT_CTX__ = null;
    root.innerHTML = `
      <div style="padding:20px 0"><a href="${backHash}" style="font-size:0.82rem;color:var(--text-muted);text-decoration:none;display:inline-flex;align-items:center;gap:4px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg> Voltar</a></div>
      <div class="empty-state" style="padding:48px 32px">
        <div class="empty-state-icon">⚠️</div>
        <h2 class="empty-state-title">Erro ao carregar simulado</h2>
        <p class="empty-state-desc">Ocorreu um erro ao processar os dados deste simulado. Tente recarregar a página.</p>
        <p style="font-size:0.7rem;color:var(--text-muted);margin-top:8px;font-family:monospace">${String(err.message || err).slice(0, 120)}</p>
      </div>`;
  }
}

// ── Mensagem de login limpa para a página de simulados (sem gate de senha antigo) ──
function _showSimuladosLoginMessage() {
  const root = document.getElementById('simuladosRoot');
  if (root) {
    root.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;min-height:60vh">
        <div style="text-align:center;max-width:400px;padding:40px">
          <div style="font-size:2.5rem;margin-bottom:16px">🔒</div>
          <h2 style="font-size:1.2rem;font-weight:800;color:var(--text);margin-bottom:8px">Acesso restrito</h2>
          <p style="font-size:0.85rem;color:var(--text-muted);line-height:1.6;margin-bottom:20px">Esta página é exclusiva para coordenadores autenticados. Faça login com suas credenciais para visualizar os resultados dos simulados.</p>
          <a href="/admin.html" style="display:inline-flex;align-items:center;gap:8px;padding:10px 24px;background:var(--accent,#3b82f6);color:#fff;border-radius:10px;font-size:0.85rem;font-weight:700;text-decoration:none;transition:opacity 0.2s" onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
            Acessar painel
          </a>
        </div>
      </div>`;
  }
}

async function mountAccessGate() {
  const storedInstitution = sessionStorage.getItem(INSTITUTION_SESSION_KEY);
  const currentPage = document.body.dataset.page || '';
  // Bypass: admin logado (via localStorage compartilhado entre tabs)
  const isAdmin = sessionStorage.getItem('medcof_admin_bypass') === 'true' || localStorage.getItem('medcof_admin_bypass') === 'true';
  if (isAdmin) { sessionStorage.setItem(ACCESS_STATE_KEY, 'granted'); return; }
  if (sessionStorage.getItem(ACCESS_STATE_KEY) === "granted" && storedInstitution && INSTITUTION_DATASETS[storedInstitution]) return;

  // ── Verificar sessão Supabase Auth (AWAIT — antes de renderizar qualquer gate) ──
  const _SB_URL = 'https://cvwwucxjrpsfoxarsipr.supabase.co';
  const _SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2d3d1Y3hqcnBzZm94YXJzaXByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMDIxMzgsImV4cCI6MjA5MDg3ODEzOH0.GdpReqo9giSC607JQge8HA9CmZWi-2TcVggU4jCwZhI';
  if (window.supabase) {
    const slug = location.pathname.split('/').filter(Boolean)[0];
    try {
      const _sb = window.supabase.createClient(_SB_URL, _SB_KEY);
      const { data } = await _sb.auth.getSession();
      if (data?.session) {
        const meta = data.session.user.user_metadata || {};
        const ok = (meta.role === 'coordenador' && meta.instituicao === slug)
                || meta.role === 'admin' || meta.role === 'superadmin';
        if (ok) {
          sessionStorage.setItem(ACCESS_STATE_KEY, 'granted');
          sessionStorage.setItem(INSTITUTION_SESSION_KEY, slug);
          sessionStorage.setItem('medcof_admin_bypass', 'true');
          localStorage.setItem('medcof_admin_bypass', 'true');
          return; // Autenticado — sem gate
        }
      }
    } catch(_e) { console.warn('Supabase session check:', _e); }
  }

  // ── Página de Simulados: NUNCA mostra o gate antigo de senha ──
  if (currentPage === 'simulados') {
    if (sessionStorage.getItem(ACCESS_STATE_KEY) === 'granted') return;
    _showSimuladosLoginMessage();
    return;
  }

  // ── Não autenticado — redirecionar para login ──
  window.location.href = '/index.html';
}

function initGateRating(root) {
  const starsWrap = root.querySelector("#gateRatingStars");
  const label = root.querySelector("#gateRatingLabel");
  const commentWrap = root.querySelector("#gateRatingComment");
  const sendBtn = root.querySelector("#gateRatingSend");
  const thanks = root.querySelector("#gateRatingThanks");
  if (!starsWrap) return;

  const LABELS = ["", "Muito ruim", "Ruim", "Regular", "Bom", "Excelente"];
  const stars = starsWrap.querySelectorAll(".gate-star");
  let selected = 5;

  // Start with 5 stars selected
  stars.forEach((x) => x.classList.add("active"));
  if (label) { label.textContent = LABELS[5]; label.classList.add("has-value"); }

  const confirmBtn = root.querySelector("#gateRatingConfirm");

  stars.forEach((s) => {
    s.addEventListener("mouseenter", () => {
      const v = Number(s.dataset.star);
      stars.forEach((x) => x.classList.toggle("hovered", Number(x.dataset.star) <= v));
      if (label) label.textContent = LABELS[v];
    });
    s.addEventListener("click", () => {
      selected = Number(s.dataset.star);
      stars.forEach((x) => {
        x.classList.toggle("active", Number(x.dataset.star) <= selected);
        x.classList.remove("hovered");
      });
      if (label) { label.textContent = LABELS[selected]; label.classList.add("has-value"); }
    });
  });

  starsWrap.addEventListener("mouseleave", () => {
    stars.forEach((x) => x.classList.remove("hovered"));
    if (label) label.textContent = selected ? LABELS[selected] : "Avalie este painel";
  });

  // "Enviar" → shows comment box
  if (sendBtn) {
    sendBtn.addEventListener("click", () => {
      if (!selected) return;
      sendBtn.style.display = "none";
      if (commentWrap) commentWrap.style.display = "block";
      const ta = root.querySelector("#gateRatingText");
      if (ta) ta.focus();
    });
  }

  // "Confirmar" → actually sends
  function submitRating() {
    if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = "..."; }
    const comment = (root.querySelector("#gateRatingText")?.value || "").trim();
    const payload = {
      instituicao: "Login screen",
      chave: "",
      rating: selected,
      comentario: comment,
      data: new Date().toISOString(),
      pagina: "gate"
    };
    if (RATING_WEBHOOK_URL) {
      const form = new URLSearchParams();
      Object.entries(payload).forEach(([k, v]) => form.append(k, v));
      fetch(RATING_WEBHOOK_URL, { method: "POST", mode: "no-cors", body: form })
        .finally(() => showGateThanks());
    } else {
      showGateThanks();
    }
  }

  if (confirmBtn) confirmBtn.addEventListener("click", submitRating);

  function showGateThanks() {
    if (starsWrap) starsWrap.style.display = "none";
    if (label) label.style.display = "none";
    if (commentWrap) commentWrap.style.display = "none";
    if (thanks) thanks.style.display = "block";
  }
}

function renderPagination(root, totalPages, currentPage, onSelect) {
  root.innerHTML = "";
  if (totalPages <= 1) return;

  const pages = [];
  for (let page = 1; page <= totalPages; page += 1) pages.push(page);
  pages.forEach((page) => {
    const button = document.createElement("button");
    button.className = `pg-btn${page === currentPage ? " active" : ""}`;
    button.type = "button";
    button.textContent = String(page);
    button.addEventListener("click", () => onSelect(page));
    root.appendChild(button);
  });
}

function createKpiCard(item) {
  return `
    <div class="kpi-card">
      <div class="kpi-value">${item.value}</div>
      <div class="kpi-label">${item.label}</div>
      <div class="kpi-meta">${item.meta}</div>
    </div>
  `;
}

function createSummaryCard(item) {
  return `
    <div class="summary-card">
      <div class="summary-label">${item.label}</div>
      <div class="summary-value">${item.value}</div>
      <div class="summary-meta">${item.meta}</div>
    </div>
  `;
}

function createSpotlightRow(student, rank) {
  return `
    <div class="spotlight-row">
      <div class="spotlight-rank">${rank}</div>
      <div>
        <div class="spotlight-name">${student.nome}</div>
        <div class="spotlight-meta">${formatDecimal(student.questoesDia)} q/dia · ${formatHours(student.tempo_min)}</div>
      </div>
      <div class="spotlight-score">${formatNumber(student.questoes)}</div>
    </div>
  `;
}

function createHighlightRow(student, rankLabel, variant = "top") {
  return `
    <div class="highlight-row ${variant}">
      <div class="rank-pill ${variant}">${rankLabel}</div>
      <div>
        <div class="highlight-name">${student.nome}</div>
        <div class="highlight-tags">
          <span class="badge ${student.band.className}">${student.band.label}</span>
          <span class="badge ${student.traction.className}">${student.traction.label}</span>
        </div>
      </div>
      <div class="highlight-score-chip ${variant}">
        <div class="highlight-score-label">Nota</div>
        <div class="highlight-value">${student.nota}</div>
      </div>
    </div>
  `;
}

function createMonthlyProgressChartSVG(months) {
  if (!months.length) return "";

  const width = 920;
  const height = 360;
  const padding = { top: 40, right: 88, bottom: 62, left: 88 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxQuestions = Math.max(...months.map((month) => month.totalQuestions), 1);
  const maxHours = Math.max(...months.map((month) => month.totalTempo / 60), 1);
  const axisMaxQuestions = getRoundAxisMax(maxQuestions);
  const axisMaxHours = getRoundAxisMax(maxHours);
  const step = chartWidth / months.length;
  const barWidth = Math.min(60, step * 0.48);
  const gridLines = 4;

  const linePoints = months.map((month, index) => {
    const x = padding.left + step * index + step / 2;
    const hours = month.totalTempo / 60;
    const y = padding.top + chartHeight - ((hours / axisMaxHours) * chartHeight);
    return { x, y, hours };
  });

  const linePath = linePoints.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const areaPath = `M ${linePoints[0].x} ${height - padding.bottom} ${linePoints.map((point) => `L ${point.x} ${point.y}`).join(" ")} L ${linePoints[linePoints.length - 1].x} ${height - padding.bottom} Z`;

  // Barras: sem rótulo de valor (apenas tooltip), rótulo do mês no eixo X
  const bars = months.map((month, index) => {
    const barHeight = (month.totalQuestions / axisMaxQuestions) * chartHeight;
    const x = padding.left + step * index + (step - barWidth) / 2;
    const y = padding.top + chartHeight - barHeight;
    const label = shortMonthLabel(month.label);
    return `
      <g>
        <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="10" fill="url(#questionsGradient)">
          <title>${label}: ${formatNumber(month.totalQuestions)} questões e ${formatDecimal(month.totalTempo / 60)}h de acesso</title>
        </rect>
        <text x="${x + (barWidth / 2)}" y="${height - 18}" text-anchor="middle" fill="#3a5a3a" font-size="14" font-weight="700">${label}</text>
      </g>
    `;
  }).join("");

  // Pontos da linha: pílulas com fundo branco sempre visíveis
  const points = linePoints.map((point) => {
    const label = `${formatDecimal(point.hours)}h`;
    const charW = 8.4;
    const pillW = Math.max(label.length * charW + 20, 48);
    const pillH = 24;
    const pillX = point.x - pillW / 2;
    // Posicionar acima do ponto; se muito perto do topo, posicionar abaixo
    const aboveY = point.y - 16;
    const belowY = point.y + 30;
    const pillY = aboveY - pillH < padding.top ? belowY - pillH / 2 : aboveY - pillH;
    const textY = pillY + pillH / 2 + 5;
    return `
    <g>
      <rect x="${pillX}" y="${pillY}" width="${pillW}" height="${pillH}" rx="12"
        fill="#ffffff" stroke="#e8c96a" stroke-width="1.5"
        filter="url(#labelShadow)"></rect>
      <text x="${point.x}" y="${textY}" text-anchor="middle"
        fill="#7a5a00" font-size="13" font-weight="800">${label}</text>
      <circle cx="${point.x}" cy="${point.y}" r="6" fill="#d9b85b" stroke="#fff" stroke-width="3"></circle>
    </g>
  `;
  }).join("");

  // Eixos Y com valores arredondados e limpos
  const grid = Array.from({ length: gridLines + 1 }, (_, index) => {
    const y = padding.top + ((chartHeight / gridLines) * index);
    const qRaw = axisMaxQuestions - ((axisMaxQuestions / gridLines) * index);
    const hRaw = axisMaxHours - ((axisMaxHours / gridLines) * index);
    const qLabel = formatNumber(Math.round(qRaw / 1000) * 1000);
    const hLabel = `${Math.round(hRaw)}h`;
    return `
      <g>
        <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="rgba(84,114,84,0.12)" stroke-dasharray="4 6"></line>
        <text x="${padding.left - 14}" y="${y + 5}" text-anchor="end" fill="#6a8a6a" font-size="13" font-weight="600">${qLabel}</text>
        <text x="${width - padding.right + 14}" y="${y + 5}" text-anchor="start" fill="#a07820" font-size="13" font-weight="600">${hLabel}</text>
      </g>
    `;
  }).join("");

  return `
    <div class="chart-legend chart-legend-prominent" aria-label="Legenda do gráfico">
      <span class="chart-legend-item chart-legend-item-lg">
        <span class="chart-legend-swatch questions" aria-hidden="true"></span>
        <span>
          <span class="chart-legend-label">Questões resolvidas</span>
          <span class="chart-legend-axis">(eixo esquerdo)</span>
        </span>
      </span>
      <span class="chart-legend-item chart-legend-item-lg">
        <span class="chart-legend-swatch hours" aria-hidden="true"></span>
        <span>
          <span class="chart-legend-label">Horas de acesso</span>
          <span class="chart-legend-axis">(eixo direito)</span>
        </span>
      </span>
    </div>
    <svg viewBox="0 0 ${width} ${height}" aria-label="Progressão mensal de engajamento">
      <defs>
        <linearGradient id="questionsGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgba(45,122,58,0.94)"></stop>
          <stop offset="100%" stop-color="rgba(76,175,80,0.72)"></stop>
        </linearGradient>
        <filter id="labelShadow" x="-20%" y="-40%" width="140%" height="180%">
          <feDropShadow dx="0" dy="1" stdDeviation="2" flood-color="rgba(0,0,0,0.12)"/>
        </filter>
      </defs>
      ${grid}
      <path d="${areaPath}" fill="rgba(217,184,91,0.14)"></path>
      ${bars}
      <path d="${linePath}" fill="none" stroke="#d9b85b" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"></path>
      ${points}
    </svg>
  `;
}

function getNiceAxisMax(value) {
  const safeValue = Math.max(Number(value) || 0, 1);
  const exponent = Math.floor(Math.log10(safeValue));
  const fraction = safeValue / (10 ** exponent);

  let niceFraction = 1;
  if (fraction > 1) niceFraction = 2;
  if (fraction > 2) niceFraction = 5;
  if (fraction > 5) niceFraction = 10;

  return niceFraction * (10 ** exponent);
}

// Retorna um máximo de eixo arredondado para múltiplos limpos (1000, 5000, 10000, etc.)
function getRoundAxisMax(value) {
  const safeValue = Math.max(Number(value) || 0, 1);
  if (safeValue < 10) return Math.ceil(safeValue);
  if (safeValue < 100) return Math.ceil(safeValue / 10) * 10;
  if (safeValue < 1000) return Math.ceil(safeValue / 100) * 100;
  if (safeValue < 10000) return Math.ceil(safeValue / 1000) * 1000;
  if (safeValue < 100000) return Math.ceil(safeValue / 5000) * 5000;
  return Math.ceil(safeValue / 10000) * 10000;
}

function isActiveRow(row) {
  return row.tempo_min > 0 || row.questoes > 0 || row.aulas > 0 || row.videos > 0 || row.flashcards > 0;
}

function normalizeName(value) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function averageOf(values) {
  const safe = values.filter((value) => Number.isFinite(value));
  return safe.length ? safe.reduce((sum, value) => sum + value, 0) / safe.length : 0;
}

function medianOf(values) {
  const safe = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!safe.length) return 0;
  const middle = Math.floor(safe.length / 2);
  return safe.length % 2 ? safe[middle] : (safe[middle - 1] + safe[middle]) / 2;
}

function shortMonthLabel(label) {
  const SHORT = { Janeiro:"Jan", Fevereiro:"Fev", "Março":"Mar", Abril:"Abr", Maio:"Mai", Junho:"Jun", Julho:"Jul", Agosto:"Ago", Setembro:"Set", Outubro:"Out", Novembro:"Nov", Dezembro:"Dez" };
  return label.replace(/^([A-Za-zÀ-ÿ]+)\/(\d{4})$/, (_, m, y) => `${SHORT[m] || m.slice(0,3)}/${y.slice(2)}`);
}

function formatNumber(value) {
  const n = Number(value);
  if (!isFinite(n)) return "0";
  return new Intl.NumberFormat("pt-BR").format(n);
}

function formatScore(value) {
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function formatDecimal(value) {
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);
}

function formatSignedScore(value) {
  const abs = formatScore(Math.abs(value));
  if (value > 0) return `+${abs}`;
  if (value < 0) return `-${abs}`;
  return abs;
}

function formatHours(totalMinutes) {
  return `${formatDecimal((totalMinutes || 0) / 60)}h`;
}

// ─── Rating Widget (Home Page) ───────────────────────────────
// URL do Google Apps Script — substituir após publicar o script
const RATING_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbyZQIPkzDFYmNuDmDbQx0eAseGo-4eDWzzaR2N6KkuUVhg8MSrUvJzqEUew0yuHDTG9zw/exec";

function initRatingWidget() {
  const wrap = document.getElementById("ratingStarsWrap");
  const label = document.getElementById("ratingLabel");
  const commentWrap = document.getElementById("ratingCommentWrap");
  const submitBtn = document.getElementById("ratingSubmitBtn");
  const successEl = document.getElementById("ratingSuccess");
  if (!wrap) return;

  const LABELS = ["", "Muito ruim", "Ruim", "Regular", "Bom", "Excelente"];
  const stars = wrap.querySelectorAll(".rating-star");
  let selectedRating = 0;

  // Hover effect
  stars.forEach((star) => {
    star.addEventListener("mouseenter", () => {
      const val = Number(star.dataset.star);
      stars.forEach((s) => s.classList.toggle("hovered", Number(s.dataset.star) <= val));
      label.textContent = LABELS[val];
      label.classList.add("has-value");
    });
  });

  wrap.addEventListener("mouseleave", () => {
    stars.forEach((s) => s.classList.remove("hovered"));
    if (selectedRating) {
      label.textContent = LABELS[selectedRating];
      label.classList.add("has-value");
    } else {
      label.textContent = "Clique em uma estrela para avaliar";
      label.classList.remove("has-value");
    }
  });

  // Click to select
  stars.forEach((star) => {
    star.addEventListener("click", () => {
      selectedRating = Number(star.dataset.star);
      stars.forEach((s) => {
        s.classList.toggle("active", Number(s.dataset.star) <= selectedRating);
        s.classList.remove("hovered");
      });
      label.textContent = LABELS[selectedRating];
      label.classList.add("has-value");
      if (commentWrap) commentWrap.style.display = "block";
    });
  });

  // Submit
  if (submitBtn) {
    submitBtn.addEventListener("click", () => {
      if (!selectedRating) return;
      submitBtn.disabled = true;
      submitBtn.textContent = "Enviando...";

      const comment = (document.getElementById("ratingComment")?.value || "").trim();
      const payload = {
        instituicao: CURRENT_INSTITUTION.institutionName || "Desconhecida",
        chave: CURRENT_INSTITUTION.key || "",
        rating: selectedRating,
        comentario: comment,
        data: new Date().toISOString(),
        pagina: "home"
      };

      if (RATING_WEBHOOK_URL) {
        fetch(RATING_WEBHOOK_URL, {
          method: "POST",
          mode: "no-cors",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        }).then(() => showRatingSuccess())
          .catch(() => showRatingSuccess());
      } else {
        // Fallback — sem webhook configurado, apenas visual
        showRatingSuccess();
      }
    });
  }

  function showRatingSuccess() {
    if (wrap) wrap.style.display = "none";
    if (label) label.style.display = "none";
    if (commentWrap) commentWrap.style.display = "none";
    if (successEl) successEl.style.display = "block";
  }
}

// ══════════════════════════════════════════════════════════════════
// Assistente do coordenador (OpenAI via Netlify Function — chave só no servidor)
// ══════════════════════════════════════════════════════════════════

/**
 * Slug da IES na URL (primeiro segmento do path).
 * @returns {string}
 */
function _medcofSlugFromPath() {
  const parts = location.pathname.split("/").filter(Boolean);
  return parts[0] || CURRENT_INSTITUTION_KEY || DEFAULT_INSTITUTION_KEY || "";
}

/**
 * Monta um JSON resumido do que o coordenador está vendo para enviar ao modelo.
 * @returns {Record<string, unknown>}
 */
function buildCoordenadorChatContext() {
  const page = document.body.dataset.page || "home";
  const slug = _medcofSlugFromPath();
  const inst = {
    slug,
    name: CURRENT_INSTITUTION?.institutionName || "",
    brand: CURRENT_INSTITUTION?.brandTitle || ""
  };
  const base = {
    page,
    institution: inst,
    path: location.pathname,
    hash: location.hash || "",
    generatedAt: new Date().toISOString()
  };

  try {
    if (page === "engagement") {
      const rows = engagementState.filteredRows || [];
      const sample = rows.slice(0, 45).map((s) => ({
        nome: s.nome,
        turma: s.turma || TURMA_BY_NAME[s.nome.trim().toLowerCase()] || null,
        questoes: s.questoes,
        taxa_acerto: s.taxa_acerto,
        engajamento: s.traction?.label,
        questoesDia: s.questoesDia,
        tempo_min: s.tempo_min,
        activeMonths: s.activeMonths
      }));
      return {
        ...base,
        engagement: {
          totalNoFiltro: rows.length,
          amostraAlunos: sample,
          filtros: {
            busca: (document.getElementById("engagementSearchInput")?.value || "").trim(),
            nivel: document.getElementById("engagementLevelSelect")?.value || "",
            ordenacao: document.getElementById("engagementSortSelect")?.value || ""
          },
          totalAlunosBase: ACCUMULATED_DASHBOARD?.ranking?.length || 0
        }
      };
    }

    if (page === "period") {
      const period = PERIODS[periodState.currentIndex];
      const rows = periodState.filteredRows || [];
      const days = period?.meta?.days || 1;
      const sample = rows.slice(0, 45).map((row) => {
        const eng = getPeriodEngagement(row.questoes, days);
        return {
          nome: row.nome,
          turma: row.turma || TURMA_BY_NAME[row.nome.trim().toLowerCase()] || null,
          questoes: row.questoes,
          tempo_min: row.tempo_min,
          engajamento: eng.label
        };
      });
      return {
        ...base,
        periodoDetalhado: {
          periodoLabel: period?.meta?.label || period?.sheet || "",
          turmaFiltro: periodState.activeTurmaFilter,
          totalNoFiltro: rows.length,
          amostraAlunos: sample,
          filtros: {
            busca: (document.getElementById("periodSearchInput")?.value || "").trim(),
            tracao: document.getElementById("periodTractionSelect")?.value || "",
            ordenacao: document.getElementById("periodSortSelect")?.value || ""
          }
        }
      };
    }

    if (page === "simulados") {
      if (window.__MEDCOF_SIM_CHAT_CTX__) {
        return { ...base, simuladoNaTela: window.__MEDCOF_SIM_CHAT_CTX__ };
      }
      return { ...base, simulados: { rotaHash: location.hash || "(início)" } };
    }

    return {
      ...base,
      home: { nota: "Use Engajamento, Período detalhado ou Simulados para dados específicos." }
    };
  } catch (e) {
    return { ...base, erroContexto: String(e && e.message) };
  }
}

/**
 * Sugestões por tipo de página.
 * @param {string} page
 * @returns {string[]}
 */
function getCoordenadorChatSuggestions(page) {
  const map = {
    home: [
      "Como navegar entre engajamento, período e simulados?",
      "O que priorizar para melhorar a turma?",
      "Como interpretar o ranking de engajamento?"
    ],
    engagement: [
      "Quem está com menor engajamento na lista filtrada?",
      "Quais alunos merecem acompanhamento prioritário?",
      "Como explicar a diferença entre questões e tempo na plataforma?"
    ],
    period: [
      "Como está o desempenho deste recorte em relação ao engajamento?",
      "Quais alunos estão abaixo do esperado neste período?",
      "O que significa a faixa de engajamento na tabela?"
    ],
    simulados: [
      "Quais insights pedagógicos você tira deste simulado?",
      "Quais temas ou áreas precisam de reforço?",
      "Como está a turma em relação à média geral?"
    ]
  };
  return map[page] || map.home;
}

/**
 * Garante cliente Supabase no browser (carrega CDN se necessário).
 * @returns {Promise<any>}
 */
async function _medcofEnsureSupabaseForChat() {
  const SB_URL = "https://cvwwucxjrpsfoxarsipr.supabase.co";
  const SB_ANON =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2d3d1Y3hqcnBzZm94YXJzaXByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMDIxMzgsImV4cCI6MjA5MDg3ODEzOH0.GdpReqo9giSC607JQge8HA9CmZWi-2TcVggU4jCwZhI";
  if (!window.supabase) {
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
      s.onload = resolve;
      s.onerror = () => reject(new Error("Não foi possível carregar o cliente Supabase."));
      document.head.appendChild(s);
    });
  }
  if (!window._medcofSbClient) {
    window._medcofSbClient = window.supabase.createClient(SB_URL, SB_ANON);
  }
  return window._medcofSbClient;
}

/**
 * Injeta botão flutuante e painel de chat (após acesso concedido).
 */
function mountCoordenadorChat() {
  if (document.getElementById("medcof-coord-chat-root")) return;

  const root = document.createElement("div");
  root.id = "medcof-coord-chat-root";
  root.innerHTML = `
    <button type="button" class="medcof-coord-chat-fab" id="medcofCoordChatFab" aria-label="Abrir assistente do coordenador" aria-expanded="false">
      <span class="medcof-coord-chat-fab-icon" aria-hidden="true">💬</span>
    </button>
    <div class="medcof-coord-chat-panel" id="medcofCoordChatPanel" hidden>
      <div class="medcof-coord-chat-head">
        <div>
          <div class="medcof-coord-chat-title">Assistente</div>
          <div class="medcof-coord-chat-sub">Com base no que está na tela</div>
        </div>
        <button type="button" class="medcof-coord-chat-close" id="medcofCoordChatClose" aria-label="Fechar">×</button>
      </div>
      <div class="medcof-coord-chat-suggestions" id="medcofCoordChatSuggestions"></div>
      <div class="medcof-coord-chat-messages" id="medcofCoordChatMessages"></div>
      <div class="medcof-coord-chat-error" id="medcofCoordChatError" hidden></div>
      <form class="medcof-coord-chat-form" id="medcofCoordChatForm">
        <input type="text" class="medcof-coord-chat-input" id="medcofCoordChatInput" placeholder="Pergunte sobre alunos, turma ou simulado…" autocomplete="off" maxlength="2000" />
        <button type="submit" class="medcof-coord-chat-send" id="medcofCoordChatSend">Enviar</button>
      </form>
    </div>
  `;
  document.body.appendChild(root);

  const panel = root.querySelector("#medcofCoordChatPanel");
  const fab = root.querySelector("#medcofCoordChatFab");
  const closeBtn = root.querySelector("#medcofCoordChatClose");
  const suggestionsEl = root.querySelector("#medcofCoordChatSuggestions");
  const messagesEl = root.querySelector("#medcofCoordChatMessages");
  const errorEl = root.querySelector("#medcofCoordChatError");
  const form = root.querySelector("#medcofCoordChatForm");
  const input = root.querySelector("#medcofCoordChatInput");
  const sendBtn = root.querySelector("#medcofCoordChatSend");

  const chatUrl = `${window.location.origin}/.netlify/functions/coordenador-chat`;
  let panelOpen = false;
  /** @type {{ role: string, content: string }[]} */
  let thread = [];

  function renderSuggestions() {
    const page = document.body.dataset.page || "home";
    const chips = getCoordenadorChatSuggestions(page);
    suggestionsEl.innerHTML = chips
      .map((text) => {
        const safe = document.createElement("span");
        safe.textContent = text;
        return `<button type="button" class="medcof-coord-chat-chip">${safe.innerHTML}</button>`;
      })
      .join("");
    suggestionsEl.querySelectorAll(".medcof-coord-chat-chip").forEach((btn, i) => {
      btn.addEventListener("click", () => {
        input.value = chips[i];
        form.requestSubmit();
      });
    });
  }

  function appendMessage(role, text) {
    const div = document.createElement("div");
    div.className = `medcof-coord-chat-msg medcof-coord-chat-msg--${role}`;
    div.textContent = text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function setPanel(v) {
    panelOpen = v;
    panel.hidden = !v;
    fab.setAttribute("aria-expanded", v ? "true" : "false");
  }

  fab.addEventListener("click", () => setPanel(!panelOpen));
  closeBtn.addEventListener("click", () => setPanel(false));

  renderSuggestions();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = (input.value || "").trim();
    if (!text) return;
    errorEl.hidden = true;
    appendMessage("user", text);
    input.value = "";
    thread.push({ role: "user", content: text });
    sendBtn.disabled = true;
    const loading = document.createElement("div");
    loading.className = "medcof-coord-chat-msg medcof-coord-chat-msg--assistant medcof-coord-chat-loading";
    loading.textContent = "…";
    messagesEl.appendChild(loading);

    try {
      const sb = await _medcofEnsureSupabaseForChat();
      const { data } = await sb.auth.getSession();
      const token = data?.session?.access_token;
      if (!token) {
        throw new Error("Faça login no painel para usar o assistente.");
      }
      const ies_slug = _medcofSlugFromPath();
      const context = buildCoordenadorChatContext();
      const res = await fetch(chatUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          messages: thread,
          context,
          ies_slug
        })
      });
      const body = await res.json().catch(() => ({}));
      loading.remove();
      if (!res.ok) {
        let msg = body.error || `Erro HTTP ${res.status}`;
        if (res.status === 501 || res.status === 405) {
          msg =
            "Servidor local simples (ex.: python -m http.server) não executa Netlify Functions — por isso o POST retorna 501. Na pasta do projeto rode: npx netlify-cli dev e use a URL indicada (ex.: http://localhost:8888). Em produção, confira o deploy no Netlify.";
        } else if (res.status === 404) {
          msg =
            "Function coordenador-chat não encontrada. Verifique se o deploy inclui netlify/functions e a variável OPENAI_API_KEY no Netlify.";
        }
        throw new Error(msg);
      }
      const reply = body.reply || "";
      appendMessage("assistant", reply);
      thread.push({ role: "assistant", content: reply });
    } catch (err) {
      loading.remove();
      errorEl.textContent = err.message || "Erro ao enviar.";
      errorEl.hidden = false;
    } finally {
      sendBtn.disabled = false;
    }
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && panelOpen) setPanel(false);
  });
}
