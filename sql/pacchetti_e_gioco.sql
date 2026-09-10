-- ============================================================
-- Pacchetti e gioco sulla prenotazione — fase 4.
-- Da eseguire nell'SQL Editor di Supabase.
--
-- Oggi il nome del pacchetto tiene insieme tre cose: la modalità (solo gioco, party, noleggio),
-- il gioco (Bubble, Dark) e la durata. Da qui i nove pacchetti che hai, e la certezza che
-- diventino quindici il giorno che l'Archery si potrà prenotare. Con il gioco su una colonna
-- sua, al pacchetto resta la sola modalità e l'elenco smette di moltiplicarsi.
--
-- Questa migrazione fa solo la parte invisibile: aggiunge la colonna che permette di togliere un
-- pacchetto dalle tendine senza cancellarlo. Cancellarlo non si può — 38 prenotazioni ci puntano
-- per id, e perderebbero il riferimento.
--
-- LA RIORGANIZZAZIONE DEI PACCHETTI NON È QUI: sta in fondo, commentata, e va eseguita
-- soltanto quando il codice nuovo è online. Prima di allora la versione in produzione non
-- conosce "attivo", mostrerebbe vecchi e nuovi insieme e l'elenco raddoppierebbe sotto gli
-- occhi di chi sta lavorando.
-- ============================================================

-- ------------------------------------------------------------
-- 1) LA PARTE DA ESEGUIRE ORA. Invisibile: tutti i pacchetti nascono attivi, e il codice in
--    produzione non legge la colonna.
-- ------------------------------------------------------------
begin;
set local lock_timeout = '3s';

alter table pren_pacchetti add column if not exists attivo boolean not null default true;

commit;

-- Controllo: tutti attivi, nessuno perso.
select count(*) as pacchetti, count(*) filter (where attivo) as attivi from pren_pacchetti;


-- ============================================================
-- 2) LA RIORGANIZZAZIONE DEI PACCHETTI NON È PIÙ QUI.
--
-- Si è spostata in sql/pacchetti_sei.sql, da eseguire dopo che il codice nuovo è online. Tenerla
-- commentata in fondo a un file già eseguito voleva dire due versioni della stessa verità, e la
-- probabilità di aggiornarne una sola.
-- ============================================================
