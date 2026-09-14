-- ============================================================
-- Il nome di una location libera.
-- Da eseguire nell'SQL Editor di Supabase.
--
-- "Via Roma 12, Bergamo" dice dove andare, ma non cosa si trova: un oratorio, uno stadio, un
-- giardino privato. E' la cosa che l'operatore cerca con gli occhi quando arriva, e quella che
-- il cliente riconosce nella mail di conferma.
--
-- Sui campi nostri il nome c'e' gia' (sta sul campo). Questa colonna serve alle location libere.
--
-- Additiva e nullable: le prenotazioni che ci sono restano senza nome, e si leggono come prima.
-- ============================================================

begin;
set local lock_timeout = '3s';

alter table prenotazioni add column if not exists "locationNome" text;

commit;

select count(*) as prenotazioni, count("locationNome") as con_nome_location from prenotazioni;
