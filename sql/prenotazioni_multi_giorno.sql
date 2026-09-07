-- ============================================================
-- Prenotazioni: eventi su più giorni e senza orario
-- Schema da eseguire nell'SQL Editor di Supabase.
-- ============================================================

-- Giorni coperti dall'evento, come array JSON di date ISO ordinate: ["2026-09-05","2026-09-12"].
-- Non è un intervallo perché i giorni possono essere staccati fra loro (es. due sabati di fila),
-- quindi una data di fine non basterebbe a descriverli.
-- Resta nulla sulle prenotazioni di un giorno solo, che continuano a essere descritte dalla sola
-- "data": l'app legge l'elenco con giorniEventoDi() (src/lib/utils.js), che in quel caso ricade su
-- "data". Anche quando l'elenco c'è, "data" resta il primo giorno, così ordinamenti e ricerche
-- esistenti continuano a funzionare senza modifiche.
alter table prenotazioni add column if not exists "giorni" jsonb;

-- Prenotazione senza orario: copre l'intera giornata (o tutte le giornate dell'elenco). Quando è
-- vero, "oraInizio" e "oraFine" restano nulle e la durata non si calcola.
alter table prenotazioni add column if not exists "senzaOrario" boolean not null default false;
