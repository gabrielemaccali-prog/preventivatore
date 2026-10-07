-- ============================================================
-- Albatros: POS e contanti di una chiusura nascono vuoti, non a zero.
-- Da eseguire nell'SQL Editor di Supabase, dopo sql/albatros.sql.
--
-- La chiusura nasce alla prima cosa che si scrive per quel giorno, anche solo una riga della
-- composizione: con il default a zero il campo dei contanti mostrava "0" prima che qualcuno li
-- avesse contati. Vuoto vuol dire "non ancora scritto"; zero e' un valore vero, e resta tale.
--
-- Sulle giornate ancora aperte gli zeri si svuotano: quasi sempre sono il default, non una
-- conta. Le giornate chiuse non si toccano.
-- ============================================================

begin;
set local lock_timeout = '3s';

alter table albatros_chiusure alter column pos drop not null, alter column pos drop default;
alter table albatros_chiusure alter column contanti drop not null, alter column contanti drop default;

update albatros_chiusure set pos = null where chiusa_il is null and pos = 0;
update albatros_chiusure set contanti = null where chiusa_il is null and contanti = 0;

commit;

select data, pos, contanti, chiusa_il from albatros_chiusure order by data desc limit 10;
