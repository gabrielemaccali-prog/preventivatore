-- ============================================================
-- Il motivo per cui una partita e' stata annullata.
-- Da eseguire nell'SQL Editor di Supabase.
--
-- Lo stato dice che la partita non si fa, ma non dice perche'. E il perche' e' l'unica cosa che
-- serve davvero dopo: un cliente che disdice tre giorni prima e un campo che allaga sono la stessa
-- riga rossa in elenco, e sono due fatti diversi -- uno riguarda il cliente, l'altro il campo.
--
-- Senza scriverlo resta nella testa di chi ha cliccato, e fra due mesi non c'e' piu'.
--
-- Additiva e nullable: le prenotazioni che ci sono restano senza motivo, che e' corretto -- non
-- sono state annullate.
-- ============================================================

begin;
set local lock_timeout = '3s';

alter table prenotazioni add column if not exists "motivoAnnullamento" text;

commit;

-- Controllo: la colonna c'e' e nessuna prenotazione e' stata toccata.
select count(*) as prenotazioni, count("motivoAnnullamento") as con_motivo from prenotazioni;
