-- ============================================================
-- Albatros: le spese le paga uno dei tre enti (Albatros, BFM, Lama).
-- Da eseguire nell'SQL Editor di Supabase, dopo sql/albatros_semplifica.sql.
--
-- Al posto di "pagata con" (cassa, carta, bonifico, di tasca), di chi l'ha anticipata e del
-- rimborso, ogni spesa dice solo quale ente l'ha pagata. L'elenco degli enti sta nell'app
-- (src/moduli/albatros/calcolo.js), non nel database.
--
-- Le spese gia' scritte vanno ad Albatros.
-- ATTENZIONE: cancella definitivamente metodo di pagamento, chi aveva anticipato e rimborsi.
-- ============================================================

begin;
set local lock_timeout = '3s';

alter table albatros_spese add column if not exists ente text not null default 'albatros';

-- Con le colonne se ne va anche il vincolo che chiedeva "pagata da" sulle spese anticipate.
alter table albatros_spese drop column if exists pagata_con;
alter table albatros_spese drop column if exists pagata_da;
alter table albatros_spese drop column if exists rimborsata_il;

commit;

select ente, count(*) as spese from albatros_spese group by ente;
