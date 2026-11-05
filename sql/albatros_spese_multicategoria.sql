-- ============================================================
-- Albatros: lo scontrino con più categorie.
-- Da eseguire nell'SQL Editor di Supabase, una volta.
--
-- Prima una spesa aveva sempre una categoria in testata, e alcune categorie (la "Spesa bar") si
-- potevano aprire per scrivere le voci, ognuna con la sua categoria: la "Spesa bar" era insieme il
-- contenitore e una categoria, e il filtro le mescolava.
-- Adesso le categorie sono un solo livello, e una spesa è di due tipi:
--   multicategoria = false  una categoria in testata, niente dettaglio;
--   multicategoria = true   uno scontrino: la testata non ha categoria, le categorie stanno sulle
--                           voci; quello che non è ancora dettagliato è "da dettagliare".
-- Il filtro per categoria guarda la testata delle spese semplici e le voci degli scontrini.
--
-- Le spese che passano a scontrino: quelle che hanno già delle voci, e quelle di una categoria
-- dettagliabile (la "Spesa bar"). Le loro voci senza categoria prendono quella che aveva la testata,
-- così nessun importo cambia categoria. Le spese arrivate dal conto BFM (spesa_bfm_id) restano
-- semplici: la loro categoria la decide il modulo Spese.
-- La colonna albatros_categorie.dettagliabile non serve più: resta, ma l'app non la legge.
-- (Niente tabelle temporanee: l'SQL Editor non le tiene da un'istruzione all'altra.)
-- ============================================================

begin;
set local lock_timeout = '3s';

alter table albatros_spese add column if not exists multicategoria boolean not null default false;

-- 1. Le voci senza categoria prendono quella della testata (prima che la testata la perda).
update albatros_spese_righe r
set categoria_id = s.categoria_id
from albatros_spese s
where r.spesa_id = s.id
  and r.categoria_id is null
  and s.spesa_bfm_id is null
  and not s.multicategoria;

-- 2. Diventano scontrini le spese con delle voci e quelle di una categoria dettagliabile.
update albatros_spese s
set multicategoria = true, categoria_id = null
where s.spesa_bfm_id is null
  and not s.multicategoria
  and (exists (select 1 from albatros_spese_righe r where r.spesa_id = s.id)
       or exists (select 1 from albatros_categorie c where c.id = s.categoria_id and c.dettagliabile));

commit;

-- Controllo: quanti scontrini e quanto resta da dettagliare.
select count(*) as scontrini,
       sum(s.importo) as totale,
       sum(s.importo - coalesce((select sum(r.importo) from albatros_spese_righe r where r.spesa_id = s.id), 0)) as da_dettagliare
from albatros_spese s
where s.multicategoria;
