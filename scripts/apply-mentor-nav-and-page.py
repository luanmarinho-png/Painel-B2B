#!/usr/bin/env python3
"""
Garante mentor.html em cada pasta de IES (cockpit multipágina).

O Mentor não aparece mais no menu dos coordenadores — desenvolvimento no admin (superadmin).
Este script só cria mentor.html se faltar (URL usada pelo iframe «Mentor (piloto)» em admin.html).

Uso: python3 scripts/apply-mentor-nav-and-page.py
"""
import os
import re

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SKIP_DIRS = frozenset(
    {
        ".git",
        "node_modules",
        ".netlify",
        "panel-core",
        "netlify",
        "assets",
        ".claude",
    }
)


def extract_logo_and_brand(index_html: str):
    m = re.search(
        r'<img class="home-institution-logo"[^>]+src="([^"]+)"',
        index_html,
    )
    logo = m.group(1) if m else "logo.png"
    m2 = re.search(
        r'<div class="brand-title"[^>]*data-institution-brand[^>]*>([^<]+)</div>',
        index_html,
    )
    brand = m2.group(1).strip() if m2 else "IES × MedCof"
    return logo, brand


def build_mentor_page(logo: str, brand: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <title>Painel Institucional — Mentor</title>
  <script src="/session-fix.js?v=2"></script>
  <link rel="stylesheet" href="shared.css?v=2">
  <style>
    .btn-logout {{
      display: flex; align-items: center; gap: 6px;
      padding: 7px 14px; border-radius: 8px;
      background: transparent; border: 1px solid #ccc;
      color: #555; font-size: 0.8rem; font-weight: 600;
      cursor: pointer; transition: all 0.2s; font-family: inherit;
      white-space: nowrap;
    }}
    .btn-logout:hover {{ background: rgba(220,38,38,0.08); border-color: rgba(220,38,38,0.5); color: #dc2626; }}
    .btn-logout svg {{ flex-shrink: 0; }}
  </style>
</head>
<body data-page="mentor">
  <header class="topbar">
    <div class="topbar-inner">
      <div class="brand brand--home-cockpit">
        <div class="topbar-logo-pair">
          <div id="institutionLogoSlot" class="topbar-logo-ies">
            <img class="home-institution-logo" src="{logo}" alt="Instituição">
          </div>
          <span class="topbar-logo-connector" aria-hidden="true">×</span>
          <img class="topbar-logo-medcof" src="logo-novo-medcof.avif" alt="Logo do Grupo MedCof">
        </div>
        <div class="brand-copy">
          <div class="brand-title" data-institution-brand>{brand}</div>
          <div class="brand-subtitle">Mentor — planejamento do simulado</div>
        </div>
      </div>
      <nav class="main-nav" aria-label="Navegação principal">
        <a class="nav-link" href="index.html">Inicial</a>
        <a class="nav-link" href="engajamento.html">Engajamento</a>
        <a class="nav-link" href="periodo-detalhado.html">Período detalhado</a>
        <a class="nav-link" href="simulado-personalizado.html">Simulados</a>
      </nav>
      <button class="btn-logout" id="btnLogout" onclick="handleLogout()" title="Sair da conta">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        Sair
      </button>
    </div>
  </header>

  <main class="page-shell home-cockpit-main">
    <div id="mentorRoot"></div>
  </main>

  <footer class="site-footer">
    Painel institucional <strong data-institution-brand>{brand}</strong>
  </footer>

  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script src="dashboard-data.js"></script>
  <script src="shared.js?v=2"></script>
  <script src="/brand-loader.js?v=2"></script>
</body>
</html>
"""


def main():
    created = 0
    skipped = 0

    for name in sorted(os.listdir(BASE)):
        path = os.path.join(BASE, name)
        if not os.path.isdir(path) or name in SKIP_DIRS:
            continue
        idx = os.path.join(path, "index.html")
        sim = os.path.join(path, "simulado-personalizado.html")
        sh = os.path.join(path, "shared.js")
        if not (os.path.isfile(idx) and os.path.isfile(sim) and os.path.isfile(sh)):
            continue

        with open(idx, "r", encoding="utf-8") as f:
            index_html = f.read()
        logo, brand = extract_logo_and_brand(index_html)

        mentor_path = os.path.join(path, "mentor.html")
        if not os.path.isfile(mentor_path):
            with open(mentor_path, "w", encoding="utf-8") as f:
                f.write(build_mentor_page(logo, brand))
            created += 1
        else:
            skipped += 1

    print(
        f"OK — mentor.html criados: {created}, pastas com mentor.html já existente: {skipped}"
    )


if __name__ == "__main__":
    main()
