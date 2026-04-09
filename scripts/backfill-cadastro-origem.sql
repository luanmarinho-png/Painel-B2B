-- ═══════════════════════════════════════════════════════════════════════════
-- Backfill: cadastro_origem = 'ies' | 'simulado' em alunos_master
-- ═══════════════════════════════════════════════════════════════════════════
-- Os "logs" de import não são gravados no banco; esta reatribuição usa apenas
-- o estado atual dos dados (nome vazio = típico de stub só-CPF do simulado).
--
-- Rode no Supabase → SQL Editor. Revise o SELECT de pré-checagem antes do UPDATE.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE alunos_master ADD COLUMN IF NOT EXISTS cadastro_origem text;

-- ── 1) Correção forte: quem tem nome preenchido → B2B (cadastro IES / legado) ──
UPDATE alunos_master
SET cadastro_origem = 'ies'
WHERE btrim(coalesce(nome, '')) <> '';

-- ── 2) Quem só tem CPF (sem nome) → origem simulado ──
UPDATE alunos_master
SET cadastro_origem = 'simulado'
WHERE btrim(coalesce(nome, '')) = '';

-- ── 3) (Opcional) Ainda NULL por algum motivo → tratar como B2B legado ──
UPDATE alunos_master
SET cadastro_origem = 'ies'
WHERE cadastro_origem IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- Opcional: marcar como simulado apenas CPFs que aparecem em resultados de
-- simulado (blocos __BATCH__*) e estão sem nome — útil se no passo 1 você
-- quiser excluir algum caso raro. Descomente e ajuste se usar.
-- ═══════════════════════════════════════════════════════════════════════════
/*
WITH sim_cpfs AS (
  SELECT DISTINCT
    lpad(regexp_replace(elem->>'cpf', '\D', '', 'g'), 11, '0') AS cpf_norm
  FROM simulado_respostas sr,
       jsonb_array_elements(coalesce(sr.respostas->'alunos', '[]'::jsonb)) AS elem
  WHERE sr.aluno_nome LIKE '__BATCH_%'
    AND length(regexp_replace(elem->>'cpf', '\D', '', 'g')) BETWEEN 5 AND 13
)
UPDATE alunos_master a
SET cadastro_origem = 'simulado'
FROM sim_cpfs s
WHERE lpad(regexp_replace(a.cpf, '\D', '', 'g'), 11, '0') = s.cpf_norm
  AND btrim(coalesce(a.nome, '')) = '';
*/

-- ═══════════════════════════════════════════════════════════════════════════
-- Pré-visualização (rode antes, sem UPDATE)
-- ═══════════════════════════════════════════════════════════════════════════
-- SELECT cadastro_origem, count(*) FROM alunos_master GROUP BY 1 ORDER BY 2 DESC;
-- SELECT id, cpf, nome, cadastro_origem, instituicao FROM alunos_master
--   WHERE btrim(coalesce(nome,'')) = '' LIMIT 50;
