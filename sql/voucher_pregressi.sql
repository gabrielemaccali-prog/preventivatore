-- ============================================================
-- Voucher pregressi: i buoni venduti prima di questo applicativo.
-- Da eseguire nell'SQL Editor di Supabase.
--
-- Il cliente ha in mano un buono del vecchio sistema e lo vuole usare. Qui non esiste, quindi
-- sulla prenotazione non si puo' scegliere. L'admin lo registra quando capita, uno alla volta:
-- con il codice e la data scritti sul buono, e senza fatturazione ne' pagamenti, perche' quelli
-- sono gia' avvenuti nel vecchio sistema. Rifarli qui vorrebbe dire incassare due volte.
--
-- La colonna serve a tenerli distinti: un voucher pregresso resta "emesso" anche senza dati di
-- fatturazione, e non si stampa.
--
-- Additiva, con default false: i voucher che ci sono sono tutti nati qui, e restano come sono.
-- ============================================================

begin;
set local lock_timeout = '3s';

alter table voucher add column if not exists pregresso boolean not null default false;

commit;

-- Controllo: la colonna c'e' e nessun voucher e' diventato pregresso.
select count(*) as voucher, count(*) filter (where pregresso) as pregressi from voucher;
