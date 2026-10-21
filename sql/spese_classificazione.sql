-- ============================================================
-- Spese: la classificazione a tre livelli, al posto di categoria + centro di costo.
-- Da eseguire nell'SQL Editor di Supabase, dopo sql/spese_banca.sql.
--
-- Ogni spesa si classifica in quest'ordine:
--   1. ente       'bfm' | 'albatros'. Una spesa di Albatros prende una categoria di Albatros
--                 (albatros_categoria_id) e compare anche fra le spese di Albatros, pagata da BFM.
--   2. natura     solo per BFM: 'operativa' se e' un costo che un altro modulo gia' conosce e che
--                 andra' riconciliato -- operativa = 'bubbler' (compensi), 'campo' (affitti),
--                 'fornitore' (noleggi e servizi), con la controparte se si riconosce --
--                 oppure 'generale'.
--   3. categoria  solo per le generali: una voce di un albero a due livelli (categoria >
--                 sottocategoria), scelta sempre all'ultimo livello.
--
-- I centri di costo spariscono: il centro di Albatros diventa ente = 'albatros'. Le categorie di
-- partenza messe da spese_banca.sql si tolgono: l'albero lo costruisce chi usa l'app. Le spese che
-- le avevano restano generali, con la categoria da scegliere; quelle dei compensi diventano
-- operative.
--
-- DISTRUTTIVA: cancella la tabella spese_centri e le colonne centro_id. Le regole perdono la
-- categoria se era una di quelle di partenza.
-- ============================================================

begin;
set local lock_timeout = '3s';

-- ------------------------------------------------------------
-- CATEGORIE A DUE LIVELLI. Una categoria senza padre e' di primo livello; una sottocategoria ha
-- per padre una di primo livello. Il nome e' unico fra le sorelle, non in tutto l'albero: "Altro"
-- puo' stare sotto piu' categorie.
-- ------------------------------------------------------------
alter table spese_categorie add column if not exists padre_id bigint references spese_categorie(id) on delete restrict;
drop index if exists spese_categorie_nome_idx;
create unique index if not exists spese_categorie_nome_idx on spese_categorie (coalesce(padre_id, 0), lower(btrim(nome)));
create index if not exists spese_categorie_padre_idx on spese_categorie (padre_id);

create or replace function riservato.spese_categorie_due_livelli() returns trigger
language plpgsql as $$
begin
  if new.padre_id is not null and new.padre_id = new.id then
    raise exception 'Una categoria non puo'' stare sotto se stessa.';
  end if;
  if new.padre_id is not null and exists (select 1 from public.spese_categorie where id = new.padre_id and padre_id is not null) then
    raise exception 'Le categorie hanno due livelli: una sottocategoria non puo'' averne altre sotto.';
  end if;
  if new.padre_id is not null and exists (select 1 from public.spese_categorie where padre_id = new.id) then
    raise exception 'Questa categoria ha gia'' delle sottocategorie: non puo'' diventarne una.';
  end if;
  return new;
end $$;
drop trigger if exists spese_categorie_due_livelli on spese_categorie;
create trigger spese_categorie_due_livelli before insert or update of padre_id on spese_categorie
  for each row execute function riservato.spese_categorie_due_livelli();

-- ------------------------------------------------------------
-- SPESE: ente, natura, tipo operativo e controparte.
-- controparte_id e' testo, senza foreign key, come in pagamenti e fatture: utenti.id per un
-- bubbler, pren_campi.id per un campo, sedi.id per un fornitore.
-- ------------------------------------------------------------
alter table spese add column if not exists ente text check (ente in ('bfm', 'albatros'));
alter table spese add column if not exists natura text check (natura in ('generale', 'operativa'));
alter table spese add column if not exists operativa text check (operativa in ('bubbler', 'campo', 'fornitore'));
alter table spese add column if not exists controparte_id text;

alter table spese_regole add column if not exists ente text check (ente in ('bfm', 'albatros'));
alter table spese_regole add column if not exists natura text check (natura in ('generale', 'operativa'));
alter table spese_regole add column if not exists operativa text check (operativa in ('bubbler', 'campo', 'fornitore'));
alter table spese_regole add column if not exists albatros_categoria_id bigint references albatros_categorie(id) on delete set null;
-- La regola vale solo se nel movimento si riconosce la controparte (il bubbler, il campo, il
-- fornitore). Prende il posto di beneficiario_bubbler, che valeva solo per i bubbler.
alter table spese_regole add column if not exists richiede_controparte boolean not null default false;

-- Conversione, solo se c'e' ancora quello da convertire (ripetibile).
do $$
declare
  partenza text[] := array['Compensi bubbler', 'Affitti campi', 'Affitto sede', 'Fornitori e noleggi', 'Materiali',
    'Software e hosting', 'Utenze', 'Imposte e contributi', 'Oneri bancari', 'Rimborsi note spese',
    'Consulenze e notaio', 'Rappresentanza', 'Altro'];
begin
  if exists (select 1 from information_schema.columns where table_name = 'spese' and column_name = 'centro_id') then
    -- Il centro di Albatros diventa l'ente; ogni altro centro vuol dire BFM.
    update spese s set ente = case when c.albatros then 'albatros' else 'bfm' end
      from spese_centri c where c.id = s.centro_id and s.ente is null;
    update spese_regole r set ente = case when c.albatros then 'albatros' else 'bfm' end
      from spese_centri c where c.id = r.centro_id and r.ente is null;
  end if;

  -- Le categorie che dicevano un costo gia' gestito altrove diventano la natura operativa.
  update spese s set ente = coalesce(s.ente, 'bfm'), natura = 'operativa',
         operativa = case c.nome when 'Compensi bubbler' then 'bubbler' when 'Affitti campi' then 'campo' else 'fornitore' end
    from spese_categorie c
   where c.id = s.categoria_id and c.nome in ('Compensi bubbler', 'Affitti campi', 'Fornitori e noleggi') and s.ente is distinct from 'albatros';
  update spese_regole r set ente = coalesce(r.ente, 'bfm'), natura = 'operativa',
         operativa = case c.nome when 'Compensi bubbler' then 'bubbler' when 'Affitti campi' then 'campo' else 'fornitore' end
    from spese_categorie c
   where c.id = r.categoria_id and c.nome in ('Compensi bubbler', 'Affitti campi', 'Fornitori e noleggi') and r.ente is distinct from 'albatros';
  -- Le altre di partenza: spese generali di BFM, con la categoria da scegliere nell'albero nuovo.
  update spese s set ente = coalesce(s.ente, 'bfm'), natura = 'generale'
    from spese_categorie c where c.id = s.categoria_id and c.nome = any(partenza) and s.natura is null and s.ente is distinct from 'albatros';
  update spese_regole r set ente = coalesce(r.ente, 'bfm'), natura = 'generale'
    from spese_categorie c where c.id = r.categoria_id and c.nome = any(partenza) and r.natura is null and r.ente is distinct from 'albatros';

  if exists (select 1 from information_schema.columns where table_name = 'spese_regole' and column_name = 'beneficiario_bubbler') then
    update spese_regole set richiede_controparte = true, ente = coalesce(ente, 'bfm'), natura = 'operativa', operativa = 'bubbler'
     where beneficiario_bubbler;
    alter table spese_regole drop column beneficiario_bubbler;
  end if;

  -- Via le categorie di partenza (solo quelle senza sottocategorie: se qualcuno le ha gia'
  -- trasformate in un ramo dell'albero, restano).
  update spese set categoria_id = null
   where categoria_id in (select id from spese_categorie c where c.nome = any(partenza) and c.padre_id is null
                            and not exists (select 1 from spese_categorie f where f.padre_id = c.id));
  update spese_regole set categoria_id = null
   where categoria_id in (select id from spese_categorie c where c.nome = any(partenza) and c.padre_id is null
                            and not exists (select 1 from spese_categorie f where f.padre_id = c.id));
  delete from spese_categorie c where c.nome = any(partenza) and c.padre_id is null
     and not exists (select 1 from spese_categorie f where f.padre_id = c.id);
end $$;

-- Una spesa di Albatros non ha natura ne' categoria di BFM.
update spese set natura = null, operativa = null, controparte_id = null, categoria_id = null where ente = 'albatros';
update spese_regole set natura = null, operativa = null, categoria_id = null where ente = 'albatros';
-- E una non operativa non ha tipo ne' controparte.
update spese set operativa = null, controparte_id = null where natura is distinct from 'operativa';
update spese_regole set operativa = null, richiede_controparte = false where natura is distinct from 'operativa';

alter table spese drop column if exists centro_id;
alter table spese_regole drop column if exists centro_id;
drop table if exists spese_centri;

commit;

-- Controllo: come sono classificate le spese, e quante regole per tipo di classificazione.
select ente, natura, operativa, count(*) as spese, count(categoria_id) as con_categoria
  from spese group by ente, natura, operativa order by ente, natura, operativa;
select ente, natura, operativa, count(*) as regole from spese_regole group by ente, natura, operativa order by ente, natura, operativa;
