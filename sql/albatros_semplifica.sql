-- ============================================================
-- Albatros: via note, cliente e traccia delle modifiche.
-- Da eseguire nell'SQL Editor di Supabase, dopo sql/albatros_cassa_vuota.sql.
--
-- - albatros_chiusure.note: la chiusura non ha piu' note.
-- - albatros_righe.cliente: la composizione dell'incassato non dice piu' chi ha pagato.
-- - albatros_correzioni: le modifiche le fa solo l'amministratore, non serve tracciarle.
--
-- ATTENZIONE: cancella definitivamente note, clienti e storico delle riaperture gia' scritti.
-- ============================================================

begin;
set local lock_timeout = '3s';

alter table albatros_chiusure drop column if exists note;
alter table albatros_righe drop column if exists cliente;
drop table if exists albatros_correzioni;

commit;
