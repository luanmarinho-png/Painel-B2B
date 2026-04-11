-- Telemetria do Mentor (plano premoldado). Escrita apenas via service role / Functions.
-- Aplicar no Supabase SQL Editor ou via migration.

CREATE TABLE IF NOT EXISTS mentor_planner_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ies_slug text NOT NULL,
  user_id text NOT NULL DEFAULT '',
  tipo text NOT NULL CHECK (tipo IN ('montar', 'export_xlsx')),
  plan_hash text NOT NULL DEFAULT '',
  contagem_slots int NOT NULL DEFAULT 0,
  areas_json jsonb DEFAULT '[]'::jsonb,
  temas_chave text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mentor_planner_ies_created
  ON mentor_planner_eventos (ies_slug, created_at DESC);

COMMENT ON TABLE mentor_planner_eventos IS 'Eventos do Mentor (montagem de plano / export) para analytics e anti-repetição.';

ALTER TABLE mentor_planner_eventos ENABLE ROW LEVEL SECURITY;
