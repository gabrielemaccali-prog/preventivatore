-- ============================================================
-- Albatros: le commissioni bancarie in Servizi accessori › Banca.
-- Da eseguire nell'SQL Editor di Supabase (si può rieseguire).
-- Crea la principale "Servizi accessori" e la secondaria "Banca" se mancano, e ci sposta spese e
-- voci che stavano in una categoria "Oneri bancari" / "Commissioni bancarie" (poi archiviata se vuota).
-- ============================================================

begin;

do $$
declare
  servizi bigint; banca bigint; vecchie bigint[];
begin
  select id into servizi from albatros_categorie where tipo = 'spesa' and gruppo and lower(btrim(nome)) = 'servizi accessori' limit 1;
  if servizi is null then
    insert into albatros_categorie (tipo, nome, gruppo, padre_id, ordine, attiva)
    values ('spesa', 'Servizi accessori', true, null, (select coalesce(max(ordine), 0) + 1 from albatros_categorie where tipo = 'spesa' and gruppo), true)
    returning id into servizi;
  end if;
  select id into banca from albatros_categorie where tipo = 'spesa' and not gruppo and padre_id = servizi and lower(btrim(nome)) = 'banca' limit 1;
  if banca is null then
    insert into albatros_categorie (tipo, nome, gruppo, padre_id, ordine, attiva)
    values ('spesa', 'Banca', false, servizi, (select coalesce(max(ordine), 0) + 1 from albatros_categorie where tipo = 'spesa' and padre_id = servizi), true)
    returning id into banca;
  end if;
  update albatros_categorie set attiva = true where id in (servizi, banca);

  select coalesce(array_agg(id), '{}') into vecchie from albatros_categorie
   where tipo = 'spesa' and not gruppo and id <> banca and (nome ~* 'oneri bancari' or nome ~* 'commissioni bancarie');
  update albatros_spese set categoria_id = banca where categoria_id = any(vecchie);
  update albatros_spese_righe set categoria_id = banca where categoria_id = any(vecchie);
  update albatros_categorie c set attiva = false where c.id = any(vecchie)
    and not exists (select 1 from albatros_spese s where s.categoria_id = c.id)
    and not exists (select 1 from albatros_spese_righe v where v.categoria_id = c.id);
end $$;

commit;

-- Controllo
select coalesce(p.nome || ' › ', '') || c.nome as categoria, c.attiva,
       (select count(*) from albatros_spese s where s.categoria_id = c.id) as spese,
       (select count(*) from albatros_spese_righe v where v.categoria_id = c.id) as voci
from albatros_categorie c left join albatros_categorie p on p.id = c.padre_id
where c.tipo = 'spesa' and (c.nome ~* 'oneri|commissioni' or (c.nome ilike 'banca' and p.nome ilike 'servizi accessori'));
