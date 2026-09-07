-- ============================================================
-- I preventivi salvati ritrovano sede e gonfiabile per id, non per nome.
-- Da eseguire nell'SQL Editor di Supabase.
--
-- preventivi.gonfiabili è un array json, una riga per gioco quotato, che porta scritti il nome
-- del gioco e il nome della sede di partenza. Quei due nomi vanno tenuti: sono ciò che il
-- preventivo dice al cliente, e vanno letti come erano il giorno dell'emissione. Il problema è
-- che l'app li usava anche come chiave per ritrovare l'anagrafica quando il preventivo viene
-- riaperto, e le sedi nel frattempo sono state rinominate:
--
--   "BFM - Milano"         31 righe    ->  "BFM"
--   "Ezio - Bergamo"       25 righe    ->  "Laquilone"
--   "Giancarlo - Scandicci" 12 righe   ->  "Giancarlo"
--
-- 68 righe su 201, sparse su 44 preventivi dei 131 salvati. Riaprendoli l'app non trovava più
-- la sede: le 31 righe che partivano da Milano perdevano il flag "sede di proprietà" (e quindi
-- il costo di noleggio, che per le sedi nostre è zero, tornava a essere conteggiato), e per 26
-- righe la scheda tecnica veniva ripescata da un'istanza qualsiasi dello stesso gioco.
--
-- Questa migrazione non cambia i nomi. Aggiunge accanto "sedeId" e "gonfiabileId", che sono
-- quello che l'app userà d'ora in poi per ritrovare l'anagrafica.
-- ============================================================

-- ------------------------------------------------------------
-- 1) PRIMA — quante righe per ogni nome di sede scritto nei preventivi, e se quel nome esiste
--    ancora in anagrafica. Serve a confermare che le tre rinomine siano ancora quelle attese.
-- ------------------------------------------------------------
select e->>'sedePartenza' as sede_scritta,
       count(*) as righe,
       count(distinct p.codice) as preventivi,
       max(s.nome) as trovata_in_anagrafica
  from preventivi p,
       lateral jsonb_array_elements(p.gonfiabili::jsonb) e
       left join sedi s on s.nome = e->>'sedePartenza'
 where jsonb_typeof(p.gonfiabili::jsonb) = 'array'
   and coalesce(e->>'sedePartenza', '') not in ('', '—')
 group by 1 order by 2 desc;

-- ------------------------------------------------------------
-- 2) LA MAPPATURA delle sedi che non esistono più, confermata dal committente.
--    Vive in una tabella temporanea invece che sparsa nel codice: si legge in un colpo solo,
--    ed è l'unico punto da correggere se una corrispondenza è sbagliata.
-- ------------------------------------------------------------
create temporary table mappa_sedi (nome_vecchio text primary key, nome_nuovo text not null);
insert into mappa_sedi values
  ('BFM - Milano',          'BFM'),
  ('Ezio - Bergamo',        'Laquilone'),
  ('Giancarlo - Scandicci', 'Giancarlo');

-- Ogni nome nuovo deve esistere davvero in anagrafica, altrimenti si riempirebbe di null.
do $$
declare mancanti text;
begin
  select string_agg(m.nome_nuovo, ', ') into mancanti
    from mappa_sedi m where not exists (select 1 from sedi s where s.nome = m.nome_nuovo);
  if mancanti is not null then
    raise exception 'Queste sedi non esistono in anagrafica: %', mancanti;
  end if;
end $$;

-- ------------------------------------------------------------
-- 3) L'AGGIUNTA degli id.
--    La sede si risolve prima per nome attuale, poi passando dalla mappa. Il gonfiabile si
--    risolve per nome + sede, che è l'istanza giusta: lo stesso gioco esiste presso più
--    fornitori a prezzi diversi, ed è quella la coppia che identifica la riga quotata.
--    Le righe senza sede (83, i preventivi vecchi in cui il campo non c'era) restano senza id:
--    non c'è niente da cui ricavarlo, e inventarlo sarebbe peggio che lasciarlo vuoto.
-- ------------------------------------------------------------
do $$
declare tipo_colonna text;
begin
  select data_type into tipo_colonna
    from information_schema.columns
   where table_schema = 'public' and table_name = 'preventivi' and column_name = 'gonfiabili';

  execute format(
    'update preventivi p
        set gonfiabili = (
              select jsonb_agg(
                       case when s.id is null then e
                            else e || jsonb_strip_nulls(jsonb_build_object(
                                        ''sedeId'', to_jsonb(s.id),
                                        ''gonfiabileId'', to_jsonb(g.id)))
                       end
                       order by ord)
                from jsonb_array_elements(p.gonfiabili::jsonb) with ordinality as t(e, ord)
                left join sedi s
                  on s.nome = e->>''sedePartenza''
                  or s.nome = (select m.nome_nuovo from mappa_sedi m where m.nome_vecchio = e->>''sedePartenza'')
                left join gonfiabili g
                  on g.nome = e->>''nome'' and g."locationId" = s.id
            )::%s
      where jsonb_typeof(p.gonfiabili::jsonb) = ''array''
        and jsonb_array_length(p.gonfiabili::jsonb) > 0',
    tipo_colonna
  );
end $$;

-- Il gioco in offerta è uno snapshot a sé, con la stessa forma: stessa cura.
do $$
declare tipo_colonna text;
begin
  select data_type into tipo_colonna
    from information_schema.columns
   where table_schema = 'public' and table_name = 'preventivi' and column_name = 'giocoOfferta';

  execute format(
    'update preventivi p
        set "giocoOfferta" = (
              select p."giocoOfferta"::jsonb || jsonb_strip_nulls(jsonb_build_object(
                       ''sedeId'', to_jsonb(s.id), ''gonfiabileId'', to_jsonb(g.id)))
                from sedi s
                left join gonfiabili g
                  on g.nome = p."giocoOfferta"::jsonb->>''nome'' and g."locationId" = s.id
               where s.nome = p."giocoOfferta"::jsonb->>''sedePartenza''
                  or s.nome = (select m.nome_nuovo from mappa_sedi m
                                where m.nome_vecchio = p."giocoOfferta"::jsonb->>''sedePartenza'')
               limit 1
            )::%s
      where p."giocoOfferta" is not null
        and jsonb_typeof(p."giocoOfferta"::jsonb) = ''object''
        and coalesce(p."giocoOfferta"::jsonb->>''sedePartenza'', '''') <> ''''',
    tipo_colonna
  );
end $$;

-- ------------------------------------------------------------
-- 4) DOPO — il conto delle righe agganciate.
--    Atteso: 118 righe con sedeId (50 che già trovavano la sede + 68 recuperate dalla mappa)
--    e 83 senza, che sono quelle che la sede non l'hanno mai avuta.
-- ------------------------------------------------------------
select case
         when e->>'sedeId' is not null then 'sede agganciata'
         when coalesce(e->>'sedePartenza', '') in ('', '—') then 'nessuna sede nel preventivo'
         else 'DA GUARDARE: sede scritta ma non risolta'
       end as esito,
       count(*) as righe,
       count(*) filter (where e->>'gonfiabileId' is not null) as con_gonfiabile
  from preventivi p, lateral jsonb_array_elements(p.gonfiabili::jsonb) e
 where jsonb_typeof(p.gonfiabili::jsonb) = 'array'
 group by 1 order by 2 desc;

-- Se la riga "DA GUARDARE" esiste, qui si vede quali nomi sono rimasti fuori dalla mappa.
select distinct e->>'sedePartenza' as sede_non_risolta
  from preventivi p, lateral jsonb_array_elements(p.gonfiabili::jsonb) e
 where jsonb_typeof(p.gonfiabili::jsonb) = 'array'
   and e->>'sedeId' is null
   and coalesce(e->>'sedePartenza', '') not in ('', '—');
