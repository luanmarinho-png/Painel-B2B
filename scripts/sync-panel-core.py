#!/usr/bin/env python3
"""
Copia panel-core/shared.js e panel-core/shared.css para a raiz e para todas as pastas
de IES que já possuem shared.js (exceto panel-core).

Fonte única: panel-core/ — não edite shared.js diretamente nas pastas das IES.

Uso: python3 scripts/sync-panel-core.py
"""
import os
import shutil

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PANEL = os.path.join(BASE, "panel-core")
SRC_JS = os.path.join(PANEL, "shared.js")
SRC_CSS = os.path.join(PANEL, "shared.css")

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


def main():
    if not os.path.isfile(SRC_JS) or not os.path.isfile(SRC_CSS):
        raise SystemExit(f"Missing {SRC_JS} or {SRC_CSS}")

    copied = []
    for name in sorted(os.listdir(BASE)):
        path = os.path.join(BASE, name)
        if not os.path.isdir(path) or name in SKIP_DIRS:
            continue
        js = os.path.join(path, "shared.js")
        css = os.path.join(path, "shared.css")
        if os.path.isfile(js):
            shutil.copy2(SRC_JS, js)
            copied.append(f"{name}/shared.js")
            if os.path.isfile(css):
                shutil.copy2(SRC_CSS, css)
                copied.append(f"{name}/shared.css")

    root_js = os.path.join(BASE, "shared.js")
    root_css = os.path.join(BASE, "shared.css")
    shutil.copy2(SRC_JS, root_js)
    shutil.copy2(SRC_CSS, root_css)
    copied.append("shared.js (raiz)")
    copied.append("shared.css (raiz)")

    print(f"OK — {len(copied)} arquivos atualizados a partir de panel-core/")
    for c in copied:
        print(f"  · {c}")


if __name__ == "__main__":
    main()
