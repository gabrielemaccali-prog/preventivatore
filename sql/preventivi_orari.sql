-- ============================================================
-- Preventivi: orario di servizio e telefono del referente
-- Schema da eseguire nell'SQL Editor di Supabase.
-- ============================================================

-- Fascia oraria giornaliera del noleggio, come la digita l'utente ("HH:MM").
-- Testo e non `time` per restare coerenti con il resto dell'app, che scambia gli orari
-- come stringhe (vedi prenotazioni."oraInizio"/"oraFine") e li mostra così come sono.
alter table preventivi add column if not exists "oraInizio" text;
alter table preventivi add column if not exists "oraFine" text;

-- Ore di servizio della giornata, cioè la durata della fascia "oraInizio"–"oraFine": resta la stessa
-- anche su noleggi di più giorni (2 giorni dalle 15 alle 18 fanno 3 ore, non 6).
-- È un valore derivato, salvato insieme a "giorni" perché fa parte di quanto proposto al cliente
-- e non deve cambiare se in futuro cambia il modo di calcolarlo.
alter table preventivi add column if not exists "oreNoleggio" numeric;

-- Recapito telefonico del referente, accanto a "nomeReferente"/"emailReferente".
alter table preventivi add column if not exists "telefonoReferente" text;
