#!/usr/bin/env python3
"""
Deploy seguro para Netlify — sempre faz merge correto com o último deploy COMPLETO.
Nunca usa deploys em estado 'uploading' ou com poucos arquivos como base.

Uso: python3 deploy-safe.py
"""
import json, urllib.request, hashlib, time, sys, os, zipfile, io, hashlib

TOKEN = "nfc_WMdi7KsBiBga5RhzHszLmtHBZhEex96G6828"
SITE_ID = "9a61aead-5bfa-4efb-a3f8-fe3431c2c684"
API = "https://api.netlify.com/api/v1"
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FN_DIR = os.path.join(BASE_DIR, "netlify", "functions")

MIN_FILES = 100  # Safety: minimum files for a "good" deploy

def api_get(path):
    req = urllib.request.Request(f"{API}{path}", headers={"Authorization": f"Bearer {TOKEN}"})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

def make_fn_zip(js_path):
    """Zip a single JS function file for Netlify upload."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(js_path, os.path.basename(js_path))
    return buf.getvalue()

def build_fn_data():
    """Compute SHA256 of each function zip (Netlify uses SHA256 for functions)."""
    shas = {}
    zips = {}
    for fn_file in sorted(os.listdir(FN_DIR)):
        if not fn_file.endswith(".js"):
            continue
        name = fn_file[:-3]
        full_path = os.path.join(FN_DIR, fn_file)
        zipped = make_fn_zip(full_path)
        sha = hashlib.sha256(zipped).hexdigest()
        shas[name] = sha
        zips[sha] = (name, zipped)
    return shas, zips

def find_good_deploy():
    """Find the most recent deploy that is ready AND has enough files."""
    deploys = api_get(f"/sites/{SITE_ID}/deploys?per_page=20")
    for d in deploys:
        if d["state"] != "ready":
            continue
        files = api_get(f"/deploys/{d['id']}/files")
        if len(files) >= MIN_FILES:
            return d["id"], {f["id"]: f["sha"] for f in files}
    raise RuntimeError(f"ABORTADO: Nenhum deploy encontrado com >={MIN_FILES} arquivos!")

def upload_function(deploy_id, name, zipped):
    """Upload a function bundle. Try runtime=js, fallback to no runtime."""
    url = f"{API}/deploys/{deploy_id}/functions/{name}?runtime=js"
    req = urllib.request.Request(url, data=zipped,
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/zip"},
        method="PUT")
    try:
        with urllib.request.urlopen(req) as r:
            return True
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"   ⚠️ Function {name} upload falhou (runtime=js): HTTP {e.code} — {body[:120]}")
        return False

def deploy(admin_path=None):
    print("🔍 Buscando último deploy completo...")
    deploy_id, files = find_good_deploy()
    print(f"✅ Base: {deploy_id} ({len(files)} arquivos)")

    # Build function zips + SHAs
    print("📦 Preparando functions...")
    fn_shas, fn_zips = build_fn_data()
    for name, sha in fn_shas.items():
        print(f"   {name}: {sha[:12]}...")

    # Update admin.html + any extra local files
    uploads = {}
    extra_files = [
        "favicon.svg",
        "brand-loader.js",
        "session-fix.js",
        "assets/coordenador-chat-fab.png",
        "assets/coordenador-chat-fab.svg",
        "assets/logo_univassouras.svg",
    ]
    if admin_path:
        with open(admin_path, "rb") as f:
            content = f.read()
        sha = hashlib.sha1(content).hexdigest()
        files["/admin.html"] = sha
        uploads[sha] = ("/admin.html", content)
        print(f"📝 admin.html: {len(content)} bytes (sha={sha[:12]}...)")
    for ef in extra_files:
        ef_path = os.path.join(BASE_DIR, ef)
        if os.path.exists(ef_path):
            with open(ef_path, "rb") as f:
                content = f.read()
            sha = hashlib.sha1(content).hexdigest()
            files["/"+ef] = sha
            uploads[sha] = ("/"+ef, content)
            print(f"📝 {ef}: {len(content)} bytes (sha={sha[:12]}...)")

    # Scan IES subfolders: only files that already exist in the Netlify deploy
    # IMPORTANT: dashboard-data.js is EXCLUDED — it is managed exclusively by the
    # deploy-ies Netlify function and must never be overwritten by local (stale) copies.
    import urllib.parse
    SKIP_DIRS = {"netlify", "__pycache__", ".git", "node_modules"}
    # Files managed exclusively by deploy-ies — never overwrite from local copies
    IES_SKIP_FILES = {"dashboard-data.js"}
    changed_ies = 0
    for root, dirs, fnames in os.walk(BASE_DIR):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        rel_root = os.path.relpath(root, BASE_DIR)
        if rel_root == ".":
            continue  # root-level files handled separately
        for fname in fnames:
            ext = os.path.splitext(fname)[1].lower()
            if ext not in (".js", ".html", ".css"):
                continue
            # Never overwrite IES-specific data files managed by deploy-ies
            if fname in IES_SKIP_FILES:
                continue
            # Only update files that already exist in the Netlify deploy
            netlify_path = "/" + rel_root.replace(os.sep, "/") + "/" + fname
            if netlify_path not in files:
                continue
            local_path = os.path.join(root, fname)
            with open(local_path, "rb") as f:
                content = f.read()
            sha = hashlib.sha1(content).hexdigest()
            if files.get(netlify_path) != sha:
                files[netlify_path] = sha
                url_path = urllib.parse.quote(netlify_path)
                uploads[sha] = (url_path, content)
                changed_ies += 1
    if changed_ies:
        print(f"📂 IES: {changed_ies} arquivo(s) alterado(s) detectado(s)")

    # Create deploy
    print(f"🚀 Criando deploy com {len(files)} arquivos + {len(fn_shas)} functions...")
    body = json.dumps({"files": files, "functions": fn_shas, "draft": False}).encode()
    req = urllib.request.Request(f"{API}/sites/{SITE_ID}/deploys", data=body,
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req) as r:
        result = json.loads(r.read())

    new_id = result["id"]
    required = result.get("required", [])
    req_fns = result.get("required_functions", [])
    print(f"📦 Deploy: {new_id}")
    print(f"   Upload necessário: {len(required)} arquivo(s), {len(req_fns)} function(s)")

    # Upload required files
    for sha in required:
        if sha in uploads:
            path, content = uploads[sha]
            print(f"   ⬆ Uploading {path}...")
            req = urllib.request.Request(f"{API}/deploys/{new_id}/files{path}", data=content,
                headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/octet-stream"}, method="PUT")
            with urllib.request.urlopen(req) as r:
                pass

    # Upload required functions
    for sha in req_fns:
        if sha in fn_zips:
            name, zipped = fn_zips[sha]
            print(f"   ⬆ Uploading function: {name}...")
            ok = upload_function(new_id, name, zipped)
            if ok:
                print(f"   ✅ {name} enviada")
        else:
            print(f"   ⚠️ Function SHA {sha[:12]} não encontrado localmente")

    # Wait for deploy to be ready (up to 90s)
    print("⏳ Aguardando deploy ficar pronto...")
    d = {}
    for i in range(30):
        time.sleep(3)
        req = urllib.request.Request(f"{API}/deploys/{new_id}", headers={"Authorization": f"Bearer {TOKEN}"})
        with urllib.request.urlopen(req) as r:
            d = json.loads(r.read())
        state = d["state"]
        if state in ("ready", "error"):
            break
        if i % 5 == 0:
            print(f"   [{i*3}s] Estado: {state}...")

    final_files = len(api_get(f"/deploys/{new_id}/files"))
    final_fns = len(d.get("available_functions", []))
    ok = d["state"] == "ready" and final_files >= MIN_FILES

    print(f"\n{'✅' if ok else '❌'} Estado: {d['state']} | {final_files} arquivos | {final_fns} functions")
    if ok:
        print(f"🌐 Deploy publicado com sucesso!")
    else:
        print("ERRO: Deploy pode estar incompleto!")
    return ok

if __name__ == "__main__":
    admin = os.path.join(BASE_DIR, "admin.html")
    if not os.path.exists(admin):
        print(f"admin.html não encontrado em {admin}")
        sys.exit(1)
    success = deploy(admin)
    sys.exit(0 if success else 1)
