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
/** Mesmo vermelho do admin claro (--accent); theme_hex por IES não altera o painel. */
const MEDCOF_PANEL_ACCENT_HEX = "#dc2626";
const PAGE_SIZE = 25;

const INSTITUTION_DATASETS = window.INSTITUTION_DATASETS || {};
// Extrair slug da URL como prioridade máxima (evita carregar dados de outra IES)
const _URL_SLUG = location.pathname.split('/').filter(Boolean)[0] || '';
const DEFAULT_INSTITUTION_KEY = _URL_SLUG || window.DEFAULT_INSTITUTION_KEY || Object.keys(INSTITUTION_DATASETS)[0] || "unicet";
const CURRENT_INSTITUTION_KEY = _URL_SLUG || getStoredInstitutionKey();
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

/** Leitura pública via Netlify (Mongo ou Supabase conforme DATA_BACKEND no servidor). */
async function _anonDataProxyRead(table, query) {
  try {
    const resp = await fetch("/.netlify/functions/anon-data-proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ table, query: query || "" })
    });
    if (!resp.ok) return [];
    return await resp.json();
  } catch {
    return [];
  }
}

/** Superadmin liberou o card Mentor na aba Simulados (medcof_app_config). */
window.__MEDCOF_MENTOR_COORDENADOR_ENABLED__ = false;

/**
 * Lê flag global `mentor_coordenador_enabled` (anon-data-proxy).
 */
async function loadMentorCoordenadorFlag() {
  window.__MEDCOF_MENTOR_COORDENADOR_ENABLED__ = false;
  try {
    const rows = await _anonDataProxyRead(
      "medcof_app_config",
      "select=key,config_value&key=eq.mentor_coordenador_enabled&limit=1"
    );
    const v = rows && rows[0] ? rows[0].config_value : null;
    window.__MEDCOF_MENTOR_COORDENADOR_ENABLED__ = v === true || v === "true";
  } catch {
    window.__MEDCOF_MENTOR_COORDENADOR_ENABLED__ = false;
  }
}

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

/** ISO string ou null — última atualização do payload remoto de engajamento. */
let lastEngajamentoUpdatedAt = null;

// ── Fetch assíncrono do Supabase (chamado no DOMContentLoaded) ──
async function _loadEngajamentoFromSupabase() {
  const slug = CURRENT_INSTITUTION?.key || CURRENT_INSTITUTION_KEY || DEFAULT_INSTITUTION_KEY || "";
  if (!slug) return null;
  try {
    const rows = await _anonDataProxyRead(
      "dashboard_engajamento",
      `select=payload,updated_at&ies_slug=eq.${encodeURIComponent(slug)}&limit=1`
    );
    if (!Array.isArray(rows) || !rows.length) return null;
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
  if (page === "mentor") renderMentorPage();
  if (page === "home") renderHomePage();
}

window.addEventListener("DOMContentLoaded", async () => {
  applyInstitutionBranding();
  // ── Revelar body após tema aplicado (anti-flash) ──
  document.body.setAttribute('data-theme-ready', 'true');
  renderTurmaSwitcher();
  await mountAccessGate();
  await loadMentorCoordenadorFlag();
  const page = document.body.dataset.page;

  // ── Tentar carregar dados frescos do Supabase ──
  const hasStaticData = CURRENT_ALL_DATA.length > 0;
  if (hasStaticData) {
    // Renderiza imediatamente com dados estáticos (sem loading)
    if (page === "engagement") renderEngagementPage();
    if (page === "period") renderPeriodPage();
    if (page === "simulados") renderSimuladosPage();
    if (page === "mentor") renderMentorPage();
    if (page === "home") renderHomePage();
    // Buscar atualização em background — se houver dados mais novos, re-renderiza
    _loadEngajamentoFromSupabase().then(result => {
      if (result && result.updatedAt) lastEngajamentoUpdatedAt = result.updatedAt;
      if (result && result.allData) {
        _refreshDashboardWithData(result.allData);
      } else if (page === "home") {
        renderHomePage();
      }
    });
  } else {
    // Sem dados estáticos — mostrar loading e buscar do Supabase
    if (page === "home") renderHomePage();
    _showLoadingState();
    const result = await _loadEngajamentoFromSupabase();
    if (result && result.updatedAt) lastEngajamentoUpdatedAt = result.updatedAt;
    if (result && result.allData) {
      _refreshDashboardWithData(result.allData);
      _hideLoadingState();
    } else {
      _hideLoadingState();
      // Sem dados em nenhuma fonte — renderizar páginas vazias
      if (page === "engagement") renderEngagementPage();
      if (page === "period") renderPeriodPage();
      if (page === "simulados") renderSimuladosPage();
      if (page === "mentor") renderMentorPage();
      if (page === "home") renderHomePage();
    }
  }

  if (sessionStorage.getItem(ACCESS_STATE_KEY) === "granted") {
    mountCoordenadorChat();
    void mountCoordNotificacoesUi();
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

  // ── Tema síncrono: paleta alinhada ao admin claro (sem theme_hex por IES) ──
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
 * Injeta o mesmo CSS temático que brand-loader.js (cor MedCof fixa — theme_hex do admin não altera o painel).
 */
function _applySyncThemeHex() {
  const hex = MEDCOF_PANEL_ACCENT_HEX;
  if (document.getElementById('brand-loader-theme')) return;
  if (document.getElementById('sync-theme')) return;

  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  const dark  = `rgb(${Math.round(r*.55)},${Math.round(g*.55)},${Math.round(b*.55)})`;
  const mid   = `rgb(${Math.round(r*.75)},${Math.round(g*.75)},${Math.round(b*.75)})`;
  const rgba  = (a) => `rgba(${r},${g},${b},${a})`;

  const toLinear = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const dr = Math.round(r * 0.55);
  const dg = Math.round(g * 0.55);
  const db = Math.round(b * 0.55);
  const theadBgLum =
    0.2126 * toLinear(dr) + 0.7152 * toLinear(dg) + 0.0722 * toLinear(db);
  const theadTextColor = theadBgLum > 0.45 ? "#111827" : "#ffffff";

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
.table-wrap table thead tr { background: ${dark} !important; }
.table-wrap table thead th { background: ${dark} !important; color: ${theadTextColor} !important; }
.table-wrap table tbody th { background: ${rgba(0.06)} !important; color: ${dark} !important; }
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
  const _topRaw = [...rows].sort((a, b) => (b.questoes - a.questoes) || (b.tempo_min - a.tempo_min))[0];
  const topStudent = _topRaw ? { ..._topRaw, questoesDia: (_topRaw.questoes || 0) / safeDays } : null;
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
    avgQuestionsPerDay: activeRows.length
      ? activeRows.reduce((sum, row) => sum + (row.questoes || 0), 0) / activeRows.length / safeDays
      : 0,
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
      const activeList = students.filter((student) => student.active);
      const tqActive = activeList.reduce((sum, s) => sum + s.questoes, 0);
      return {
        key: bucket.key,
        label: bucket.label,
        days: bucket.days,
        students,
        totalQuestions,
        totalTempo,
        activeStudents,
        avgQuestionsPerDay: bucket.days && activeList.length ? tqActive / activeList.length / bucket.days : 0
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
    avgQuestionsPerDay: totalDays && ranking.length
      ? ranking.reduce((sum, student) => sum + student.questoes, 0) / ranking.length / totalDays
      : 0,
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
        meta: `${formatDecimal(ACCUMULATED_DASHBOARD.avgQuestionsPerDay)} q/dia · média por aluno`
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

  // Carregar notas de simulados em paralelo e re-renderizar quando pronto
  _loadSimNotasForEngagement().then(sims => {
    if (sims.length > 0) renderEngagementRanking();
  });
}

function _escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function _formatHomeDateLabel(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return "—";
  }
}

/** Meta de engajamento (q/dia por aluno) — mesma faixa "alta" do ranking. */
const HOME_META_QDIA = 20;

/**
 * Passo “nice” para ticks de eixo em escala ~0–100.
 * @param {number} rawSpan
 * @returns {number}
 */
function _nicePercentAxisStep(rawSpan) {
  if (!rawSpan || rawSpan <= 0) return 1;
  const pow10 = 10 ** Math.floor(Math.log10(rawSpan));
  const f = rawSpan / pow10;
  let nice = 10;
  if (f < 1.5) nice = 1;
  else if (f < 3) nice = 2;
  else if (f < 7) nice = 5;
  return nice * pow10;
}

/**
 * Valores de tick entre lo e hi (inclusivos), limitados a [0, 100].
 * @param {number} lo
 * @param {number} hi
 * @returns {number[]}
 */
function _percentAxisTickValues(lo, hi) {
  const span = hi - lo;
  const step = _nicePercentAxisStep(span / 4);
  const start = Math.ceil((lo - 1e-9) / step) * step;
  const ticks = [];
  for (let t = start; t <= hi + 1e-9; t += step) {
    const v = Math.min(100, Math.max(0, t));
    if (v >= lo - 1e-6 && v <= hi + 1e-6) ticks.push(v);
    if (ticks.length > 12) break;
  }
  if (!ticks.length) return [lo, hi];
  return ticks;
}

/**
 * Linha de evolução da média da IES nos simulados (mesma base da aba Simulados).
 * @param {Array<{ media: number, tipoLabel: string, dateStr: string, detailTitle?: string }>} points
 */
function createHomeSimuladoEvolucaoSVG(points) {
  if (!points.length) return "";
  const w = 640;
  const n = points.length;
  const maxLabLen = points.reduce(
    (m, p) =>
      Math.max(
        m,
        String(p.tipoLabel || "").length + String(p.dateStr || "").length
      ),
    0
  );
  const pt = 30;
  const useXRot = n > 5 || maxLabLen > 22;
  const pb = useXRot ? 62 : 54;
  const ch = 200;
  const h = pt + ch + pb;
  const pl = 28;
  const pr = 28;
  const cw = w - pl - pr;
  const vals = points.map((p) => p.media);
  let minV = Math.min(...vals);
  let maxV = Math.max(...vals);
  let span = maxV - minV;
  if (span < 1e-6) {
    minV -= 2;
    maxV += 2;
    span = 4;
  }
  const pad = Math.max(span * 0.12, 1.5);
  let lo = Math.max(0, minV - pad);
  let hi = Math.min(100, maxV + pad);
  if (hi - lo < 4) {
    const mid = (minV + maxV) / 2;
    lo = Math.max(0, mid - 2);
    hi = Math.min(100, mid + 2);
  }
  const range = Math.max(hi - lo, 1e-6);
  const ySvg = (media) => pt + ch - ((media - lo) / range) * ch;
  const coords = points.map((p, i) => {
    const x = pl + (n === 1 ? cw / 2 : (i / (n - 1)) * cw);
    const y = ySvg(p.media);
    return { x, y };
  });
  const pathD =
    n === 1
      ? ""
      : coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(" ");
  const tickVals = _percentAxisTickValues(lo, hi);
  const gridLines = tickVals
    .map((tv) => {
      const y = ySvg(tv);
      return `<line x1="${pl}" y1="${y.toFixed(1)}" x2="${w - pr}" y2="${y.toFixed(1)}" stroke="#e8eef4" stroke-width="1"/>`;
    })
    .join("");
  const valueLabs = coords
    .map((c, i) => {
      const pct = String(points[i].media.toFixed(1)).replace(".", ",") + "%";
      const va = n > 1 && i === 0 ? "start" : n > 1 && i === n - 1 ? "end" : "middle";
      return `<text x="${c.x.toFixed(1)}" y="${(c.y - 12).toFixed(1)}" text-anchor="${va}" fill="#b91c1c" font-size="11" font-weight="800">${_escapeHtml(pct)}</text>`;
    })
    .join("");
  const dots = coords
    .map(
      (c, i) =>
        `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="5" fill="#fff" stroke="#dc2626" stroke-width="2.5"><title>${_escapeHtml(
          [points[i].detailTitle, points[i].tipoLabel, String(points[i].media.toFixed(1)).replace(".", ",") + "%"]
            .filter(Boolean)
            .join(" · ")
        )}</title></circle>`
    )
    .join("");
  const xLabRot = useXRot ? -34 : 0;
  const fsTipo = n > 6 ? 8 : 9;
  const fsData = n > 6 ? 7 : 7.5;
  const xLabs = points
    .map((p, i) => {
      const xDot = pl + (n === 1 ? cw / 2 : (i / (n - 1)) * cw);
      const tAnchor =
        n > 1 && i === 0 ? "start" : n > 1 && i === n - 1 ? "end" : "middle";
      const xa = xDot;
      const tipo = _escapeHtml(p.tipoLabel || "");
      const dat = _escapeHtml(p.dateStr || "");
      const tspans = dat
        ? `<tspan x="${xa.toFixed(1)}" dy="0" font-size="${fsTipo}" font-weight="700" fill="#475569">${tipo}</tspan><tspan x="${xa.toFixed(1)}" dy="12" font-size="${fsData}" font-weight="500" fill="#94a3b8">${dat}</tspan>`
        : `<tspan x="${xa.toFixed(1)}" dy="0" font-size="${fsTipo}" font-weight="700" fill="#475569">${tipo}</tspan>`;
      if (xLabRot) {
        const pivotY = h - 12;
        const rfs = Math.max(fsTipo - 0.5, 7);
        const rfd = Math.max(fsData - 0.5, 6.5);
        const tspansR = dat
          ? `<tspan x="0" dy="0" font-size="${rfs}" font-weight="700" fill="#475569">${tipo}</tspan><tspan x="0" dy="11" font-size="${rfd}" font-weight="500" fill="#94a3b8">${dat}</tspan>`
          : `<tspan x="0" dy="0" font-size="${rfs}" font-weight="700" fill="#475569">${tipo}</tspan>`;
        return `<g transform="translate(${xa.toFixed(1)},${pivotY}) rotate(${xLabRot})"><text x="0" y="0" text-anchor="${tAnchor}" dominant-baseline="alphabetic">${tspansR}</text></g>`;
      }
      return `<text x="${xa.toFixed(1)}" y="${h - 28}" text-anchor="${tAnchor}" fill="#64748b">${tspans}</text>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${w} ${h}" class="home-sim-evolucao-svg" role="img" aria-label="Evolução da média da IES nos simulados">
    ${gridLines}
    <line x1="${pl}" y1="${pt + ch}" x2="${w - pr}" y2="${pt + ch}" stroke="#cbd5e1" stroke-width="1"/>
    ${pathD ? `<path d="${pathD}" fill="none" stroke="#dc2626" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>` : ""}
    ${valueLabs}
    ${dots}
    ${xLabs}
  </svg>`;
}

/**
 * Carrega e desenha o gráfico de evolução dos simulados na home (assíncrono).
 */
async function _renderHomeSimuladoEvolucaoChart() {
  const el = document.getElementById("homeSimuladoChart");
  if (!el) return;
  const slug = CURRENT_INSTITUTION?.key || CURRENT_INSTITUTION_KEY || "";
  if (!slug) {
    el.innerHTML = `<p class="home-empty-hint">Sem instituição para carregar simulados.</p>`;
    return;
  }
  el.innerHTML = `<div class="home-sim-loading">Carregando evolução…</div>`;
  try {
    const [allRankings, simCtx] = await Promise.all([
      _simFetch(
        `ies_slug=eq.${encodeURIComponent(slug)}&aluno_nome=eq.__RANKING__&select=simulado_ref,respostas,created_at&order=created_at.asc`
      ),
      _simBancoContextForSlug(slug)
    ]);
    const validRefs = simCtx ? simCtx.validRefs : null;
    const rankingsRaw = validRefs ? allRankings.filter((r) => validRefs.has(r.simulado_ref)) : allRankings;
    const rankings = _dedupeSimuladoRankings(rankingsRaw);
    const tipoById8 = simCtx ? simCtx.tipoById8 : null;
    const points = rankings
      .map((r) => {
        const d = r.respostas || {};
        const m = d.media_ies;
        if (m == null || !Number.isFinite(Number(m))) return null;
        const titulo = (d.simulado_titulo && String(d.simulado_titulo).trim()) || "";
        const ref = (r.simulado_ref && String(r.simulado_ref).trim()) || "";
        const nome = titulo || ref || "—";
        const isTend = _refIsTendencias(r.simulado_ref, tipoById8);
        const tipoLabel = isTend ? "Tendências" : "Personalizado";
        const dt = r.created_at ? new Date(r.created_at) : null;
        const dataStr =
          dt && !Number.isNaN(dt.getTime())
            ? dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" })
            : "";
        return {
          media: Number(m),
          tipoLabel,
          dateStr: dataStr,
          detailTitle: nome
        };
      })
      .filter(Boolean);
    if (!points.length) {
      el.innerHTML = `<p class="home-empty-hint">Nenhum simulado com média da IES processada ainda.</p>`;
      return;
    }
    el.innerHTML = `${createHomeSimuladoEvolucaoSVG(points)}<p class="home-sparkline-caption">Média da instituição (%) por resultado, em ordem cronológica — mesma base da aba Simulados. <a class="home-sim-deep-link" href="simulado-personalizado.html">Abrir análise completa</a></p>`;
  } catch (e) {
    console.warn("home simulado chart", e);
    el.innerHTML = `<p class="home-empty-hint">Não foi possível carregar a evolução dos simulados.</p>`;
  }
}

function renderHomePage() {
  const lastUpdatedEl = document.getElementById("homeLastUpdated");
  if (lastUpdatedEl) {
    lastUpdatedEl.textContent = lastEngajamentoUpdatedAt
      ? `Último seguimento: ${_formatHomeDateLabel(lastEngajamentoUpdatedAt)}`
      : "Sem data remota — dados locais ou cache";
  }

  const kpisRoot = document.getElementById("homeKpiRow");
  const monthlyChartRoot = document.getElementById("homeMonthlyChart");
  const attentionRoot = document.getElementById("homeAttention");
  const insightsRoot = document.getElementById("homeCycleInsights");

  const acc = typeof ACCUMULATED_DASHBOARD !== "undefined" ? ACCUMULATED_DASHBOARD : null;
  const total = acc?.totalStudents || 0;
  const high = acc?.highTractionCount || 0;
  const pctMeta = total > 0 ? Math.round((high / total) * 100) : null;
  const avgQd = acc?.avgQuestionsPerDay ?? 0;
  const totalTempoMin = acc?.totalTempo ?? 0;

  if (kpisRoot) {
    kpisRoot.innerHTML = [
      {
        value: total ? String(total) : "—",
        label: "Alunos ativos",
        meta: "no ciclo consolidado"
      },
      {
        value: pctMeta != null ? `${pctMeta}%` : "—",
        label: "Turma na meta",
        meta: `≥${HOME_META_QDIA} q/dia (engajamento alto)`
      },
      {
        value: total ? formatDecimal(avgQd) : "—",
        label: "Questões/dia (média)",
        meta: "média por aluno no ciclo (mesma base do ranking)"
      },
      {
        value: total && totalTempoMin > 0 ? formatHours(totalTempoMin) : "—",
        label: "Tempo total no ciclo",
        meta: "soma do tempo de estudo do grupo"
      }
    ]
      .map(createKpiCard)
      .join("");
  }

  if (monthlyChartRoot) {
    const monthly = MONTHLY_DASHBOARD || [];
    monthlyChartRoot.innerHTML = monthly.length
      ? createMonthlyProgressChartSVG(monthly)
      : `<p class="home-empty-hint">Sem dados mensais para exibir.</p>`;
  }

  if (attentionRoot) {
    const low = (acc?.ranking || [])
      .filter((s) => (s.questoesDia || 0) < HOME_META_QDIA)
      .sort((a, b) => a.questoesDia - b.questoesDia)
      .slice(0, 5);
    const rows = low
      .map(
        (s) => `<div class="home-attention-row">
        <span class="home-attention-name">${_escapeHtml(s.nome)}</span>
        <span class="home-attention-meta">${formatDecimal(s.questoesDia)} q/dia</span>
      </div>`
      )
      .join("");
    attentionRoot.innerHTML = `
      <div class="home-attention-head">
        <div class="section-kicker">Atenção necessária</div>
        <h3 class="home-attention-title">Abaixo da meta (&lt;${HOME_META_QDIA} q/dia)</h3>
      </div>
      <div class="home-attention-list" id="homeAttentionList">${rows || `<p class="home-empty-hint">Nenhum aluno abaixo da meta.</p>`}</div>
    `;
  }

  if (insightsRoot) {
    const monthly = MONTHLY_DASHBOARD || [];
    const peakQuestionsMonth = monthly.length
      ? [...monthly].sort((a, b) => b.totalQuestions - a.totalQuestions)[0]
      : null;
    const peakHoursMonth = monthly.length
      ? [...monthly].sort((a, b) => b.totalTempo - a.totalTempo)[0]
      : null;
    const bestStudent = acc?.bestStudent;
    insightsRoot.innerHTML = `
      <div class="home-insights-head">
        <div class="section-kicker">Insights do ciclo</div>
        <h3 class="home-insights-title">Destaques consolidados</h3>
      </div>
      <div class="insight-list home-insights-grid">
        ${[
          {
            label: "Melhor destaque do ciclo",
            value: bestStudent ? formatNumber(bestStudent.questoes) : "—",
            meta: bestStudent
              ? `${_escapeHtml(bestStudent.nome)} · ${formatDecimal(bestStudent.questoesDia)} q/dia`
              : "Sem dados"
          },
          {
            label: "Pico de questões",
            value: peakQuestionsMonth ? shortMonthLabel(peakQuestionsMonth.label) : "—",
            meta: peakQuestionsMonth
              ? `${formatNumber(peakQuestionsMonth.totalQuestions)} questões no mês`
              : "Sem dados"
          },
          {
            label: "Pico de acesso (tempo)",
            value: peakHoursMonth ? shortMonthLabel(peakHoursMonth.label) : "—",
            meta: peakHoursMonth
              ? `${formatHours(peakHoursMonth.totalTempo)} no mês`
              : "Sem dados"
          }
        ]
          .map(createSummaryCard)
          .join("")}
      </div>
    `;
  }

  _renderHomeSimuladoEvolucaoChart();

  _wireHomeSniperOnce();
  const sniperDl = document.getElementById("homeSniperList");
  if (sniperDl && acc?.ranking?.length) {
    sniperDl.innerHTML = "";
    const frag = document.createDocumentFragment();
    const sorted = [...acc.ranking]
      .filter((r) => r?.nome)
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }));
    const max = Math.min(sorted.length, 600);
    for (let i = 0; i < max; i++) {
      const nome = sorted[i].nome;
      const opt = document.createElement("option");
      opt.value = nome;
      frag.appendChild(opt);
    }
    sniperDl.appendChild(frag);
  }
  _loadSimNotasForEngagement().catch(() => {});
}

/**
 * Modo sniper: envia ao Cofbot pedido de resumo operacional do aluno escolhido.
 */
function _onHomeSniperSubmit() {
  const errEl = document.getElementById("homeSniperError");
  const inp = document.getElementById("homeSniperInput");
  if (errEl) {
    errEl.textContent = "";
    errEl.hidden = true;
  }
  const q = (inp?.value || "").trim();
  if (!q) {
    if (errEl) {
      errEl.textContent = "Digite o nome do aluno.";
      errEl.hidden = false;
    }
    return;
  }
  const student = findStudentInRankingByQuery(q);
  if (!student) {
    if (errEl) {
      errEl.textContent =
        "Nenhum aluno encontrado. Confira a grafia ou escolha um nome da lista de sugestões.";
      errEl.hidden = false;
    }
    return;
  }
  const payload = buildHomeSniperStudentPayload(student);
  const promptText = `[Modo sniper] Gere um resumo operacional objetivo para a coordenação sobre o aluno "${student.nome}": engajamento (faixa e questões/dia), volume de questões e tempo na plataforma, taxa de acerto quando houver, e desempenho nos simulados listados no contexto. Inclua 2 ações práticas imediatas.`;
  if (typeof window.medcofCofbotSubmitSniperPrompt === "function") {
    window.medcofCofbotSubmitSniperPrompt(promptText, payload);
  } else if (errEl) {
    errEl.textContent = "Cofbot disponível após login no painel — recarregue se já estiver autenticado.";
    errEl.hidden = false;
  }
}

function _onHomeSniperClear() {
  const inp = document.getElementById("homeSniperInput");
  const errEl = document.getElementById("homeSniperError");
  if (inp) inp.value = "";
  if (errEl) {
    errEl.textContent = "";
    errEl.hidden = true;
  }
  inp?.focus();
}

function _wireHomeSniperOnce() {
  if (window.__medcofHomeSniperWired) return;
  const btn = document.getElementById("homeSniperSubmit");
  const clearBtn = document.getElementById("homeSniperClear");
  const inp = document.getElementById("homeSniperInput");
  if (!btn || !inp) return;
  window.__medcofHomeSniperWired = true;
  btn.addEventListener("click", _onHomeSniperSubmit);
  if (clearBtn) clearBtn.addEventListener("click", _onHomeSniperClear);
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      _onHomeSniperSubmit();
    }
  });
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

// ── Notas de simulados no engajamento ──
let _engSimCache = null; // { slug, sims: [{label, notaByName}] }
async function _loadSimNotasForEngagement() {
  const slug = CURRENT_INSTITUTION?.key || CURRENT_INSTITUTION_KEY || '';
  if (!slug) return [];
  if (_engSimCache && _engSimCache.slug === slug) return _engSimCache.sims;
  try {
    const rows = await _anonDataProxyRead(
      "simulado_respostas",
      `select=simulado_ref,aluno_nome,respostas&ies_slug=eq.${encodeURIComponent(slug)}&aluno_nome=in.(__RANKING__,__BATCH_0__,__BATCH_1__,__BATCH_2__,__BATCH_3__,__BATCH_4__,__BATCH_5__,__BATCH_6__,__BATCH_7__,__BATCH_8__,__BATCH_9__,__BATCH_10__,__BATCH_11__,__BATCH_12__,__BATCH_13__,__BATCH_14__,__BATCH_15__,__BATCH_16__,__BATCH_17__,__BATCH_18__,__BATCH_19__)`
    );
    if (!Array.isArray(rows) || !rows.length) return [];
    // Agrupar por simulado_ref
    const byRef = {};
    rows.forEach(r => {
      if (!byRef[r.simulado_ref]) byRef[r.simulado_ref] = { ranking: null, alunos: [] };
      if (r.aluno_nome === '__RANKING__') byRef[r.simulado_ref].ranking = r.respostas;
      else (r.respostas?.alunos || []).forEach(a => byRef[r.simulado_ref].alunos.push(a));
    });
    // Montar lista de simulados — apenas completos (com __RANKING__), deduplicar por título
    const normName = n => (n || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const sims = [];
    const simEntries = Object.entries(byRef).filter(([, v]) => v.ranking && v.alunos.length > 0);
    // Ordenar por data de processamento (mais recente último)
    simEntries.sort((a, b) => {
      const da = a[1].ranking?.processado_em || '';
      const db = b[1].ranking?.processado_em || '';
      return da.localeCompare(db);
    });
    // Deduplicar por título — manter o mais recente (último na lista)
    const byTitulo = {};
    simEntries.forEach(([ref, data]) => {
      const titulo = (data.ranking?.simulado_titulo || ref).trim();
      byTitulo[titulo.toLowerCase()] = { ref, data, titulo };
    });
    const uniqueSims = Object.values(byTitulo);
    uniqueSims.sort((a, b) => {
      const da = a.data.ranking?.processado_em || '';
      const db = b.data.ranking?.processado_em || '';
      return da.localeCompare(db);
    });
    let tendCount = 0, persCount = 0;
    uniqueSims.forEach(({ data, titulo }) => {
      const isTend = titulo.toLowerCase().includes('tend');
      if (isTend) tendCount++; else persCount++;
      const label = isTend ? (tendCount > 1 ? `Tend. ${tendCount}` : 'Tend.') : (persCount > 1 ? `Pers. ${persCount}` : 'Pers.');
      const notaByName = {};
      data.alunos.forEach(a => { notaByName[normName(a.nome)] = a.nota; });
      sims.push({ label, notaByName, titulo, isTend });
    });
    // Para a tabela: apenas o último de cada tipo
    const lastTend = [...sims].reverse().find(s => s.isTend);
    const lastPers = [...sims].reverse().find(s => !s.isTend);
    const tableSims = [lastTend, lastPers].filter(Boolean);
    // Histórico completo: todos os simulados por aluno (para popover)
    _engSimCache = { slug, sims, tableSims, allSims: sims };
    return sims;
  } catch(e) { console.warn('Erro ao carregar notas simulado:', e); return []; }
}

function renderEngagementRanking() {
  const rankingRoot = document.getElementById("engagementRankingBody");
  const theadRoot = rankingRoot?.closest("table")?.querySelector("thead");
  const count = document.getElementById("engagementResultsCount");
  if (!rankingRoot) return;

  const all = ACCUMULATED_DASHBOARD.ranking;
  const hasTurma = all.some(s => s.turma) || Object.keys(TURMA_BY_NAME).length > 0;
  const tableSims = _engSimCache?.tableSims || [];
  const allSims = _engSimCache?.allSims || [];
  const normName = n => (n || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  if (theadRoot) {
    theadRoot.innerHTML = `<tr>
      <th style="width:36px">#</th>
      <th>Aluno</th>
      ${hasTurma ? '<th class="num">Turma</th>' : ''}
      <th class="num">Questões</th>
      <th class="num">% Acerto</th>
      <th class="num">Aulas</th>
      <th class="num">Flashcards</th>
      <th class="num">Q/dia</th>
      <th class="num">Tempo</th>
      <th class="num">Meses</th>
      <th>Engajamento</th>
      ${tableSims.map(s => `<th class="num" title="${s.titulo}" style="font-size:0.65rem;white-space:nowrap">${s.label}</th>`).join('')}
    </tr>`;
  }

  const fmt0 = v => (v > 0 ? formatNumber(v) : '—');
  const _notaColor = v => v >= 60 ? '#16a34a' : v >= 50 ? '#eab308' : '#dc2626';

  rankingRoot.innerHTML = engagementState.filteredRows.map((student, index) => {
    const rowTurma = student.turma || TURMA_BY_NAME[student.nome.trim().toLowerCase()] || "—";
    const taxaAcerto = student.taxa_acerto != null
      ? student.taxa_acerto.toFixed(1) + '%'
      : student.questoes_acertadas && student.questoes > 0
        ? ((student.questoes_acertadas / student.questoes) * 100).toFixed(1) + '%'
        : '—';
    const nk = normName(student.nome);
    const simCells = tableSims.map(s => {
      const nota = s.notaByName[nk];
      if (nota == null) return '<td class="num" style="color:var(--text-muted);font-size:0.72rem">—</td>';
      return `<td class="num" style="color:${_notaColor(nota)};font-weight:700;font-size:0.75rem;cursor:pointer" data-aluno-sim="${encodeURIComponent(student.nome)}">${nota.toFixed(1)}%</td>`;
    }).join('');
    // Nome clicável se tem dados de simulado
    const hasAnySim = allSims.some(s => s.notaByName[nk] != null);
    const nameStyle = `font-weight:${index < 3 ? "700" : "400"}${hasAnySim ? ';cursor:pointer;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px' : ''}`;
    return `
    <tr>
      <td style="font-weight:800;color:${index < 3 ? "var(--green-dark)" : "#7a8b7a"}">${index + 1}</td>
      <td style="${nameStyle}" ${hasAnySim ? `data-aluno-sim="${encodeURIComponent(student.nome)}"` : ''}>${student.nome}</td>
      ${hasTurma ? `<td class="num">${rowTurma}</td>` : ''}
      <td class="num">${formatNumber(student.questoes)}</td>
      <td class="num">${taxaAcerto}</td>
      <td class="num">${fmt0(student.aulas)}</td>
      <td class="num">${fmt0(student.flashcards)}</td>
      <td class="num">${formatDecimal(student.questoesDia)}</td>
      <td class="num">${formatHours(student.tempo_min)}</td>
      <td class="num">${student.activeMonths}</td>
      <td><span class="badge ${student.traction.className}">${student.traction.label}</span></td>
      ${simCells}
    </tr>`;
  }).join("");

  if (count) count.textContent = `${engagementState.filteredRows.length} aluno(s) no filtro`;

  // Attach popover listeners
  rankingRoot.querySelectorAll('[data-aluno-sim]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const nome = decodeURIComponent(el.dataset.alunoSim);
      _showSimHistoryPopover(nome, e.target);
    });
  });
}

/** Popover com histórico de notas do aluno nos simulados + mini gráfico */
function _showSimHistoryPopover(nome, anchor) {
  // Remover popover anterior
  document.querySelectorAll('._sim-popover').forEach(p => p.remove());

  const allSims = _engSimCache?.allSims || [];
  const normName = n => (n || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const nk = normName(nome);

  // Coletar notas do aluno em todos os simulados
  const entries = allSims.map(s => ({
    label: s.label,
    titulo: s.titulo,
    nota: s.notaByName[nk] ?? null
  }));
  const withNota = entries.filter(e => e.nota != null);
  if (!withNota.length) return;

  const _nc = v => v >= 60 ? '#16a34a' : v >= 50 ? '#eab308' : '#dc2626';
  const media = withNota.reduce((s, e) => s + e.nota, 0) / withNota.length;

  // Mini gráfico de barras
  const maxNota = Math.max(...withNota.map(e => e.nota), 100);
  const barW = Math.max(40, Math.min(60, 240 / entries.length));
  const chartH = 80;
  const barsHTML = entries.map(e => {
    if (e.nota == null) return `<div style="width:${barW}px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:${chartH}px">
      <div style="width:70%;height:4px;background:#2a2f3e;border-radius:2px;opacity:0.3"></div>
      <div style="font-size:0.58rem;color:#5c6175;margin-top:4px;white-space:nowrap">${e.label}</div>
    </div>`;
    const h = Math.max((e.nota / maxNota) * chartH, 6);
    return `<div style="width:${barW}px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:${chartH}px">
      <div style="font-size:0.62rem;font-weight:700;color:${_nc(e.nota)};margin-bottom:2px">${e.nota.toFixed(0)}%</div>
      <div style="width:70%;height:${h}px;background:${_nc(e.nota)};border-radius:4px 4px 0 0;opacity:0.8"></div>
      <div style="font-size:0.58rem;color:#8b91a5;margin-top:4px;white-space:nowrap">${e.label}</div>
    </div>`;
  }).join('');

  // Linha de 60% (proficiência)
  const line60 = chartH - (60 / maxNota) * chartH;

  // Tabela detalhada
  const tableRows = entries.map(e => `
    <tr style="border-bottom:1px solid #2a2f3e;background:#1a1d27 !important">
      <td style="padding:6px 10px;font-size:0.75rem;font-weight:600;color:#e8eaf0 !important">${e.label}</td>
      <td style="padding:6px 10px;font-size:0.72rem;color:#8b91a5 !important">${e.titulo}</td>
      <td style="padding:6px 10px;font-size:0.75rem;font-weight:700;text-align:center;color:${e.nota != null ? _nc(e.nota) : '#5c6175'} !important">
        ${e.nota != null ? e.nota.toFixed(1) + '%' : '—'}
      </td>
    </tr>`).join('');

  const popover = document.createElement('div');
  popover.className = '_sim-popover';
  popover.style.cssText = 'position:fixed;z-index:99999;background:#1a1d27;color:#e8eaf0;border:1.5px solid #2a2f3e;border-radius:16px;padding:24px;box-shadow:0 12px 40px rgba(0,0,0,0.6);max-width:500px;width:92vw';

  // Buscar engajamento (q/dia) do aluno
  let engBadgeHTML = '';
  try {
    const _normEng = n => (n || '').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
    const nomeKey = _normEng(nome);
    const accRanking = typeof ACCUMULATED_DASHBOARD !== 'undefined' ? ACCUMULATED_DASHBOARD.ranking : [];
    const student = accRanking.find(s => _normEng(s.nome) === nomeKey);
    if (student) {
      const qDia = student.questoesDia || 0;
      if (qDia >= 20) {
        engBadgeHTML = `<span style="display:inline-flex;align-items:center;gap:4px;font-size:0.7rem;font-weight:700;color:#16a34a;background:rgba(22,163,74,0.15);padding:3px 10px;border-radius:6px"><span style="width:6px;height:6px;border-radius:50%;background:#16a34a"></span>${qDia.toFixed(0)} q/dia</span>`;
      } else if (qDia >= 10) {
        engBadgeHTML = `<span style="display:inline-flex;align-items:center;gap:4px;font-size:0.7rem;font-weight:700;color:#d97706;background:rgba(217,119,6,0.15);padding:3px 10px;border-radius:6px"><span style="width:6px;height:6px;border-radius:50%;background:#d97706"></span>${qDia.toFixed(0)} q/dia</span>`;
      } else {
        engBadgeHTML = `<span style="display:inline-flex;align-items:center;gap:4px;font-size:0.7rem;font-weight:700;color:#dc2626;background:rgba(220,38,38,0.15);padding:3px 10px;border-radius:6px"><span style="width:6px;height:6px;border-radius:50%;background:#dc2626"></span>${qDia.toFixed(0)} q/dia</span>`;
      }
    } else {
      engBadgeHTML = `<span style="font-size:0.65rem;color:#5c6175">só simulado</span>`;
    }
  } catch(_) {}

  popover.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
          <span style="font-size:1rem;font-weight:800;color:#e8eaf0">${nome}</span>
          ${engBadgeHTML}
        </div>
        <div style="font-size:0.75rem;color:#8b91a5">${withNota.length} simulado(s) · Média: <strong style="color:${_nc(media)}">${media.toFixed(1)}%</strong></div>
      </div>
      <button onclick="this.closest('._sim-popover').remove()" style="background:none;border:none;font-size:1.2rem;cursor:pointer;color:#8b91a5;padding:4px">✕</button>
    </div>
    <div style="display:flex;align-items:flex-end;justify-content:center;gap:2px;margin-bottom:16px;position:relative;padding:0 4px">
      <div style="position:absolute;top:${line60}px;left:0;right:0;border-top:1.5px dashed rgba(22,163,74,0.3);z-index:1"></div>
      <div style="position:absolute;top:${line60 - 8}px;right:4px;font-size:0.5rem;color:rgba(22,163,74,0.5);z-index:1">60%</div>
      ${barsHTML}
    </div>
    <div style="border:1px solid #2a2f3e;border-radius:10px;overflow:hidden">
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:#1e2230">
          <th style="padding:6px 10px;font-size:0.62rem;text-transform:uppercase;font-weight:700;color:#8b91a5;text-align:left">Sim.</th>
          <th style="padding:6px 10px;font-size:0.62rem;text-transform:uppercase;font-weight:700;color:#8b91a5;text-align:left">Título</th>
          <th style="padding:6px 10px;font-size:0.62rem;text-transform:uppercase;font-weight:700;color:#8b91a5;text-align:center">Nota</th>
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>`;

  document.body.appendChild(popover);

  // Position near anchor
  const rect = anchor.getBoundingClientRect();
  let top = rect.bottom + 8;
  let left = rect.left;
  if (top + 400 > window.innerHeight) top = rect.top - 400;
  if (left + 500 > window.innerWidth) left = window.innerWidth - 510;
  if (left < 10) left = 10;
  popover.style.top = top + 'px';
  popover.style.left = left + 'px';

  // Close on outside click
  setTimeout(() => {
    const close = (e) => {
      if (!popover.contains(e.target)) { popover.remove(); document.removeEventListener('click', close); }
    };
    document.addEventListener('click', close);
  }, 100);
}

function _buildPeriodThead(hasTurma) {
  return `<tr>
    <th style="width:42px">#</th>
    <th>Aluno</th>
    ${hasTurma ? '<th class="num">Turma</th>' : ''}
    <th class="num">Tempo</th>
    <th class="num">Questões</th>
    <th class="num">% Acerto</th>
    <th class="num">Aulas</th>
    <th class="num">Flashcards</th>
    <th scope="col" style="text-align:center">Engajamento</th>
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
  initPeriodFiltersCollapsible();
  selectPeriod(0);
}

/**
 * Card colapsável dos filtros da tabela detalhada (período).
 */
function initPeriodFiltersCollapsible() {
  const toggle = document.getElementById("periodFiltersToggle");
  const panel = document.getElementById("periodFiltersPanel");
  if (!toggle || !panel || toggle.dataset.bound === "1") return;
  toggle.dataset.bound = "1";
  const chevron = toggle.querySelector(".period-filters-chevron");
  toggle.addEventListener("click", () => {
    const willOpen = panel.hasAttribute("hidden");
    if (willOpen) panel.removeAttribute("hidden");
    else panel.setAttribute("hidden", "");
    toggle.setAttribute("aria-expanded", willOpen ? "true" : "false");
    toggle.classList.toggle("is-open", willOpen);
    if (chevron) chevron.classList.toggle("is-open", willOpen);
  });
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
        meta: period.summary.topStudent ? `${period.summary.topStudent.nome} · ${formatDecimal(period.summary.topStudent.questoesDia)} q/dia · ${formatHours(period.summary.topStudent.tempo_min)}` : "Sem dados"
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
        <td class="num">${formatNumber(row.aulas)}</td>
        <td class="num">${formatNumber(row.flashcards)}</td>
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

/**
 * Carrega ExcelJS (CDN) para exportação Excel (.xlsx) do período detalhado.
 * @returns {Promise<void>}
 */
function _ensureExcelJSPanel() {
  if (typeof ExcelJS !== "undefined") return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js";
    s.onload = () => res();
    s.onerror = () => rej(new Error("Falha ao carregar ExcelJS"));
    document.head.appendChild(s);
  });
}

/**
 * Nome de aba Excel (≤31 chars, sem caracteres inválidos, único no workbook).
 * @param {string} raw
 * @param {Set<string>} used
 */
function _excelSheetNameFromLabel(raw, used) {
  const cleaned = (raw || "Periodo").replace(/[:\\/?*[\]]/g, "-").replace(/\s+/g, " ").trim().slice(0, 31);
  let name = cleaned || "Periodo";
  let i = 2;
  while (used.has(name)) {
    const suf = ` (${i})`;
    name = ((raw || "Periodo").replace(/[:\\/?*[\]]/g, "-").trim().slice(0, 31 - suf.length) + suf).slice(0, 31);
    i += 1;
  }
  used.add(name);
  return name;
}

/**
 * Exporta recortes em .xlsx (OOXML): uma aba por período (ordem cronológica),
 * cabeçalho MedCof, fonte Roboto, autofiltro e linhas congeladas.
 */
async function downloadSelectedPeriods() {
  const selectedPeriods = PERIODS.filter((_, index) => exportSelections[index]);
  if (!selectedPeriods.length) {
    updateExportHint();
    return;
  }

  const csvHasTurma = selectedPeriods.flatMap((p) => p.data).some((r) => r.turma) || Object.keys(TURMA_BY_NAME).length > 0;

  const header = [
    "Aluno",
    ...(csvHasTurma ? ["Turma"] : []),
    "Tempo de uso",
    "Tempo (min)",
    "Questões",
    "% Acerto",
    "Vídeos",
    "Aulas",
    "Flashcards",
    "Logins",
    "Q. por dia",
    "Engajamento"
  ];

  const colWidths = {
    Aluno: 34,
    Turma: 12,
    "Tempo de uso": 14,
    "Tempo (min)": 12,
    "Questões": 11,
    "% Acerto": 11,
    "Vídeos": 9,
    Aulas: 9,
    Flashcards: 12,
    Logins: 9,
    "Q. por dia": 12,
    Engajamento: 14
  };

  const MEDCOF_HEADER = "FFDC2626";
  const MEDCOF_HEADER_FONT = "FFFFFFFF";
  const STRIPE_A = "FFF9F9F9";
  const STRIPE_B = "FFFFFFFF";
  const TITLE_BG = "FFFEF2F2";
  const BORDER = {
    top: { style: "thin", color: { argb: "FFE0E0E0" } },
    left: { style: "thin", color: { argb: "FFE0E0E0" } },
    bottom: { style: "thin", color: { argb: "FFE0E0E0" } },
    right: { style: "thin", color: { argb: "FFE0E0E0" } }
  };

  try {
    await _ensureExcelJSPanel();
    const wb = new ExcelJS.Workbook();
    wb.creator = "MedCof";
    wb.created = new Date();

    const sorted = [...selectedPeriods].sort((a, b) => a.meta.startDate - b.meta.startDate);
    const usedSheetNames = new Set();

    for (const period of sorted) {
      const sheetName = _excelSheetNameFromLabel(period.meta.label, usedSheetNames);
      const ws = wb.addWorksheet(sheetName, { views: [{ state: "frozen", ySplit: 2, xSplit: 0 }] });
      const numCols = header.length;

      ws.mergeCells(1, 1, 1, numCols);
      const titleCell = ws.getCell(1, 1);
      titleCell.value = `${CURRENT_INSTITUTION.institutionName} — ${period.meta.label}`;
      titleCell.font = { name: "Roboto", size: 12, bold: true, color: { argb: "FFB91C1C" } };
      titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TITLE_BG } };
      titleCell.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
      ws.getRow(1).height = 24;

      const headerRow = ws.getRow(2);
      header.forEach((h, hi) => {
        const c = headerRow.getCell(hi + 1);
        c.value = h;
        c.font = { name: "Roboto", size: 11, bold: true, color: { argb: MEDCOF_HEADER_FONT } };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: MEDCOF_HEADER } };
        const rightish = ["Tempo (min)", "Questões", "% Acerto", "Vídeos", "Aulas", "Flashcards", "Logins", "Q. por dia"].includes(h);
        c.alignment = { horizontal: rightish ? "right" : "left", vertical: "middle", wrapText: true };
        c.border = BORDER;
      });
      headerRow.height = 22;

      const dataRows = period.data || [];
      dataRows.forEach((row, ri) => {
        const engagement = getPeriodEngagement(row.questoes, period.meta.days);
        const rowTurma = row.turma || TURMA_BY_NAME[row.nome?.trim().toLowerCase()] || "";
        const taxaPct =
          row.questoes_acertadas && row.questoes > 0
            ? (row.questoes_acertadas / row.questoes) * 100
            : row.taxa_acerto != null
              ? Number(row.taxa_acerto)
              : null;

        const excelRow = ws.getRow(3 + ri);
        const bg = ri % 2 === 0 ? STRIPE_A : STRIPE_B;
        let col = 1;

        const cell = (value, align, opts) => {
          const ac = excelRow.getCell(col);
          col += 1;
          ac.value = value;
          ac.font = { name: "Roboto", size: 11, color: { argb: "FF1A2233" } };
          ac.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
          ac.alignment = { horizontal: align, vertical: "middle" };
          ac.border = BORDER;
          if (opts?.numFmt) ac.numFmt = opts.numFmt;
        };

        cell(row.nome, "left");
        if (csvHasTurma) cell(rowTurma, "left");
        cell(formatHours(row.tempo_min), "right");
        cell(row.tempo_min != null ? row.tempo_min : "", "right", { numFmt: "0" });
        cell(row.questoes != null ? row.questoes : "", "right", { numFmt: "0" });
        if (taxaPct != null && !Number.isNaN(taxaPct)) {
          const ac = excelRow.getCell(col);
          col += 1;
          ac.value = taxaPct / 100;
          ac.numFmt = "0.0%";
          ac.font = { name: "Roboto", size: 11, color: { argb: "FF1A2233" } };
          ac.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
          ac.alignment = { horizontal: "right", vertical: "middle" };
          ac.border = BORDER;
        } else {
          cell("", "right");
        }
        cell(row.videos || 0, "right", { numFmt: "0" });
        cell(row.aulas || 0, "right", { numFmt: "0" });
        cell(row.flashcards || 0, "right", { numFmt: "0" });
        cell(row.logins || 0, "right", { numFmt: "0" });
        cell(engagement.rate, "right", { numFmt: "0.00" });
        cell(engagement.label, "left");
      });

      if (dataRows.length) {
        ws.autoFilter = {
          from: { row: 2, column: 1 },
          to: { row: 2, column: numCols }
        };
      }

      header.forEach((h, hi) => {
        ws.getColumn(hi + 1).width = colWidths[h] || 14;
      });
    }

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `analises_${slugifyInstitutionName(CURRENT_INSTITUTION.institutionName)}_medcof_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error(e);
    alert("Não foi possível gerar a planilha. Verifique a conexão e tente novamente.");
  }
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
  return _anonDataProxyRead("simulado_respostas", query);
}

// Cache de dados já carregados na sessão
const _simCache = {};

/**
 * Normaliza tipo do simulados_banco → 'tendencias' | 'personalizado' (única fonte para os cards).
 */
function _normalizeSimTipo(raw) {
  const t = String(raw || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (t === "tendencias" || t === "tendencia") return "tendencias";
  return "personalizado";
}

/**
 * Contexto do simulados_banco para uma IES: refs válidos + tipo (tendências vs personalizado) por id8.
 * Inclui simulados com instituicoes_destino vazio (todas as IES).
 */
async function _simBancoContextForSlug(slug) {
  const ck = "_simCtx_v2_" + slug;
  if (_simCache[ck]) return _simCache[ck];
  const out = { validRefs: new Set(), tipoById8: new Map(), linkById8: new Map() };
  let sims;
  try {
    sims = await _anonDataProxyRead("simulados_banco", "select=id,tipo,instituicoes_destino,link_gabarito");
  } catch {
    try {
      sims = await _anonDataProxyRead("simulados_banco", "select=id,tipo,instituicoes_destino");
    } catch {
      return null;
    }
  }
  try {
    sims.forEach((s) => {
      let dest = s.instituicoes_destino;
      if (!Array.isArray(dest)) {
        try {
          dest = JSON.parse(dest || "[]");
        } catch {
          dest = [];
        }
      }
      if (dest.length && !dest.includes(slug)) return;
      const id8 = String(s.id || "").slice(0, 8).toLowerCase();
      if (!id8) return;
      out.tipoById8.set(id8, _normalizeSimTipo(s.tipo));
      out.validRefs.add(`bq_${slug}_${id8}`);
      out.validRefs.add(`bq_${slug}_tendencias_${id8}`);
      const lg = s.link_gabarito != null ? String(s.link_gabarito).trim() : "";
      if (lg) out.linkById8.set(id8, lg);
    });
    _simCache[ck] = out;
    return out;
  } catch {
    return null;
  }
}

async function _validSimRefs(slug) {
  const ctx = await _simBancoContextForSlug(slug);
  return ctx ? ctx.validRefs : null;
}

/**
 * Extrai id8 (UUID) do fim de simulado_ref (bq_*_* ou bq_*_tendencias_*).
 */
function _refExtractId8(ref) {
  const s = String(ref || "");
  const m1 = s.match(/_tendencias_([a-f0-9]{8})$/i);
  if (m1) return m1[1].toLowerCase();
  const m2 = s.match(/_([a-f0-9]{8})$/i);
  return m2 ? m2[1].toLowerCase() : null;
}

/**
 * Tendências vs personalizado: somente pelo tipo cadastrado em simulados_banco (qualquer ciclo).
 */
function _refIsTendencias(ref, tipoById8) {
  if (!ref || !tipoById8 || !tipoById8.size) return false;
  const id8 = _refExtractId8(ref);
  if (!id8) return false;
  return (tipoById8.get(id8) || "") === "tendencias";
}

/** Remove __RANKING__ duplicado por mesmo simulado_ref (re-upload). */
function _dedupeSimuladoRankings(rankings) {
  const seen = new Set();
  const out = [];
  for (const r of rankings) {
    const ref = r.simulado_ref || "";
    if (!ref || seen.has(ref)) continue;
    seen.add(ref);
    out.push(r);
  }
  return out;
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

/**
 * Página Mentor (aba dedicada): gestão do simulado + distribuição livre por grande área.
 * Dados: simulado-planner (Tendências + Personalizado). UI em etapas sequenciais.
 */
function renderMentorPage() {
  const root = document.getElementById("mentorRoot");
  if (!root) return;
  const slug = location.pathname.split("/").filter(Boolean)[0] || "";
  const plannerUrl = `${window.location.origin}/.netlify/functions/simulado-planner`;
  window.__MEDCOF_SIM_CHAT_CTX__ = null;

  root.innerHTML = `
    <div class="medcof-mentor-page">
      <div class="medcof-mentor-flow">
        <div id="medcofMentorErr" class="medcof-mentor-banner medcof-mentor-banner--err" style="display:none;margin-bottom:12px"></div>
        <div id="medcofMentorLoading" class="medcof-mentor-banner medcof-mentor-banner--load" style="display:none;margin-bottom:12px">Carregando dados do Mentor…</div>
        <div class="medcof-mentor-stepper" id="medcofMentorStepper" role="tablist" aria-label="Etapas do Mentor">
          <button type="button" class="medcof-mentor-step-pill is-active" data-go="1" role="tab">1 · Entender a turma</button>
          <button type="button" class="medcof-mentor-step-pill" data-go="2" role="tab">2 · Desempenho por área</button>
          <button type="button" class="medcof-mentor-step-pill" data-go="3" role="tab">3 · Seu plano de questões</button>
          <button type="button" class="medcof-mentor-step-pill" data-go="4" role="tab">4 · Plano e exportação</button>
        </div>
        <div class="medcof-mentor-panels-shell">
        <div class="medcof-mentor-cofbot-float" aria-hidden="true">
          <img src="/assets/coordenador-chat-fab.png" alt="" width="64" height="76" decoding="async" draggable="false" />
        </div>
        <div class="medcof-mentor-panels-inner">
        <div class="medcof-mentor-step-panel is-active" data-mentor-step="1">
          <p class="medcof-mentor-step-head">Passo 1</p>
          <h2 class="medcof-mentor-step-title">O que já sabemos sobre a sua turma</h2>
          <p class="medcof-mentor-step-lead">Usamos o histórico agregado de simulados <strong>Tendências</strong> e <strong>Personalizado</strong> — sem substituir o seu critério: você continua no comando.</p>
          <div class="medcof-mentor-prompts">
            <strong>Para refletir com a coordenação</strong>
            <ul>
              <li>Qual é a maior preocupação com a turma neste ciclo?</li>
              <li>Há data de prova ou edital que devemos ter em vista?</li>
            </ul>
          </div>
          <div id="medcofMentorHero"></div>
        </div>
        <div class="medcof-mentor-step-panel" data-mentor-step="2">
          <p class="medcof-mentor-step-head">Passo 2</p>
          <h2 class="medcof-mentor-step-title">% de acerto por grande área</h2>
          <p class="medcof-mentor-step-lead">Visão consolidada do histórico — útil para decidir onde reforçar.</p>
          <div class="medcof-mentor-prompts">
            <strong>Questionamentos</strong>
            <ul>
              <li>Quais áreas você sente que a turma ainda subestima?</li>
              <li>Onde faz sentido combinar reforço teórico com lista de questões?</li>
            </ul>
          </div>
          <div id="medcofMentorAreas"></div>
        </div>
        <div class="medcof-mentor-step-panel" data-mentor-step="3">
          <p class="medcof-mentor-step-head">Passo 3</p>
          <h2 class="medcof-mentor-step-title">Distribuição de questões — sua escolha</h2>
          <p class="medcof-mentor-step-lead">Marque as grandes áreas, defina quantidades e inclua outras linhas se precisar.</p>
          <div class="medcof-mentor-prompts">
            <strong>Questionamentos</strong>
            <ul>
              <li>Quantas questões no total faz sentido para o próximo simulado?</li>
              <li>Prefere priorizar áreas mais fracas ou equilibrar entre áreas?</li>
            </ul>
          </div>
          <div id="medcofMentorPlan"></div>
          <div id="medcofMentorCustom"></div>
          <button type="button" id="medcofMentorAddRow" class="medcof-mentor-btn" style="margin-top:12px;border-style:dashed;width:100%;max-width:320px">+ Outra grande área</button>
          <div class="medcof-mentor-toolbar">
            <button type="button" id="medcofMentorRefresh" class="medcof-mentor-btn">Refazer</button>
            <button type="button" id="medcofMentorGerar" class="medcof-mentor-btn medcof-mentor-btn--primary">Gerar plano</button>
          </div>
          <div id="medcofMentorTotal" style="margin-top:12px;font-size:0.84rem;font-weight:700;color:var(--text)"></div>
        </div>
        <div class="medcof-mentor-step-panel" data-mentor-step="4">
          <p class="medcof-mentor-step-head">Passo 4</p>
          <h2 class="medcof-mentor-step-title">Plano premoldado e exportação</h2>
          <p class="medcof-mentor-step-lead">Use <strong>Gerar plano</strong> no passo 3 para cruzar sua distribuição com o histórico da IES e o banco de questões aprovadas.</p>
          <div class="medcof-mentor-prompts">
            <strong>Como usar</strong>
            <ul>
              <li>Revise cada slot (ordem, área, tema, dificuldade) antes de aplicar na turma.</li>
              <li>Baixe a planilha para arquivo ou reunião de coordenação.</li>
            </ul>
          </div>
          <div id="medcofMentorPremolded"></div>
          <h3 class="medcof-mentor-subh" style="font-size:0.95rem;font-weight:800;margin:22px 0 10px;color:var(--text)">Temas de referência (histórico)</h3>
          <div id="medcofMentorThemes"></div>
          <div class="medcof-mentor-toolbar" style="margin-top:18px">
            <button type="button" id="medcofMentorXlsx" class="medcof-mentor-btn medcof-mentor-btn--primary" disabled>Baixar planilha (.xlsx)</button>
            <button type="button" id="medcofMentorCsvThemes" class="medcof-mentor-btn" disabled>Exportar temas (CSV)</button>
          </div>
        </div>
        </div>
        </div>
        <div class="medcof-mentor-nav" id="medcofMentorNavBar">
          <button type="button" class="medcof-mentor-btn" id="medcofMentorBtnPrev" disabled>Anterior</button>
          <span class="medcof-mentor-progress" id="medcofMentorProgress">Passo 1 de 4</span>
          <button type="button" class="medcof-mentor-btn medcof-mentor-btn--primary" id="medcofMentorBtnNext">Próximo</button>
        </div>
      </div>
    </div>`;

  const heroEl = document.getElementById("medcofMentorHero");
  const areasEl = document.getElementById("medcofMentorAreas");
  const planEl = document.getElementById("medcofMentorPlan");
  const customEl = document.getElementById("medcofMentorCustom");
  const themesEl = document.getElementById("medcofMentorThemes");
  const errEl = document.getElementById("medcofMentorErr");
  const loadEl = document.getElementById("medcofMentorLoading");
  const totalEl = document.getElementById("medcofMentorTotal");
  const premoldedEl = document.getElementById("medcofMentorPremolded");
  const btnRefresh = document.getElementById("medcofMentorRefresh");
  const btnGerar = document.getElementById("medcofMentorGerar");
  const btnCsvThemes = document.getElementById("medcofMentorCsvThemes");
  const btnXlsx = document.getElementById("medcofMentorXlsx");
  const btnAdd = document.getElementById("medcofMentorAddRow");
  const btnPrev = document.getElementById("medcofMentorBtnPrev");
  const btnNext = document.getElementById("medcofMentorBtnNext");
  const progressEl = document.getElementById("medcofMentorProgress");
  const stepperEl = document.getElementById("medcofMentorStepper");

  /** @type {any} */
  let lastPayload = null;
  let customRowId = 0;
  let currentStep = 1;

  /**
   * Alterna painéis e pills do fluxo Mentor (4 etapas).
   * @param {number} n
   */
  function setStep(n) {
    const step = Math.max(1, Math.min(4, n));
    currentStep = step;
    root.querySelectorAll("[data-mentor-step]").forEach((el) => {
      el.classList.toggle("is-active", Number(el.getAttribute("data-mentor-step")) === step);
    });
    root.querySelectorAll(".medcof-mentor-step-pill").forEach((btn) => {
      const s = Number(btn.getAttribute("data-go"));
      btn.classList.toggle("is-active", s === step);
      btn.classList.toggle("is-done", s < step);
    });
    if (btnPrev) btnPrev.disabled = step === 1;
    if (btnNext) {
      if (step === 4) {
        btnNext.textContent = "Recomeçar";
        btnNext.classList.remove("medcof-mentor-btn--primary");
      } else {
        btnNext.textContent = "Próximo";
        btnNext.classList.add("medcof-mentor-btn--primary");
      }
    }
    if (progressEl) progressEl.textContent = `Passo ${step} de 4 — você decide o ritmo`;
  }

  function escHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function updatePlanTotal() {
    let sum = 0;
    planEl.querySelectorAll(".medcof-mentor-area-qty").forEach((inp) => {
      const row = inp.closest(".medcof-mentor-plan-row");
      const chk = row && row.querySelector(".medcof-mentor-area-chk");
      if (chk && !chk.checked) return;
      sum += Math.max(0, parseInt(String(inp.value || "0"), 10) || 0);
    });
    customEl.querySelectorAll(".medcof-mentor-custom-row").forEach((row) => {
      const name = (row.querySelector(".medcof-mentor-custom-name") || {}).value;
      const q = row.querySelector(".medcof-mentor-area-qty");
      if (name && String(name).trim() && q) {
        sum += Math.max(0, parseInt(String(q.value || "0"), 10) || 0);
      }
    });
    totalEl.textContent = sum > 0 ? `Total de questões no plano: ${sum}` : "";
  }

  root.addEventListener("input", (e) => {
    if (
      e.target &&
      (e.target.classList.contains("medcof-mentor-area-qty") ||
        e.target.classList.contains("medcof-mentor-custom-name"))
    ) {
      updatePlanTotal();
    }
  });
  root.addEventListener("change", (e) => {
    if (e.target && e.target.classList.contains("medcof-mentor-area-chk")) updatePlanTotal();
  });

  function buildPlanFromAreas(areas) {
    if (!areas || !areas.length) {
      planEl.innerHTML =
        '<p style="font-size:0.84rem;color:var(--text-soft)">Sem dados de área ainda — use &quot;Refazer&quot; após processar simulados.</p>';
      return;
    }
    let html = "";
    areas.forEach((a) => {
      const pct = a.pct_acerto_ies != null ? Number(a.pct_acerto_ies).toFixed(1) : "—";
      const ga = escHtml(a.grande_area || "—");
      html += `<div class="medcof-mentor-plan-row">
        <label style="display:flex;align-items:center;gap:8px;flex:1;min-width:220px;cursor:pointer">
          <input type="checkbox" class="medcof-mentor-area-chk" checked />
          <span class="medcof-mentor-area-name" style="font-weight:700">${ga}</span>
          <span style="font-size:0.78rem;color:var(--text-soft)">(${pct}% acerto no histórico)</span>
        </label>
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:0.76rem;color:var(--text-soft)">Questões</span>
          <input type="number" min="0" max="999" value="0" class="medcof-mentor-area-qty" style="width:72px" />
        </div>
      </div>`;
    });
    planEl.innerHTML = html;
    updatePlanTotal();
  }

  function collectPlanRows() {
    /** @type {{ area: string, questoes: number }[]} */
    const out = [];
    planEl.querySelectorAll(".medcof-mentor-plan-row").forEach((row) => {
      const chk = row.querySelector(".medcof-mentor-area-chk");
      const nm = row.querySelector(".medcof-mentor-area-name");
      const qtyInp = row.querySelector(".medcof-mentor-area-qty");
      if (!nm || !qtyInp) return;
      if (chk && !chk.checked) return;
      const n = Math.max(0, parseInt(String(qtyInp.value || "0"), 10) || 0);
      if (n <= 0) return;
      const area = (nm.textContent || "").trim();
      if (area) out.push({ area, questoes: n });
    });
    customEl.querySelectorAll(".medcof-mentor-custom-row").forEach((row) => {
      const nameInp = row.querySelector(".medcof-mentor-custom-name");
      const qtyInp = row.querySelector(".medcof-mentor-area-qty");
      if (!nameInp || !qtyInp) return;
      const area = String(nameInp.value || "").trim();
      const n = Math.max(0, parseInt(String(qtyInp.value || "0"), 10) || 0);
      if (area && n > 0) out.push({ area, questoes: n });
    });
    return out;
  }

  function renderPremoldedFromPayload() {
    const plano = lastPayload && lastPayload.planoPremoldado;
    if (!premoldedEl) return;
    if (!plano || !Array.isArray(plano.slots) || !plano.slots.length) {
      premoldedEl.innerHTML = `<p style="font-size:0.84rem;color:var(--text-soft);margin:0">Gere o plano no passo 3 com o botão <strong>Gerar plano</strong> para ver o simulado premoldado aqui.</p>`;
      return;
    }
    const avisos = Array.isArray(lastPayload.avisos) ? lastPayload.avisos : [];
    let html = '<div class="medcof-mentor-slot-grid">';
    plano.slots.forEach((s) => {
      const difLabel =
        s.dificuldade === "facil" ? "Fácil" : s.dificuldade === "dificil" ? "Difícil" : "Média";
      const badges = [];
      if (s.fraco_ies) {
        badges.push('<span class="medcof-mentor-badge medcof-mentor-badge--weak">Fraco na IES</span>');
      }
      if (s.peso_enamed && s.peso_enamed !== "—") {
        badges.push(
          `<span class="medcof-mentor-badge medcof-mentor-badge--prio" title="Prioridade no banco">${escHtml(
            s.peso_enamed
          )}</span>`
        );
      }
      html += `<div class="medcof-mentor-slot-card">
        <div class="medcof-mentor-slot-num">Q${s.ordem}</div>
        <div class="medcof-mentor-slot-body">
          <div class="medcof-mentor-slot-meta">${escHtml(s.grande_area)} · ${escHtml(difLabel)}</div>
          <div class="medcof-mentor-slot-tema">${escHtml(s.tema)}</div>
          <div class="medcof-mentor-slot-codigo">${s.codigo_questao ? escHtml(s.codigo_questao) : "—"}</div>
          <div class="medcof-mentor-slot-motivo">${escHtml(s.motivo || "")}</div>
          <div class="medcof-mentor-slot-badges">${badges.join(" ")}</div>
        </div>
      </div>`;
    });
    html += "</div>";
    if (avisos.length) {
      html += `<div class="medcof-mentor-avisos">${avisos.map((a) => `<p>${escHtml(a)}</p>`).join("")}</div>`;
    }
    premoldedEl.innerHTML = html;
  }

  async function gerarPlano() {
    errEl.style.display = "none";
    const rows = collectPlanRows();
    const distribuicao = rows.map((r) => ({ grande_area: r.area, questoes: r.questoes }));
    if (!distribuicao.length) {
      errEl.style.display = "block";
      errEl.textContent = "Marque áreas e informe quantidades maiores que zero.";
      return;
    }
    if (btnGerar) btnGerar.disabled = true;
    loadEl.style.display = "block";
    try {
      const sb = await _medcofEnsureSupabaseForChat();
      const { data } = await sb.auth.getSession();
      const token = data?.session?.access_token;
      if (!token) throw new Error("Entre no painel com seu usuário MedCof para usar o Mentor.");
      const res = await fetch(plannerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "montar",
          supabase_access_token: token,
          ies_slug: slug,
          distribuicao
        })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Não foi possível montar o plano.");
      lastPayload = { ...(lastPayload || {}), ...body };
      window.__MEDCOF_MENTOR_CTX__ = {
        resumoTemasFrageis: lastPayload.resumoTemasFrageis || [],
        areasDesempenho: lastPayload.areasDesempenho || [],
        meta: lastPayload.meta || {},
        planoPremoldado: lastPayload.planoPremoldado || null
      };
      renderPremoldedFromPayload();
      if (btnXlsx) {
        const ok = !!(body.planoPremoldado && body.planoPremoldado.slots && body.planoPremoldado.slots.length);
        btnXlsx.disabled = !ok;
        btnXlsx.style.opacity = ok ? "1" : "0.65";
      }
      setStep(4);
    } catch (e) {
      errEl.style.display = "block";
      errEl.textContent = e && e.message ? e.message : "Erro ao montar.";
    } finally {
      loadEl.style.display = "none";
      if (btnGerar) btnGerar.disabled = false;
    }
  }

  async function downloadMentorXlsx() {
    const plano = lastPayload && lastPayload.planoPremoldado;
    if (!plano || !plano.slots || !plano.slots.length) return;
    await _ensureExcelJSPanel();
    const wb = new ExcelJS.Workbook();
    const w1 = wb.addWorksheet("Plano", { properties: { defaultRowHeight: 18 } });
    w1.addRow(["Ordem", "Grande área", "Tema", "Dificuldade", "Código", "Observação"]);
    plano.slots.forEach((s) => {
      const difLabel =
        s.dificuldade === "facil" ? "Fácil" : s.dificuldade === "dificil" ? "Difícil" : "Média";
      w1.addRow([s.ordem, s.grande_area, s.tema, difLabel, s.codigo_questao || "", s.motivo || ""]);
    });
    const w2 = wb.addWorksheet("Temas ref.", { properties: { defaultRowHeight: 18 } });
    w2.addRow(["#", "Grande área", "Tema", "% acerto", "Respostas"]);
    (lastPayload.suggestedThemes || []).forEach((t) => {
      w2.addRow([
        t.prioridade != null ? t.prioridade : "",
        t.grande_area || "",
        t.tema || "",
        t.pct_acerto_ies != null ? t.pct_acerto_ies : "",
        t.amostras_resposta != null ? t.amostras_resposta : ""
      ]);
    });
    w1.getRow(1).font = { bold: true };
    w2.getRow(1).font = { bold: true };
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `mentor-plano-${slug}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(a.href);
    try {
      const sb = await _medcofEnsureSupabaseForChat();
      const { data } = await sb.auth.getSession();
      const token = data?.session?.access_token;
      if (!token) return;
      const temasChave = (plano.slots || [])
        .map((s) => String(s.tema || "")
          .trim()
          .toLowerCase())
        .filter(Boolean)
        .sort()
        .join("|");
      await fetch(plannerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "export_xlsx",
          supabase_access_token: token,
          ies_slug: slug,
          plan_hash: plano.plan_hash || "",
          contagem_slots: plano.slots.length,
          temas_chave: temasChave,
          areas_json: collectPlanRows().map((r) => ({ grande_area: r.area, questoes: r.questoes }))
        })
      });
    } catch {
      /* telemetria best-effort */
    }
  }

  async function run() {
    errEl.style.display = "none";
    errEl.textContent = "";
    if (heroEl) heroEl.innerHTML = "";
    if (areasEl) areasEl.innerHTML = "";
    if (customEl) customEl.innerHTML = "";
    if (themesEl) themesEl.innerHTML = "";
    btnCsvThemes.disabled = true;
    btnCsvThemes.style.opacity = "0.65";
    if (btnXlsx) {
      btnXlsx.disabled = true;
      btnXlsx.style.opacity = "0.65";
    }
    lastPayload = null;
    loadEl.style.display = "block";
    btnRefresh.disabled = true;
    if (btnGerar) btnGerar.disabled = true;
    try {
      const sb = await _medcofEnsureSupabaseForChat();
      const { data } = await sb.auth.getSession();
      const token = data?.session?.access_token;
      if (!token) throw new Error("Entre no painel com seu usuário MedCof para usar o Mentor.");
      const res = await fetch(plannerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supabase_access_token: token, ies_slug: slug })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Não foi possível carregar o Mentor.");
      lastPayload = body;
      window.__MEDCOF_MENTOR_CTX__ = {
        resumoTemasFrageis: body.resumoTemasFrageis || [],
        areasDesempenho: body.areasDesempenho || [],
        meta: body.meta || {},
        planoPremoldado: null
      };

      const meta = body.meta || {};
      const totalAll = meta.totalSimulados != null ? meta.totalSimulados : null;
      const nT = meta.totalSimuladosTendencias != null ? meta.totalSimuladosTendencias : 0;
      const nP = meta.totalSimuladosPersonalizado != null ? meta.totalSimuladosPersonalizado : 0;
      const apoio = (body.mensagemApoioCoordenador || "").replace(/</g, "");
      const resumo = Array.isArray(body.resumoTemasFrageis) ? body.resumoTemasFrageis : [];
      const areas = Array.isArray(body.areasDesempenho) ? body.areasDesempenho : [];

      if (heroEl) {
        let heroInner = `
          <div class="medcof-mentor-hero-card">
            <div class="medcof-mentor-hero-kicker">MedCof com a sua coordenação</div>
            <p>${escHtml(apoio) || "Acompanhamos o desempenho da sua instituição e usamos esse histórico para apoiar a organização do simulado — com transparência e no seu lado."}</p>`;
        if (totalAll != null && totalAll > 0) {
          heroInner += `<p style="font-size:0.82rem;color:var(--text-soft);margin:14px 0 0;line-height:1.5">Esta leitura considera <strong style="color:var(--text)">${totalAll}</strong> simulado(s) no histórico (<strong>${nT}</strong> Tendências + <strong>${nP}</strong> Personalizado) — visão agregada da IES.</p>`;
        } else if (totalAll === 0) {
          heroInner += `<p style="font-size:0.82rem;color:var(--text-soft);margin:14px 0 0">Assim que houver resultados processados, o resumo aparecerá aqui.</p>`;
        }
        if (resumo.length > 0) {
          heroInner += `<div class="medcof-mentor-hero-list">
            <div class="medcof-mentor-hero-sub">Onde a turma mais precisa de reforço (resumo)</div>
            <ul>`;
          resumo.forEach((row) => {
            const pct = row.pct_acerto_ies != null ? Number(row.pct_acerto_ies).toFixed(1) : "—";
            heroInner += `<li style="margin-bottom:6px"><strong>${escHtml(row.grande_area)}</strong> — ${escHtml(row.tema)} <span style="color:var(--text-soft);font-weight:600">(${pct}% acerto)</span></li>`;
          });
          heroInner += `</ul></div>`;
        }
        heroInner += `</div>`;
        heroEl.innerHTML = heroInner;
      }

      if (areasEl) {
        if (areas.length) {
          let t = `<div class="medcof-mentor-table-wrap"><table><thead><tr><th>Grande área</th><th style="text-align:right">% acerto</th><th style="text-align:right">Respostas (amostra)</th></tr></thead><tbody>`;
          areas.forEach((a) => {
            const pct = a.pct_acerto_ies != null ? Number(a.pct_acerto_ies).toFixed(1) : "—";
            t += `<tr><td>${escHtml(a.grande_area)}</td><td style="text-align:right">${pct}</td><td style="text-align:right">${a.amostras_resposta != null ? a.amostras_resposta : "—"}</td></tr>`;
          });
          t += `</tbody></table></div>`;
          areasEl.innerHTML = t;
        } else {
          areasEl.innerHTML =
            '<p style="font-size:0.84rem;color:var(--text-soft)">Sem agregação por área neste recorte.</p>';
        }
      }

      buildPlanFromAreas(areas);

      const themes = body.suggestedThemes || [];
      if (themesEl) {
        const warn = body.warning
          ? `<div style="padding:12px 14px;border-radius:12px;background:rgba(234,179,8,0.12);color:#a16207;font-size:0.8rem;margin-bottom:14px;border:1px solid rgba(234,179,8,0.35)">${escHtml(body.warning)}</div>`
          : "";
        const note = body.nota
          ? `<p style="font-size:0.8rem;color:var(--text-soft);margin:0 0 14px;line-height:1.45">${escHtml(body.nota)}</p>`
          : "";
        if (!themes.length) {
          themesEl.innerHTML =
            warn +
            note +
            '<p style="font-size:0.84rem;color:var(--text-soft)">Nenhum tema listado neste recorte — use &quot;Refazer&quot; após novos simulados processados.</p>';
        } else {
          let table =
            '<div class="medcof-mentor-table-wrap"><table><thead><tr><th>#</th><th>Grande área</th><th>Tema</th><th style="text-align:right">% acerto</th><th style="text-align:right">Respostas</th></tr></thead><tbody>';
          themes.forEach((trow) => {
            const pct = trow.pct_acerto_ies != null ? Number(trow.pct_acerto_ies).toFixed(1) : "—";
            table += `<tr><td>${trow.prioridade != null ? trow.prioridade : ""}</td><td>${escHtml(trow.grande_area)}</td><td>${escHtml(trow.tema)}</td><td style="text-align:right">${pct}</td><td style="text-align:right">${trow.amostras_resposta != null ? trow.amostras_resposta : "—"}</td></tr>`;
          });
          table += `</tbody></table></div>`;
          themesEl.innerHTML = warn + note + table;
        }
      }

      btnCsvThemes.disabled = !(themes && themes.length);
      btnCsvThemes.style.opacity = themes && themes.length ? "1" : "0.65";
      renderPremoldedFromPayload();
    } catch (e) {
      errEl.style.display = "block";
      errEl.textContent = e && e.message ? e.message : "Erro ao carregar.";
    } finally {
      loadEl.style.display = "none";
      btnRefresh.disabled = false;
      if (btnGerar) btnGerar.disabled = false;
    }
  }

  function exportThemesCsv() {
    if (!lastPayload || !Array.isArray(lastPayload.suggestedThemes)) return;
    const sep = ";";
    const lines = [];
    lines.push(`Mentor — temas${sep}${slug}`);
    lines.push(`Data${sep}${new Date().toISOString()}`);
    const m = lastPayload.meta || {};
    if (m.totalSimulados != null) lines.push(`Simulados no historico${sep}${m.totalSimulados}`);
    if (m.totalSimuladosTendencias != null) lines.push(`Tendencias${sep}${m.totalSimuladosTendencias}`);
    if (m.totalSimuladosPersonalizado != null) lines.push(`Personalizado${sep}${m.totalSimuladosPersonalizado}`);
    lines.push("");
    lines.push(`Prioridade${sep}Grande area${sep}Tema${sep}Pct${sep}Amostras${sep}Observacao`);
    (lastPayload.suggestedThemes || []).forEach((t) => {
      const obs = (t.motivo || "").split(sep).join(",").replace(/\r?\n/g, " ");
      lines.push(
        `${t.prioridade}${sep}${t.grande_area || ""}${sep}${t.tema || ""}${sep}${t.pct_acerto_ies != null ? t.pct_acerto_ies : ""}${sep}${t.amostras_resposta != null ? t.amostras_resposta : ""}${sep}${obs}`
      );
    });
    const blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `mentor-temas-${slug}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  btnRefresh.addEventListener("click", run);
  if (btnGerar) btnGerar.addEventListener("click", () => void gerarPlano());
  btnCsvThemes.addEventListener("click", exportThemesCsv);
  if (btnXlsx) btnXlsx.addEventListener("click", () => void downloadMentorXlsx());
  btnAdd.addEventListener("click", () => {
    const div = document.createElement("div");
    div.className = "medcof-mentor-custom-row medcof-mentor-plan-row";
    div.innerHTML = `<input type="text" class="medcof-mentor-custom-name" placeholder="Nome da grande área" style="flex:1;min-width:180px" />
      <div style="display:flex;align-items:center;gap:6px"><span style="font-size:0.76rem;color:var(--text-soft)">Questões</span>
      <input type="number" min="0" max="999" value="0" class="medcof-mentor-area-qty" style="width:72px" /></div>`;
    customEl.appendChild(div);
    updatePlanTotal();
  });

  if (btnNext) {
    btnNext.addEventListener("click", () => {
      if (currentStep === 4) setStep(1);
      else setStep(currentStep + 1);
    });
  }
  if (btnPrev) {
    btnPrev.addEventListener("click", () => setStep(currentStep - 1));
  }
  if (stepperEl) {
    stepperEl.addEventListener("click", (e) => {
      const t = e.target && e.target.closest && e.target.closest(".medcof-mentor-step-pill");
      if (!t || !t.getAttribute("data-go")) return;
      setStep(Number(t.getAttribute("data-go"), 10));
    });
  }
  setStep(1);

  void run();
}


// ── HUB: 2 cards (Tendências / Personalizado) ──────────────────
async function _renderSimuladoHub(root, slug) {
  const [allRankings, simCtx] = await Promise.all([
    _simFetch(`ies_slug=eq.${encodeURIComponent(slug)}&aluno_nome=eq.__RANKING__&select=simulado_ref,respostas&order=created_at.desc`),
    _simBancoContextForSlug(slug)
  ]);
  const validRefs = simCtx ? simCtx.validRefs : null;
  const tipoById8 = simCtx ? simCtx.tipoById8 : new Map();
  const rankingsRaw = validRefs
    ? allRankings.filter((r) => validRefs.has(r.simulado_ref))
    : allRankings;
  const rankings = _dedupeSimuladoRankings(rankingsRaw);

  let tendCount = 0, persCount = 0, tendLast = null, persLast = null, tendMedia = null, persMedia = null;
  rankings.forEach((r) => {
    const ref = r.simulado_ref || "";
    const d = r.respostas || {};
    const m = d.media_ies;
    const isT = _refIsTendencias(ref, tipoById8);
    if (isT) {
      tendCount++;
      if (!tendLast) {
        tendLast = d.simulado_titulo || ref;
        tendMedia = m;
      }
    } else {
      persCount++;
      if (!persLast) {
        persLast = d.simulado_titulo || ref;
        persMedia = m;
      }
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
            <div class="sim-card-metric"><div class="sim-card-metric-label">Última média</div><div class="sim-card-metric-value" style="color:${media >= 60 ? '#16a34a' : media >= 50 ? '#eab308' : '#dc2626'}">${fmt(media)}</div></div>
          </div>
          <div style="font-size:0.76rem;color:var(--text-muted)">Último: <strong>${last}</strong></div>
          <div style="margin-top:8px;font-size:0.78rem;font-weight:700;color:${color};display:flex;align-items:center;gap:4px">Ver resultados <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg></div>
        ` : `<div style="padding:20px 0;text-align:center"><div style="font-size:0.82rem;color:var(--text-muted);font-style:italic">Nenhum resultado processado ainda</div></div>`}
      </div>
    </a>`;

  const mentorOn = !!window.__MEDCOF_MENTOR_COORDENADOR_ENABLED__;
  const hubGridClass = mentorOn ? "sim-hub-grid" : "sim-hub-grid sim-hub-grid--two";
  const mentorCard = mentorOn
    ? `<a href="mentor.html" class="sim-card sim-hub-mentor-card" style="text-decoration:none;color:inherit">
          <div class="sim-card-top" style="background:linear-gradient(90deg,#a855f7,#7c3aed)"></div>
          <div class="sim-card-body sim-hub-mentor-row">
            <div class="sim-hub-mentor-cofbot">
              <img src="/assets/coordenador-chat-fab.png" alt="" width="48" height="56" decoding="async" />
              <div class="sim-hub-mentor-bubble" role="status">Quer ajuda para organizar simulados para a sua IES?</div>
            </div>
            <div>
              <span class="sim-card-tag" style="background:rgba(124,58,237,0.14);color:#5b21b6">Mentor</span>
              <div class="sim-card-title" style="margin-top:8px">Organizar próximo simulado</div>
              <p class="sim-hub-mentor-desc">Pontos fracos da turma, % por grande área e distribuição de questões — no seu ritmo.</p>
              <div class="sim-hub-mentor-cta">Abrir <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg></div>
            </div>
          </div>
        </a>`
    : "";

  root.innerHTML = `
    <section class="section-shell" style="margin-top:0">
      <div class="${hubGridClass}">
        ${hubCard('#tendencias','📊','Tendências','ENAMED e simulados nacionais',tendCount,tendMedia,tendLast,'#16a34a',tendCount===0)}
        ${hubCard('#personalizado','🎯','Personalizado','Simulados do banco de questões',persCount,persMedia,persLast,'#3b82f6',persCount===0)}
        ${mentorCard}
      </div>
    </section>`;
}

// ── GRID: lista de simulados de um tipo ─────────────────────────
async function _renderSimuladoGrid(root, slug, tipo) {
  const [allRankings, simCtx] = await Promise.all([
    _simFetch(`ies_slug=eq.${encodeURIComponent(slug)}&aluno_nome=eq.__RANKING__&select=simulado_ref,respostas,created_at&order=created_at.desc`),
    _simBancoContextForSlug(slug)
  ]);
  const validRefs = simCtx ? simCtx.validRefs : null;
  const tipoById8 = simCtx ? simCtx.tipoById8 : new Map();
  const rankingsRaw = validRefs
    ? allRankings.filter((r) => validRefs.has(r.simulado_ref))
    : allRankings;
  const rankings = _dedupeSimuladoRankings(rankingsRaw);

  const wantTend = tipo === "tendencias";
  const filtered = rankings.filter((r) => {
    const ref = r.simulado_ref || "";
    const isT = _refIsTendencias(ref, tipoById8);
    return wantTend ? isT : !isT;
  });

  const tipoLabel = wantTend ? "Tendências" : "Personalizado";
  const tipoIcon = wantTend ? "📊" : "🎯";
  const tipoColor = wantTend ? "#16a34a" : "#3b82f6";
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
            ${wantTend && mediaGeral != null ? `<div class="sim-card-metric"><div class="sim-card-metric-label">Média geral</div><div class="sim-card-metric-value" style="color:var(--text-muted)">${mediaGeral.toFixed(1)}%</div></div>` : ''}
            ${wantTend && rankNac != null ? `<div class="sim-card-metric"><div class="sim-card-metric-label">Ranking</div><div class="sim-card-metric-value">${rankNac}<span style="font-size:0.7rem;font-weight:600;color:var(--text-muted)">/${rankNacTotal}</span></div></div>` : ''}
          </div>
        </div>
      </a>`;
  }).join('');

  root.innerHTML = `
    <div style="padding:20px 0"><a href="#" class="sim-back">${backSvg} Todos os simulados</a></div>
    <section class="home-cockpit-intro" style="margin-bottom:20px">
      <div class="section-kicker" style="color:${tipoColor}">${tipoIcon} ${tipoLabel}</div>
      <h1>Simulados ${tipoLabel.toLowerCase()}</h1>
      <p class="home-cockpit-lead">${wantTend ? 'Resultados dos simulados ENAMED com ranking nacional e regional.' : 'Resultados dos simulados do banco de questões com análise por área e tema.'}</p>
    </section>
    <section class="section-shell"><div class="sim-grid">${cards}</div></section>`;
}

// Race condition guard — cancela renderização anterior se o usuário navegar rápido
let _simDetailVersion = 0;

// ── DETALHE: análise completa de um simulado ──────────────────
async function _renderSimuladoDetail(root, slug, ref) {
  const myVersion = ++_simDetailVersion;
  const simCtx = await _simBancoContextForSlug(slug);
  const tipoById8 = simCtx ? simCtx.tipoById8 : new Map();
  const isTend = _refIsTendencias(ref, tipoById8);
  const tipoLabel = isTend ? 'Tendências' : 'Personalizado';
  const tipoColor = isTend ? 'var(--green)' : 'var(--accent)';
  const backHash = isTend ? '#tendencias' : '#personalizado';
  const id8Ref = _refExtractId8(ref);
  const linkGabCadastro =
    simCtx && simCtx.linkById8 && id8Ref ? simCtx.linkById8.get(id8Ref) : null;

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
  const _notaSourceMeta = (meta && meta._notaSource) || (ranking && ranking.nota_source) || null;
  const _anuladasTratMeta = (anuladasInfo && anuladasInfo.tratamento) || (ranking && ranking.anuladas_tratamento) || null;

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
  const anuladasTratHint = anuladasInfo && anuladasInfo.tratamento
    ? (anuladasInfo.tratamento === 'creditar'
      ? 'Anuladas no upload: <strong>creditadas</strong> (contam como acerto — média tende a ficar acima do Excel com “excluir”).'
      : 'Anuladas no upload: <strong>excluídas do denominador</strong> (alinha ao Remark®).')
    : '';
  const _notaSourceHint = _notaSourceMeta
    ? (_notaSourceMeta === 'planilha'
      ? '<span style=”display:inline-block;margin-top:4px;padding:2px 8px;border-radius:4px;background:rgba(22,163,74,0.1);color:#16a34a;font-size:0.58rem;font-weight:700”>Fonte: planilha</span>'
      : '<span style=”display:inline-block;margin-top:4px;padding:2px 8px;border-radius:4px;background:rgba(234,179,8,0.1);color:#d97706;font-size:0.58rem;font-weight:700”>Fonte: calculada' + (_anuladasTratMeta ? ' · ' + (_anuladasTratMeta === 'creditar' ? 'anul. creditadas' : 'anul. excluídas') : '') + '</span>')
    : '';

  // ── OVERVIEW ──
  let overviewMetrics = `
    <div class=”sim-metric-card”>
      <div class=”sim-metric-label”>Média IES</div>
      <div class=”sim-metric-value” style=”color:${mediaIES != null ? _faixaColor(mediaIES) : 'var(--text)'}”>${fmtPct(mediaIES)}</div>
      ${mediaIES != null ? `<div style=”font-size:0.62rem;font-weight:700;color:${_faixaColor(mediaIES)};margin-top:4px”>${_faixaLabel(mediaIES)}</div>` : ''}
      ${_notaSourceHint}
      ${anuladasCount > 0 && anuladasTratHint ? `<div style=”font-size:0.58rem;color:var(--text-muted);margin-top:8px;line-height:1.4;max-width:280px”>${anuladasTratHint}</div>` : ''}
    </div>
    ${mediaGeral != null ? `<div class="sim-metric-card"><div class="sim-metric-label">Média Geral</div><div class="sim-metric-value" style="color:var(--text-muted)">${fmtPct(mediaGeral)}</div></div>` : ''}
    <div class="sim-metric-card"><div class="sim-metric-label">Alunos</div><div class="sim-metric-value">${totalAlunos}</div></div>
    <div class="sim-metric-card"><div class="sim-metric-label">Questões</div><div class="sim-metric-value">${totalQuestoes}${anuladasCount > 0 ? ` <span style="font-size:0.6rem;color:#d97706">(${anuladasCount} anul.)</span>` : ''}</div></div>
    ${mediana != null ? `<div class="sim-metric-card"><div class="sim-metric-label">Mediana</div><div class="sim-metric-value">${fmtPct(mediana)}</div></div>` : ''}
    ${notaMax != null ? `<div class="sim-metric-card"><div class="sim-metric-label">Maior nota</div><div class="sim-metric-value" style="color:#16a34a">${fmtPct(notaMax)}</div></div>` : ''}
    ${notaMin != null ? `<div class="sim-metric-card"><div class="sim-metric-label">Menor nota</div><div class="sim-metric-value" style="color:#dc2626">${fmtPct(notaMin)}</div></div>` : ''}
  `;

  // Rankings (tendências only) — destaque visual
  let rankingSection = '';
  if (isTend && rankNac != null) {
    const _rankColor = (pos, total) => {
      const pct = total > 0 ? pos / total : 1;
      if (pct <= 0.25) return '#16a34a';
      if (pct <= 0.50) return '#3b82f6';
      if (pct <= 0.75) return '#eab308';
      return '#dc2626';
    };
    const nacColor = _rankColor(rankNac, rankNacTotal);
    const regColor = rankReg != null ? _rankColor(rankReg, rankRegTotal) : null;
    rankingSection = `
    <section class="section-shell" style="margin-top:24px">
      <h2 class="section-title">Posicionamento no ranking</h2>
      <div style="display:grid;grid-template-columns:${rankReg != null ? '1fr 1fr' : '1fr'};gap:14px">
        <div style="background:var(--bg-card);border:1.5px solid ${nacColor}33;border-radius:16px;padding:24px;text-align:center">
          <div style="font-size:0.7rem;text-transform:uppercase;font-weight:700;letter-spacing:0.06em;color:var(--text-muted);margin-bottom:10px">Ranking Nacional</div>
          <div style="font-size:2.8rem;font-weight:900;color:${nacColor};line-height:1">${rankNac}<span style="font-size:1.1rem;font-weight:700;color:var(--text-muted)">/${rankNacTotal}</span></div>
          ${mediaGeral != null ? `<div style="font-size:0.75rem;color:var(--text-muted);margin-top:10px">Média geral: <strong>${fmtPct(mediaGeral)}</strong></div>` : ''}
        </div>
        ${rankReg != null ? `
        <div style="background:var(--bg-card);border:1.5px solid ${regColor}33;border-radius:16px;padding:24px;text-align:center">
          <div style="font-size:0.7rem;text-transform:uppercase;font-weight:700;letter-spacing:0.06em;color:var(--text-muted);margin-bottom:10px">Ranking Regional</div>
          <div style="font-size:2.8rem;font-weight:900;color:${regColor};line-height:1">${rankReg}<span style="font-size:1.1rem;font-weight:700;color:var(--text-muted)">/${rankRegTotal}</span></div>
        </div>` : ''}
      </div>
    </section>`;
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

  // Q/dia: prioriza engajamento acumulado (aba Engajamento — histórico completo por aluno).
  // Recorte do período (painel Período) só preenche alunos que não existem no acumulado.
  const _normNome = (n) => (n || '').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const _engMap = {};
  try {
    if (typeof ACCUMULATED_DASHBOARD !== 'undefined' && ACCUMULATED_DASHBOARD.ranking) {
      ACCUMULATED_DASHBOARD.ranking.forEach((s) => {
        const key = _normNome(s.nome);
        if (!key) return;
        _engMap[key] = {
          questoes: s.questoes || 0,
          tempo_min: s.tempo_min || 0,
          flashcards: s.flashcards || 0,
          questoesDia: s.questoesDia || 0
        };
      });
    }
  } catch (_e) {}
  try {
    const pi = typeof periodState !== 'undefined' ? periodState.currentIndex : 0;
    const periods = typeof PERIODS !== 'undefined' ? PERIODS : [];
    const period = periods[pi] || periods[0];
    const days = Math.max(period?.meta?.days || 1, 1);
    (period?.data || []).forEach((row) => {
      const key = _normNome(row.nome);
      if (!key || _engMap[key]) return;
      const qd = (Number(row.questoes) || 0) / days;
      _engMap[key] = {
        questoes: row.questoes || 0,
        tempo_min: row.tempo_min || 0,
        flashcards: row.flashcards || 0,
        questoesDia: qd
      };
    });
  } catch (_e) {}

  /** Resolve engajamento por nome exato; se falhar, primeiro+último token (planilha vs painel com grafia diferente). */
  const _engResolve = (nome) => {
    const key = _normNome(nome);
    if (_engMap[key]) return _engMap[key];
    const parts = key.split(/\s+/).filter(Boolean);
    if (parts.length < 2) return null;
    const first = parts[0];
    const last = parts[parts.length - 1];
    const rank = typeof ACCUMULATED_DASHBOARD !== 'undefined' && ACCUMULATED_DASHBOARD.ranking
      ? ACCUMULATED_DASHBOARD.ranking
      : [];
    for (let ri = 0; ri < rank.length; ri++) {
      const nk = _normNome(rank[ri].nome);
      if (nk.startsWith(first + ' ') && nk.endsWith(' ' + last) && _engMap[nk]) return _engMap[nk];
    }
    return null;
  };

  // ── RANKING ALUNOS com correlação Engajamento x Nota ──
  let rankingHTML = '';
  if (alunosSorted.length > 0) {
    // Engajamento badge: >20 q/dia = alto (verde), >10 = moderado (azul), <10 = baixo (cinza)
    const _engBadge = (nome) => {
      const eng = _engResolve(nome);
      if (!eng) {
        const _tip = 'Sem histórico de engajamento na plataforma — participação apenas neste simulado (não integra o cadastro B2B com uso do app).';
        return `<span style="font-size:0.68rem;color:var(--text-muted);display:inline-flex;flex-direction:column;align-items:center;gap:1px;line-height:1.15;max-width:120px;cursor:help" title="${_tip}"><span>—</span><span style="font-size:0.58rem;font-weight:600;opacity:0.9">só simulado</span></span>`;
      }
      const qDia = eng.questoesDia || 0;
      if (qDia >= 20) return `<span style="display:inline-flex;align-items:center;gap:4px;font-size:0.7rem;font-weight:700;color:#16a34a;background:rgba(22,163,74,0.1);padding:3px 10px;border-radius:6px"><span style="width:6px;height:6px;border-radius:50%;background:#16a34a"></span>${qDia.toFixed(0)} q/dia</span>`;
      if (qDia >= 10) return `<span style="display:inline-flex;align-items:center;gap:4px;font-size:0.7rem;font-weight:700;color:#d97706;background:rgba(217,119,6,0.1);padding:3px 10px;border-radius:6px"><span style="width:6px;height:6px;border-radius:50%;background:#d97706"></span>${qDia.toFixed(0)} q/dia</span>`;
      return `<span style="display:inline-flex;align-items:center;gap:4px;font-size:0.7rem;font-weight:700;color:#dc2626;background:rgba(220,38,38,0.1);padding:3px 10px;border-radius:6px"><span style="width:6px;height:6px;border-radius:50%;background:#dc2626"></span>${qDia.toFixed(0)} q/dia</span>`;
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
        const eng = _engResolve(a.nome);
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

    let _rankingPeriodHint = "";
    try {
      const hasAcc = typeof ACCUMULATED_DASHBOARD !== "undefined" && ACCUMULATED_DASHBOARD.ranking && ACCUMULATED_DASHBOARD.ranking.length > 0;
      if (hasAcc) {
        _rankingPeriodHint = ` <span style="font-size:0.72rem;font-weight:500;color:var(--text-muted)">(Q/dia · engajamento acumulado)</span>`;
      } else {
        const pi = typeof periodState !== "undefined" ? periodState.currentIndex : 0;
        const p = PERIODS?.[pi] || PERIODS?.[0];
        if (p?.meta?.label) {
          _rankingPeriodHint = ` <span style="font-size:0.72rem;font-weight:500;color:var(--text-muted)">(Q/dia · ${p.meta.label})</span>`;
        }
      }
    } catch (_e) {}

    rankingHTML = `
    <section class="section-shell" style="margin-top:24px">
      <h2 class="section-title">Ranking de alunos${_rankingPeriodHint}</h2>
      <div style="background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:16px;overflow:auto">
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:var(--bg-elevated);border-bottom:1.5px solid var(--border-subtle)">
            <th style="padding:10px 14px;text-align:center;font-size:0.65rem;text-transform:uppercase;font-weight:700;color:var(--text-muted);width:50px">#</th>
            <th style="padding:10px 14px;text-align:left;font-size:0.65rem;text-transform:uppercase;font-weight:700;color:var(--text-muted)">Aluno</th>
            <th style="padding:10px 14px;text-align:center;font-size:0.65rem;text-transform:uppercase;font-weight:700;color:var(--text-muted)">Q/dia</th>
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

  // ── LINK BOLETINS (section no final) — um ou vários pacotes ──
  const _boletinsUrls = (() => {
    if (!ranking) return [];
    const multi = ranking.link_boletins_pacotes;
    if (Array.isArray(multi) && multi.length) {
      return multi.map(u => String(u).trim()).filter(Boolean);
    }
    const s = ranking.link_boletins;
    if (typeof s === 'string' && s.trim()) return [s.trim()];
    return [];
  })();

  const _boletinsRotulos = (() => {
    if (!ranking) return [];
    const multi = ranking.link_boletins_pacotes;
    if (Array.isArray(multi) && multi.length > 1) {
      const rr = ranking.link_boletins_pacotes_rotulos;
      return multi.map((_, i) =>
        Array.isArray(rr) && rr[i] != null && String(rr[i]).trim()
          ? String(rr[i]).trim()
          : ''
      );
    }
    const ru = ranking.link_boletins_rotulo;
    if (_boletinsUrls.length === 1 && typeof ru === 'string' && ru.trim()) return [ru.trim()];
    return _boletinsUrls.map(() => '');
  })();

  const _boletinsBtnsBlock = _boletinsUrls.length
    ? `<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:flex-end">${_boletinsUrls
        .map(
          (u, idx) => {
            const rot = _boletinsRotulos[idx];
            const btnLabel =
              _boletinsUrls.length > 1
                ? `Boletins part.${idx + 1}`
                : rot || 'Acessar boletins';
            const titleAttr =
              _boletinsUrls.length > 1
                ? `Boletins part.${idx + 1} de ${_boletinsUrls.length}`
                : rot
                  ? `${rot} — download`
                  : `Pacote ${idx + 1} de ${_boletinsUrls.length}`;
            return `<a href="${u}" target="_blank" rel="noopener" title="${titleAttr.replace(/"/g, '&quot;')}" style="display:inline-flex;align-items:center;gap:6px;padding:10px 16px;background:#16a34a;border:none;border-radius:10px;color:#fff;font-size:0.82rem;font-weight:700;text-decoration:none;cursor:pointer;transition:all 0.2s;white-space:nowrap;max-width:100%" onmouseover="this.style.background='#15803d'" onmouseout="this.style.background='#16a34a'"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>${btnLabel}</a>`;
          }
        )
        .join('')}</div>`
    : '';

  const boletinsHTML = _boletinsUrls.length ? `
    <section class="section-shell" style="margin-top:24px;margin-bottom:40px">
      <div style="background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:16px;padding:24px;display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap">
        <div style="width:48px;height:48px;border-radius:12px;background:rgba(22,163,94,0.1);display:flex;align-items:center;justify-content:center;font-size:1.4rem;flex-shrink:0">📥</div>
        <div style="flex:1;min-width:200px">
          <div style="font-size:0.95rem;font-weight:800;color:var(--text);margin-bottom:4px">Boletins disponíveis para download</div>
          <div style="font-size:0.78rem;color:var(--text-muted);line-height:1.5">${_boletinsUrls.length > 1 ? `Há <strong>${_boletinsUrls.length} arquivos</strong> (turma grande). Baixe cada pacote abaixo.` : 'Os boletins individuais estão disponíveis para download no link abaixo (pasta, arquivo ou pacote publicado pela central).'}</div>
        </div>
        ${_boletinsBtnsBlock}
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
  if (isTend && rankNac != null) heroPills += _pill('Nacional', `${rankNac}<span style="font-size:0.7rem;font-weight:600;color:var(--text-muted)">/${rankNacTotal}</span>`);
  if (isTend && rankReg != null) heroPills += _pill('Regional', `${rankReg}<span style="font-size:0.7rem;font-weight:600;color:var(--text-muted)">/${rankRegTotal}</span>`);

  // Gabarito: URL em simulados_banco (cadastro); fallback legado __RANKING__.link_gabarito
  const _lgTrim = (u) => (u != null && String(u).trim()) || null;
  const linkGabarito = _lgTrim(linkGabCadastro) || _lgTrim(ranking && ranking.link_gabarito);
  const _heroBtnStyle = `display:inline-flex;align-items:center;gap:6px;padding:8px 18px;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.2);border-radius:10px;color:#fff;font-size:0.78rem;font-weight:700;text-decoration:none;transition:all 0.2s;cursor:pointer`;
  const gabaritoBtn = linkGabarito ? `<a href="${linkGabarito}" target="_blank" rel="noopener" style="${_heroBtnStyle}" onmouseover="this.style.background='rgba(255,255,255,0.2)'" onmouseout="this.style.background='rgba(255,255,255,0.12)'"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>Ver gabarito</a>` : '';

  // Contexto de exportação PDF/Excel
  window.__MEDCOF_SIM_EXPORT__ = {
    titulo, tipoLabel, slug, ref,
    totalAlunos, totalQuestoes, anuladasCount,
    mediaIES, mediaGeral, mediana, notaMax, notaMin,
    rankNac, rankNacTotal, rankReg, rankRegTotal,
    alunosSorted, areaList, temaList, qStats, questions
  };

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
          <button onclick="window._exportSimPDF()" style="${_heroBtnStyle}" onmouseover="this.style.background='rgba(255,255,255,0.2)'" onmouseout="this.style.background='rgba(255,255,255,0.12)'"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>Exportar PDF</button>
          <button onclick="window._exportSimExcel()" style="${_heroBtnStyle}" onmouseover="this.style.background='rgba(255,255,255,0.2)'" onmouseout="this.style.background='rgba(255,255,255,0.12)'"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>Exportar Excel</button>
        </div>
      </div>
    </section>

    <section class="section-shell" style="margin-bottom:24px">
      <div style="display:flex;flex-wrap:wrap;gap:10px">
        ${heroPills}
      </div>
    </section>

    ${rankingSection}
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
        if (meta.role === 'coordenador' && meta.access_approved === false) {
          window.location.href = '/index.html';
          return;
        }
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

  // Pontos da linha: pílulas acima do marcador para não cobrir as barras
  const points = linePoints.map((point) => {
    const label = `${formatDecimal(point.hours)}h`;
    const charW = 8.4;
    const pillW = Math.max(label.length * charW + 20, 48);
    const pillH = 24;
    const pillX = point.x - pillW / 2;
    let pillY = point.y - pillH - 14;
    if (pillY < padding.top + 4) {
      pillY = point.y + 20;
    }
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
// Central de avisos (coordenadores) — ícone alinhado ao painel admin
// ══════════════════════════════════════════════════════════════════

const COORD_NOTIF_FN = "/.netlify/functions/coord-notificacoes";

/** @type {Record<string, unknown>[]} */
let _coordNotifCache = [];

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
function _coordNormalizeLidoPor(raw) {
  if (Array.isArray(raw)) return raw.map(String);
  if (raw == null || raw === "") return [];
  if (typeof raw === "string") {
    const t = raw.trim();
    if (t.startsWith("[")) {
      try {
        const p = JSON.parse(t);
        return Array.isArray(p) ? p.map(String) : [];
      } catch {
        return [];
      }
    }
    return [];
  }
  if (typeof raw === "object") return Object.values(/** @type {Record<string, unknown>} */ (raw)).map(String);
  return [];
}

/**
 * @param {string} s
 * @returns {string}
 */
function _coordEscHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * @param {string} msg
 */
function _coordBriefToast(msg) {
  let el = document.getElementById("coordBriefToast");
  if (!el) {
    el = document.createElement("div");
    el.id = "coordBriefToast";
    el.className = "coord-brief-toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(/** @type {unknown} */ (el)._coordT);
  el._coordT = setTimeout(() => {
    el.hidden = true;
  }, 2600);
}

/**
 * @param {string} action
 * @param {string} [notifId]
 */
async function _coordNotifRequest(action, notifId) {
  const sb = await _medcofEnsureSupabaseForChat();
  const { data } = await sb.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("Faça login no painel para gerenciar avisos.");
  const res = await fetch(COORD_NOTIF_FN, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      supabase_access_token: token,
      ies_slug: _medcofSlugFromPath(),
      action,
      notifId
    })
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(/** @type {{ error?: string }} */ (j).error || res.statusText || "Erro");
  return j;
}

/**
 * @returns {Promise<string>}
 */
async function _coordNotifUserEmail() {
  const sb = await _medcofEnsureSupabaseForChat();
  const { data } = await sb.auth.getSession();
  return String(data?.session?.user?.email || "").trim();
}

async function _coordRefreshNotifUi() {
  const listEl = document.getElementById("coordNotifList");
  const badge = document.getElementById("coordNotifBadge");
  const email = await _coordNotifUserEmail();
  if (!email || !listEl) return;

  listEl.innerHTML =
    '<div style="padding:20px;text-align:center;color:var(--text-soft);font-size:0.82rem">Carregando…</div>';

  const rows = await _anonDataProxyRead(
    "notificacoes_admin",
    "select=id,tipo,titulo,mensagem,prioridade,criado_por,created_at,destinatarios,lido_por,modo_coord&destinatarios=eq.all&tipo=eq.manual&order=created_at.desc&limit=50"
  );

  if (!Array.isArray(rows)) {
    _coordNotifCache = [];
    listEl.innerHTML =
      '<div style="padding:24px;text-align:center;color:var(--text-soft);font-size:0.82rem">Não foi possível carregar avisos.</div>';
    if (badge) badge.hidden = true;
    return;
  }

  _coordNotifCache = rows;
  const prioIcons = { urgent: "🔴", warn: "⚠️", info: "ℹ️" };
  const prioColors = {
    urgent: "rgba(220,38,38,0.08)",
    warn: "rgba(245,158,11,0.08)",
    info: "rgba(59,130,246,0.06)"
  };

  let unread = 0;
  const html = rows
    .map((n) => {
      const lidoPor = _coordNormalizeLidoPor(n.lido_por);
      const isRead = lidoPor.includes(email);
      if (!isRead) unread++;
      const icon = prioIcons[/** @type {keyof typeof prioIcons} */ (n.prioridade)] || "ℹ️";
      const bg = !isRead ? prioColors[/** @type {keyof typeof prioColors} */ (n.prioridade)] || prioColors.info : "transparent";
      const date = n.created_at
        ? new Date(String(n.created_at)).toLocaleDateString("pt-BR", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit"
          })
        : "";
      const id = _coordEscHtml(String(n.id));
      return `<button type="button" class="coord-notif-row" data-coord-notif-id="${id}" style="display:block;width:100%;text-align:left;padding:12px 14px;border-radius:10px;margin-bottom:4px;background:${bg};cursor:pointer;border:none;font:inherit;border-left:3px solid ${
        !isRead
          ? n.prioridade === "urgent"
            ? "#dc2626"
            : n.prioridade === "warn"
              ? "#f59e0b"
              : "#3b82f6"
          : "transparent"
      }">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
          <span style="font-size:0.85rem">${icon}</span>
          <span style="font-size:0.82rem;font-weight:${isRead ? "500" : "700"};color:var(--text);flex:1">${_coordEscHtml(
            String(n.titulo || "")
          )}</span>
          <span style="font-size:0.65rem;color:var(--text-soft);white-space:nowrap">${date}</span>
        </div>
        <div style="font-size:0.78rem;color:var(--text-soft);line-height:1.5;margin-left:22px">${_coordEscHtml(
          String(n.mensagem || "")
        ).substring(0, 200)}${String(n.mensagem || "").length > 200 ? "…" : ""}</div>
        ${
          n.criado_por
            ? `<div style="font-size:0.65rem;color:var(--text-soft);margin-top:4px;margin-left:22px">por ${_coordEscHtml(
                String(n.criado_por)
              )}</div>`
            : ""
        }
      </button>`;
    })
    .join("");

  listEl.innerHTML =
    html ||
    '<div style="padding:28px;text-align:center;color:var(--text-soft);font-size:0.82rem">Nenhum aviso no momento.</div>';

  if (badge) {
    if (unread > 0) {
      badge.textContent = unread > 99 ? "99+" : String(unread);
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }

  listEl.querySelectorAll("[data-coord-notif-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-coord-notif-id");
      if (!id) return;
      try {
        await _coordNotifRequest("markRead", id);
        await _coordRefreshNotifUi();
      } catch (e) {
        _coordBriefToast((e && e.message) || "Não foi possível atualizar.");
      }
    });
  });
}

/**
 * Mostra pop-ups de avisos com modo_coord=popup (um de cada vez).
 */
async function _coordRunPopupQueue() {
  const email = await _coordNotifUserEmail();
  if (!email) return;
  const overlay = document.getElementById("coordNotifPopupOverlay");
  const titleEl = document.getElementById("coordNotifPopupTitle");
  const bodyEl = document.getElementById("coordNotifPopupBody");
  if (!overlay || !titleEl || !bodyEl) return;

  const pending = _coordNotifCache.filter((n) => {
    const lido = _coordNormalizeLidoPor(n.lido_por);
    if (lido.includes(email)) return false;
    const modo = String(n.modo_coord || "central").toLowerCase();
    if (modo !== "popup") return false;
    // Não exibir popup se título e mensagem estiverem vazios
    if (!String(n.titulo || "").trim() && !String(n.mensagem || "").trim()) return false;
    return true;
  });
  pending.sort((a, b) => {
    const ta = a.created_at ? new Date(String(a.created_at)).getTime() : 0;
    const tb = b.created_at ? new Date(String(b.created_at)).getTime() : 0;
    return ta - tb;
  });

  const showNext = async () => {
    const n = pending.shift();
    if (!n) {
      overlay.hidden = true;
      return;
    }
    titleEl.textContent = String(n.titulo || "Aviso");
    bodyEl.textContent = String(n.mensagem || "");
    overlay.hidden = false;
    const okBtn = document.getElementById("coordNotifPopupOk");
    const onOk = async () => {
      okBtn && okBtn.removeEventListener("click", onOk);
      try {
        await _coordNotifRequest("markRead", String(n.id));
        await _coordRefreshNotifUi();
      } catch {
        /* ignore */
      }
      showNext();
    };
    if (okBtn) okBtn.addEventListener("click", onOk, { once: true });
  };

  if (pending.length) await showNext();
}

/**
 * Injeta sino, painel e fila de pop-ups no painel do coordenador.
 */
async function mountCoordNotificacoesUi() {
  if (document.getElementById("coordNotifBtn")) return;
  let email = "";
  try {
    email = await _coordNotifUserEmail();
  } catch {
    return;
  }
  if (!email) return;

  const topbarInner = document.querySelector(".topbar-inner");
  const logoutBtn = document.getElementById("btnLogout");
  if (!topbarInner || !logoutBtn) return;

  const wrap = document.createElement("div");
  wrap.className = "coord-notif-toolbar";
  wrap.innerHTML = `
    <button type="button" id="coordNotifBtn" class="coord-notif-btn" title="Central de avisos" aria-expanded="false" aria-haspopup="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
      <span id="coordNotifBadge" class="coord-notif-badge" hidden>0</span>
    </button>`;
  topbarInner.insertBefore(wrap, logoutBtn);

  const panel = document.createElement("div");
  panel.id = "coordNotifPanel";
  panel.className = "coord-notif-panel";
  panel.hidden = true;
  panel.innerHTML = `
    <div class="coord-notif-panel-head">
      <span class="coord-notif-panel-title">🔔 Central de avisos</span>
      <button type="button" class="coord-notif-clear-all" id="coordNotifClearAll">Limpar todos os avisos</button>
    </div>
    <div id="coordNotifList" class="coord-notif-list"></div>`;
  document.body.appendChild(panel);

  const popup = document.createElement("div");
  popup.id = "coordNotifPopupOverlay";
  popup.className = "coord-notif-popup-overlay";
  popup.hidden = true;
  popup.innerHTML = `
    <div class="coord-notif-popup-card" role="dialog" aria-modal="true" aria-labelledby="coordNotifPopupTitle">
      <div class="coord-notif-popup-kicker">Aviso da equipe MedCof</div>
      <h2 id="coordNotifPopupTitle" class="coord-notif-popup-h2"></h2>
      <p id="coordNotifPopupBody" class="coord-notif-popup-body"></p>
      <button type="button" class="coord-notif-popup-ok" id="coordNotifPopupOk">Entendi</button>
    </div>`;
  document.body.appendChild(popup);

  const btn = document.getElementById("coordNotifBtn");
  const clearAll = document.getElementById("coordNotifClearAll");

  const togglePanel = () => {
    const open = panel.hidden;
    panel.hidden = !open;
    if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
    if (!panel.hidden) void _coordRefreshNotifUi();
  };

  btn &&
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePanel();
    });

  clearAll &&
    clearAll.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await _coordNotifRequest("markAllRead");
        _coordBriefToast("Todos os avisos foram limpos.");
        await _coordRefreshNotifUi();
        panel.hidden = true;
        if (btn) btn.setAttribute("aria-expanded", "false");
      } catch (err) {
        _coordBriefToast((err && err.message) || "Não foi possível limpar.");
      }
    });

  document.addEventListener("click", (e) => {
    if (panel.hidden) return;
    const t = /** @type {Node} */ (e.target);
    if (panel.contains(t) || (btn && btn.contains(t))) return;
    panel.hidden = true;
    if (btn) btn.setAttribute("aria-expanded", "false");
  });

  await _coordRefreshNotifUi();
  await _coordRunPopupQueue();

  setInterval(() => {
    if (sessionStorage.getItem(ACCESS_STATE_KEY) !== "granted") return;
    if (!panel.hidden) return;
    void _coordRefreshNotifUi().then(() => _coordRunPopupQueue());
  }, 120000);
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
 * Remove campos e padrões sensíveis do contexto enviado ao Cofbot (defesa em profundidade — LGPD).
 * @param {Record<string, unknown>} payload
 * @returns {Record<string, unknown>}
 */
function sanitizeCoordChatContextPayload(payload) {
  const sensitiveKey = /^(cpf|documento|rg|email|telefone|phone|tel|senha|password)$/i;
  /**
   * @param {string} s
   */
  function redactString(s) {
    return s.replace(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[omitido]");
  }
  /**
   * @param {unknown} v
   * @returns {unknown}
   */
  function walk(v) {
    if (v == null) return v;
    if (Array.isArray(v)) return v.map(walk);
    if (typeof v === "object") {
      const o = {};
      for (const [k, val] of Object.entries(v)) {
        if (sensitiveKey.test(k)) continue;
        o[k] = walk(val);
      }
      return o;
    }
    if (typeof v === "string") return redactString(v);
    return v;
  }
  try {
    return /** @type {Record<string, unknown>} */ (walk(payload));
  } catch {
    return { page: "erro", aviso: "contexto_indisponivel" };
  }
}

/**
 * @param {string} n
 * @returns {string}
 */
function _normStudentNameKey(n) {
  return String(n || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Localiza aluno no ranking consolidado (match exato, depois único prefixo/inclusão).
 * @param {string} query
 * @returns {object | null}
 */
function findStudentInRankingByQuery(query) {
  const q = _normStudentNameKey(query);
  if (q.length < 2) return null;
  const rows = ACCUMULATED_DASHBOARD?.ranking || [];
  const exact = rows.find((s) => _normStudentNameKey(s.nome) === q);
  if (exact) return exact;
  const starts = rows.filter((s) => _normStudentNameKey(s.nome).startsWith(q));
  if (starts.length === 1) return starts[0];
  const includes = rows.filter((s) => _normStudentNameKey(s.nome).includes(q));
  if (includes.length === 1) return includes[0];
  return null;
}

/**
 * Monta payload de contexto do Modo sniper (um aluno) para o Cofbot.
 * @param {object} student
 * @returns {Record<string, unknown>}
 */
function buildHomeSniperStudentPayload(student) {
  const nk = _normStudentNameKey(student.nome);
  const simulados = [];
  const allSims = _engSimCache?.allSims || [];
  allSims.forEach((s) => {
    const n = s.notaByName[nk];
    if (n != null) {
      simulados.push({
        rotulo: s.label || "",
        titulo: (s.titulo || "").slice(0, 120),
        notaPercentual: n
      });
    }
  });
  return {
    nome: student.nome,
    turma: student.turma || null,
    questoesTotal: student.questoes,
    questoesPorDia: student.questoesDia,
    taxaAcertoPercentual: student.taxa_acerto ?? null,
    tempoEstudoMinutos: student.tempo_min ?? null,
    mesesAtivos: student.activeMonths,
    faixaEngajamento: student.traction?.label || null,
    aulas: student.aulas ?? null,
    flashcards: student.flashcards ?? null,
    simuladosComNota: simulados
  };
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
    generatedAt: new Date().toISOString(),
    orientacaoMedCof: {
      metaQuestoesPorDia: 20,
      focoProva: "ENAMED",
      nota:
        "Correlacione engajamento (questões/dia, quando disponível) com desempenho em simulados; não invente valores nem causalidade estatística."
    }
  };

  /** @type {Record<string, unknown>} */
  let out;
  try {
    if (page === "engagement") {
      const rows = engagementState.filteredRows || [];
      const sample = rows.slice(0, 45).map((s) => {
        const rawQd = s.questoesDia;
        const qdNum =
          typeof rawQd === "number"
            ? rawQd
            : parseFloat(String(rawQd ?? "").replace(",", "."));
        const abaixoMeta20 = Number.isFinite(qdNum) ? qdNum < 20 : null;
        return {
          nome: s.nome,
          turma: s.turma || TURMA_BY_NAME[s.nome.trim().toLowerCase()] || null,
          questoes: s.questoes,
          taxa_acerto: s.taxa_acerto,
          engajamento: s.traction?.label,
          questoesDia: s.questoesDia,
          abaixoMeta20,
          tempo_min: s.tempo_min,
          activeMonths: s.activeMonths
        };
      });
      out = {
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
    } else if (page === "period") {
      const period = PERIODS[periodState.currentIndex];
      const rows = periodState.filteredRows || [];
      const days = period?.meta?.days || 1;
      const sample = rows.slice(0, 45).map((row) => {
        const eng = getPeriodEngagement(row.questoes, days);
        const qdApprox =
          row.questoes != null && days > 0
            ? Math.round((row.questoes / days) * 10) / 10
            : null;
        const abaixoMeta20 =
          qdApprox != null && Number.isFinite(qdApprox) ? qdApprox < 20 : null;
        return {
          nome: row.nome,
          turma: row.turma || TURMA_BY_NAME[row.nome.trim().toLowerCase()] || null,
          questoes: row.questoes,
          questoesPorDiaAprox: qdApprox,
          abaixoMeta20,
          tempo_min: row.tempo_min,
          engajamento: eng.label
        };
      });
      out = {
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
    } else if (page === "mentor") {
      out = {
        ...base,
        mentor:
          window.__MEDCOF_MENTOR_CTX__ || {
            nota: "Use Refazer na página Mentor para atualizar o resumo de áreas e temas para o Cofbot."
          }
      };
    } else if (page === "simulados") {
      if (window.__MEDCOF_SIM_CHAT_CTX__) {
        out = { ...base, simuladoNaTela: window.__MEDCOF_SIM_CHAT_CTX__ };
      } else {
        out = { ...base, simulados: { rotaHash: location.hash || "(início)" } };
      }
    } else {
      let sniper = null;
      try {
        sniper = window.__MEDCOF_SNIPER_CONTEXT__;
        if (sniper) window.__MEDCOF_SNIPER_CONTEXT__ = null;
      } catch {
        sniper = null;
      }
      if (sniper && typeof sniper === "object" && sniper.nome) {
        out = {
          ...base,
          home: {
            dashboardInicial: true,
            modoSniper: true,
            alunoFoco: sniper
          }
        };
      } else {
        out = {
          ...base,
          home: {
            dashboardInicial: true,
            nota: "KPIs e gráficos do ciclo. Use Modo sniper na página inicial para focar em um aluno."
          }
        };
      }
    }
  } catch (e) {
    out = { ...base, erroContexto: String(e && e.message) };
  }
  return sanitizeCoordChatContextPayload(out);
}

/**
 * Sugestões por tipo de página.
 * @param {string} page
 * @returns {string[]}
 */
function getCoordenadorChatSuggestions(page) {
  const map = {
    home: [
      "Modo sniper: como usar o resumo operacional de um aluno numa conversa individual?",
      "Quais 3 ações eu priorizo na reunião de coordenação esta semana?",
      "Como explicar a meta de ~20 questões/dia para a turma sem soar genérico?"
    ],
    engagement: [
      "Quem está abaixo de 20 questões/dia neste filtro — e o que sugerir primeiro?",
      "Como montar uma lista de acompanhamento semana a semana?",
      "Tempo na plataforma alto mas poucas questões: como orientar o aluno?"
    ],
    period: [
      "Neste período selecionado, quem está mais abaixo da média de questões/dia?",
      "Com o filtro de turma atual, qual é o recorte mais crítico para agir hoje?",
      "Como usar a faixa de engajamento do período numa conversa individual?"
    ],
    simulados: [
      "Como relacionar o desempenho deste simulado com o engajamento na plataforma?",
      "Quais temas ou áreas priorizar para a ENAMED com base no que está na tela?",
      "A turma está acima ou abaixo da referência — qual mensagem passar na próxima aula?"
    ],
    mentor: [
      "Como alinhar a distribuição de questões por grande área com os temas mais frágeis?",
      "O que comunicar à turma com base no resumo de desempenho por área?",
      "Como equilibrar Tendências e Personalizado na preparação para a ENAMED?"
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

  const nudgeTri =
    '<svg class="medcof-cofbot-nudge-ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 5 L20 19 H4 Z"/></svg>';

  const root = document.createElement("div");
  root.id = "medcof-coord-chat-root";
  root.className = "medcof-coord-chat-root--br medcof-cofbot-theme-light";
  root.innerHTML = `
    <div class="medcof-cofbot-fab-cluster">
      <button type="button" class="medcof-cofbot-nudge medcof-cofbot-nudge--tl" data-cofbot-corner="tl" aria-label="Cofbot no canto superior esquerdo">${nudgeTri}</button>
      <button type="button" class="medcof-cofbot-nudge medcof-cofbot-nudge--tr" data-cofbot-corner="tr" aria-label="Cofbot no canto superior direito">${nudgeTri}</button>
      <button type="button" class="medcof-cofbot-nudge medcof-cofbot-nudge--bl" data-cofbot-corner="bl" aria-label="Cofbot no canto inferior esquerdo">${nudgeTri}</button>
      <button type="button" class="medcof-coord-chat-fab" id="medcofCoordChatFab" aria-label="Abrir Cofbot — assistente do coordenador" aria-expanded="false">
        <img class="medcof-coord-chat-fab-icon" src="/assets/coordenador-chat-fab.png" alt="" width="44" height="52" decoding="async" draggable="false" />
      </button>
    </div>
    <div class="medcof-coord-chat-panel" id="medcofCoordChatPanel" hidden>
      <div class="medcof-coord-chat-head medcof-cofbot-head">
        <div class="medcof-cofbot-head-main">
          <div class="medcof-cofbot-avatar" aria-hidden="true"><img src="/assets/coordenador-chat-fab.png" alt="" width="36" height="42" decoding="async" draggable="false" /></div>
          <div>
            <div class="medcof-coord-chat-title">Cofbot</div>
            <div class="medcof-coord-chat-sub">Assistente MedCof com base no que você vê no painel — sem dados sensíveis</div>
          </div>
        </div>
        <div class="medcof-cofbot-head-actions">
          <button type="button" class="medcof-cofbot-icon-btn" id="medcofCoordChatExpand" aria-label="Expandir painel" title="Expandir">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>
          </button>
          <button type="button" class="medcof-cofbot-icon-btn" id="medcofCoordChatDock" aria-label="Mudar posição do Cofbot na página" title="Posição na tela">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="12" height="12" rx="2"/><path d="M14 10h6v6a2 2 0 0 1-2 2h-6"/></svg>
          </button>
          <button type="button" class="medcof-cofbot-icon-btn" id="medcofCoordChatClear" aria-label="Limpar histórico do chat" title="Limpar histórico">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
          </button>
          <button type="button" class="medcof-coord-chat-close" id="medcofCoordChatClose" aria-label="Fechar">×</button>
        </div>
      </div>
      <div class="medcof-coord-chat-suggestions" id="medcofCoordChatSuggestions">
        <div class="medcof-coord-chat-insight" id="medcofCoordChatInsight" hidden></div>
        <div class="medcof-coord-chat-chips" id="medcofCoordChatChips"></div>
      </div>
      <div class="medcof-coord-chat-messages" id="medcofCoordChatMessages"></div>
      <div class="medcof-coord-chat-error" id="medcofCoordChatError" hidden></div>
      <form class="medcof-coord-chat-form" id="medcofCoordChatForm">
        <input type="text" class="medcof-coord-chat-input" id="medcofCoordChatInput" placeholder="Ex.: quem precisa de acompanhamento neste período?" autocomplete="off" maxlength="2000" />
        <button type="submit" class="medcof-coord-chat-send" id="medcofCoordChatSend">Enviar</button>
      </form>
      <div class="medcof-cofbot-resize-grip" aria-hidden="true"></div>
    </div>
  `;
  document.body.appendChild(root);

  const COF_CORNER_KEY = "medcofCoordChatCorner";
  const CORNERS = ["br", "bl", "tr", "tl"];

  /**
   * Fixa o widget Cofbot em um canto da viewport e persiste a escolha.
   * @param {string} pos
   */
  function applyCofbotCorner(pos) {
    if (CORNERS.indexOf(pos) < 0) pos = "br";
    root.className = `medcof-coord-chat-root--${pos}`;
    try {
      localStorage.setItem(COF_CORNER_KEY, pos);
    } catch {
      /* ignore */
    }
  }

  function loadCofbotCorner() {
    let pos = "br";
    try {
      pos = localStorage.getItem(COF_CORNER_KEY) || "br";
    } catch {
      /* ignore */
    }
    applyCofbotCorner(pos);
  }

  loadCofbotCorner();

  root.querySelectorAll("[data-cofbot-corner]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      applyCofbotCorner(btn.getAttribute("data-cofbot-corner") || "br");
    });
  });

  const panel = root.querySelector("#medcofCoordChatPanel");
  const expandBtn = document.getElementById("medcofCoordChatExpand");
  const dockBtn = document.getElementById("medcofCoordChatDock");
  if (expandBtn && panel) {
    expandBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const fs = panel.classList.toggle("medcof-cofbot-panel--fullscreen");
      expandBtn.setAttribute("aria-pressed", fs ? "true" : "false");
    });
  }
  if (dockBtn) {
    dockBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      let cur = "br";
      try {
        cur = localStorage.getItem(COF_CORNER_KEY) || "br";
      } catch {
        /* ignore */
      }
      const idx = CORNERS.indexOf(cur);
      const next = CORNERS[(idx < 0 ? 0 : idx + 1) % CORNERS.length];
      applyCofbotCorner(next);
    });
  }

  const fab = root.querySelector("#medcofCoordChatFab");
  const closeBtn = root.querySelector("#medcofCoordChatClose");
  const insightEl = root.querySelector("#medcofCoordChatInsight");
  const chipsEl = root.querySelector("#medcofCoordChatChips");
  const messagesEl = root.querySelector("#medcofCoordChatMessages");
  const errorEl = root.querySelector("#medcofCoordChatError");
  const form = root.querySelector("#medcofCoordChatForm");
  const input = root.querySelector("#medcofCoordChatInput");
  const sendBtn = root.querySelector("#medcofCoordChatSend");

  const chatUrl = `${window.location.origin}/.netlify/functions/coordenador-chat`;
  let panelOpen = false;
  /** @type {{ role: string, content: string }[]} */
  let thread = [];

  /**
   * @param {string} text
   */
  function setCoordInsight(text) {
    const t = String(text || "").trim();
    if (!t || !insightEl) {
      if (insightEl) {
        insightEl.hidden = true;
        insightEl.textContent = "";
      }
      return;
    }
    insightEl.hidden = false;
    insightEl.innerHTML = renderCofbotAssistantHtml(t);
  }

  /**
   * @param {string[]} chips
   */
  function bindCoordChips(chips) {
    if (!chipsEl) return;
    chipsEl.innerHTML = chips
      .map((text) => {
        const safe = document.createElement("span");
        safe.textContent = text;
        return `<button type="button" class="medcof-coord-chat-chip">${safe.innerHTML}</button>`;
      })
      .join("");
    chipsEl.querySelectorAll(".medcof-coord-chat-chip").forEach((btn, i) => {
      btn.addEventListener("click", () => {
        input.value = chips[i];
        form.requestSubmit();
      });
    });
  }

  function renderSuggestions() {
    setCoordInsight("");
    const page = document.body.dataset.page || "home";
    bindCoordChips(getCoordenadorChatSuggestions(page));
  }

  /**
   * Escapa HTML e aplica negrito Markdown (`**texto**`) nas mensagens do assistente.
   * @param {string} text
   * @returns {string}
   */
  function renderCofbotAssistantHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>");
  }

  /**
   * Após resposta do assistente: insight opcional e chips dinâmicos (ou fallback estático).
   * @param {string} [insight]
   * @param {string[]} [followUps]
   */
  function applyCoordFollowUps(insight, followUps) {
    setCoordInsight(insight || "");
    const page = document.body.dataset.page || "home";
    const list = Array.isArray(followUps) ? followUps.filter((s) => String(s || "").trim()) : [];
    bindCoordChips(list.length ? list : getCoordenadorChatSuggestions(page));
  }

  function appendMessage(role, text) {
    const div = document.createElement("div");
    div.className = `medcof-coord-chat-msg medcof-coord-chat-msg--${role}`;
    if (role === "assistant") {
      div.innerHTML = renderCofbotAssistantHtml(text);
    } else {
      div.textContent = text;
    }
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function setPanel(v) {
    panelOpen = v;
    panel.hidden = !v;
    fab.setAttribute("aria-expanded", v ? "true" : "false");
  }

  fab.addEventListener("click", (e) => {
    e.stopPropagation();
    setPanel(!panelOpen);
  });
  closeBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    setPanel(false);
  });

  /** Fecha ao clicar fora do chat (captura, antes de outros handlers). */
  function onDocPointerDown(ev) {
    if (!panelOpen) return;
    if (root.contains(ev.target)) return;
    setPanel(false);
  }
  document.addEventListener("pointerdown", onDocPointerDown, true);

  const clearBtn = document.getElementById("medcofCoordChatClear");
  if (clearBtn) {
    clearBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      thread = [];
      messagesEl.innerHTML = "";
      errorEl.hidden = true;
      errorEl.textContent = "";
      renderSuggestions();
    });
  }

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
        throw new Error(
          "Para conversar com o Cofbot ao lado dos dados da sua turma, entre no painel com seu usuário MedCof."
        );
      }
      const ies_slug = _medcofSlugFromPath();
      const context = buildCoordenadorChatContext();
      const res = await fetch(chatUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messages: thread,
          context,
          ies_slug,
          supabase_access_token: token
        })
      });
      const body = await res.json().catch(() => ({}));
      loading.remove();
      if (!res.ok) {
        let msg =
          body.error ||
          "Não conseguimos resposta do Cofbot neste momento. Tente de novo em instantes — se continuar, fale com o time MedCof.";
        if (res.status === 501 || res.status === 405) {
          msg =
            "Para testar o Cofbot no seu computador, use o fluxo de desenvolvimento MedCof com Netlify CLI — um servidor de arquivos simples não executa o assistente do painel.";
        } else if (res.status === 404) {
          msg =
            "Cofbot não está disponível neste endereço. O time MedCof pode conferir o deploy do painel institucional.";
        } else if (res.status === 502 && !body.error) {
          msg =
            "Cofbot não respondeu a tempo. Tente de novo; se repetir, avise o time MedCof — estamos para ajudar sua instituição.";
        } else if (res.status === 504 && !body.error) {
          msg =
            "A leitura dos dados levou mais tempo que o esperado. Tente uma pergunta mais curta ou aguarde um instante e envie de novo.";
        }
        throw new Error(msg);
      }
      const reply = body.reply || "";
      appendMessage("assistant", reply);
      thread.push({ role: "assistant", content: reply });
      applyCoordFollowUps(body.insight, body.follow_up_questions);
    } catch (err) {
      loading.remove();
      errorEl.textContent = err.message || "Não foi possível enviar agora. Tente de novo ou fale com o time MedCof.";
      errorEl.hidden = false;
    } finally {
      sendBtn.disabled = false;
    }
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape" || !panelOpen) return;
    if (panel && panel.classList.contains("medcof-cofbot-panel--fullscreen")) {
      panel.classList.remove("medcof-cofbot-panel--fullscreen");
      if (expandBtn) expandBtn.setAttribute("aria-pressed", "false");
      return;
    }
    setPanel(false);
  });

  window.medcofCofbotSubmitSniperPrompt = function (promptText, contextPayload) {
    window.__MEDCOF_SNIPER_CONTEXT__ = contextPayload || null;
    setPanel(true);
    input.value = promptText || "";
    form.requestSubmit();
  };
}

// ── Exportar resultado do simulado como PDF (via print) ──
window._exportSimPDF = function() {
  const ctx = window.__MEDCOF_SIM_EXPORT__;
  if (!ctx) return;
  const w = window.open('', '_blank');
  if (!w) { alert('Permita popups para gerar o PDF.'); return; }
  const fmtPct = v => v != null ? Number(v).toFixed(1) + '%' : '—';
  const fmtNome = nome => {
    if (!nome || nome.startsWith('CPF:')) return nome || '—';
    const lower = ['da','de','do','dos','das','e'];
    return nome.trim().split(/\s+/).map(p => { const l = p.toLowerCase(); return lower.includes(l) ? l : l.charAt(0).toUpperCase() + l.slice(1); }).join(' ');
  };
  const alunoRows = ctx.alunosSorted.map((a, i) =>
    `<tr><td style="text-align:center;padding:6px 10px">${i+1}</td><td style="padding:6px 10px">${fmtNome(a.nome)}</td><td style="text-align:center;padding:6px 10px">${a.turma || '—'}</td><td style="text-align:right;padding:6px 10px;font-weight:700">${fmtPct(a.nota)}</td></tr>`
  ).join('');
  const areaRows = ctx.areaList.map(a =>
    `<tr><td style="padding:6px 10px">${a.label}</td><td style="text-align:right;padding:6px 10px;font-weight:700">${a.media.toFixed(1)}%</td></tr>`
  ).join('');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${ctx.titulo} — Resultado</title>
  <style>body{font-family:-apple-system,sans-serif;padding:32px;color:#1e293b;font-size:12px;line-height:1.5}
  h1{font-size:18px;margin:0 0 4px}h2{font-size:14px;margin:24px 0 8px;border-bottom:1px solid #e2e8f0;padding-bottom:4px}
  table{width:100%;border-collapse:collapse;margin-bottom:16px}th,td{border:1px solid #e2e8f0;padding:6px 10px;text-align:left}
  th{background:#f1f5f9;font-size:11px;text-transform:uppercase;font-weight:700}
  .meta{display:flex;gap:24px;margin:12px 0 20px;flex-wrap:wrap}.meta-item{text-align:center}.meta-label{font-size:10px;text-transform:uppercase;color:#64748b;font-weight:700}.meta-value{font-size:20px;font-weight:800}
  @media print{body{padding:16px}}</style></head><body>
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
    <div><span style="font-size:11px;padding:3px 10px;border-radius:4px;background:${ctx.tipoLabel==='Tendências'?'#16a34a':'#3b82f6'};color:#fff;font-weight:700">${ctx.tipoLabel.toUpperCase()}</span></div>
    <div style="font-size:10px;color:#94a3b8">Gerado em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</div>
  </div>
  <h1>${ctx.titulo}</h1>
  <p style="color:#64748b;margin:0 0 16px">${ctx.totalAlunos} alunos · ${ctx.totalQuestoes} questões${ctx.anuladasCount ? ' · ' + ctx.anuladasCount + ' anulada(s)' : ''}</p>
  <div class="meta">
    <div class="meta-item"><div class="meta-label">Média IES</div><div class="meta-value">${fmtPct(ctx.mediaIES)}</div></div>
    ${ctx.mediaGeral != null ? `<div class="meta-item"><div class="meta-label">Média Geral</div><div class="meta-value">${fmtPct(ctx.mediaGeral)}</div></div>` : ''}
    <div class="meta-item"><div class="meta-label">Mediana</div><div class="meta-value">${fmtPct(ctx.mediana)}</div></div>
    <div class="meta-item"><div class="meta-label">Maior</div><div class="meta-value">${fmtPct(ctx.notaMax)}</div></div>
    <div class="meta-item"><div class="meta-label">Menor</div><div class="meta-value">${fmtPct(ctx.notaMin)}</div></div>
    ${ctx.rankNac != null ? `<div class="meta-item"><div class="meta-label">Nacional</div><div class="meta-value">${ctx.rankNac}/${ctx.rankNacTotal}</div></div>` : ''}
    ${ctx.rankReg != null ? `<div class="meta-item"><div class="meta-label">Regional</div><div class="meta-value">${ctx.rankReg}/${ctx.rankRegTotal}</div></div>` : ''}
  </div>
  ${ctx.areaList.length ? `<h2>Desempenho por Área</h2><table><thead><tr><th>Área</th><th style="text-align:right">Média</th></tr></thead><tbody>${areaRows}</tbody></table>` : ''}
  <h2>Ranking de Alunos</h2>
  <table><thead><tr><th style="text-align:center;width:40px">#</th><th>Aluno</th><th style="text-align:center">Turma</th><th style="text-align:right">Nota</th></tr></thead><tbody>${alunoRows}</tbody></table>
  <script>window.onload=function(){window.print()}<\/script></body></html>`);
  w.document.close();
};

// ── Exportar resultado do simulado como Excel (CSV) ──
window._exportSimExcel = function() {
  const ctx = window.__MEDCOF_SIM_EXPORT__;
  if (!ctx) return;
  const fmtNome = nome => {
    if (!nome || nome.startsWith('CPF:')) return nome || '—';
    const lower = ['da','de','do','dos','das','e'];
    return nome.trim().split(/\s+/).map(p => { const l = p.toLowerCase(); return lower.includes(l) ? l : l.charAt(0).toUpperCase() + l.slice(1); }).join(' ');
  };
  const sep = ';';
  const lines = [];
  lines.push(`Simulado${sep}${ctx.titulo}`);
  lines.push(`Tipo${sep}${ctx.tipoLabel}`);
  lines.push(`Total Alunos${sep}${ctx.totalAlunos}`);
  lines.push(`Total Questões${sep}${ctx.totalQuestoes}`);
  lines.push(`Média IES${sep}${ctx.mediaIES != null ? ctx.mediaIES.toFixed(1) : ''}`);
  if (ctx.mediaGeral != null) lines.push(`Média Geral${sep}${ctx.mediaGeral.toFixed(1)}`);
  if (ctx.mediana != null) lines.push(`Mediana${sep}${ctx.mediana.toFixed(1)}`);
  if (ctx.rankNac != null) lines.push(`Ranking Nacional${sep}${ctx.rankNac}/${ctx.rankNacTotal}`);
  lines.push('');
  lines.push(`#${sep}Aluno${sep}Turma${sep}Nota (%)`);
  ctx.alunosSorted.forEach((a, i) => {
    const nota = a.nota != null ? a.nota.toFixed(1) : '';
    lines.push(`${i+1}${sep}${fmtNome(a.nome)}${sep}${a.turma || ''}${sep}${nota}`);
  });
  if (ctx.areaList.length) {
    lines.push('');
    lines.push(`Área${sep}Média (%)`);
    ctx.areaList.forEach(a => lines.push(`${a.label}${sep}${a.media.toFixed(1)}`));
  }
  if (ctx.temaList.length) {
    lines.push('');
    lines.push(`Tema${sep}Área${sep}% Acerto`);
    ctx.temaList.forEach(t => lines.push(`${t.tema}${sep}${t.area}${sep}${t.pct.toFixed(1)}`));
  }
  const bom = '\uFEFF';
  const blob = new Blob([bom + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${ctx.titulo.replace(/[^a-zA-Z0-9À-ÿ ]/g, '').trim()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};
