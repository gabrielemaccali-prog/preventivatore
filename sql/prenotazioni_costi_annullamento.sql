-- ============================================================
-- Le partite annullate che ci costano comunque.
-- Da eseguire nell'SQL Editor di Supabase.
--
-- Un'annullata senza incasso non ha prodotto ricavo, e di norma nemmeno costi: la si archivia e
-- basta. Ogni tanto pero' il campo chiede l'affitto lo stesso, il rinfresco era gia' pronto o gli
-- operatori erano gia' sul posto. Succede di rado, e allora lo si dice al momento dell'annullamento
-- invece di cercarlo dopo: si segna QUALI costi restano, non quanto -- gli importi sono quelli della
-- prenotazione e dei compensi, e la differenza con quanto pagato davvero si rettifica in consuntivazione.
--
--   costiAnnullamento  text[] con 'campo', 'rinfresco', 'operatori'; null = nessun costo
--
-- Con 'campo' o 'rinfresco' la partita entra in Consuntivazione > Campi, con 'operatori' nei
-- Compensi, e il cruscotto di Costi/Ricavi la conta.
--
-- Additiva e nullable: le annullate che ci sono restano senza costi, com'erano trattate.
-- ============================================================

begin;
set local lock_timeout = '3s';

alter table prenotazioni add column if not exists "costiAnnullamento" text[];

alter table prenotazioni drop constraint if exists prenotazioni_costi_annullamento_validi;
alter table prenotazioni add constraint prenotazioni_costi_annullamento_validi
  check ("costiAnnullamento" is null or "costiAnnullamento" <@ array['campo', 'rinfresco', 'operatori']::text[]);

commit;

-- Controllo: la colonna c'e' e nessuna prenotazione ha costi di annullamento.
select count(*) as prenotazioni, count("costiAnnullamento") as annullate_con_costi from prenotazioni;
