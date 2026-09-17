-- ============================================================
-- Preventivi: note interne e annullamento.
-- Da eseguire nell'SQL Editor di Supabase.
--
-- Un preventivo non confermato oltre la validita' non e' "scaduto" e basta: e' un cliente che non
-- ha risposto, e qualcuno deve fare qualcosa. O lo sente -- e allora scrive nelle note interne che
-- l'ha chiamato, che gli ha mandato una email -- o annulla il preventivo, dicendo perche'.
--
--   "noteInterne"        il diario di chi segue il preventivo. Non va sul PDF.
--   "motivoAnnullamento" come per le prenotazioni: lo stato dice che non si fa, il motivo dice perche'.
--
-- Lo stato "Annullato" e' un valore nuovo della colonna stato: se su quella colonna c'e' un vincolo
-- sui valori ammessi va allargato (il controllo in fondo lo mostra).
--
-- Additiva e nullable: i preventivi che ci sono restano senza note e senza motivo, che e' corretto.
-- ============================================================

begin;
set local lock_timeout = '3s';

alter table preventivi add column if not exists "noteInterne" text;
alter table preventivi add column if not exists "motivoAnnullamento" text;

commit;

-- Controllo: le colonne ci sono e nessun preventivo e' stato toccato.
select count(*) as preventivi, count("noteInterne") as con_note, count("motivoAnnullamento") as con_motivo from preventivi;

-- Vincoli sulla tabella: se ne compare uno che elenca gli stati, deve ammettere anche 'Annullato'.
select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'preventivi'::regclass and contype = 'c';
