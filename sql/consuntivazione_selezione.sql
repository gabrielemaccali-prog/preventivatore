-- ============================================================
-- Consuntivazione per righe scelte.
-- Da eseguire nell'SQL Editor di Supabase, dopo consuntivazione_campi.sql e identita_utenti.sql.
--
-- Finora un periodo chiuso copriva tutte le giornate fra dal e al: consuntivare voleva dire
-- chiudere tutto quello che c'era nell'intervallo. Adesso si possono scegliere le righe, e quelle
-- lasciate fuori restano da consuntivare anche se cadono fra le stesse date. Un periodo dice quindi
-- cosa copre:
--   cons_periodi.per_righe  true = copre solo le righe che porta (lato + riferimento);
--                           false = come prima, tutte le giornate fra dal e al
--   op_periodi.giornate     le giornate chiuse per quel bubbler; null = come prima, tutto
--                           l'intervallo. Si sceglie per giornata e non per partita: blocchi
--                           consecutivi e tetto giornaliero vivono dentro la giornata.
--
-- I vincoli di esclusione sulle date non possono piu' reggere: due periodi dello stesso fornitore
-- ora si intrecciano legittimamente. La rete contro il doppio pagamento resta, spostata in un
-- trigger che confronta le righe (o le giornate) invece degli intervalli. Il messaggio d'errore
-- porta lo stesso nome del vecchio vincolo, che e' quello che l'app riconosce.
--
-- Additiva: i periodi gia' chiusi restano com'erano e continuano a coprire il loro intervallo.
-- ============================================================

begin;
set local lock_timeout = '3s';

alter table cons_periodi add column if not exists per_righe boolean not null default false;
alter table op_periodi add column if not exists giornate date[];

alter table cons_periodi drop constraint if exists cons_periodi_no_sovrapposizioni;
alter table op_periodi drop constraint if exists op_periodi_no_sovrapposizioni;

-- ------------------------------------------------------------
-- FORNITORI E CAMPI: la stessa riga (lato + prenotazione) non si chiude due volte per la stessa
-- controparte. Un periodo vecchio copre una riga se la sua data cade nell'intervallo.
-- ------------------------------------------------------------
create or replace function cons_periodi_no_sovrapposizioni() returns trigger language plpgsql as $$
begin
  -- Due consuntivazioni contemporanee della stessa controparte si mettono in fila: senza, ognuna
  -- controllerebbe prima che l'altra abbia scritto, e passerebbero tutte e due.
  perform pg_advisory_xact_lock(hashtext('cons_periodi|' || new.controparte || '|' || new.controparte_id));
  if exists (
    select 1 from cons_periodi o
     where o.id is distinct from new.id
       and o.controparte = new.controparte
       and o.controparte_id = new.controparte_id
       and case
         when new.per_righe then exists (
           select 1 from jsonb_array_elements(new.righe) r
            where case
              when o.per_righe then exists (
                select 1 from jsonb_array_elements(o.righe) q
                 where q->>'riferimento' = r->>'riferimento' and q->>'lato' = r->>'lato')
              else (r->>'data')::date between o.dal and o.al
            end)
         when o.per_righe then exists (
           select 1 from jsonb_array_elements(o.righe) q
            where (q->>'data')::date between new.dal and new.al)
         else daterange(o.dal, o.al, '[]') && daterange(new.dal, new.al, '[]')
       end
  ) then
    raise exception 'cons_periodi_no_sovrapposizioni: una riga di questo periodo e'' gia'' consuntivata';
  end if;
  return new;
end $$;

drop trigger if exists cons_periodi_no_sovrapposizioni on cons_periodi;
create trigger cons_periodi_no_sovrapposizioni
  before insert or update of dal, al, righe, per_righe, controparte, controparte_id on cons_periodi
  for each row execute function cons_periodi_no_sovrapposizioni();

-- ------------------------------------------------------------
-- BUBBLER: la stessa giornata non si chiude due volte per lo stesso operatore.
-- ------------------------------------------------------------
create or replace function op_periodi_giorni(p_dal date, p_al date, p_giornate date[]) returns date[]
language sql immutable as $$
  select coalesce(p_giornate, array(select d::date from generate_series(p_dal, p_al, interval '1 day') d))
$$;

create or replace function op_periodi_no_sovrapposizioni() returns trigger language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtext('op_periodi|' || new.operatore_id::text));
  if exists (
    select 1 from op_periodi o
     where o.id is distinct from new.id
       and o.operatore_id = new.operatore_id
       and op_periodi_giorni(o.dal, o.al, o.giornate) && op_periodi_giorni(new.dal, new.al, new.giornate)
  ) then
    raise exception 'op_periodi_no_sovrapposizioni: una giornata di questo periodo e'' gia'' consuntivata';
  end if;
  return new;
end $$;

drop trigger if exists op_periodi_no_sovrapposizioni on op_periodi;
create trigger op_periodi_no_sovrapposizioni
  before insert or update of dal, al, giornate, operatore_id on op_periodi
  for each row execute function op_periodi_no_sovrapposizioni();

commit;

-- Controllo: le colonne ci sono e i periodi gia' chiusi sono tutti "per intervallo".
select (select count(*) from cons_periodi) as periodi_campi_fornitori,
       (select count(*) from cons_periodi where per_righe) as per_righe,
       (select count(*) from op_periodi) as periodi_bubbler,
       (select count(*) from op_periodi where giornate is not null) as per_giornate;
