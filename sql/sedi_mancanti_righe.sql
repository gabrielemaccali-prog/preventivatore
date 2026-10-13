-- ============================================================
-- Preventivi e prenotazioni: righe rimaste senza sede di partenza
-- Da eseguire nell'SQL Editor di Supabase.
-- ============================================================

-- Alcune righe di preventivo sono state salvate con la sede vuota o a trattino: il nome della sede
-- era l'unico riferimento e si è perso (rinomina della sede, oppure righe scritte prima che venisse
-- salvato anche "sedeId"). La riga però conserva "gonfiabileId", e l'anagrafica dei gonfiabili sa da
-- quale sede parte ciascun articolo: è da lì che la sede si ricostruisce.
-- L'app ora fa la stessa cosa quando riapre un preventivo, così una riga riaperta e risalvata si
-- risana da sé; questo script sistema in blocco quelle già a database.

-- 1) Preventivi: sede e id ripresi dal gonfiabile a catalogo, solo dove la riga ne è priva.
update preventivi p
   set gonfiabili = (
     select jsonb_agg(
              case when coalesce(nullif(trim(g->>'sedePartenza'), ''), '—') = '—' and s.id is not null
                   then g || jsonb_build_object('sedeId', s.id, 'sedePartenza', s.nome)
                   else g end
              order by ord)
       from jsonb_array_elements(p.gonfiabili) with ordinality as t(g, ord)
       left join gonfiabili gg on gg.id = g->>'gonfiabileId'
       left join sedi s on s.id = gg."locationId"
   )
 where p.gonfiabili is not null
   and exists (
     select 1
       from jsonb_array_elements(p.gonfiabili) g2
       join gonfiabili gg2 on gg2.id = g2->>'gonfiabileId'
       join sedi s2 on s2.id = gg2."locationId"
      where coalesce(nullif(trim(g2->>'sedePartenza'), ''), '—') = '—'
   );

-- 2) Prenotazioni: le righe copiate dal preventivo riprendono la sede dal preventivo collegato,
--    che il passo 1 ha appena sistemato. Si abbina per nome dell'articolo.
update prenotazioni p
   set voci = (
     select jsonb_agg(
              case when coalesce(nullif(trim(v->>'sede'), ''), '—') = '—' and dal_preventivo.sede is not null
                   then v || jsonb_build_object('sede', dal_preventivo.sede)
                   else v end
              order by ord)
       from jsonb_array_elements(p.voci) with ordinality as t(v, ord)
       left join lateral (
         select g->>'sedePartenza' as sede
           from preventivi pv, jsonb_array_elements(pv.gonfiabili) g
          where pv.codice = p."preventivoCollegato"
            and g->>'nome' = v->>'nome'
            and coalesce(nullif(trim(g->>'sedePartenza'), ''), '—') <> '—'
          limit 1
       ) dal_preventivo on true
   )
 where p."preventivoCollegato" is not null
   and p.voci is not null
   and exists (
     select 1 from jsonb_array_elements(p.voci) v2
      where coalesce(nullif(trim(v2->>'sede'), ''), '—') = '—'
   );

-- Controllo: quante righe restano senza sede (quelle senza "gonfiabileId" non sono ricostruibili,
-- e vanno sistemate a mano riaprendo il preventivo e riscegliendo l'articolo).
-- select p.codice, g->>'nome' as articolo, g->>'gonfiabileId' as gonfiabile
--   from preventivi p, jsonb_array_elements(p.gonfiabili) g
--  where coalesce(nullif(trim(g->>'sedePartenza'), ''), '—') = '—'
--  order by p.codice;
