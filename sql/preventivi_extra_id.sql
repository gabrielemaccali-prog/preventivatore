-- ============================================================
-- I preventivi salvati ritrovano l'extra per id, non per nome.
-- Da eseguire nell'SQL Editor di Supabase.
--
-- Ultimo riferimento testuale rimasto nel database. preventivi.extras è un array json, una riga
-- per extra venduto, che porta scritto il nome dell'extra. Quel nome va tenuto — è cio' che il
-- preventivo dice al cliente, e va letto come era il giorno dell'emissione — ma l'applicazione
-- lo usava anche per ritrovare l'extra in anagrafica alla riapertura del preventivo.
--
-- Qui non c'è niente da recuperare: le due sole righe esistenti si risolvono ancora, perché
-- nessuno ha ancora rinominato un extra. È prevenzione, ed è la stessa cura già data alle sedi
-- con sql/preventivi_sede_id.sql: accanto al nome si aggiunge "extraId".
--
-- La rottura, se arrivasse, sarebbe mite ma silenziosa: l'extra sparirebbe dal preventivo
-- riaperto — via la riga, via il suo prezzo di vendita dal totale ricostruito — senza nessun
-- errore. Non falsa i costi come faceva la sede, ma toglie una voce senza dirlo.
-- ============================================================

-- ------------------------------------------------------------
-- 1) PRIMA — quali extra sono scritti nei preventivi e se esistono ancora in anagrafica.
--    Atteso oggi: 2 righe, entrambe "Pernotto", entrambe con un id trovato.
-- ------------------------------------------------------------
select p.codice,
       e->>'nome' as extra_scritto,
       x.id       as extra_id,
       e->>'extraId' as id_gia_presente
  from preventivi p,
       lateral jsonb_array_elements(p.extras::jsonb) e
       left join extras x on x.nome = e->>'nome'
 where jsonb_typeof(p.extras::jsonb) = 'array'
 order by p.codice;

-- ------------------------------------------------------------
-- 2) L'AGGIUNTA dell'id.
--    Le righe il cui nome non corrisponde a nessun extra restano come sono: non c'è niente da
--    cui ricavare l'id, e inventarlo sarebbe peggio che lasciarlo vuoto. Il blocco è dinamico
--    perché la colonna può essere json, jsonb o text a seconda di come è nata.
--    Rieseguibile senza danni: sulle righe già a posto riscrive lo stesso valore.
-- ------------------------------------------------------------
do $$
declare tipo_colonna text;
begin
  select data_type into tipo_colonna
    from information_schema.columns
   where table_schema = 'public' and table_name = 'preventivi' and column_name = 'extras';

  execute format(
    'update preventivi p
        set extras = (
              select jsonb_agg(
                       case when x.id is null then e
                            else e || jsonb_build_object(''extraId'', to_jsonb(x.id)) end
                       order by ord)
                from jsonb_array_elements(p.extras::jsonb) with ordinality as t(e, ord)
                left join extras x on x.nome = e->>''nome''
            )::%s
      where jsonb_typeof(p.extras::jsonb) = ''array''
        and jsonb_array_length(p.extras::jsonb) > 0',
    tipo_colonna
  );
end $$;

-- ------------------------------------------------------------
-- 3) DOPO — ogni riga deve avere un extraId che punta a un extra esistente.
--    La prima query non deve restituire righe; la seconda mostra il risultato.
-- ------------------------------------------------------------
select p.codice, e->>'nome' as extra_senza_id
  from preventivi p, lateral jsonb_array_elements(p.extras::jsonb) e
 where jsonb_typeof(p.extras::jsonb) = 'array'
   and (e->>'extraId' is null
        or not exists (select 1 from extras x where x.id = e->>'extraId'));

select p.codice, e->>'nome' as nome_sul_preventivo, x.nome as nome_in_anagrafica, e->>'extraId' as extra_id
  from preventivi p,
       lateral jsonb_array_elements(p.extras::jsonb) e
       join extras x on x.id = e->>'extraId'
 where jsonb_typeof(p.extras::jsonb) = 'array'
 order by p.codice;
