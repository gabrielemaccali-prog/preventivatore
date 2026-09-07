-- ============================================================
-- Prenotazioni: clienti privati stranieri e codice SDI dei privati
-- Schema da eseguire nell'SQL Editor di Supabase.
-- ============================================================

-- Flag "cliente straniero" sull'anagrafica di fatturazione del privato. Quando è vero l'app scrive
-- sempre CAP '00000' e provincia 'EE' (le due convenzioni della fattura elettronica per l'estero)
-- e non chiede il codice fiscale italiano, che per uno straniero non si applica.
alter table prenotazioni add column if not exists "fattStraniero" boolean not null default false;

-- Stato di appartenenza del cliente privato: 'Italia' quando non è straniero, altrimenti lo stato
-- scelto dall'elenco (nomi in italiano, vedi STATI_ESTERI in src/lib/costanti.js).
-- Resta nullo sulle prenotazioni intestate a un'azienda.
alter table prenotazioni add column if not exists "fattStato" text;

-- Allineamento dei dati già presenti: i privati registrati finora sono tutti italiani.
update prenotazioni
   set "fattStato" = 'Italia'
 where "fattStato" is null
   and coalesce("fattTipo", 'privato') <> 'azienda';

-- Il codice SDI di un privato è sempre '0000000' (sette zeri): non viene più chiesto a schermo,
-- quindi va scritto anche sulle prenotazioni già registrate che ne sono prive.
update prenotazioni
   set sdi = '0000000'
 where coalesce("fattTipo", 'privato') <> 'azienda'
   and (sdi is null or sdi = '');
