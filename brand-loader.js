/**
 * brand-loader.js v3 — Logo da IES via Supabase; cor do painel = identidade MedCof fixa
 * (theme_hex do admin não altera o visual do painel — só identificação no admin).
 */
const MEDCOF_PANEL_ACCENT_HEX = '#dc2626';

(async function () {
  const slug = location.pathname.split('/').filter(Boolean)[0];
  if (!slug) return;

  // ── Fix microframe: limpar sessão de outra IES ─────────────────────
  const storedInst = sessionStorage.getItem('medcof_panel_institution');
  if (storedInst && storedInst !== slug) {
    sessionStorage.removeItem('medcof_panel_institution');
    sessionStorage.removeItem('medcof_panel_access');
    sessionStorage.removeItem('medcof_admin_bypass');
  }

  try {
    // Só filtra por slug: muitos documentos no Mongo vêm sem `ativo` ou com sync antigo;
    // exigir ativo=eq.true fazia a query retornar vazio e o painel ficava só no logo local.
    const resp = await fetch('/.netlify/functions/anon-data-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        table: 'instituicoes',
        query: `select=logo_url,theme_hex&slug=eq.${encodeURIComponent(slug)}`
      })
    });
    if (!resp.ok) return;
    const [inst] = await resp.json();
    if (!inst) return;

    // ── LOGO ─────────────────────────────────────────────────────────
    if (inst.logo_url) {
      const applyLogo = () => {
        // Atualizar imgs existentes
        document.querySelectorAll(
          '.topbar-institution-logo, .home-institution-logo, img[class*="institution-logo"]'
        ).forEach(img => { img.src = inst.logo_url; });

        // Se shared.js inseriu badge de iniciais (sem img), criar a img no slot
        const logoSlot = document.getElementById('institutionLogoSlot');
        if (logoSlot && !logoSlot.querySelector('img')) {
          logoSlot.innerHTML = `<img class="home-institution-logo" src="${inst.logo_url}" alt="Logo" style="max-width:100%;max-height:100%;object-fit:contain">`;
        }

        // Se topbar brand-mark não tem img, criar
        const brandMark = document.querySelector('.brand-mark[data-institution-initials]');
        if (brandMark && !brandMark.querySelector('img')) {
          brandMark.innerHTML = `<img class="topbar-institution-logo" src="${inst.logo_url}" alt="Logo" style="max-width:100%;max-height:100%;object-fit:contain">`;
          brandMark.classList.add('brand-mark-logo');
        }
      };
      applyLogo();
      window.addEventListener('load', applyLogo);
      const obs = new MutationObserver(applyLogo);
      obs.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => obs.disconnect(), 6000);
    }

    // ── COR DO PAINEL: paleta MedCof (não usa inst.theme_hex) ─────────
    {
      const hex = MEDCOF_PANEL_ACCENT_HEX;
      const r = parseInt(hex.slice(1,3),16);
      const g = parseInt(hex.slice(3,5),16);
      const b = parseInt(hex.slice(5,7),16);

      // Variantes
      const dark  = `rgb(${Math.round(r*.55)},${Math.round(g*.55)},${Math.round(b*.55)})`;
      const mid   = `rgb(${Math.round(r*.75)},${Math.round(g*.75)},${Math.round(b*.75)})`;
      const rgba  = (a) => `rgba(${r},${g},${b},${a})`;

      // Luminância do fundo real do thead (rgb escurecido 55%) — texto legível (branco no vermelho MedCof)
      const toLinear = c => { const s = c/255; return s<=0.04045 ? s/12.92 : Math.pow((s+0.055)/1.055,2.4); };
      const dr = Math.round(r * 0.55);
      const dg = Math.round(g * 0.55);
      const db = Math.round(b * 0.55);
      const theadBgLum = 0.2126 * toLinear(dr) + 0.7152 * toLinear(dg) + 0.0722 * toLinear(db);
      const theadTextColor = theadBgLum > 0.45 ? '#111827' : '#ffffff';

      const css = `
/* ══════════════════════════════════════════════════════════════
   Brand Loader v3 — Cor completa do painel: ${hex}
   ══════════════════════════════════════════════════════════════ */

/* ── 1. BODY: fundo geral ── */
body {
  background:
    radial-gradient(circle at top left, ${rgba(0.12)}, transparent 30%),
    linear-gradient(180deg, ${rgba(0.06)} 0%, ${rgba(0.03)} 48%, ${rgba(0.08)} 100%)
    !important;
}

/* ── 2. TOPBAR ── */
.topbar {
  border-bottom-color: ${rgba(0.18)} !important;
  box-shadow: 0 8px 28px ${rgba(0.06)} !important;
}

/* ── 3. BRAND MARK + NAV ATIVO + ROADMAP INDEX ── */
.brand-mark:not(.brand-mark-logo),
.nav-link.active,
.roadmap-index {
  background: linear-gradient(135deg, ${dark} 0%, ${hex} 100%) !important;
  box-shadow: 0 12px 24px ${rgba(0.25)} !important;
  color: #ffffff !important;
}

/* Logo na topbar — manter branco */
.brand-mark.brand-mark-logo {
  background: #ffffff !important;
  box-shadow: 0 2px 8px ${rgba(0.10)} !important;
}

/* Nav links inativos */
.nav-link {
  border-color: ${rgba(0.22)} !important;
}
.nav-link:hover {
  border-color: ${rgba(0.40)} !important;
  box-shadow: 0 8px 18px ${rgba(0.12)} !important;
}

/* ── 4. HERO CARD (área principal colorida) ── */
.hero-card.hero-strong {
  background:
    radial-gradient(circle at top right, rgba(255,255,255,0.18), transparent 34%),
    linear-gradient(135deg, ${dark} 0%, ${mid} 55%, ${hex} 100%)
    !important;
  box-shadow: 0 26px 52px ${rgba(0.28)} !important;
}

/* ── 5. TEXTOS ACCENT (kickers, links, CTAs) ── */
.section-kicker,
.home-page-link,
.cta-link,
.kpi-card .kpi-value,
.spotlight-name,
.spotlight-score,
.export-icon-svg,
.check-chip span {
  color: ${hex} !important;
}

/* ── 6. KPI ICON ── */
.kpi-card .kpi-icon {
  background: ${rgba(0.10)} !important;
  color: ${hex} !important;
}

/* ── 7. CARDS hover/bordas ── */
.home-page-card:hover {
  border-color: ${rgba(0.25)} !important;
  box-shadow: 0 24px 44px ${rgba(0.14)} !important;
}

/* Logo card IES — MANTER BRANCO */
.home-logo-card.institution {
  background: #ffffff !important;
  border-color: ${rgba(0.18)} !important;
}

/* Spotlight cards */
.spotlight-card {
  border-color: ${rgba(0.15)} !important;
}
.spotlight-card .spotlight-rank {
  color: ${hex} !important;
}
.spotlight-card .spotlight-title {
  color: ${hex} !important;
}

/* ── 8. PERIOD SELECTOR (Período Detalhado) ── */
.period-selector.active {
  background: linear-gradient(135deg, ${dark} 0%, ${hex} 100%) !important;
  box-shadow: 0 18px 34px ${rgba(0.22)} !important;
}
.period-selector:hover {
  border-color: ${rgba(0.35)} !important;
}

/* ── 9. BOTÕES TURMA / FILTRO ── */
.turma-btn {
  border-color: ${rgba(0.22)} !important;
  color: ${dark} !important;
}
.turma-btn:hover {
  background: ${rgba(0.06)} !important;
  border-color: ${rgba(0.35)} !important;
}
.turma-btn.active {
  background: linear-gradient(135deg, ${dark}, ${hex}) !important;
  color: #ffffff !important;
  border-color: transparent !important;
  box-shadow: 0 6px 16px ${rgba(0.25)} !important;
}

/* Filtros de período (Simulado) */
.period-filter-btn.active,
.sp-rank-filter-btn.active {
  background: ${hex} !important;
  color: #ffffff !important;
  border-color: ${hex} !important;
}

/* ── 10. EXPORT (Baixar Excel) ── */
.export-card {
  border-color: ${rgba(0.20)} !important;
}
.btn-export {
  background: linear-gradient(135deg, ${dark} 0%, ${hex} 100%) !important;
  box-shadow: 0 12px 24px ${rgba(0.20)} !important;
  color: #ffffff !important;
}
.btn-select-all {
  background: ${rgba(0.08)} !important;
  color: ${dark} !important;
  border-color: ${rgba(0.22)} !important;
}
.check-chip input {
  accent-color: ${hex} !important;
}

/* ── 11. TABELA ── */
.table-wrap table th {
  background: ${rgba(0.06)} !important;
  color: ${dark} !important;
}
.table-wrap table thead tr {
  background: ${dark} !important;
}
.table-wrap table thead th {
  background: ${dark} !important;
  color: ${theadTextColor} !important;
}

/* ── 12. BADGES ── */
.badge-alto {
  background: ${rgba(0.10)} !important;
  color: ${hex} !important;
}

/* ── 13. ACCESS GATE (tela de senha) ── */
.access-btn {
  background: linear-gradient(135deg, ${dark}, ${hex}) !important;
  box-shadow: 0 12px 28px ${rgba(0.30)} !important;
}

/* ── 14. CSS VARIABLES (para elementos que usam var) ── */
body {
  --green: ${hex} !important;
  --green-dark: ${dark} !important;
  --green-soft: ${rgba(0.08)} !important;
  --green-mid: ${mid} !important;
  --blue: ${hex} !important;
  --blue-soft: ${rgba(0.08)} !important;
}
`;

      // Remover sync-theme (aplicado por shared.js) se existir — brand-loader é mais atualizado
      const oldSync = document.getElementById('sync-theme');
      if (oldSync) oldSync.remove();
      const style = document.createElement('style');
      style.id = 'brand-loader-theme';
      style.textContent = css;
      document.head.appendChild(style);
    }

    // ── AVISOS ÀS COORDENAÇÕES: popup desativado (evita modal vazio / intrusivo) ──

  } catch (e) { /* silencioso */ }
})();
