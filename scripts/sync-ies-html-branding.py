#!/usr/bin/env python3
"""
Atualiza texto de marca nos HTML estáticos de cada pasta IES (index, engajamento,
periodo-detalhado, simulado-personalizado) a partir de config.json ou do cabeçalho
de dashboard-data.js. Corrige resíduos do template (FACENE / FN / logo_facene).

Onde rodar: na raiz do repositório (pasta que contém scripts/ e as pastas das IES), no terminal:

    cd "/caminho/para/deploy atual b2b"
    python3 scripts/sync-ies-html-branding.py

Não roda dentro do Netlify nem no browser — só no clone local do projeto.

Uso: python3 scripts/sync-ies-html-branding.py
"""
import json
import os
import re
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def initials_from_name(name):
    name = (name or "").strip()
    if not name:
        return "MC"
    parts = name.split()
    if len(parts) == 1:
        return parts[0][:2].upper()
    return (parts[0][0] + parts[1][0]).upper()


def parse_dashboard_name(folder):
    p = os.path.join(folder, "dashboard-data.js")
    if not os.path.isfile(p):
        return None
    with open(p, encoding="utf-8", errors="replace") as f:
        line = f.readline()
    m = re.search(r"/\*\s*===\s*(.+?)\s*—\s*dashboard-data", line)
    return m.group(1).strip() if m else None


def load_meta(slug, folder):
    cfg_path = os.path.join(folder, "config.json")
    if os.path.isfile(cfg_path):
        with open(cfg_path, encoding="utf-8") as f:
            cfg = json.load(f)
        name = cfg.get("name") or slug.upper()
        brand = cfg.get("brand") or f"{name} × MedCof"
        initials = cfg.get("initials") or initials_from_name(name)
        logo = cfg.get("logo") or f"logo_{slug}.png"
        return {"name": name, "brand": brand, "initials": initials, "logo": logo}
    name = parse_dashboard_name(folder) or slug.replace("-", " ").upper()
    return {
        "name": name,
        "brand": f"{name} × MedCof",
        "initials": initials_from_name(name),
        "logo": f"logo_{slug}.png",
    }


def main():
    n = 0
    for name in sorted(os.listdir(BASE)):
        folder = os.path.join(BASE, name)
        if not os.path.isdir(folder) or not os.path.isfile(os.path.join(folder, "shared.js")):
            continue
        meta = load_meta(name, folder)
        for hf in os.listdir(folder):
            if not hf.endswith(".html"):
                continue
            path = os.path.join(folder, hf)
            with open(path, encoding="utf-8", errors="replace") as f:
                text = f.read()
            orig = text
            text = text.replace("FACENE × MedCof", meta["brand"])
            text = text.replace("logo_facene.png", meta["logo"])
            text = text.replace("Logo da FACENE", f"Logo da {meta['name']}")
            text = re.sub(
                r'(<div class="brand-mark" data-institution-initials>)FN(</div>)',
                r"\g<1>" + meta["initials"] + r"\2",
                text,
            )
            if text != orig:
                with open(path, "w", encoding="utf-8") as f:
                    f.write(text)
                n += 1
                print(f"{name}/{hf}", file=sys.stderr)
    print(f"Arquivos HTML alterados: {n}", file=sys.stderr)


if __name__ == "__main__":
    main()
