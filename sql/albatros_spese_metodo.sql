-- ============================================================
-- Albatros: con cosa Albatros paga una spesa.
-- Da eseguire nell'SQL Editor di Supabase.
--
-- metodo 'contanti' | 'carta' | 'da_pagare', per le spese di Albatros (per Lama e BFM resta vuoto).
-- Nel Cashflow le spese in contanti abbassano i contanti che Albatros ha in mano, quelle con carta
-- il conto (dove arrivano gli incassi POS).
-- Le spese di Albatros gia' inserite sono state pagate tutte in contanti; per Lama e BFM il
-- metodo non interessa e resta vuoto.
-- ============================================================

begin;
set local lock_timeout = '3s';

alter table albatros_spese add column if not exists metodo text;
update albatros_spese set metodo = 'contanti' where ente = 'albatros' and metodo is null;
update albatros_spese set metodo = null where ente is distinct from 'albatros';

commit;

select ente, metodo, count(*) as spese from albatros_spese group by ente, metodo order by ente, metodo;
