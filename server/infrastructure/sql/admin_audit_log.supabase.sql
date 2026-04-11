-- Executar no SQL Editor do Supabase quando DATA_BACKEND ≠ mongo (dados em Postgres).
-- Com DATA_BACKEND=mongo a auditoria vai para a coleção admin_audit_log no Atlas.

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid (),
  created_at timestamptz not null default now(),
  actor_user_id text,
  actor_email text,
  admin_role text,
  resource_table text not null,
  http_method text not null,
  query_preview text,
  status_code int,
  response_ok boolean,
  error_summary text,
  body_keys text[],
  client_ip text,
  user_agent text
);

create index if not exists admin_audit_log_created_at_idx on public.admin_audit_log (created_at desc);

alter table public.admin_audit_log enable row level security;

-- Sem políticas públicas: apenas service_role (admin-proxy) grava; leitura via API dedicada futura ou SQL.
