-- ============================================================
-- Via il centro di ricavo dai pacchetti.
-- Da eseguire nell'SQL Editor di Supabase, DOPO che il codice nuovo e' online.
--
-- DISTRUTTIVA: cancella una colonna e quello che contiene. Non e' urgente, ed e' l'ultimo passo.
--
-- Il centro di ricavo era sul pacchetto quando il pacchetto era anche il gioco: "Bubble Party
-- Basic" apparteneva al centro Bubble perche' dentro c'era il Bubble. Da quando il pacchetto dice
-- solo la modalita' -- Party Basic, Noleggio -- non ha piu' un centro suo: quello e' del gioco, e
-- sta a catalogo, dove Costi/Ricavi ormai lo legge.
--
-- Sui sei pacchetti di oggi la colonna e' gia' vuota, quindi non si perde niente. E il codice non
-- la scrive piu' ne' la legge: prima di eseguirla basta che sia online, altrimenti la versione
-- vecchia proverebbe a scrivere una colonna che non c'e' piu'.
-- ============================================================

-- Controllo prima: se qui esce qualcosa, quel valore sparisce.
select nome, "centroRicavo" from pren_pacchetti where "centroRicavo" is not null;

begin;
set local lock_timeout = '3s';

alter table pren_pacchetti drop column if exists "centroRicavo";

commit;

-- Controllo: le colonne rimaste.
select column_name from information_schema.columns where table_name = 'pren_pacchetti' order by ordinal_position;
