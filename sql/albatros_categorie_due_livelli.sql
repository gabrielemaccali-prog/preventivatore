-- ============================================================
-- Albatros: le categorie delle spese a due livelli, come nel modulo Spese di BFM.
-- Da eseguire nell'SQL Editor di Supabase.
--
-- Le categorie che ci sono sono tutte secondarie: sono quelle a cui vanno le spese. Sopra si creano
-- le categorie principali (gruppo = true), che le raggruppano e a cui una spesa non va mai.
--   gruppo    true = categoria principale (un gruppo), false = secondaria
--   padre_id  la principale che contiene una secondaria; null = non ancora raggruppata (si usa
--             lo stesso, e il Configuratore la mostra fra quelle da raggruppare)
-- Spostare una secondaria sotto un'altra principale non cambia niente nelle spese che la usano.
-- Il nome è unico fra le sorelle (stesso tipo e stesso padre): "Altro" può stare sotto due
-- principali diverse. Le categorie del listino restano a un livello.
-- ============================================================

begin;
set local lock_timeout = '3s';

alter table albatros_categorie add column if not exists gruppo boolean not null default false;
alter table albatros_categorie add column if not exists padre_id bigint references albatros_categorie(id) on delete restrict;

drop index if exists albatros_categorie_nome_idx;
create unique index if not exists albatros_categorie_nome_idx on albatros_categorie (tipo, coalesce(padre_id, 0), lower(btrim(nome)));

commit;
