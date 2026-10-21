-- ============================================================
-- Spese: la regola dice anche a chi va la spesa.
-- Da eseguire nell'SQL Editor di Supabase, dopo sql/spese_classificazione.sql.
--
-- Una regola operativa (compensi bubbler, campo, fornitore) puo' indicare la sua controparte: la
-- regola "Karin" mette Karin Sergi su ogni bonifico che prende. Vuota, la controparte si cerca nel
-- movimento per nome, come prima.
-- controparte_id e' testo senza foreign key, come spese.controparte_id: utenti.id per un bubbler,
-- pren_campi.id per un campo, sedi.id per un fornitore.
--
-- Additiva: le regole esistenti restano come sono.
-- ============================================================

begin;
set local lock_timeout = '3s';

alter table spese_regole add column if not exists controparte_id text;

commit;

-- Controllo: la colonna c'e' ed e' vuota.
select count(*) as regole, count(controparte_id) as con_controparte from spese_regole;
