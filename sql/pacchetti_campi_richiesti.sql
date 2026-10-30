-- ============================================================
-- Pacchetti: quanti campi occupa un pacchetto nella stessa ora
-- Schema da eseguire nell'SQL Editor di Supabase.
-- ============================================================

-- Un pacchetto come "2 SET" fa giocare due giochi in parallelo: dura un'ora come gli altri, ma al
-- centro sportivo serve il doppio dello spazio, e quell'ora il centro la fattura doppia.
-- Il numero sta sul pacchetto perché è una sua caratteristica, non una scelta da rifare a ogni
-- prenotazione: chi vende "2 SET" sa che sono due campi.
-- Vale sull'affitto del campo: il rinfresco segue le persone, non i campi.
alter table pren_pacchetti add column if not exists campi_richiesti smallint not null default 1;

-- La prenotazione congela il numero del giorno in cui è stata venduta, come già fa con il nome del
-- pacchetto: cambiare il pacchetto domani non deve riscrivere il costo di una partita già fatta.
alter table prenotazioni add column if not exists "campiOccupati" integer not null default 1;

-- Controllo: i pacchetti che occupano più di un campo, e le prenotazioni che li usano.
-- select nome, giochi_richiesti, campi_richiesti from pren_pacchetti order by nome;
-- select id, data, "pacchettoNome", "campoNome", "campiOccupati" from prenotazioni where "campiOccupati" > 1 order by data desc;
