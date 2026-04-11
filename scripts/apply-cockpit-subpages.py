#!/usr/bin/env python3
"""
Aplica o mesmo topbar (logos IES × MedCof), fundo e bloco intro da home cockpit
em engajamento.html, periodo-detalhado.html e simulado-personalizado.html.

Logo e marca vêm do index.html de cada pasta. Pastas sem index.html ou com nav
diferente da multipágina (ex.: raiz com href='/') são ignoradas.

Uso: python3 scripts/apply-cockpit-subpages.py
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

ENG_INTRO = """    <section class="home-cockpit-intro">
      <div class="section-kicker">Engajamento</div>
      <h1>Engajamento dos alunos na plataforma</h1>
      <p class="home-cockpit-lead">Esta página concentra exclusivamente a leitura de uso da plataforma. O objetivo é mostrar ritmo de estudo, constância e intensidade de participação, destacando quem puxa o grupo, quem está estável e onde a coordenação pode agir para fortalecer aderência.</p>
      <div class="cockpit-intro-chips">
        <span class="cockpit-chip">Base oficial de engajamento preservada</span>
        <span class="cockpit-chip">Leitura focada em participação e rotina</span>
        <span class="cockpit-chip">Sem mistura com os tempos da planilha nova</span>
      </div>
    </section>
"""

PERIOD_INTRO = """    <section class="home-cockpit-intro">
      <div class="section-kicker">Período detalhado</div>
      <h1>Período detalhado dos alunos</h1>
      <p class="home-cockpit-lead">Esta página foi organizada para aprofundar a leitura por recorte temporal, facilitando comparação, distribuição e compreensão do comportamento dos alunos dentro de cada período avaliado. O foco aqui é análise operacional detalhada, sem perder clareza visual.</p>
      <div class="cockpit-intro-chips">
        <span class="cockpit-chip">Comparação entre recortes do ciclo</span>
        <span class="cockpit-chip">Filtros rápidos por aluno e engajamento</span>
        <span class="cockpit-chip">Leitura clara para acompanhamento fino</span>
      </div>
    </section>
"""

SIM_INTRO = """    <section class="home-cockpit-intro">
      <div class="section-kicker">Simulados</div>
      <h1>Análise de simulados</h1>
      <p class="home-cockpit-lead">Visualize resultados, evolução temporal e diagnósticos por área, tema e aluno.</p>
    </section>
"""

HERO_BLOCK = re.compile(
    r"<section class=\"hero-card hero-strong\">.*?</section>\s*\n",
    re.DOTALL,
)

OLD_BRAND = re.compile(
    r"[ \t]*<div class=\"brand\">\s*"
    r"<div class=\"brand-mark\"[^>]*>.*?</div>\s*"
    r"<div class=\"brand-copy\">\s*"
    r"<div class=\"brand-title\"[^>]*data-institution-brand[^>]*>.*?</div>\s*"
    r"<div class=\"brand-subtitle\">.*?</div>\s*"
    r"</div>\s*</div>",
    re.DOTALL,
)


def extract_logo_and_alt(html: str):
    m = re.search(
        r'<img class="home-institution-logo"[^>]+src="([^"]+)"[^>]*(?:alt="([^"]*)")?',
        html,
        re.DOTALL,
    )
    if m:
        return m.group(1), (m.group(2) or "").strip() or "Instituição"
    m = re.search(
        r'src="(logo_[^"]+\.(?:png|jpg|jpeg|webp|avif|svg))"[^>]*alt="([^"]*)"', html
    )
    if m:
        return m.group(1), m.group(2).strip() or "Instituição"
    return None, None


def extract_brand(html: str) -> str:
    m = re.search(
        r'<div class="brand-title"[^>]*data-institution-brand[^>]*>([^<]+)</div>',
        html,
    )
    if m:
        return m.group(1).strip()
    m = re.search(r'data-institution-brand[^>]*>([^<]+)<', html)
    if m:
        return m.group(1).strip()
    return "Instituição × MedCof"


def brand_block(logo_src: str, logo_alt: str, brand: str, subtitle: str) -> str:
    return (
        '      <div class="brand brand--home-cockpit">\n'
        '        <div class="topbar-logo-pair">\n'
        '          <div id="institutionLogoSlot" class="topbar-logo-ies">\n'
        f'            <img class="home-institution-logo" src="{logo_src}" alt="{logo_alt}">\n'
        "          </div>\n"
        '          <span class="topbar-logo-connector" aria-hidden="true">×</span>\n'
        '          <img class="topbar-logo-medcof" src="logo-novo-medcof.avif" alt="Logo do Grupo MedCof">\n'
        "        </div>\n"
        "        <div class=\"brand-copy\">\n"
        f'          <div class="brand-title" data-institution-brand>{brand}</div>\n'
        f"          <div class=\"brand-subtitle\">{subtitle}</div>\n"
        "        </div>\n"
        "      </div>"
    )


def should_process(html: str) -> bool:
    if "brand--home-cockpit" in html:
        return False
    if 'href="index.html"' not in html:
        return False
    if "brand-mark" not in html and "data-institution-initials" not in html:
        return False
    return True


def patch_engagement(html: str, logo_src: str, logo_alt: str, brand: str) -> str:
    sub = "Leitura institucional de uso da plataforma"
    html = OLD_BRAND.sub(brand_block(logo_src, logo_alt, brand, sub), html, count=1)
    html = html.replace('<main class="page-shell">', '<main class="page-shell home-cockpit-main">', 1)
    html = HERO_BLOCK.sub(ENG_INTRO + "\n", html, count=1)
    return html


def patch_period(html: str, logo_src: str, logo_alt: str, brand: str) -> str:
    sub = "Leitura comparativa por recorte temporal"
    html = OLD_BRAND.sub(brand_block(logo_src, logo_alt, brand, sub), html, count=1)
    html = html.replace('<main class="page-shell">', '<main class="page-shell home-cockpit-main">', 1)
    html = HERO_BLOCK.sub(PERIOD_INTRO + "\n", html, count=1)
    return html


def patch_simulados(html: str, logo_src: str, logo_alt: str, brand: str) -> str:
    sub = "Simulados — tendências e personalizados"
    html = OLD_BRAND.sub(brand_block(logo_src, logo_alt, brand, sub), html, count=1)
    html = html.replace(
        '<main class="page-shell">\n    <!-- Container principal',
        '<main class="page-shell home-cockpit-main">\n' + SIM_INTRO + "\n\n    <!-- Container principal",
        1,
    )
    if '<main class="page-shell home-cockpit-main">' not in html:
        html = html.replace('<main class="page-shell">', '<main class="page-shell home-cockpit-main">', 1)
        if "home-cockpit-intro" not in html:
            html = html.replace(
                '<div id="simuladosRoot"></div>',
                SIM_INTRO.strip() + "\n\n    " + '<div id="simuladosRoot"></div>',
                1,
            )
    return html


def main():
    updated = []
    for name in sorted(os.listdir(BASE)):
        path = os.path.join(BASE, name)
        if not os.path.isdir(path) or name in SKIP_DIRS:
            continue
        js_path = os.path.join(path, "shared.js")
        idx_path = os.path.join(path, "index.html")
        if not os.path.isfile(js_path) or not os.path.isfile(idx_path):
            continue

        with open(idx_path, "r", encoding="utf-8") as f:
            idx = f.read()
        logo_src, logo_alt = extract_logo_and_alt(idx)
        if not logo_src:
            continue
        brand = extract_brand(idx)

        for fname, patcher in (
            ("engajamento.html", patch_engagement),
            ("periodo-detalhado.html", patch_period),
            ("simulado-personalizado.html", patch_simulados),
        ):
            fp = os.path.join(path, fname)
            if not os.path.isfile(fp):
                continue
            with open(fp, "r", encoding="utf-8") as f:
                old = f.read()
            if not should_process(old):
                continue
            try:
                new = patcher(old, logo_src, logo_alt, brand)
            except Exception:
                continue
            if new != old:
                with open(fp, "w", encoding="utf-8") as f:
                    f.write(new)
                updated.append(f"{name}/{fname}")

    print(f"OK — {len(updated)} arquivos atualizados")
    for u in updated:
        print(f"  · {u}")


if __name__ == "__main__":
    main()
