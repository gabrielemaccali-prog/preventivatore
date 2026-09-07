-- ============================================================
-- Pulizia dei residui: tre tabelle e otto colonne che non usa più nessuno.
-- Da eseguire nell'SQL Editor di Supabase.
--
-- ATTENZIONE: questo file elimina dati in modo definitivo. Non c'è modo di annullarlo
-- dopo il commit. Il punto 1 esiste apposta perché tu possa guardare cosa stai per
-- perdere prima di perderlo: eseguilo da solo, leggi il risultato, e solo dopo prosegui.
--
-- Che cosa se ne va, e perché:
--
--   TRE TABELLE, resti di due passaggi già completati — la disponibilità che da "giorni
--   ricorrenti della settimana" è diventata un calendario di date puntuali, e gli operatori
--   che da anagrafica separata sono diventati utenti con il flag bubbler. Nessuna delle tre
--   compare da nessuna parte nel codice, e i dati che contengono sono intestati a username
--   scomparsi da due generazioni (diego, grassi, e due indirizzi email usati come nome utente).
--
--   OTTO COLONNE che il codice non legge mai. Verificate cercando ciascun nome nell'intero
--   sorgente: zero occorrenze. Restano fuori da questa pulizia le colonne testuali sostituite
--   dagli identificatori (utenti.ruolo, disp_calendario.utente_username e le altre): quelle
--   sono la via di ritorno se qualcosa non tornasse, e si eliminano più avanti.
-- ============================================================

-- ------------------------------------------------------------
-- 1) GUARDA PRIMA. Esegui solo questo blocco, leggi cosa esce, poi decidi.
--
--    In particolare pren_operatori contiene nome, telefono ed email personali di due persone:
--    se per qualche motivo servissero altrove, questo è l'ultimo momento per copiarli.
-- ------------------------------------------------------------

select 'pren_operatori' as tabella, count(*) as righe from pren_operatori
union all select 'disp_campi', count(*) from disp_campi
union all select 'disp_campi_fasce', count(*) from disp_campi_fasce;

select * from pren_operatori;

-- A chi erano intestate le disponibilità vecchie, e se quell'utente esiste ancora.
-- Atteso: nessuno di questi username esiste più, tranne "gabo".
select d.utente_username,
       count(*) as righe,
       exists (select 1 from utenti u where u.username = d.utente_username) as utente_esiste
  from disp_campi d group by 1
union all
select f.utente_username, count(*),
       exists (select 1 from utenti u where u.username = f.utente_username)
  from disp_campi_fasce f group by 1
 order by 2 desc;

-- Le otto colonne, con quante righe le valorizzano davvero.
select 'prenotazioni.gcalEventId'       as colonna, count(*) filter (where "gcalEventId" is not null) as valorizzate, count(*) as totali from prenotazioni
union all select 'prenotazioni.pIvaCF',            count(*) filter (where "pIvaCF" is not null), count(*) from prenotazioni
union all select 'prenotazioni.pagamenti',         count(*) filter (where pagamenti is not null), count(*) from prenotazioni
union all select 'pren_campi.tariffaFlat',         count(*) filter (where "tariffaFlat" is not null), count(*) from pren_campi
union all select 'op_periodi.documento_id',        count(*) filter (where documento_id is not null), count(*) from op_periodi
union all select 'op_periodi.rimborso_forfettario', count(*) filter (where rimborso_forfettario is not null), count(*) from op_periodi
union all select 'disp_conferme.confermato_il',    count(*) filter (where confermato_il is not null), count(*) from disp_conferme
union all select 'ruoli.created_at',               count(*) filter (where created_at is not null), count(*) from ruoli;

-- ------------------------------------------------------------
-- 2) LA PULIZIA.
--    Tutto dentro una transazione: se una qualsiasi istruzione fallisce, non si muove niente.
--    In PostgreSQL anche le modifiche allo schema si annullano, quindi finché non arriva il
--    commit sei ancora in tempo a fermarti.
-- ------------------------------------------------------------
begin;

-- --- le tre tabelle ---
-- L'ordine non conta: nessuna delle tre è collegata alle altre né a niente d'altro.
drop table if exists disp_campi_fasce;
drop table if exists disp_campi;
drop table if exists pren_operatori;

-- --- le otto colonne ---

-- Doveva tenere l'id dell'evento su Google Calendar. La sincronizzazione funziona con un
-- link precompilato e il flag googleCalendarSync, non con l'id: mai scritta, mai letta.
alter table prenotazioni drop column if exists "gcalEventId";

-- Campo unico per partita IVA e codice fiscale, sostituito da pIva e cfAzienda separati.
alter table prenotazioni drop column if exists "pIvaCF";

-- Copia di sicurezza precedente alla tabella "pagamenti". L'app costruisce p.pagamenti in
-- memoria leggendo quella tabella e sovrascrive sempre questa colonna, che quindi non viene
-- mai letta. Nota: eliminandola, sql/pagamenti.sql non è più rieseguibile — ha già fatto il
-- suo lavoro, ma se un domani ricostruisci il database da zero vanno saltate quelle righe.
alter table prenotazioni drop column if exists pagamenti;

-- Booleano, vale true su tutti e nove i campi. Distingueva i campi a tariffa fissa da quelli
-- variabili; oggi il lavoro lo fanno costoFlat e la tabella pren_campi_tariffe.
alter table pren_campi drop column if exists "tariffaFlat";

-- Previsto per collegare il periodo a una ricevuta numerata. La ricevuta non è mai diventata
-- un record a sé: vive dentro la colonna jsonb "rimborso".
alter table op_periodi drop column if exists documento_id;

-- Sostituito dal blocco rimborso.trasferte, che tiene le righe una per una invece di un totale.
alter table op_periodi drop column if exists rimborso_forfettario;

-- Data di conferma, riempita in automatico e mai letta: la conferma è l'esistenza della riga.
alter table disp_conferme drop column if exists confermato_il;

-- Colonna di servizio creata da Supabase, mai usata.
alter table ruoli drop column if exists created_at;

commit;

-- ------------------------------------------------------------
-- 3) DOPO. Le tabelle non devono più esistere e le colonne non devono più comparire.
--    Entrambe le query devono tornare vuote.
-- ------------------------------------------------------------

select table_name as tabella_ancora_presente
  from information_schema.tables
 where table_schema = 'public'
   and table_name in ('disp_campi', 'disp_campi_fasce', 'pren_operatori');

select table_name || '.' || column_name as colonna_ancora_presente
  from information_schema.columns
 where table_schema = 'public'
   and (table_name, column_name) in (
     ('prenotazioni','gcalEventId'), ('prenotazioni','pIvaCF'), ('prenotazioni','pagamenti'),
     ('pren_campi','tariffaFlat'),
     ('op_periodi','documento_id'), ('op_periodi','rimborso_forfettario'),
     ('disp_conferme','confermato_il'), ('ruoli','created_at')
   );

-- Il conto delle tabelle deve essere sceso da 24 a 21.
select count(*) as tabelle_rimaste from information_schema.tables where table_schema = 'public';
