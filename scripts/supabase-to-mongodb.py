#!/usr/bin/env python3
"""
Migração somente leitura: Supabase (PostgREST) → MongoDB Atlas.
Não altera nem apaga dados no Supabase.

Pré-requisitos:
  pip install -r scripts/requirements-migrate.txt

Uso (na raiz do projeto, com .env configurado):
  python3 scripts/supabase-to-mongodb.py
  python3 scripts/supabase-to-mongodb.py --table instituicoes
  python3 scripts/supabase-to-mongodb.py --dry-run

Variáveis .env:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MONGODB_URI, MONGODB_DATABASE (padrão: medcof_b2b)
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

try:
    from dotenv import load_dotenv
except ImportError:
    print("Instale dependências: pip install -r scripts/requirements-migrate.txt", file=sys.stderr)
    sys.exit(1)

load_dotenv(ROOT / ".env")

import requests
from pymongo import MongoClient
from pymongo.errors import BulkWriteError

# Mesma whitelist conceitual do admin-proxy (tabelas de dados do app)
DEFAULT_TABLES = (
    "alunos_master",
    "excluidos_master",
    "usuarios_autorizados",
    "simulado_respostas",
    "simulados_banco",
    "simulados_questoes",
    "simulados_envios",
    "instituicoes",
    "dashboard_engajamento",
    "atividades_contrato",
    "alunos_faltantes_simulado",
    "avisos",
)


def fetch_table_rows(
    supabase_url: str,
    service_key: str,
    table: str,
    page_size: int,
) -> list[dict]:
    """Lê todas as linhas via PostgREST (GET), paginado por limit/offset."""
    base = supabase_url.rstrip("/")
    url = f"{base}/rest/v1/{table}"
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Accept": "application/json",
        "Accept-Profile": "public",
        "Content-Profile": "public",
    }
    rows: list[dict] = []
    offset = 0
    while True:
        params = {"select": "*", "limit": str(page_size), "offset": str(offset)}
        r = requests.get(url, headers=headers, params=params, timeout=120)
        if not r.ok:
            raise RuntimeError(f"{table}: HTTP {r.status_code} — {r.text[:500]}")
        batch = r.json()
        if not isinstance(batch, list):
            raise RuntimeError(f"{table}: resposta inesperada (não é lista)")
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description="Copia tabelas Supabase → MongoDB (read-only no Supabase)")
    parser.add_argument(
        "--table",
        help="Migrar só uma tabela (nome exato no PostgREST)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Só busca no Supabase e imprime contagens; não grava no Mongo",
    )
    parser.add_argument(
        "--drop-collection",
        action="store_true",
        help="Antes de inserir, remove a coleção no Mongo (reimport limpo)",
    )
    parser.add_argument("--page-size", type=int, default=500, help="Linhas por requisição (default 500)")
    args = parser.parse_args()

    # URL pública do projeto; pode sobrescrever com SUPABASE_URL no .env
    supabase_url = os.environ.get(
        "SUPABASE_URL", "https://cvwwucxjrpsfoxarsipr.supabase.co"
    ).strip()
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    mongo_uri = os.environ.get("MONGODB_URI", "").strip()
    db_name = os.environ.get("MONGODB_DATABASE", "medcof_b2b").strip() or "medcof_b2b"

    if not supabase_url:
        print("Defina SUPABASE_URL no .env", file=sys.stderr)
        return 1
    if not service_key:
        print("Defina SUPABASE_SERVICE_ROLE_KEY no .env", file=sys.stderr)
        return 1
    if not args.dry_run and not mongo_uri:
        print("Defina MONGODB_URI no .env (ou use --dry-run)", file=sys.stderr)
        return 1

    tables = (args.table,) if args.table else DEFAULT_TABLES
    if args.table and args.table not in DEFAULT_TABLES:
        print(
            f"Aviso: '{args.table}' não está na lista padrão; prosseguindo mesmo assim.",
            file=sys.stderr,
        )

    client = None if args.dry_run else MongoClient(mongo_uri, serverSelectionTimeoutMS=15000)
    if client:
        client.admin.command("ping")
        db = client[db_name]

    migrated_at = datetime.now(timezone.utc).isoformat()
    summary: list[tuple[str, int, int]] = []

    for table in tables:
        print(f"→ Lendo Supabase: {table} …")
        try:
            rows = fetch_table_rows(supabase_url, service_key, table, args.page_size)
        except Exception as e:
            print(f"  ERRO: {e}", file=sys.stderr)
            return 1
        n = len(rows)
        print(f"   {n} linha(s)")

        if args.dry_run:
            summary.append((table, n, 0))
            continue

        assert client is not None
        coll = db[table]
        if args.drop_collection:
            coll.drop()
            print(f"   Coleção '{table}' removida (drop)")

        docs = []
        for row in rows:
            doc = dict(row)
            doc["_migrated_at"] = migrated_at
            doc["_source"] = "supabase"
            docs.append(doc)

        inserted = 0
        if docs:
            try:
                res = coll.insert_many(docs, ordered=False)
                inserted = len(res.inserted_ids)
            except BulkWriteError as bwe:
                print(f"  ERRO Mongo bulk: {bwe.details}", file=sys.stderr)
                return 1
        print(f"   MongoDB: inseridos {inserted} documento(s) em '{db_name}.{table}'")
        summary.append((table, n, inserted))

    if summary:
        print("\n--- Resumo ---")
        for t, supa_n, mongo_n in summary:
            print(f"  {t}: supabase={supa_n} mongo_inseridos={mongo_n}")
        if not args.dry_run:
            print(f"\nDatabase Mongo: '{db_name}'")
            print("Confira no Compass: atualize a lista de databases/collections.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
