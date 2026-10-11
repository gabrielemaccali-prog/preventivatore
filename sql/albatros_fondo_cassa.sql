-- ============================================================
-- Albatros: il fondo cassa.
-- Da eseguire nell'SQL Editor di Supabase.
--
-- In cassa resta un fondo da una sera all'altra, che e' di Albatros. Alla chiusura:
--   contanti        i contanti incassati, senza il fondo (come li contano i ragazzi)
--   fondo_partenza  il fondo con cui si e' partiti: proposto da quello lasciato all'ultima
--                   chiusura, confermato o corretto da chi chiude
--   fondo_lasciato  quanto si lascia in cassa per domani
--   ritirato_da     chi ritira il resto (contanti + fondo_partenza - fondo_lasciato): 'lama' o 'bfm'
-- Il fondo non entra nell'incassato: serve a sapere quanto resta in cassa e quanto si ritira.
--
-- Le giornate gia' chiuse restano con i campi vuoti, che valgono zero: i loro conti non cambiano.
-- ============================================================

begin;
set local lock_timeout = '3s';

alter table albatros_chiusure add column if not exists fondo_partenza numeric(10,2) check (fondo_partenza >= 0);
alter table albatros_chiusure add column if not exists fondo_lasciato numeric(10,2) check (fondo_lasciato >= 0);
alter table albatros_chiusure add column if not exists ritirato_da text;

commit;
