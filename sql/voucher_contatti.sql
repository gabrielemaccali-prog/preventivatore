-- ============================================================
-- Telefono ed email di chi compra un voucher.
-- Da eseguire nell'SQL Editor di Supabase.
--
-- Il voucher sapeva a chi era intestato ma non come raggiungere chi l'aveva comprato: per
-- ricordargli la scadenza, mandargli il PDF o chiarire un pagamento bisognava cercare il contatto
-- altrove. Chi compra e chi usa il voucher spesso sono persone diverse -- e' un regalo -- quindi
-- il contatto va salvato qui, al momento dell'acquisto.
--
-- Additiva e nullable: i voucher che ci sono restano senza contatti.
-- ============================================================

begin;
set local lock_timeout = '3s';

alter table voucher add column if not exists telefono text;
alter table voucher add column if not exists email text;

commit;

select count(*) as voucher, count(telefono) as con_telefono, count(email) as con_email from voucher;
