-- ============================================================
-- Il voucher omaggio
-- Schema da eseguire nell'SQL Editor di Supabase.
--
-- Un voucher regalato da noi: ha il suo valore nominale, quello del pacchetto, perche' serve a
-- coprire una partita vera, ma nessuno lo paga e non si fattura. Non e' uno stato a parte -- nasce
-- Emesso e si spende come gli altri -- e' un segno, come "pregresso" e "daPosticipo".
--
-- Tre conseguenze, tutte nel codice: niente sezione pagamenti, niente dati di fatturazione da
-- chiedere (non c'e' un acquirente), e la partita su cui verra' speso non conta come ricavo --
-- un omaggio non e' mai entrato in cassa. I costi di quella partita restano e si vedono: e'
-- esattamente quello che l'omaggio e' costato.
--
-- Additiva: nasce falso su tutte le righe di prima, che infatti omaggi non erano.
-- ============================================================

begin;
set local lock_timeout = '3s';

alter table voucher add column if not exists omaggio boolean not null default false;

commit;

-- Controllo: i voucher regalati e quanto valgono.
-- select codice, "dataEmissione", nominativo, importo, stato from voucher where omaggio order by "dataEmissione" desc;
