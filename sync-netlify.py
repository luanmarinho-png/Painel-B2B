#!/usr/bin/env python3
"""
sync-netlify.py — Sincroniza o deploy atual do Netlify para a pasta local.

EXECUTE SEMPRE ANTES de qualquer deploy via CLI ou modificação via Claude.
Isso garante que arquivos enviados via painel (deploy-ies) não sejam perdidos.

Uso:
  python3 sync-netlify.py          # só sincroniza
  python3 sync-netlify.py --deploy # sincroniza e faz deploy em seguida
"""
import json, urllib.request, urllib.parse, urllib.error, os, sys, base64, ssl

# Ignora verificação de certificado SSL (problema comum no macOS com Python 3.13)
_SSL_CTX = ssl._create_unverified_context()

SITE_ID = os.environ.get("NETLIFY_SITE_ID") or "9a61aead-5bfa-4efb-a3f8-fe3431c2c684"
API     = "https://api.netlify.com/api/v1"
BASE    = os.path.dirname(os.path.abspath(__file__))

def _load_dotenv():
    path = os.path.join(BASE, ".env")
    if not os.path.isfile(path):
        return
    with open(path, encoding="utf-8-sig") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if not key:
                continue
            prev = (os.environ.get(key) or "").strip()
            if not prev:
                os.environ[key] = val

def _netlify_auth_header():
    t = os.environ.get("NETLIFY_AUTH_TOKEN") or os.environ.get("NETLIFY_TOKEN")
    if not t or not str(t).strip():
        print("ERRO: defina NETLIFY_AUTH_TOKEN (https://app.netlify.com/user/applications#personal-access-tokens)")
        print("      ou adicione NETLIFY_AUTH_TOKEN no .env")
        sys.exit(1)
    return f"Bearer {str(t).strip()}"

# Arquivos/pastas que NUNCA devem ser baixados (gerados localmente)
IGNORE_PREFIXES = [
    "/netlify/",       # functions source
    "/node_modules/",  # deps
]
IGNORE_FILES = {
    "/netlify.toml",
}

def api_get(path):
    req = urllib.request.Request(f"{API}{path}",
          headers={"Authorization": _netlify_auth_header()})
    try:
        with urllib.request.urlopen(req, context=_SSL_CTX) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace") if e.fp else ""
        if e.code == 401:
            print("\n❌ 401 — token inválido ou revogado. Atualize NETLIFY_AUTH_TOKEN no .env")
            print("   https://app.netlify.com/user/applications#personal-access-tokens")
            print("   Se exportou um token errado no terminal: unset NETLIFY_AUTH_TOKEN")
        elif body:
            print("\nResposta:", body[:400])
        raise SystemExit(1) from e

def find_good_deploy():
    deploys = api_get(f"/sites/{SITE_ID}/deploys?per_page=20")
    for d in deploys:
        if d["state"] != "ready":
            continue
        files = api_get(f"/deploys/{d['id']}/files")
        if len(files) >= 100:
            return d["id"], files
    raise RuntimeError("Nenhum deploy válido encontrado (>= 100 arquivos).")

def should_ignore(path):
    if path in IGNORE_FILES:
        return True
    for prefix in IGNORE_PREFIXES:
        if path.startswith(prefix):
            return True
    return False

def is_template_dashboard(path):
    """Retorna True se o dashboard-data.js local for um template vazio."""
    if not path.endswith('/dashboard-data.js'):
        return False
    local_path = os.path.join(BASE, path.lstrip("/").replace("/", os.sep))
    try:
        with open(local_path, 'r', encoding='utf-8', errors='replace') as fh:
            content = fh.read()
        return '_ALL_DATA = []' in content and '_RESULTS_DATA = []' in content
    except Exception:
        return False

def sync():
    print("🔍 Buscando deploy atual no Netlify...")
    deploy_id, files = find_good_deploy()
    print(f"✅ Deploy base: {deploy_id} ({len(files)} arquivos)\n")

    # Mapear arquivos locais (relativo ao BASE_DIR)
    local_files = set()
    for root, dirs, fnames in os.walk(BASE):
        # Ignorar node_modules e .netlify
        dirs[:] = [d for d in dirs if d not in ('node_modules', '.netlify', '__pycache__')]
        for fname in fnames:
            full = os.path.join(root, fname)
            rel  = "/" + os.path.relpath(full, BASE).replace(os.sep, "/")
            local_files.add(rel)

    # dashboard-data.js com arrays vazios são templates — forçar download do Netlify
    for p in list(local_files):
        if is_template_dashboard(p):
            local_files.discard(p)
            print(f"  ♻ Template vazio detectado, buscando versão real: {p}")

    downloaded = 0
    skipped    = 0

    for f in files:
        path = f["id"]  # ex: /unit/index.html

        if should_ignore(path):
            skipped += 1
            continue

        local_path = os.path.join(BASE, path.lstrip("/").replace("/", os.sep))

        # Se o arquivo já existe localmente, não baixar (respeita edições locais)
        if path in local_files:
            skipped += 1
            continue

        # Baixar arquivo do Netlify via CDN
        cdn_url = f"https://{deploy_id}--b2bmedcof.netlify.app{path}"
        try:
            req = urllib.request.Request(cdn_url,
                  headers={"User-Agent": "sync-netlify/1.0"})
            with urllib.request.urlopen(req, timeout=15, context=_SSL_CTX) as r:
                content = r.read()

            os.makedirs(os.path.dirname(local_path), exist_ok=True)
            with open(local_path, "wb") as out:
                out.write(content)

            print(f"  ⬇ {path} ({len(content)} bytes)")
            downloaded += 1

        except Exception as e:
            print(f"  ⚠ Falha ao baixar {path}: {e}")

    print(f"\n📦 Sincronização concluída: {downloaded} baixados, {skipped} já existiam/ignorados")
    return downloaded

def collect_template_paths():
    """Retorna lista de paths relativos (ex: unipar/dashboard-data.js) que são templates."""
    templates = []
    for root, dirs, fnames in os.walk(BASE):
        dirs[:] = [d for d in dirs if d not in ('node_modules', '.netlify', '__pycache__')]
        for fname in fnames:
            if fname != 'dashboard-data.js':
                continue
            full = os.path.join(root, fname)
            rel  = "/" + os.path.relpath(full, BASE).replace(os.sep, "/")
            if is_template_dashboard(rel):
                # Formato relativo para .netlifyignore (sem barra inicial)
                templates.append(os.path.relpath(full, BASE).replace(os.sep, "/"))
    return templates

if __name__ == "__main__":
    _load_dotenv()
    n = sync()
    if "--deploy" in sys.argv:
        if n == 0:
            print("\nℹ️  Nada novo para sincronizar. Prosseguindo com deploy...")
        import subprocess, shutil

        # ── Proteger templates: criar .netlifyignore temporário ──────────
        # Templates de dashboard-data.js NÃO devem ser deployados — o Netlify
        # mantém a versão anterior (com dados reais) para esses arquivos.
        netlify_ignore_path = os.path.join(BASE, '.netlifyignore')
        ignore_existed = os.path.exists(netlify_ignore_path)
        template_paths = collect_template_paths()
        created_ignore = False

        if template_paths:
            print(f"\n🛡️  Protegendo {len(template_paths)} dashboard-data.js de IES sem dados do deploy:")
            for p in template_paths:
                print(f"     ↳ {p}")
            # Ler conteúdo existente (se houver) para não apagar
            existing_content = ""
            if ignore_existed:
                with open(netlify_ignore_path, 'r') as fh:
                    existing_content = fh.read()
            with open(netlify_ignore_path, 'w') as fh:
                if existing_content:
                    fh.write(existing_content.rstrip() + "\n")
                fh.write("\n".join(template_paths) + "\n")
            created_ignore = True
            print()

        npx = shutil.which("npx") or "/opt/homebrew/bin/npx"
        result = subprocess.run([
            npx, "netlify-cli@latest", "deploy", "--prod",
            f"--site={SITE_ID}",
            f"--dir={BASE}",
            f"--functions={os.path.join(BASE, 'netlify/functions')}",
        ], env={**os.environ, "PATH": f"/opt/homebrew/bin:{os.environ.get('PATH','')}"},
           cwd=BASE)

        # ── Remover as linhas de templates do .netlifyignore ─────────────
        if created_ignore:
            if ignore_existed and existing_content:
                # Restaurar conteúdo original (sem as linhas de templates)
                with open(netlify_ignore_path, 'w') as fh:
                    fh.write(existing_content)
            else:
                os.remove(netlify_ignore_path)

        sys.exit(result.returncode)
