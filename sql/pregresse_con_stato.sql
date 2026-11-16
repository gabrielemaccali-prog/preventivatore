-- ============================================================
-- Le pregresse con uno stato vero.
-- Da eseguire nell'SQL Editor di Supabase.
--
-- Finora "PREGRESSA" era lo stato stesso, e una partita della vecchia gestione non poteva essere
-- annullata. Ora l'essere pregressa è un segno a parte (prenotazioni.pregressa), e lo stato torna
-- quello di tutte: CONFERMATO, o ANNULLATA per quelle pagate e poi saltate.
-- Il segno tiene le pregresse fuori dal lavoro di tutti i giorni (Storico, Calendario, Gestione,
-- Compensi, Consuntivazione, Fatture), come prima.
--
-- Rieseguibile: la seconda volta non trova più niente da spostare.
-- ============================================================

begin;
set local lock_timeout = '3s';

alter table prenotazioni add column if not exists pregressa boolean not null default false;

update prenotazioni
   set pregressa = true,
       stato = 'CONFERMATO'
 where stato = 'PREGRESSA';

commit;

-- Controllo: tutte le pregresse hanno il segno, e nessuna ha più lo stato vecchio.
select
  count(*) filter (where pregressa) as pregresse,
  count(*) filter (where pregressa and stato = 'CONFERMATO') as confermate,
  count(*) filter (where stato = 'PREGRESSA') as stato_vecchio
from prenotazioni;
