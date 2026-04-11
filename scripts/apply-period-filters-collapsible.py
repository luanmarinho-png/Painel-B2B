#!/usr/bin/env python3
"""
Move filtros da seção 'Recorte selecionado' para card colapsável na seção da tabela detalhada.
Uso: python3 scripts/apply-period-filters-collapsible.py
"""
import os
import re

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

COLLAPSE_HEAD = """      <div class="period-filters-card">
        <button type="button" class="period-filters-toggle" id="periodFiltersToggle" aria-expanded="false" aria-controls="periodFiltersPanel">
          <span class="period-filters-toggle-left">
            <svg class="period-filters-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
            </svg>
            <span class="period-filters-toggle-label">Filtros</span>
          </span>
          <svg class="period-filters-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
        <div class="period-filters-panel" id="periodFiltersPanel" hidden>
          <div class="filters filters--in-card">
"""

COLLAPSE_TAIL = """          </div>
        </div>
      </div>

"""


def _indent_inner(s: str) -> str:
    lines = s.split("\n")
    return "\n".join(("  " + line) if line.strip() else line for line in lines)


def transform(content: str):
    m = re.search(
        r"\n      <div class=\"filters\">\n([\s\S]*?)\n      </div>\n    </section>\n\n    <section class=\"section-shell\">\n      <div class=\"table-head\">",
        content,
    )
    if not m:
        return None
    inner = _indent_inner(m.group(1))
    content = re.sub(
        r"\n      <div class=\"filters\">\n[\s\S]*?\n      </div>\n    </section>\n\n    <section class=\"section-shell\">\n      <div class=\"table-head\">",
        "\n    </section>\n\n    <section class=\"section-shell\">\n      <div class=\"table-head\">",
        content,
        count=1,
    )
    block = COLLAPSE_HEAD + inner + "\n" + COLLAPSE_TAIL
    content = re.sub(
        r"(\n      </div>\n\n      <!-- Filtro por período acadêmico[^\n]*\n      <div id=\"periodTurmaFilterBar\" style=\"display:none\"></div>)",
        "\n" + block + r"\1",
        content,
        count=1,
    )
    return content


def main():
    n = 0
    for name in sorted(os.listdir(BASE)):
        path = os.path.join(BASE, name, "periodo-detalhado.html")
        if not os.path.isfile(path):
            continue
        raw = open(path, encoding="utf-8").read()
        if "periodFiltersToggle" in raw:
            continue
        out = transform(raw)
        if out is None:
            print(f"SKIP (pattern): {name}/periodo-detalhado.html")
            continue
        open(path, "w", encoding="utf-8").write(out)
        n += 1
        print(f"OK — {name}/periodo-detalhado.html")
    root = os.path.join(BASE, "periodo-detalhado.html")
    if os.path.isfile(root):
        raw = open(root, encoding="utf-8").read()
        if "periodFiltersToggle" not in raw:
            out = transform(raw)
            if out:
                open(root, "w", encoding="utf-8").write(out)
                n += 1
                print("OK — periodo-detalhado.html (raiz)")
    print(f"Total: {n} arquivo(s)")


if __name__ == "__main__":
    main()
