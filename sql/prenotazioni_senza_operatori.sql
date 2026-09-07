-- ============================================================
-- Prenotazioni: prenotazioni che non richiedono operatori
-- Schema da eseguire nell'SQL Editor di Supabase.
-- ============================================================

-- "Non servono operatori" è una scelta dichiarata, non l'assenza di dati: senza questa colonna una
-- prenotazione con l'elenco operatori vuoto resterebbe indistinguibile da una a cui gli operatori
-- non sono ancora stati assegnati. Quando è vero, la colonna jsonb "operatori" resta un array vuoto.
alter table prenotazioni add column if not exists "senzaOperatori" boolean not null default false;
