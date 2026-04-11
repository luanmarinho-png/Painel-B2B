#!/usr/bin/env python3
"""
Aplica o markup da home cockpit (fonte: cesmac/index.html) em todas as pastas
com shared.js, preservando logo e marca extraídos do index.html atual.
Uso: python3 scripts/apply-home-index.py
"""
import os
import re

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATE_PATH = os.path.join(BASE, "cesmac", "index.html")

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


def extract_logo_and_alt(html: str):
    m = re.search(
        r'<img class="home-institution-logo"[^>]+src="([^"]+)"[^>]*(?:alt="([^"]*)")?',
        html,
        re.DOTALL,
    )
    if m:
        return m.group(1), (m.group(2) or "").strip() or "Instituição"
    m = re.search(r'src="(logo_[^"]+\.(?:png|jpg|jpeg|webp|avif|svg))"[^>]*alt="([^"]*)"', html)
    if m:
        return m.group(1), m.group(2).strip()
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


def main():
    if not os.path.isfile(TEMPLATE_PATH):
        raise SystemExit(f"Missing template {TEMPLATE_PATH}")

    with open(TEMPLATE_PATH, "r", encoding="utf-8") as f:
        template = f.read()

    updated = []
    for name in sorted(os.listdir(BASE)):
        path = os.path.join(BASE, name)
        if not os.path.isdir(path) or name in SKIP_DIRS:
            continue
        idx_path = os.path.join(path, "index.html")
        js_path = os.path.join(path, "shared.js")
        if not os.path.isfile(idx_path) or not os.path.isfile(js_path):
            continue

        with open(idx_path, "r", encoding="utf-8") as f:
            old = f.read()

        logo_src, logo_alt = extract_logo_and_alt(old)
        if not logo_src:
            print(f"  skip (no logo): {name}")
            continue

        brand = extract_brand(old)

        out = template
        out = out.replace("CESMAC × MedCof", brand)
        out = out.replace("logo_cesmac.png", logo_src)
        out = out.replace('alt="Logo da CESMAC"', f'alt="{logo_alt}"')

        if out == old:
            continue

        with open(idx_path, "w", encoding="utf-8") as f:
            f.write(out)
        updated.append(f"{name}/index.html")

    print(f"OK — {len(updated)} arquivos atualizados a partir de cesmac/index.html")
    for u in updated:
        print(f"  · {u}")


if __name__ == "__main__":
    main()
