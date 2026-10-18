-- ============================================================
-- L'accesso passa a Supabase Auth, e il database si chiude a chi non è entrato.
-- Da eseguire tutto insieme nell'SQL Editor di Supabase, e subito dopo pubblicare il codice
-- che lo accompagna: la versione precedente dell'app, da qui in poi, non fa più entrare nessuno.
--
-- Fino a oggi la password stava in chiaro in utenti.password, e il login la confrontava dal
-- browser con la chiave anon. Per il database ogni richiesta arrivava da uno sconosciuto: con la
-- sola chiave pubblica, che è dentro il codice della pagina, si leggeva tutto — password comprese.
--
-- Dopo questa migrazione:
--   - le credenziali stanno in auth.users, gestite da Supabase: la password è un'impronta
--     bcrypt da cui non si torna indietro. Non la vede l'amministratore, non la vede il database.
--   - utenti.auth_id lega la riga dell'anagrafica alla sua credenziale. utenti.password sparisce.
--   - ogni tabella ha il Row Level Security attivo: chi non è entrato non legge e non scrive
--     niente. Chi è entrato lavora solo se ha un ruolo e non ha un cambio password in sospeso.
--   - ruoli, configurazione dei moduli, accessi ed eliminazione degli utenti: solo l'amministratore.
--
-- Le password di oggi si trasferiscono così come sono: nessuno deve rifare niente per entrare.
--
-- Dopo averlo eseguito, nella dashboard di Supabase (Authentication):
--   - Sign In / Providers > Email: disattivare "Allow new users to sign up". Gli account li crea
--     solo l'amministratore; lasciarlo acceso permette a chiunque di registrarsi (senza ruolo non
--     vedrebbe niente, ma non c'è motivo di permetterlo).
--   - Password minima: 8 caratteri, la stessa che l'app e le funzioni qui sotto chiedono.
--
-- Tutto o niente: se un controllo non torna la transazione si annulla e il database resta com'era.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. IL LEGAME FRA ANAGRAFICA E CREDENZIALE
-- ------------------------------------------------------------
-- cambio_password c'è già se è stato eseguito sql/cambio_password.sql; qui serve di sicuro.
alter table public.utenti add column if not exists cambio_password boolean not null default false;
-- Revocare l'accesso cancella la credenziale: la riga dell'anagrafica resta, senza legame.
alter table public.utenti add column if not exists auth_id uuid unique references auth.users(id) on delete set null;

-- Le funzioni di servizio stanno in uno schema che le API di Supabase non espongono: le usano
-- le regole e le funzioni qui sotto, nessuno le può chiamare dal browser.
create schema if not exists riservato;
grant usage on schema riservato to authenticated;

-- L'email con cui si entra. Chi non ha un'email (un account di servizio) entra col suo username,
-- che diventa un indirizzo finto su un dominio che per definizione non esiste: Supabase Auth
-- vuole un'email, e l'app fa la stessa trasformazione quando si scrive un username (utils.js).
create or replace function riservato.email_di_accesso(p_email text, p_username text) returns text
language sql immutable set search_path = '' as $$
  select coalesce(nullif(lower(trim(p_email)), ''),
                  regexp_replace(lower(trim(p_username)), '[^a-z0-9]+', '.', 'g') || '@account.invalid')
$$;

-- Crea la credenziale in auth.users con la password già cifrata, com'è quella che Supabase
-- scrive da sé. I token vuoti e non nulli servono: con un NULL il login di Supabase fallisce.
create or replace function riservato.crea_credenziale(p_email text, p_password text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := gen_random_uuid();
begin
  if exists (select 1 from auth.users where lower(email) = p_email) then
    raise exception 'Esiste già una credenziale con l''email %', p_email;
  end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', p_email,
          extensions.crypt(p_password, extensions.gen_salt('bf', 10)), now(),
          '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
          '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text,
          jsonb_build_object('sub', v_id::text, 'email', p_email, 'email_verified', true),
          'email', now(), now(), now());
  return v_id;
end $$;

-- Scrive una password nuova e chiude le sessioni aperte, tranne quella indicata (la propria,
-- quando la password se la cambia l'utente da sé). Chi era dentro altrove deve rientrare.
create or replace function riservato.cambia_credenziale(p_auth_id uuid, p_password text, p_sessione_da_tenere uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 10)), updated_at = now()
   where id = p_auth_id;
  delete from auth.sessions where user_id = p_auth_id and id is distinct from p_sessione_da_tenere;
end $$;

-- Chi sta facendo la richiesta può lavorare: è entrato, ha un ruolo e non deve cambiare password.
-- È security definer perché legge utenti, che a sua volta è protetta da queste stesse regole.
create or replace function riservato.puo_operare() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.utenti u
                  where u.auth_id = auth.uid() and u.ruolo_id is not null and not u.cambio_password)
$$;

create or replace function riservato.sono_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.utenti u join public.ruoli r on r.id = u.ruolo_id
                  where u.auth_id = auth.uid() and r.is_admin and not u.cambio_password)
$$;

-- Il nome testuale del ruolo, finché la vecchia colonna esiste (vedi sql/ruolo_id.sql).
create or replace function riservato.allinea_nome_ruolo(p_utente_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'utenti' and column_name = 'ruolo') then
    execute 'update public.utenti u set ruolo = (select r.nome from public.ruoli r where r.id = u.ruolo_id) where u.id = $1'
      using p_utente_id;
  end if;
end $$;

revoke all on all functions in schema riservato from public, anon, authenticated;
grant execute on function riservato.puo_operare(), riservato.sono_admin() to authenticated;

-- ------------------------------------------------------------
-- 2. LE PASSWORD DI OGGI DIVENTANO CREDENZIALI
-- ------------------------------------------------------------
-- Solo chi ha davvero l'accesso: password e ruolo. Gli altri restano "senza accesso" come sono.
do $$
declare r record; v uuid;
begin
  for r in select id, email, username, password from public.utenti
            where password is not null and password <> '' and ruolo_id is not null and auth_id is null
  loop
    v := riservato.crea_credenziale(riservato.email_di_accesso(r.email, r.username), r.password);
    update public.utenti set auth_id = v where id = r.id;
  end loop;
end $$;

-- Nessuno con l'accesso deve restare senza credenziale: sarebbe chiuso fuori.
do $$
declare mancanti text;
begin
  select string_agg(coalesce(email, username), ', ') into mancanti
    from public.utenti where password is not null and password <> '' and ruolo_id is not null and auth_id is null;
  if mancanti is not null then
    raise exception 'Utenti con accesso rimasti senza credenziale, migrazione annullata -> %', mancanti;
  end if;
end $$;

-- La password in chiaro non serve più a niente, e tenerla sarebbe il problema di prima.
alter table public.utenti drop column password;

-- ------------------------------------------------------------
-- 3. GUARDIA SU UTENTI
-- ------------------------------------------------------------
-- Chi gestisce i bubbler scrive in utenti anche senza essere amministratore (Anagrafiche >
-- Bubbler). Le regole di accesso lavorano per riga, non per colonna: senza questa guardia potrebbe
-- darsi da solo il ruolo di amministratore. Ruolo, credenziale e cambio password li tocca solo
-- l'amministratore, e la credenziale solo passando dalle funzioni qui sotto.
--
-- Vale per le richieste dall'app (ruolo "authenticated"). L'SQL Editor, la chiave service_role e
-- le funzioni security definer girano con un altro ruolo e non vengono fermati.
create or replace function riservato.proteggi_utenti() returns trigger
language plpgsql set search_path = '' as $$
declare
  vecchio jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  nuovo   jsonb := to_jsonb(new);
  campo   text;
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;

  if nuovo->'auth_id' is distinct from vecchio->'auth_id' and not (tg_op = 'INSERT' and nuovo->'auth_id' = 'null'::jsonb) then
    raise exception 'La credenziale di un utente si assegna solo da Impostazioni > Utenti';
  end if;

  if riservato.sono_admin() then return new; end if;

  foreach campo in array array['ruolo_id', 'ruolo', 'cambio_password'] loop
    if tg_op = 'INSERT' then
      if coalesce(nuovo->campo, 'null'::jsonb) not in ('null'::jsonb, 'false'::jsonb) then
        raise exception 'Solo un amministratore può dare un ruolo o un accesso';
      end if;
    elsif nuovo->campo is distinct from vecchio->campo then
      raise exception 'Solo un amministratore può cambiare ruolo e accesso di un utente';
    end if;
  end loop;

  -- L'email è la credenziale: una volta scritta la cambia solo l'amministratore.
  if tg_op = 'UPDATE' and vecchio->>'email' is not null and nuovo->'email' is distinct from vecchio->'email' then
    raise exception 'Solo un amministratore può cambiare l''email di un utente';
  end if;
  return new;
end $$;

drop trigger if exists utenti_protezione on public.utenti;
create trigger utenti_protezione before insert or update on public.utenti
  for each row execute function riservato.proteggi_utenti();

-- L'email data più tardi a un account di servizio diventa la sua credenziale: si entra con quella.
create or replace function riservato.allinea_email_credenziale() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_email text := riservato.email_di_accesso(new.email, new.username);
begin
  if new.auth_id is not null then
    update auth.users set email = v_email, updated_at = now() where id = new.auth_id and email is distinct from v_email;
    update auth.identities set identity_data = identity_data || jsonb_build_object('email', v_email)
     where user_id = new.auth_id and provider = 'email';
  end if;
  return new;
end $$;

drop trigger if exists utenti_email_credenziale on public.utenti;
create trigger utenti_email_credenziale after update of email, username on public.utenti
  for each row execute function riservato.allinea_email_credenziale();

-- Eliminare l'utente elimina anche la sua credenziale, invece di lasciarla orfana.
create or replace function riservato.elimina_credenziale() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.auth_id is not null then delete from auth.users where id = old.auth_id; end if;
  return old;
end $$;

drop trigger if exists utenti_elimina_credenziale on public.utenti;
create trigger utenti_elimina_credenziale after delete on public.utenti
  for each row execute function riservato.elimina_credenziale();

revoke all on function riservato.proteggi_utenti(), riservato.allinea_email_credenziale(), riservato.elimina_credenziale()
  from public, anon, authenticated;

-- ------------------------------------------------------------
-- 4. LE FUNZIONI CHE L'APP CHIAMA
-- ------------------------------------------------------------
-- Dare o reimpostare la password di un utente (Nuovo, Abilita, Reimposta password). Se non ha
-- ancora una credenziale la crea; il ruolo, se indicato, si assegna nello stesso passaggio.
create or replace function public.admin_imposta_accesso(p_utente_id bigint, p_password text,
                                                        p_cambio_password boolean default true,
                                                        p_ruolo_id bigint default null) returns void
language plpgsql security definer set search_path = '' as $$
declare u public.utenti%rowtype;
begin
  if not riservato.sono_admin() then raise exception 'Solo un amministratore può impostare una password'; end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'La password deve avere almeno 8 caratteri'; end if;
  select * into u from public.utenti where id = p_utente_id;
  if not found then raise exception 'Utente non trovato'; end if;
  if u.auth_id is null and p_ruolo_id is null and u.ruolo_id is null then
    raise exception 'Per dare l''accesso serve anche un ruolo';
  end if;

  if u.auth_id is null then
    update public.utenti
       set auth_id = riservato.crea_credenziale(riservato.email_di_accesso(u.email, u.username), p_password)
     where id = p_utente_id;
  else
    -- Le sessioni aperte si chiudono tutte, tranne quella dell'amministratore se la password è la sua.
    perform riservato.cambia_credenziale(u.auth_id, p_password,
      case when u.auth_id = auth.uid() then nullif(auth.jwt()->>'session_id', '')::uuid end);
  end if;

  update public.utenti
     set cambio_password = coalesce(p_cambio_password, true),
         ruolo_id = coalesce(p_ruolo_id, ruolo_id)
   where id = p_utente_id;
  perform riservato.allinea_nome_ruolo(p_utente_id);
end $$;

-- Togliere l'accesso: la credenziale si cancella (e con lei le sessioni aperte), l'anagrafica resta.
create or replace function public.admin_revoca_accesso(p_utente_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare v_auth uuid;
begin
  if not riservato.sono_admin() then raise exception 'Solo un amministratore può revocare un accesso'; end if;
  select auth_id into v_auth from public.utenti where id = p_utente_id;
  if v_auth = auth.uid() then raise exception 'Non puoi revocare il tuo stesso accesso'; end if;
  if v_auth is not null then delete from auth.users where id = v_auth; end if;
  update public.utenti set auth_id = null, ruolo_id = null, cambio_password = false where id = p_utente_id;
  perform riservato.allinea_nome_ruolo(p_utente_id);
end $$;

-- La password che l'utente si sceglie da sé. Sta qui e non nell'app perché è il database a dover
-- accettare che la richiesta di cambio sia esaudita: deve essere davvero nuova, e solo allora il
-- cambio richiesto si spegne. Le altre sessioni aperte si chiudono, quella in uso resta.
create or replace function public.cambia_mia_password(p_nuova text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_hash text;
begin
  if auth.uid() is null then raise exception 'Accesso richiesto'; end if;
  if length(coalesce(p_nuova, '')) < 8 then raise exception 'La nuova password deve avere almeno 8 caratteri'; end if;
  select encrypted_password into v_hash from auth.users where id = auth.uid();
  if v_hash = extensions.crypt(p_nuova, v_hash) then
    raise exception 'La nuova password deve essere diversa da quella attuale';
  end if;
  perform riservato.cambia_credenziale(auth.uid(), p_nuova, nullif(auth.jwt()->>'session_id', '')::uuid);
  update public.utenti set cambio_password = false where auth_id = auth.uid();
end $$;

revoke all on function public.admin_imposta_accesso(bigint, text, boolean, bigint),
                       public.admin_revoca_accesso(bigint),
                       public.cambia_mia_password(text) from public, anon;
grant execute on function public.admin_imposta_accesso(bigint, text, boolean, bigint),
                          public.admin_revoca_accesso(bigint),
                          public.cambia_mia_password(text) to authenticated;

-- ------------------------------------------------------------
-- 5. ROW LEVEL SECURITY SU TUTTE LE TABELLE
-- ------------------------------------------------------------
-- Le regole di prima (dove c'erano) si tolgono tutte: una sola regola permissiva rimasta per
-- anon basterebbe a lasciare aperta la tabella.
do $$
declare p record; t record;
begin
  for p in select tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;

  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
    -- Utenti, ruoli e configurazione dei moduli hanno regole loro, qui sotto.
    if t.tablename not in ('utenti', 'ruoli', 'moduli_config') then
      execute format('create policy app_accesso on public.%I for all to authenticated
                        using ((select riservato.puo_operare())) with check ((select riservato.puo_operare()))', t.tablename);
    end if;
  end loop;
end $$;

-- Una vista legge con i diritti di chi l'ha creata e scavalcherebbe le regole: si allinea a chi la usa.
do $$
declare v record;
begin
  for v in select viewname from pg_views where schemaname = 'public' loop
    execute format('alter view public.%I set (security_invoker = true)', v.viewname);
  end loop;
end $$;

-- Utenti: la propria riga si legge sempre, anche col cambio password in sospeso (serve alla
-- schermata che lo chiede). Il resto come le altre tabelle; eliminare, solo l'amministratore.
create policy utenti_lettura  on public.utenti for select to authenticated
  using ((select riservato.puo_operare()) or auth_id = (select auth.uid()));
create policy utenti_aggiunta on public.utenti for insert to authenticated
  with check ((select riservato.puo_operare()));
create policy utenti_modifica on public.utenti for update to authenticated
  using ((select riservato.puo_operare())) with check ((select riservato.puo_operare()));
create policy utenti_elimina  on public.utenti for delete to authenticated
  using ((select riservato.sono_admin()));

-- Ruoli e configurazione dei moduli: li leggono tutti, li scrive solo l'amministratore.
create policy ruoli_lettura on public.ruoli for select to authenticated using ((select riservato.puo_operare()));
create policy ruoli_scrittura on public.ruoli for all to authenticated
  using ((select riservato.sono_admin())) with check ((select riservato.sono_admin()));
create policy moduli_config_lettura on public.moduli_config for select to authenticated using ((select riservato.puo_operare()));
create policy moduli_config_scrittura on public.moduli_config for all to authenticated
  using ((select riservato.sono_admin())) with check ((select riservato.sono_admin()));

-- Almeno un amministratore deve poter entrare, altrimenti nessuno potrebbe più rimediare.
do $$
begin
  if not exists (select 1 from public.utenti u join public.ruoli r on r.id = u.ruolo_id
                  where r.is_admin and u.auth_id is not null) then
    raise exception 'Nessun amministratore con credenziale: migrazione annullata';
  end if;
end $$;

commit;

-- Controllo: chi può entrare, e con quale email. "account.invalid" è chi entra con l'username.
select u.id, coalesce(nullif(trim(coalesce(u.nome, '') || ' ' || coalesce(u.cognome, '')), ''), u.username) as utente,
       a.email as entra_con, r.nome as ruolo, u.cambio_password
  from public.utenti u
  join auth.users a on a.id = u.auth_id
  left join public.ruoli r on r.id = u.ruolo_id
 order by r.nome, utente;
