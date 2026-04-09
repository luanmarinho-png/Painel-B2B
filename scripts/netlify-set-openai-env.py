#!/usr/bin/env python3
"""
Define OPENAI_API_KEY no Netlify com escopos Builds + Functions (serverless enxergam a chave).

Lê a chave do .env na raiz (OPENAI_API_KEY ou openai_api_key).
Usa o mesmo TOKEN e SITE_ID do deploy-safe.py (ou NETLIFY_AUTH_TOKEN / NETLIFY_SITE_ID).

Uso: python3 scripts/netlify-set-openai-env.py
Depois: novo deploy (python3 deploy-safe.py) para as functions pegarem o valor atualizado.
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = "https://api.netlify.com/api/v1"


def _read_deploy_safe_const(name):
    path = os.path.join(BASE_DIR, "deploy-safe.py")
    if not os.path.isfile(path):
        return None
    with open(path, encoding="utf-8") as f:
        text = f.read()
    m = re.search(rf"^{name}\s*=\s*\"([^\"]+)\"", text, re.MULTILINE)
    return m.group(1) if m else None


def load_openai_key():
    env_path = os.path.join(BASE_DIR, ".env")
    if not os.path.isfile(env_path):
        print("ERRO: crie um arquivo .env na raiz com OPENAI_API_KEY=sk-...")
        sys.exit(1)
    for raw in open(env_path, encoding="utf-8"):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        up = line.upper()
        if up.startswith("OPENAI_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
        if line.lower().startswith("openai_api_key="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    print("ERRO: .env sem OPENAI_API_KEY ou openai_api_key")
    sys.exit(1)


def api_json_error(tok, method, path, body=None):
    url = API + path
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        body_txt = e.read().decode() if e.fp else ""
        try:
            parsed = json.loads(body_txt) if body_txt else {}
        except json.JSONDecodeError:
            parsed = {"raw": body_txt[:500]}
        return e.code, parsed


def main():
    tok = os.environ.get("NETLIFY_AUTH_TOKEN") or _read_deploy_safe_const("TOKEN")
    site_id = os.environ.get("NETLIFY_SITE_ID") or _read_deploy_safe_const("SITE_ID")

    if not tok or not site_id:
        print("ERRO: defina NETLIFY_AUTH_TOKEN e NETLIFY_SITE_ID ou mantenha deploy-safe.py com TOKEN/SITE_ID.")
        sys.exit(1)

    openai_key = load_openai_key()
    if not openai_key.startswith("sk-"):
        print("ERRO: a chave no .env deve começar com sk-")
        sys.exit(1)

    print("🔍 Buscando account_id do site...")
    status, site = api_json_error(tok, "GET", f"/sites/{site_id}")
    if status != 200:
        print("ERRO ao ler site:", site)
        sys.exit(1)
    account_id = site.get("account_id")
    if not account_id:
        print("ERRO: resposta do site sem account_id")
        sys.exit(1)

    # Segredos não podem usar context "all" na API — repetir o valor por contexto.
    secret_contexts = (
        "production",
        "deploy-preview",
        "branch-deploy",
        "dev",
        "dev-server",
    )
    payload = [
        {
            "key": "OPENAI_API_KEY",
            "scopes": ["builds", "functions"],
            "values": [{"context": c, "value": openai_key} for c in secret_contexts],
            "is_secret": True,
        }
    ]

    path = f"/accounts/{account_id}/env?site_id={site_id}"
    status, result = api_json_error(tok, "POST", path, payload)

    if status == 201:
        print("✅ OPENAI_API_KEY criada no Netlify com escopos builds + functions.")
    else:
        print(f"Resposta HTTP {status}:")
        print(json.dumps(result, indent=2)[:4000])
        if status not in (200, 201):
            print(
                "\nSe a variável já existir, no painel Netlify edite OPENAI_API_KEY e marque escopo Functions,"
                " ou apague a variável e rode este script de novo."
            )
            sys.exit(1)

    print("➡️ Faça um deploy: python3 deploy-safe.py")
    print("➡️ Teste: GET /.netlify/functions/coordenador-chat → openaiKeyConfigured deve ser true.")


if __name__ == "__main__":
    main()
