-- Configuração global (feature flags). Leitura pública via anon-data-proxy; escrita só admin-proxy (service role).
-- Aplicar no Supabase SQL Editor. Com MongoDB, criar coleção medcof_app_config com o mesmo formato de documento.

CREATE TABLE IF NOT EXISTS medcof_app_config (
  key text PRIMARY KEY,
  config_value jsonb NOT NULL DEFAULT 'false'::jsonb,
  updated_at timestamptz DEFAULT now()
);

INSERT INTO medcof_app_config (key, config_value)
VALUES ('mentor_coordenador_enabled', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE medcof_app_config ENABLE ROW LEVEL SECURITY;

-- Leitura anônima (painéis IES leem a flag via anon key / anon-data-proxy)
DROP POLICY IF EXISTS medcof_app_config_anon_select ON medcof_app_config;
CREATE POLICY medcof_app_config_anon_select ON medcof_app_config
  FOR SELECT TO anon
  USING (true);

-- Autenticados também podem ler (mesmo padrão de outras tabelas públicas)
DROP POLICY IF EXISTS medcof_app_config_authenticated_select ON medcof_app_config;
CREATE POLICY medcof_app_config_authenticated_select ON medcof_app_config
  FOR SELECT TO authenticated
  USING (true);

COMMENT ON TABLE medcof_app_config IS 'Flags globais MedCof (ex.: liberação do Mentor para coordenadores).';

-- MongoDB (DATA_BACKEND=mongo): coleção medcof_app_config
-- db.medcof_app_config.insertOne({ key: "mentor_coordenador_enabled", config_value: false })
