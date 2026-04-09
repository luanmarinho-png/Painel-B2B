#!/usr/bin/env python3
"""
create-all-ies.py — Cria pastas e arquivos para TODAS as IES faltantes.
Usa uninassau-cacoal/ como template e substitui slug/nome/iniciais.
"""
import os, shutil, json, re

BASE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE_DIR = os.path.join(BASE, "uninassau-cacoal")

# ── Mapeamento completo: (slug, nome_display, iniciais) ──────────────
IES_TO_CREATE = [
    # Existem no Supabase WIP, falta pasta
    ("fpp",              "FACULDADES PEQUENO PRÍNCIPE", "FPP"),
    ("unochapeco",       "UNOCHAPECÓ",                 "UNO"),
    ("franco-montoro",   "FRANCO MONTORO",             "FM"),
    ("unifadra",         "UNIFADRA",                   "UFA"),
    ("umc",              "UMC",                        "UMC"),
    ("unipar",           "UNIPAR",                     "UP"),
    ("ceuma-imperatriz", "CEUMA IMPERATRIZ",           "CEU"),
    ("unifamaz",         "UNIFAMAZ",                   "UFA"),
    ("unipac",           "UNIPAC JUIZ DE FORA",        "UPC"),
    ("atitus",           "ATITUS",                     "ATI"),
    ("unimax",           "UNIMAX",                     "UMX"),
    ("uema",             "UEMA",                       "UEM"),
    ("faminas-bh",       "FAMINAS BH",                 "FBH"),
    # Novas — precisam de pasta + Supabase
    ("ceuma-df",         "CEUMA DF",                   "CEU"),
    ("fame-barbacena",   "FAME BARBACENA",             "FAM"),
    ("unit-aracaju",     "UNIT ARACAJU",               "UNT"),
    ("unit-estancia",    "UNIT ESTÂNCIA",              "UNT"),
    ("unit-goiana",      "UNIT GOIANA",                "UNT"),
    ("nilton-lins",      "NILTON LINS",                "NL"),
    ("santa-marcelina",  "SANTA MARCELINA",            "SM"),
    ("uniube",           "UNIUBE",                     "UBE"),
    ("fametro",          "FAMETRO",                    "FMT"),
    ("unicerrado",       "UNICERRADO",                 "UCR"),
    ("fempar-mackenzie", "FEMPAR MACKENZIE",           "FMK"),
    ("uniderp",          "UNIDERP",                    "UDP"),
    ("anhanguera",       "ANHANGUERA",                 "ANG"),
    ("unic",             "UNIC",                       "UNC"),
    ("unime",            "UNIME",                      "UNM"),
]

# Template replacement tokens
TPL_SLUG     = "uninassau-cacoal"
TPL_NAME     = "UNINASSAU CACOAL"
TPL_INITIALS = "UN"
TPL_BRAND    = "UNINASSAU CACOAL × MedCof"
TPL_LOGO     = "logo_uninassau-cacoal.png"

# Files to copy and transform (text-based)
TEXT_FILES = [
    "index.html",
    "engajamento.html",
    "periodo-detalhado.html",
    "resultado-tendencias.html",
    "simulado-personalizado.html",
]

# Files to copy as-is (binary/large)
COPY_FILES = [
    "shared.js",
    "shared.css",
    "logo-novo-medcof.avif",
]


def make_initials(name):
    """Gera iniciais a partir do nome (2-3 chars)."""
    words = name.split()
    if len(words) == 1:
        return name[:3].upper()
    return "".join(w[0] for w in words[:3]).upper()


def create_ies(slug, name, initials):
    """Cria a pasta e todos os arquivos para uma IES."""
    dest = os.path.join(BASE, slug)

    if os.path.exists(dest):
        print(f"  ⏭  {slug}/ já existe — pulando")
        return False

    os.makedirs(dest, exist_ok=True)
    brand = f"{name} × MedCof"
    logo  = f"logo_{slug}.png"

    # 1. Copiar e transformar HTMLs
    for fname in TEXT_FILES:
        src_path = os.path.join(TEMPLATE_DIR, fname)
        if not os.path.exists(src_path):
            print(f"  ⚠  Template {fname} não encontrado")
            continue
        with open(src_path, "r", encoding="utf-8") as f:
            content = f.read()

        # Substituições (ordem importa: brand antes de name para evitar match parcial)
        content = content.replace(TPL_BRAND, brand)
        content = content.replace(TPL_LOGO, logo)
        content = content.replace(TPL_NAME, name)
        content = content.replace(TPL_SLUG, slug)
        # Substituir iniciais no data-institution-initials
        content = content.replace(
            f'data-institution-initials>{TPL_INITIALS}<',
            f'data-institution-initials>{initials}<'
        )

        with open(os.path.join(dest, fname), "w", encoding="utf-8") as f:
            f.write(content)

    # 2. Copiar arquivos binários/grandes
    for fname in COPY_FILES:
        src_path = os.path.join(TEMPLATE_DIR, fname)
        if os.path.exists(src_path):
            shutil.copy2(src_path, os.path.join(dest, fname))

    # 3. Gerar config.json
    config = {
        "slug": slug,
        "name": name,
        "city": "",
        "brand": brand,
        "initials": initials,
        "password": f"{name}2026",
        "logo": logo,
        "themeClass": "theme-neutro",
        "tema": "neutro"
    }
    with open(os.path.join(dest, "config.json"), "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)

    # 4. Gerar dashboard-data.js vazio
    var_name = slug.upper().replace("-", "_") + "_ALL_DATA"
    res_name = slug.upper().replace("-", "_") + "_RESULTS_DATA"
    ds_key = slug
    dash_content = f"""/* === {name} — dashboard-data.js === */
/* Gerado automaticamente — dados serão preenchidos na atualização */

const {var_name} = [];
const {res_name} = [];

window.INSTITUTION_DATASETS = window.INSTITUTION_DATASETS || {{}};
window.INSTITUTION_DATASETS['{ds_key}'] = {{
  institutionName: '{name}',
  slug: '{ds_key}',
  allData: {var_name},
  resultsData: {res_name},
}};
"""
    with open(os.path.join(dest, "dashboard-data.js"), "w", encoding="utf-8") as f:
        f.write(dash_content)

    # 5. Gerar logo placeholder (1x1 pixel PNG transparente)
    # PNG mínimo: 67 bytes
    import base64
    pixel_png = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="
    )
    with open(os.path.join(dest, logo), "wb") as f:
        f.write(pixel_png)

    print(f"  ✅ {slug}/ — {len(TEXT_FILES)} HTMLs + config + data + shared + logos")
    return True


if __name__ == "__main__":
    print(f"🏗️  Criando {len(IES_TO_CREATE)} pastas de IES...\n")

    created = 0
    skipped = 0
    for slug, name, initials in IES_TO_CREATE:
        if create_ies(slug, name, initials):
            created += 1
        else:
            skipped += 1

    print(f"\n📦 Concluído: {created} criadas, {skipped} já existiam")
    print(f"   Total de arquivos: ~{created * 11} novos")
