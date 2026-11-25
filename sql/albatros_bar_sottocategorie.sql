-- ============================================================
-- Albatros: il bar diviso in sottocategorie, uguali per le spese e per gli incassi.
-- Da eseguire nell'SQL Editor di Supabase, una volta, dopo sql/albatros_categorie_due_livelli.sql.
--
-- SPESE
--   Principale "Spesa bar", in cima all'elenco, con le secondarie: Birre, Bibite e acqua, Energy e
--   sport drink, Cocktail e alcolici, Snack e dolci, Cibo, Caffetteria, Altro.
--   Le voci degli scontrini (e le spese intere) delle categorie "Spesa bar" / "Bar" di prima vanno
--   alla secondaria giusta, letta dalla descrizione; inoltre:
--     ghiaccio                                   -> Spesa bar > Cocktail e alcolici
--     bicchieri, piatti, tovaglioli, guanti,
--     vassoi, forbici, macchina del ghiaccio     -> Materiali > Bar
--     "iva"                                      -> Tasse e imposte > IVA
--     quelle dubbie (andrea, altro, evento,
--     ordine bar) e quelle non riconosciute      -> Spesa bar > Altro
--   Le categorie di prima rimaste vuote si archiviano.
-- INCASSI (listino)
--   La categoria "Bar" del listino diventa principale, con le stesse secondarie (stessa icona,
--   niente acconti), e le voci del listino del bar vanno alla secondaria giusta. Così nel Cruscotto
--   spese e incassi di ogni secondaria si mettono a confronto.
-- Ogni categoria si cerca per nome e si crea se non c'è: lo script si può rieseguire.
-- ============================================================

begin;

do $$
declare
  secondarie text[] := array['Birre', 'Bibite e acqua', 'Energy e sport drink', 'Cocktail e alcolici', 'Snack e dolci', 'Cibo', 'Caffetteria', 'Altro'];
  nome_sec text;
  spesa_bar bigint; materiali bigint; mat_bar bigint; tasse bigint; iva bigint;
  lis_bar bigint; lis_icona text;
  sec jsonb := '{}'; lsec jsonb := '{}';
  vecchie bigint[];
  r record;
  dest bigint;
  id_cat bigint;
begin
  -- --- SPESE ---
  -- Una secondaria "Spesa bar" di primo livello prenderebbe il nome della principale nuova: si rinomina.
  update albatros_categorie set nome = nome || ' (vecchia)'
   where tipo = 'spesa' and not gruppo and padre_id is null and lower(btrim(nome)) = 'spesa bar'
     and not exists (select 1 from albatros_categorie where tipo = 'spesa' and gruppo and lower(btrim(nome)) = 'spesa bar');

  select id into spesa_bar from albatros_categorie where tipo = 'spesa' and gruppo and lower(btrim(nome)) = 'spesa bar' limit 1;
  if spesa_bar is null then
    insert into albatros_categorie (tipo, nome, gruppo, padre_id, ordine, attiva) values ('spesa', 'Spesa bar', true, null, 0, true) returning id into spesa_bar;
  end if;
  -- In cima alle principali.
  update albatros_categorie set ordine = (select coalesce(min(ordine), 1) - 1 from albatros_categorie where tipo = 'spesa' and gruppo and id <> spesa_bar), attiva = true
   where id = spesa_bar;

  foreach nome_sec in array secondarie loop
    select id into id_cat from albatros_categorie where tipo = 'spesa' and padre_id = spesa_bar and lower(btrim(nome)) = lower(nome_sec);
    if id_cat is null then
      insert into albatros_categorie (tipo, nome, gruppo, padre_id, ordine, attiva)
      values ('spesa', nome_sec, false, spesa_bar, array_position(secondarie, nome_sec), true) returning id into id_cat;
    end if;
    sec := sec || jsonb_build_object(nome_sec, id_cat);
  end loop;

  -- Materiali > Bar
  select id into materiali from albatros_categorie where tipo = 'spesa' and gruppo and lower(btrim(nome)) = 'materiali' limit 1;
  if materiali is null then
    insert into albatros_categorie (tipo, nome, gruppo, padre_id, ordine, attiva)
    values ('spesa', 'Materiali', true, null, (select coalesce(max(ordine), 0) + 1 from albatros_categorie where tipo = 'spesa' and gruppo), true) returning id into materiali;
  end if;
  select id into mat_bar from albatros_categorie where tipo = 'spesa' and not gruppo and padre_id = materiali and lower(btrim(nome)) = 'bar' limit 1;
  if mat_bar is null then
    insert into albatros_categorie (tipo, nome, gruppo, padre_id, ordine, attiva)
    values ('spesa', 'Bar', false, materiali, (select coalesce(max(ordine), 0) + 1 from albatros_categorie where tipo = 'spesa' and padre_id = materiali), true) returning id into mat_bar;
  end if;

  -- Tasse e imposte > IVA
  select id into tasse from albatros_categorie where tipo = 'spesa' and gruppo and lower(btrim(nome)) = 'tasse e imposte' limit 1;
  if tasse is null then
    insert into albatros_categorie (tipo, nome, gruppo, padre_id, ordine, attiva)
    values ('spesa', 'Tasse e imposte', true, null, (select coalesce(max(ordine), 0) + 1 from albatros_categorie where tipo = 'spesa' and gruppo), true) returning id into tasse;
  end if;
  select id into iva from albatros_categorie where tipo = 'spesa' and not gruppo and padre_id = tasse and lower(btrim(nome)) = 'iva' limit 1;
  if iva is null then
    insert into albatros_categorie (tipo, nome, gruppo, padre_id, ordine, attiva)
    values ('spesa', 'IVA', false, tasse, (select coalesce(max(ordine), 0) + 1 from albatros_categorie where tipo = 'spesa' and padre_id = tasse), true) returning id into iva;
  end if;

  -- Le categorie del bar di prima: le secondarie "Spesa bar" e "Bar" che non sono quelle nuove.
  select array_agg(id) into vecchie from albatros_categorie
   where tipo = 'spesa' and not gruppo and id <> mat_bar and coalesce(padre_id, 0) <> spesa_bar
     and lower(btrim(nome)) in ('spesa bar', 'spesa bar (vecchia)', 'bar');
  vecchie := coalesce(vecchie, '{}');

  -- Dove va una descrizione: l'ordine conta (la macchina del ghiaccio prima del ghiaccio, le voci
  -- dubbie prima del cibo, gli energy drink prima delle bibite).
  for r in
    select 'riga' as dove, id, lower(btrim(descrizione)) as d from albatros_spese_righe where categoria_id = any(vecchie)
    union all
    select 'spesa', id, lower(btrim(descrizione)) from albatros_spese where categoria_id = any(vecchie) and not coalesce(multicategoria, false)
  loop
    dest := case
      when r.d ~ '^iva$' then iva
      when r.d ~ '(macchina ghiaccio|adattatore|bicchier|piatt|tovagliol|guanti|vassoi|forbici)' then mat_bar
      when r.d ~ '(evento|andrea|^altro$|ordine bar)' then (sec->>'Altro')::bigint
      when r.d ~ 'ghiaccio' then (sec->>'Cocktail e alcolici')::bigint
      when r.d ~ '(birr|ichinusa|ichnusa|heineken|corona)' then (sec->>'Birre')::bigint
      when r.d ~ '(redbull|red bull|monster|powerade|gatorade|enervit)' then (sec->>'Energy e sport drink')::bigint
      when r.d ~ '(focacc|prosciutt|formaggi|toast|cibo)' then (sec->>'Cibo')::bigint
      when r.d ~ '(alcolic|campari|aperol|\mgin\M|spumant|vino|prosecco|amaro)' then (sec->>'Cocktail e alcolici')::bigint
      when r.d ~ '(acqua|coca|lattin|bibit|estath|estate|crodino|tonica)' then (sec->>'Bibite e acqua')::bigint
      when r.d ~ '(patatin|pringles|pop ?corn|doritos|caramell|haribo|kit kat|m&m|mems|kinder|arachid|fiorentini|snack)' then (sec->>'Snack e dolci')::bigint
      when r.d ~ '(caff|capsul|cialde)' then (sec->>'Caffetteria')::bigint
      else (sec->>'Altro')::bigint
    end;
    if r.dove = 'riga' then
      update albatros_spese_righe set categoria_id = dest where id = r.id;
    else
      update albatros_spese set categoria_id = dest where id = r.id;
    end if;
  end loop;

  -- Le categorie di prima rimaste senza spese né voci si archiviano.
  update albatros_categorie c set attiva = false
   where c.id = any(vecchie)
     and not exists (select 1 from albatros_spese s where s.categoria_id = c.id)
     and not exists (select 1 from albatros_spese_righe v where v.categoria_id = c.id);

  -- --- INCASSI (listino) ---
  select id, icona into lis_bar, lis_icona from albatros_categorie where tipo = 'listino' and padre_id is null and lower(btrim(nome)) = 'bar' limit 1;
  if lis_bar is not null then
    update albatros_categorie set gruppo = true where id = lis_bar;
    foreach nome_sec in array secondarie loop
      select id into id_cat from albatros_categorie where tipo = 'listino' and padre_id = lis_bar and lower(btrim(nome)) = lower(nome_sec);
      if id_cat is null then
        insert into albatros_categorie (tipo, nome, gruppo, padre_id, ordine, attiva, icona)
        values ('listino', nome_sec, false, lis_bar, array_position(secondarie, nome_sec), true, lis_icona) returning id into id_cat;
        -- Niente acconti sulle voci del bar, se la colonna c'è (sql/albatros_acconti.sql).
        if exists (select 1 from information_schema.columns where table_name = 'albatros_categorie' and column_name = 'acconti') then
          execute 'update albatros_categorie set acconti = false where id = $1' using id_cat;
        end if;
      end if;
      lsec := lsec || jsonb_build_object(nome_sec, id_cat);
    end loop;

    for r in select id, lower(btrim(nome)) as d from albatros_listino where categoria_id = lis_bar loop
      dest := case
        when r.d ~ 'birr' then (lsec->>'Birre')::bigint
        when r.d ~ '(gatorade|redbull|red bull|monster|powerade)' then (lsec->>'Energy e sport drink')::bigint
        when r.d ~ '(drink|spritz|\mgin\M|amaro|shot|prosecco|vino|calice)' then (lsec->>'Cocktail e alcolici')::bigint
        when r.d ~ '(acqua|lattin|\mthe\M|tè|coca|bibit)' then (lsec->>'Bibite e acqua')::bigint
        when r.d ~ '(patatin|pringles|kit kat|caramell|m&m|barrett|snack)' then (lsec->>'Snack e dolci')::bigint
        when r.d ~ '(focacc|toast|pasta|panin)' then (lsec->>'Cibo')::bigint
        when r.d ~ '(caff|cappucc)' then (lsec->>'Caffetteria')::bigint
        else (lsec->>'Altro')::bigint
      end;
      update albatros_listino set categoria_id = dest where id = r.id;
    end loop;
  end if;
end $$;

commit;

-- Controllo: le categorie del bar con quanto c'è dentro.
select c.tipo, coalesce(p.nome || ' › ', '') || c.nome as categoria, c.attiva,
       (select count(*) from albatros_spese s where s.categoria_id = c.id) as spese,
       (select count(*) from albatros_spese_righe v where v.categoria_id = c.id) as voci_scontrino,
       (select count(*) from albatros_listino l where l.categoria_id = c.id) as voci_listino
from albatros_categorie c
left join albatros_categorie p on p.id = c.padre_id
where c.nome ilike '%bar%' or p.nome ilike '%bar%' or c.nome ilike 'iva' or c.nome ilike '%vecchia%'
order by c.tipo, p.nome nulls first, c.ordine;
