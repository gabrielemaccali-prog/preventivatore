-- ============================================================
-- Un bubbler può esistere senza poter entrare nell'applicazione.
-- Da eseguire nell'SQL Editor di Supabase.
--
-- Fino a oggi un utente nasceva in Impostazioni > Utenti, con password e ruolo già decisi, e solo
-- dopo il configuratore di Disponibilità ne completava l'anagrafica. Così chi gestisce i bubbler
-- doveva passare da un amministratore anche solo per aggiungerne uno.
--
-- Ora il bubbler nasce nel configuratore, con i suoi dati e senza accesso: niente password e
-- niente ruolo. L'accesso glielo dà un amministratore in un secondo momento, da Impostazioni,
-- scegliendo ruolo e password. Revocarlo riporta la riga allo stesso stato, senza cancellare
-- disponibilità e compensi che le stanno dietro.
--
-- "Senza accesso" vuol dire password e ruolo nulli. Il login rifiuta comunque chi ne è privo,
-- a prescindere da quello che c'è scritto qui.
-- ============================================================

begin;

alter table utenti alter column ruolo_id drop not null;
alter table utenti alter column password drop not null;

-- La vecchia colonna testuale del ruolo potrebbe essere già stata eliminata (vedi sql/ruolo_id.sql).
do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'utenti' and column_name = 'ruolo') then
    execute 'alter table utenti alter column ruolo drop not null';
  end if;
end $$;

-- La foreign key verso ruoli resta com'è: un valore nullo non la viola.

commit;

-- Controllo: quanti utenti hanno l'accesso e quanti no. Subito dopo la migrazione sono tutti "con accesso".
select count(*) filter (where password is not null and ruolo_id is not null) as con_accesso,
       count(*) filter (where password is null or ruolo_id is null)          as senza_accesso
  from utenti;
