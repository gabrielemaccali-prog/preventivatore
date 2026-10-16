-- ============================================================
-- Albatros: quali categorie di spesa si possono dettagliare.
-- Da eseguire nell'SQL Editor di Supabase.
--
-- Solo le spese di una categoria dettagliabile si aprono per scrivere le voci dello scontrino.
-- Si cambia dal Configuratore; si parte con la sola "Spesa bar".
-- ============================================================

begin;
set local lock_timeout = '3s';

alter table albatros_categorie add column if not exists dettagliabile boolean not null default false;

update albatros_categorie set dettagliabile = true where tipo = 'spesa' and lower(btrim(nome)) = 'spesa bar';

commit;

select nome, dettagliabile from albatros_categorie where tipo = 'spesa' order by ordine;
