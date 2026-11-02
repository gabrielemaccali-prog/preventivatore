-- ============================================================
-- Categorie degli incassi su due livelli, come quelle delle spese.
-- Da eseguire nell'SQL Editor di Supabase, dopo sql/incassi_banca.sql.
--
-- Un incasso abbinato a una prenotazione o a un voucher è operativo e non ha categoria; gli altri
-- sono generali e prendono una categoria all'ultimo livello: una sottocategoria, o una categoria
-- che non ne ha. Le regole sono quelle di sql/spese_classificazione.sql: una categoria senza padre
-- è di primo livello, una sottocategoria ha per padre una di primo livello, e il nome è unico fra
-- le sorelle ("Altro" può stare sotto più categorie).
--
-- Additiva: le categorie che ci sono restano di primo livello.
-- ============================================================

begin;
set local lock_timeout = '3s';

alter table incassi_categorie add column if not exists padre_id bigint references incassi_categorie(id) on delete restrict;
drop index if exists incassi_categorie_nome_idx;
create unique index if not exists incassi_categorie_nome_idx on incassi_categorie (coalesce(padre_id, 0), lower(btrim(nome)));
create index if not exists incassi_categorie_padre_idx on incassi_categorie (padre_id);

create or replace function riservato.incassi_categorie_due_livelli() returns trigger
language plpgsql as $$
begin
  if new.padre_id is not null and new.padre_id = new.id then
    raise exception 'Una categoria non puo'' stare sotto se stessa.';
  end if;
  if new.padre_id is not null and exists (select 1 from public.incassi_categorie where id = new.padre_id and padre_id is not null) then
    raise exception 'Le categorie hanno due livelli: una sottocategoria non puo'' averne altre sotto.';
  end if;
  if new.padre_id is not null and exists (select 1 from public.incassi_categorie where padre_id = new.id) then
    raise exception 'Questa categoria ha gia'' delle sottocategorie: non puo'' diventarne una.';
  end if;
  return new;
end $$;
drop trigger if exists incassi_categorie_due_livelli on incassi_categorie;
create trigger incassi_categorie_due_livelli before insert or update of padre_id on incassi_categorie
  for each row execute function riservato.incassi_categorie_due_livelli();

commit;

-- Controllo: la colonna c'e'.
select count(*) as categorie, count(*) filter (where padre_id is not null) as sottocategorie from incassi_categorie;
