-- ============================================================
-- Albatros: un'icona per le categorie del listino.
-- Da eseguire nell'SQL Editor di Supabase, dopo sql/albatros_categorie.sql.
--
-- Una piccola icona colorata aiuta a riconoscere campi, feste e bar nella griglia della giornata,
-- nel battuto e nel listino. Si sceglie dal Configuratore; le chiavi possibili sono quelle di
-- src/moduli/albatros/iconeCategoria.js. Null = nessuna icona scelta.
--
-- Alle tre categorie di partenza si assegna la loro, se non ne hanno gia' una.
-- ============================================================

begin;
set local lock_timeout = '3s';

alter table albatros_categorie add column if not exists icona text;

update albatros_categorie set icona = 'pallone' where tipo = 'listino' and icona is null and lower(btrim(nome)) = 'campi';
update albatros_categorie set icona = 'festa' where tipo = 'listino' and icona is null and lower(btrim(nome)) = 'feste';
update albatros_categorie set icona = 'bar' where tipo = 'listino' and icona is null and lower(btrim(nome)) = 'bar';

commit;

select nome, icona from albatros_categorie where tipo = 'listino' order by ordine;
