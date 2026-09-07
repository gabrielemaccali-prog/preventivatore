-- ============================================================
-- L'utente punta al ruolo per id, non per nome.
-- Da eseguire nell'SQL Editor di Supabase.
--
-- Perché: utenti.ruolo contiene il NOME del ruolo, e i permessi si cercano con
-- ruoli.nome = utenti.ruolo. Nessuna foreign key. Oggi tutti e 17 gli utenti trovano il loro
-- ruolo, quindi non c'è niente da recuperare — ma il modo in cui questo si rompe è il peggiore
-- di tutti: rinominando un ruolo gli utenti che ce l'hanno non perdono l'accesso, perdono i
-- permessi. Entrano, non vedono più niente, e non compare nessun errore da nessuna parte.
--
-- Il nome del ruolo, a differenza dello username, è una cosa che ha senso poter cambiare:
-- "adminlow" un giorno diventerà "responsabile" e va bene così. Per questo qui la cura non è
-- bloccare la rinomina, è smettere di usare il nome come chiave.
--
-- Si aggiunge anche un flag is_admin, perché il ruolo "admin" oggi è riconosciuto confrontando
-- la stringa 'admin' in tre punti del codice: finché è così, il nome resta una chiave travestita.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1) Chi è l'amministratore diventa una proprietà del ruolo, non il suo nome.
-- ------------------------------------------------------------
alter table ruoli add column if not exists is_admin boolean not null default false;
update ruoli set is_admin = true where nome = 'admin';

-- Deve restarci sempre almeno un ruolo amministratore, altrimenti si resta chiusi fuori
-- dalle Impostazioni e non si può più rientrare da nessuna parte.
do $$
begin
  if not exists (select 1 from ruoli where is_admin) then
    raise exception 'Nessun ruolo con is_admin: manca il ruolo "admin"?';
  end if;
end $$;

-- ------------------------------------------------------------
-- 2) Il riferimento numerico.
-- ------------------------------------------------------------
alter table utenti add column if not exists ruolo_id bigint;

update utenti u set ruolo_id = r.id from ruoli r
 where r.nome = u.ruolo and u.ruolo_id is null;

do $$
declare orfani text;
begin
  select string_agg(format('%s utenti con ruolo = %L', n, ruolo), ', ')
    into orfani
    from (select ruolo, count(*) as n from utenti where ruolo_id is null group by ruolo) t;
  if orfani is not null then
    raise exception 'Ci sono utenti con un ruolo che non esiste in "ruoli": %', orfani;
  end if;
end $$;

alter table utenti alter column ruolo_id set not null;

alter table utenti drop constraint if exists utenti_ruolo_fk;
alter table utenti add constraint utenti_ruolo_fk
  foreign key (ruolo_id) references ruoli(id) on update cascade on delete restrict;

-- Con "on delete restrict" il database rifiuta di cancellare un ruolo ancora assegnato. Il
-- controllo che l'app già fa a mano prima di eliminare un ruolo resta utile — serve a dare un
-- messaggio comprensibile — ma smette di essere l'unica cosa che tiene.

commit;

-- ------------------------------------------------------------
-- 3) Controllo: ogni utente deve risultare sullo stesso ruolo di prima.
-- ------------------------------------------------------------
select u.username, u.ruolo as nome_vecchio, r.nome as nome_via_id, r.is_admin
  from utenti u join ruoli r on r.id = u.ruolo_id
 order by r.nome, u.username;

-- ------------------------------------------------------------
-- 4) DA ESEGUIRE PIÙ AVANTI, come per l'altra migrazione: quando il codice che legge ruolo_id
--    è in produzione e il controllo qui sopra torna, la colonna testuale non serve più.
--
-- alter table utenti drop column ruolo;
-- ------------------------------------------------------------
