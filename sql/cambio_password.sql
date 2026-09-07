-- ============================================================
-- Cambio password imposto dall'amministratore.
-- Da eseguire nell'SQL Editor di Supabase.
--
-- Quando un amministratore crea un account, o rimette in piedi quello di chi la password l'ha
-- persa, la scrive lui: da quel momento la conosce in due. Il flag qui sotto chiude il giro —
-- al primo accesso l'utente non entra, sceglie una password nuova e solo allora prosegue.
--
-- Vale una volta sola: appena la password viene cambiata il flag torna falso da solo. Non è
-- quindi uno stato da gestire a mano, è una richiesta che si esaurisce quando viene esaudita.
-- ============================================================

-- Gli account che già esistono non vengono disturbati: partono tutti da "nessun cambio richiesto".
alter table utenti add column if not exists cambio_password boolean not null default false;

-- Controllo: la colonna deve esserci e nessuno deve risultare già da aggiornare.
select count(*) filter (where cambio_password) as da_aggiornare,
       count(*)                                as utenti_totali
  from utenti;
