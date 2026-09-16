-- ============================================================
-- Consuntivazione dei campi.
-- Da eseguire nell'SQL Editor di Supabase, dopo consuntivazione_fornitori.sql.
--
-- Un campo si consuntiva come un fornitore: il costo nasce preventivato sulla prenotazione
-- (affitto e rinfresco), si corregge con le rettifiche e si chiude per periodo quando e' stato
-- pagato. E anche un campo puo' essere cliente, quando ci commissiona una partita: il prezzo non
-- si incassa, si compensa con quello che gli dobbiamo.
--
-- Le regole sono le stesse, e allora le tabelle diventano le stesse: forn_voci e forn_periodi
-- smettono di essere dei soli fornitori e dicono di quale controparte parlano.
--   forn_voci    -> cons_voci
--   forn_periodi -> cons_periodi
--   sede_id      -> controparte_id, accanto a controparte ('fornitore' | 'campo')
-- Si puo' fare adesso senza perdere niente perche' le due tabelle sono ancora vuote; se non lo
-- fossero, le righe gia' scritte restano dei fornitori, che e' quello che erano.
-- ============================================================

begin;
set local lock_timeout = '3s';

-- ------------------------------------------------------------
-- IL CAMPO CHE E' ANCHE CLIENTE.
-- Come "clienteSedeId" per i fornitori: la prenotazione dice quale campo ci ha commissionato la
-- partita. Una prenotazione ha al piu' uno dei due. Null = un cliente normale.
-- ------------------------------------------------------------
alter table prenotazioni add column if not exists "clienteCampoId" text;

-- ------------------------------------------------------------
-- LE TABELLE DIVENTANO DI TUTTE LE CONTROPARTI.
-- ------------------------------------------------------------
alter table forn_voci rename to cons_voci;
alter table forn_periodi rename to cons_periodi;

alter table cons_voci rename column sede_id to controparte_id;       -- sedi.id oppure pren_campi.id
alter table cons_periodi rename column sede_id to controparte_id;

alter table cons_voci add column controparte text not null default 'fornitore';
alter table cons_periodi add column controparte text not null default 'fornitore';
alter table cons_voci add constraint cons_voci_controparte_valida check (controparte in ('fornitore', 'campo'));
alter table cons_periodi add constraint cons_periodi_controparte_valida check (controparte in ('fornitore', 'campo'));

alter index if exists forn_voci_sede_data_idx rename to cons_voci_controparte_data_idx;
alter index if exists forn_periodi_sede_idx rename to cons_periodi_controparte_idx;
alter table cons_voci rename constraint forn_voci_lato_valido to cons_voci_lato_valido;
alter table cons_periodi rename constraint forn_periodi_intervallo_valido to cons_periodi_intervallo_valido;

-- La stessa giornata non si chiude due volte per la stessa controparte. Il tipo entra nel vincolo:
-- un id di campo e uno di sede non si incontrano, ma e' il tipo a dirlo, non la forma dell'id.
alter table cons_periodi drop constraint if exists forn_periodi_no_sovrapposizioni;
alter table cons_periodi drop constraint if exists cons_periodi_no_sovrapposizioni;
alter table cons_periodi add constraint cons_periodi_no_sovrapposizioni
  exclude using gist (controparte with =, controparte_id with =, daterange(dal, al, '[]') with &&);

commit;

-- Controllo: le colonne ci sono, le righe (se ce n'erano) sono tutte dei fornitori.
select (select count(*) from prenotazioni where "clienteCampoId" is not null) as clienti_campo,
       (select count(*) from cons_voci) as voci,
       (select count(*) from cons_periodi) as periodi,
       (select string_agg(distinct controparte, ', ') from cons_periodi) as controparti;
