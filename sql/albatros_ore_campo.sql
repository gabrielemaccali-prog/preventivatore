-- ============================================================
-- Albatros: le ore campo delle voci del listino.
-- Da eseguire nell'SQL Editor di Supabase, una volta (si può rieseguire).
--
-- Una voce del listino (es. "Campo 1h", "Festa con campo 2h") dice quante ore di campo vale una
-- sua vendita e se è a tariffa speciale (sconto). Il Cruscotto somma quantità × ore delle giornate
-- chiuse. Le ore si chiedono solo nelle categorie con ore_campo acceso (e nelle loro
-- sottocategorie): qui Campi e Feste, poi si cambia dal Configuratore del listino.
-- ============================================================

alter table albatros_listino add column if not exists ore_campo numeric(5,2) check (ore_campo is null or ore_campo >= 0);
alter table albatros_listino add column if not exists tariffa_speciale boolean not null default false;
alter table albatros_categorie add column if not exists ore_campo boolean not null default false;

update albatros_categorie set ore_campo = true
 where tipo = 'listino' and padre_id is null and lower(btrim(nome)) in ('campi', 'feste');

-- Controllo
select c.nome as categoria, c.ore_campo, l.nome as voce, l.ore_campo as ore, l.tariffa_speciale
from albatros_categorie c left join albatros_listino l on l.categoria_id = c.id
where c.tipo = 'listino' and c.ore_campo
order by c.ordine, l.nome;
