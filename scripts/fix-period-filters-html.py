#!/usr/bin/env python3
"""Corrige fechamento do table-head após apply-period-filters-collapsible.py."""
import os
import re

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def repair(content: str) -> str:
    content = content.replace(
        "        </div>\n      <div class=\"period-filters-card\">",
        "        </div>\n      </div>\n\n      <div class=\"period-filters-card\">",
        1,
    )
    content = re.sub(
        r"(      </div>\n)\n\n(      </div>\n\n      <!-- Filtro por período acadêmico)",
        r"\1\n\2",
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
        if "period-filters-card" not in raw:
            continue
        out = repair(raw)
        if out != raw:
            open(path, "w", encoding="utf-8").write(out)
            n += 1
            print(f"OK — {name}/periodo-detalhado.html")
    root = os.path.join(BASE, "periodo-detalhado.html")
    if os.path.isfile(root):
        raw = open(root, encoding="utf-8").read()
        if "period-filters-card" in raw:
            out = repair(raw)
            if out != raw:
                open(root, "w", encoding="utf-8").write(out)
                n += 1
                print("OK — periodo-detalhado.html (raiz)")
    print(f"Total: {n}")


if __name__ == "__main__":
    main()
