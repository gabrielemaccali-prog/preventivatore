-- ============================================================
-- Identità degli utenti: separare chi sei, come ti chiami e come entri.
--
-- Fino a oggi utenti.username faceva tre mestieri: credenziale di accesso, nome e cognome
-- della persona, e chiave verso cinque tabelle — tutte per testo, senza foreign key. Rinominare
-- qualcuno scollegava i suoi dati in silenzio, ed è già successo: 235 righe di disponibilità
-- puntano a "diego", che in utenti non esiste più.
--
-- Dopo questa migrazione:
--   utenti.id            la chiave, numerica e immutabile, verso cui punta tutto
--   utenti.nome/cognome  come si chiama la persona, modificabile senza conseguenze
--   utenti.email         come entra nell'applicazione
--   utenti.username      resta come vecchia credenziale di ripiego, non è più chiave di niente
--
-- Da eseguire tutto insieme nell'SQL Editor di Supabase. Le verifiche interrompono la
-- migrazione se qualcosa non torna, invece di lasciare il database a metà strada.
-- ============================================================

-- ------------------------------------------------------------
-- 1. NOME E COGNOME COME CAMPI PROPRI
-- ------------------------------------------------------------
alter table utenti
  add column if not exists nome    text,
  add column if not exists cognome text;

-- Si spacca l'username sulla prima parola: "Diego Laudisio" -> "Diego" + "Laudisio",
-- "Edoardo La Bruna" -> "Edoardo" + "La Bruna". I nomi doppi finiranno nel cognome
-- ("Ester Margherita Bina" -> "Ester" + "Margherita Bina"): si correggono a mano, sono due.
update utenti
   set nome    = coalesce(nome,    split_part(username, ' ', 1)),
       cognome = coalesce(cognome, nullif(regexp_replace(username, '^\S+\s*', ''), ''))
 where nome is null or cognome is null;

-- L'email diventa una credenziale, quindi non può ripetersi. Maiuscole e minuscole non
-- distinguono: "Mario@x.it" e "mario@x.it" sono la stessa persona.
create unique index if not exists utenti_email_unica
  on utenti (lower(email)) where email is not null;

-- ------------------------------------------------------------
-- 2. LA CHIAVE NUMERICA AL POSTO DELL'USERNAME
-- ------------------------------------------------------------
alter table disp_calendario add column if not exists utente_id bigint;
alter table disp_conferme   add column if not exists utente_id bigint;
alter table op_voci         add column if not exists operatore_id bigint;
alter table op_periodi      add column if not exists operatore_id bigint;

update disp_calendario d set utente_id    = u.id from utenti u where u.username = d.utente_username and d.utente_id is null;
update disp_conferme   d set utente_id    = u.id from utenti u where u.username = d.utente_username and d.utente_id is null;
update op_voci         v set operatore_id = u.id from utenti u where u.username = v.operatore        and v.operatore_id is null;
update op_periodi      p set operatore_id = u.id from utenti u where u.username = p.operatore        and p.operatore_id is null;

-- Le righe rimaste orfane da una vecchia rinomina: "diego" era Diego Laudisio.
update disp_calendario set utente_id = (select id from utenti where username = 'Diego Laudisio')
 where utente_id is null and utente_username = 'diego';
update disp_conferme   set utente_id = (select id from utenti where username = 'Diego Laudisio')
 where utente_id is null and utente_username = 'diego';

-- Se qualcosa non ha trovato il suo utente, ci si ferma qui: meglio una migrazione interrotta
-- che una riga scollegata in più.
do $$
declare mancanti text;
begin
  select string_agg(x.descrizione, '; ') into mancanti from (
    select 'disp_calendario: ' || count(*) || ' righe (' || string_agg(distinct utente_username, ', ') || ')' as descrizione
      from disp_calendario where utente_id is null having count(*) > 0
    union all
    select 'disp_conferme: '   || count(*) || ' righe (' || string_agg(distinct utente_username, ', ') || ')'
      from disp_conferme   where utente_id is null having count(*) > 0
    union all
    select 'op_voci: '         || count(*) || ' righe (' || string_agg(distinct operatore, ', ') || ')'
      from op_voci         where operatore_id is null having count(*) > 0
    union all
    select 'op_periodi: '      || count(*) || ' righe (' || string_agg(distinct operatore, ', ') || ')'
      from op_periodi      where operatore_id is null having count(*) > 0
  ) x;
  if mancanti is not null then
    raise exception 'Righe senza utente corrispondente, migrazione annullata -> %', mancanti;
  end if;
end $$;

alter table disp_calendario alter column utente_id    set not null;
alter table disp_conferme   alter column utente_id    set not null;
alter table op_voci         alter column operatore_id set not null;
alter table op_periodi      alter column operatore_id set not null;

-- Da qui in avanti il database non permette più di scollegare: rinominare un utente non tocca
-- niente, e cancellarne uno che ha dati alle spalle viene rifiutato invece che ignorato.
-- I drop rendono il file rilanciabile: una migrazione interrotta a metà si riprende da capo
-- senza inciampare su quello che era già passato.
alter table disp_calendario drop constraint if exists disp_calendario_utente_fk;
alter table disp_calendario add  constraint disp_calendario_utente_fk
  foreign key (utente_id) references utenti(id) on update cascade on delete restrict;
alter table disp_conferme   drop constraint if exists disp_conferme_utente_fk;
alter table disp_conferme   add  constraint disp_conferme_utente_fk
  foreign key (utente_id) references utenti(id) on update cascade on delete restrict;
alter table op_voci         drop constraint if exists op_voci_operatore_fk;
alter table op_voci         add  constraint op_voci_operatore_fk
  foreign key (operatore_id) references utenti(id) on update cascade on delete restrict;
alter table op_periodi      drop constraint if exists op_periodi_operatore_fk;
alter table op_periodi      add  constraint op_periodi_operatore_fk
  foreign key (operatore_id) references utenti(id) on update cascade on delete restrict;

-- ------------------------------------------------------------
-- 3. VINCOLI E INDICI RIFATTI SULLA CHIAVE NUOVA
-- ------------------------------------------------------------
-- Il nome è quello dato in disponibilita_per_campo.sql; la variante è quella che Postgres
-- assegna da sé se la tabella è nata dal Table Editor invece che da quello script.
alter table disp_calendario drop constraint if exists disp_calendario_utente_campo_data_fascia_key;
alter table disp_calendario drop constraint if exists disp_calendario_utente_username_campo_id_data_fascia_key;
alter table disp_calendario drop constraint if exists disp_calendario_unica;
alter table disp_calendario add  constraint disp_calendario_unica unique (utente_id, campo_id, data, fascia);
drop index if exists disp_calendario_utente_campo_idx;
create index if not exists disp_calendario_utente_campo_idx on disp_calendario (utente_id, campo_id, data);

alter table disp_conferme drop constraint if exists disp_conferme_utente_username_campo_id_mese_key;
alter table disp_conferme drop constraint if exists disp_conferme_unica;
alter table disp_conferme add  constraint disp_conferme_unica unique (utente_id, campo_id, mese);
drop index if exists disp_conferme_utente_mese_idx;
create index if not exists disp_conferme_utente_mese_idx on disp_conferme (utente_id, mese);

drop index if exists op_voci_operatore_data_idx;
create index if not exists op_voci_operatore_data_idx on op_voci (operatore_id, data);

-- Una sola recensione per operatore per partita.
drop index if exists op_voci_una_recensione_per_partita;
create unique index if not exists op_voci_una_recensione_per_partita
  on op_voci (operatore_id, riferimento) where tipo = 'recensione';

drop index if exists op_periodi_operatore_idx;
create index if not exists op_periodi_operatore_idx on op_periodi (operatore_id, dal);

-- Due periodi dello stesso operatore non possono sovrapporsi: è il vincolo che impedisce
-- di pagare due volte la stessa giornata.
alter table op_periodi drop constraint if exists op_periodi_no_sovrapposizioni;
alter table op_periodi add constraint op_periodi_no_sovrapposizioni
  exclude using gist (operatore_id with =, daterange(dal, al, '[]') with &&);

-- ------------------------------------------------------------
-- 4. GLI OPERATORI DENTRO LE PRENOTAZIONI
-- Lo snapshot resta uno snapshot — il nome è quello del giorno della prenotazione — ma l'id
-- che ci sta dentro deve essere la chiave stabile, non l'username.
-- ------------------------------------------------------------
update prenotazioni p
   set operatori = (
     select jsonb_agg(jsonb_set(o, '{id}', coalesce(to_jsonb(u.id), o->'id')) order by ord)
       from jsonb_array_elements(p.operatori) with ordinality as t(o, ord)
       left join utenti u on u.username = t.o->>'id'
   )
 where jsonb_typeof(operatori) = 'array'
   and jsonb_array_length(operatori) > 0
   and exists (select 1 from jsonb_array_elements(p.operatori) e where jsonb_typeof(e->'id') = 'string');

-- ------------------------------------------------------------
-- 5. LE VECCHIE COLONNE TESTUALI
-- Si tengono ancora un giro, come rete: se qualcosa non torna si può ricostruire il legame.
-- Quando l'applicazione gira senza intoppi, si eliminano con lo script in coda.
-- ------------------------------------------------------------
comment on column disp_calendario.utente_username is 'Obsoleta: sostituita da utente_id. Da eliminare a migrazione assestata.';
comment on column disp_conferme.utente_username   is 'Obsoleta: sostituita da utente_id. Da eliminare a migrazione assestata.';
comment on column op_voci.operatore               is 'Obsoleta: sostituita da operatore_id. Da eliminare a migrazione assestata.';
comment on column op_periodi.operatore            is 'Obsoleta: sostituita da operatore_id. Da eliminare a migrazione assestata.';

alter table disp_calendario alter column utente_username drop not null;
alter table disp_conferme   alter column utente_username drop not null;
alter table op_voci         alter column operatore       drop not null;
alter table op_periodi      alter column operatore       drop not null;

-- Da eseguire più avanti, a migrazione assestata:
--
--   alter table disp_calendario drop column utente_username;
--   alter table disp_conferme   drop column utente_username;
--   alter table op_voci         drop column operatore;
--   alter table op_periodi      drop column operatore;
