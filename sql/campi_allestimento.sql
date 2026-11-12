-- ============================================================
-- Tempo di allestimento dei campi.
-- Da eseguire nell'SQL Editor di Supabase.
--
-- Alcuni centri fanno pagare il tempo per montare e smontare: Bergamo un'ora, mezz'ora prima e
-- mezz'ora dopo. Si paga una volta per blocco di partite attaccate nello stesso campo e giorno, a
-- tariffa oraria; la prenotazione non cambia, cambia solo il costo del campo che le si attribuisce.
-- 0 = nessun allestimento, come finora.
--
-- Additiva: nessuna prenotazione viene toccata. Quelle già salvate si aggiornano col pulsante
-- "Ricalcola" del campo, che salta le partite già consuntivate.
-- ============================================================

alter table pren_campi add column if not exists "minutiAllestimento" integer not null default 0;

-- Controllo: la colonna c'è e nessun campo ha ancora un allestimento.
select count(*) as campi, count(*) filter (where "minutiAllestimento" > 0) as con_allestimento from pren_campi;
