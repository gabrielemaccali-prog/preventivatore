-- ============================================================
-- Migrazione: la disponibilità a calendario diventa per singolo campo
-- (da eseguire una volta nell'SQL Editor di Supabase, dopo sql/disponibilita.sql)
--
-- Prima: disp_campi (campi in cui lavoro) + disp_campi_fasce (giorni/fasce per campo)
--        + disp_calendario (data/fascia, senza campo). La disponibilità effettiva era
--        l'incrocio delle due cose.
-- Adesso: solo disp_calendario, con campo_id: si sceglie il campo e si segnano le fasce
--        giorno per giorno direttamente sul calendario.
-- ============================================================

-- 1) Nuova colonna
alter table disp_calendario add column if not exists campo_id text;

-- 2) Via il vecchio vincolo di unicità (data+fascia): ora la stessa data/fascia può
--    ripetersi su campi diversi.
alter table disp_calendario drop constraint if exists disp_calendario_utente_username_data_fascia_key;

-- 3) Riporta i dati esistenti: ogni riga senza campo viene espansa in una riga per ciascun
--    campo su cui il bubbler risultava disponibile in quel giorno della settimana e in quella
--    fascia (extract(isodow) restituisce 1=Lun..7=Dom, la stessa convenzione di disp_campi_fasce).
--    È esattamente la disponibilità che l'app calcolava a runtime prima della modifica.
insert into disp_calendario (utente_username, campo_id, data, fascia, ora_inizio, ora_fine, note)
select distinct dc.utente_username, dcf.campo_id, dc.data, dc.fascia, dc.ora_inizio, dc.ora_fine, dc.note
from disp_calendario dc
join disp_campi_fasce dcf
  on dcf.utente_username = dc.utente_username
 and dcf.fascia = dc.fascia
 and dcf.giorno = extract(isodow from dc.data)::int
where dc.campo_id is null;

-- 4) Le righe originali senza campo non hanno più significato
delete from disp_calendario where campo_id is null;

-- 5) Vincoli definitivi
alter table disp_calendario alter column campo_id set not null;
alter table disp_calendario add constraint disp_calendario_utente_campo_data_fascia_key
  unique (utente_username, campo_id, data, fascia);

-- 6) Indice per le letture più frequenti (calendario di un utente su un campo)
create index if not exists disp_calendario_utente_campo_idx on disp_calendario (utente_username, campo_id, data);

-- 7) disp_campi e disp_campi_fasce non sono più usate dall'app. Verificata la migrazione
--    (i dati al punto 3 sono quelli che ti aspetti), puoi eliminarle:
-- drop table if exists disp_campi_fasce;
-- drop table if exists disp_campi;
