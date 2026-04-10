/**
 * brand-loader.js v3 — Aplica logo e cor do Supabase ao painel institucional.
 * Cobre TODOS os elementos temáticos (hero, nav, periods, export, KPIs, tabelas, etc.)
 * Também corrige o flash de outra IES ao navegar entre painéis.
 */
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
    const resp = await fetch('/.netlify/functions/anon-data-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        table: 'instituicoes',
        query: `select=logo_url,theme_hex&slug=eq.${encodeURIComponent(slug)}&ativo=eq.true`
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

    // ── COR DO PAINEL (COBERTURA COMPLETA) ────────────────────────────
    if (inst.theme_hex) {
      const hex = inst.theme_hex;
      const r = parseInt(hex.slice(1,3),16);
      const g = parseInt(hex.slice(3,5),16);
      const b = parseInt(hex.slice(5,7),16);

      // Variantes
      const dark  = `rgb(${Math.round(r*.55)},${Math.round(g*.55)},${Math.round(b*.55)})`;
      const mid   = `rgb(${Math.round(r*.75)},${Math.round(g*.75)},${Math.round(b*.75)})`;
      const rgba  = (a) => `rgba(${r},${g},${b},${a})`;

      // Luminância relativa do dark (55%) — decide se thead usa texto branco ou escuro
      const toLinear = c => { const s = c/255; return s<=0.04045 ? s/12.92 : Math.pow((s+0.055)/1.055,2.4); };
      const lum = 0.55 * (0.2126*toLinear(r) + 0.7152*toLinear(g) + 0.0722*toLinear(b));
      const theadTextColor = lum > 0.18 ? '#111827' : '#ffffff';

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

    // ── AVISOS ÀS COORDENAÇÕES ────────────────────────────────────
    try {
      const now = new Date().toISOString();
      const avisoResp = await fetch('/.netlify/functions/anon-data-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table: 'avisos',
          query: `select=id,titulo,mensagem,expira_em,ies_slug&ativo=eq.true&expira_em=gt.${encodeURIComponent(now)}&or=(ies_slug.eq.${encodeURIComponent(slug)},ies_slug.eq.all)&order=created_at.desc&limit=5`
        })
      });
      const avisos = avisoResp.ok ? await avisoResp.json() : [];
      // Filtrar apenas os não vistos ainda (localStorage por ID)
      const unseen = (avisos || []).filter(a => !localStorage.getItem(`aviso_seen_${a.id}`));
      if (unseen.length > 0) {
        // Aguardar DOM pronto para exibir o popup
        const showFirst = () => _showAvisoPopup(unseen[0], inst.theme_hex || '#22c55e');
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showFirst);
        else showFirst();
      }
    } catch(_) { /* avisos silencioso */ }

  } catch (e) { /* silencioso */ }
})();

// ── Popup de aviso para coordenações ─────────────────────────────
function _showAvisoPopup(aviso, themeHex) {
  const hex = themeHex || '#22c55e';
  // Variantes de cor
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  const dark = `rgb(${Math.round(r*.6)},${Math.round(g*.6)},${Math.round(b*.6)})`;

  // Injetar CSS de animação (uma vez)
  if (!document.getElementById('aviso-popup-style')) {
    const s = document.createElement('style');
    s.id = 'aviso-popup-style';
    s.textContent = `
      @keyframes _avisoBgIn  { from { opacity:0 } to { opacity:1 } }
      @keyframes _avisoBoxIn { from { transform:scale(0.88) translateY(24px);opacity:0 } to { transform:scale(1) translateY(0);opacity:1 } }
      @keyframes _avisoBar   { from { width:100% } to { width:0% } }
      #aviso-popup-overlay { animation: _avisoBgIn 0.28s ease both; }
      #aviso-popup-box     { animation: _avisoBoxIn 0.36s cubic-bezier(0.34,1.56,0.64,1) both; }
    `;
    document.head.appendChild(s);
  }

  // Overlay
  const overlay = document.createElement('div');
  overlay.id = 'aviso-popup-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box';

  // Caixa do popup
  const box = document.createElement('div');
  box.id = 'aviso-popup-box';
  box.style.cssText = `background:#1a1d2e;border-radius:20px;width:min(100%,480px);overflow:hidden;box-shadow:0 40px 100px rgba(0,0,0,0.7),0 0 0 1px rgba(255,255,255,0.06)`;

  // Barra de progresso (expira em 12s se não dispensado)
  const AUTO_DISMISS_MS = 12000;

  // Topo colorido
  box.innerHTML = `
    <div style="background:linear-gradient(135deg,${dark} 0%,${hex} 100%);padding:22px 24px 18px;position:relative">
      <div style="font-size:1.6rem;margin-bottom:6px">📢</div>
      <div style="font-size:1.12rem;font-weight:800;color:#fff;line-height:1.3;padding-right:36px">${aviso.titulo || 'Aviso da Coordenação'}</div>
      <button id="aviso-dismiss-btn"
        style="position:absolute;top:14px;right:14px;background:rgba(255,255,255,0.22);border:none;border-radius:50%;width:32px;height:32px;color:#fff;font-size:1.25rem;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1;transition:background 0.15s"
        onmouseover="this.style.background='rgba(255,255,255,0.38)'" onmouseout="this.style.background='rgba(255,255,255,0.22)'">&times;</button>
    </div>
    <div style="padding:20px 24px 16px;font-size:0.94rem;color:#cbd5e1;line-height:1.7;white-space:pre-wrap;max-height:260px;overflow-y:auto">${_escapeHtml(aviso.mensagem || '')}</div>
    <div style="padding:0 24px 20px;display:flex;align-items:center;justify-content:space-between;gap:12px">
      <div style="font-size:0.72rem;color:#64748b">Fechará automaticamente em alguns segundos</div>
      <button id="aviso-ok-btn" style="padding:10px 28px;border-radius:10px;border:none;background:linear-gradient(135deg,${dark},${hex});color:#fff;font-weight:700;font-size:0.9rem;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,0.3);transition:opacity 0.15s" onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">Entendi ✓</button>
    </div>
    <div style="height:3px;background:rgba(255,255,255,0.08);overflow:hidden">
      <div id="aviso-progress-bar" style="height:100%;background:linear-gradient(90deg,${dark},${hex});width:100%;animation:_avisoBar ${AUTO_DISMISS_MS}ms linear forwards"></div>
    </div>
  `;

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  const dismiss = () => {
    localStorage.setItem(`aviso_seen_${aviso.id}`, '1');
    overlay.style.transition = 'opacity 0.22s';
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 230);
  };

  document.getElementById('aviso-dismiss-btn').addEventListener('click', dismiss);
  document.getElementById('aviso-ok-btn').addEventListener('click', dismiss);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(); });

  // Auto-dismiss
  const timer = setTimeout(dismiss, AUTO_DISMISS_MS);
  overlay.addEventListener('click', () => clearTimeout(timer), { once: true });
  document.getElementById('aviso-dismiss-btn').addEventListener('click', () => clearTimeout(timer), { once: true });
  document.getElementById('aviso-ok-btn').addEventListener('click', () => clearTimeout(timer), { once: true });
}

function _escapeHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
