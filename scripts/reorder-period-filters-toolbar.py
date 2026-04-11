#!/usr/bin/env python3
"""
Envolve periodTurmaFilterBar + period-filters-card em .period-detail-toolbar,
com a barra de turma antes do botão Filtros (chips e Filtros na mesma linha).
Remove </div> extra que ficava entre os dois blocos.
"""
import os
import re

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def find_matching_close_div(html: str, start: int) -> int:
    """start = índice do '<' do <div ...> externo. Retorna índice após o </div> que fecha esse div."""
    pos = html.find(">", start) + 1
    depth = 1
    n = len(html)
    while pos < n:
        if html.startswith("</div>", pos):
            depth -= 1
            pos += 6
            if depth == 0:
                return pos
            continue
        if html.startswith("<div", pos):
            depth += 1
            pos = html.find(">", pos) + 1
            continue
        pos += 1
    return -1


def transform(content: str):
    if "period-detail-toolbar" in content:
        return content

    start_marker = '<div class="period-filters-card">'
    i = content.find(start_marker)
    if i == -1:
        return None
    line_start = content.rfind("\n", 0, i) + 1

    end_card = find_matching_close_div(content, i)
    if end_card < 0:
        return None

    turma_match = re.search(
        r"\s*<div id=\"periodTurmaFilterBar\"[^>]*>\s*</div>",
        content[end_card:],
    )
    if not turma_match:
        return None

    turma_block_start = end_card + turma_match.start()
    turma_block_end = end_card + turma_match.end()
    between = content[end_card:turma_block_start]
    comment_m = re.search(r"<!--[\s\S]*?-->", between)
    comment_line = (
        comment_m.group(0).strip()
        if comment_m
        else "<!-- Filtro por período acadêmico — injetado via JS para IES com turma -->"
    )
    turma_div = turma_match.group(0).strip()
    card_html = content[line_start:end_card]
    base_indent = content[line_start:i] if i > line_start else "      "
    wrapped = (
        f"{base_indent}<div class=\"period-detail-toolbar\">\n"
        f"{base_indent}{comment_line}\n"
        f"{base_indent}{turma_div}\n\n"
        f"{card_html}\n"
        f"{base_indent}</div>\n"
    )
    return content[:line_start] + wrapped + content[turma_block_end:]


def main():
    n = 0
    for name in sorted(os.listdir(BASE)):
        path = os.path.join(BASE, name, "periodo-detalhado.html")
        if not os.path.isfile(path):
            continue
        raw = open(path, encoding="utf-8").read()
        if "periodFiltersToggle" not in raw:
            continue
        out = transform(raw)
        if out is None:
            print(f"SKIP (sem match): {name}/periodo-detalhado.html")
            continue
        if out == raw:
            print(f"SKIP (igual): {name}/periodo-detalhado.html")
            continue
        open(path, "w", encoding="utf-8").write(out)
        n += 1
        print(f"OK — {name}/periodo-detalhado.html")

    root = os.path.join(BASE, "periodo-detalhado.html")
    if os.path.isfile(root):
        raw = open(root, encoding="utf-8").read()
        if "periodFiltersToggle" in raw:
            out = transform(raw)
            if out is not None and out != raw:
                open(root, "w", encoding="utf-8").write(out)
                n += 1
                print("OK — periodo-detalhado.html (raiz)")

    print(f"Total: {n}")


if __name__ == "__main__":
    main()
