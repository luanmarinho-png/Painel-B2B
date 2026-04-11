-- Supabase / PostgreSQL apenas.
-- Com DATA_BACKEND=mongo você NÃO precisa deste script: a coleção `notificacoes_admin`
-- aceita o campo `modo_coord` nos documentos sem migration (primeiro POST cria o doc).
--
-- Exibe avisos aos coordenadores como pop-up ou só na central (ícone sino).
-- Aplique no Supabase SQL Editor se a coluna ainda não existir.

alter table public.notificacoes_admin
  add column if not exists modo_coord text default 'central';

comment on column public.notificacoes_admin.modo_coord is
  'central = só ícone sino; popup = também modal ao abrir o painel';
