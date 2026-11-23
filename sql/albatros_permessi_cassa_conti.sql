-- ============================================================
-- Albatros: i permessi seguono il menu nuovo (Cassa, Conti, Listino con le loro viste).
-- Da eseguire nell'SQL Editor di Supabase, insieme al rilascio del codice.
--
-- Le viste di Cassa, Conti e Listino diventano sottoschede, e il Configuratore non è più una
-- scheda a sé ma una sottoscheda di Listino (categorie del listino) e di Conti (categorie delle
-- spese). Senza questo script chi oggi vede quelle pagine non vedrebbe più le loro viste, senza
-- nessun errore: qui ogni ruolo riceve le sottoschede di quello che vede già.
--   scheda 'spese' (Cassa)        -> cassa_spese, cassa_dettagliare, cassa_trasferimenti
--   scheda 'conti'                -> conti_spese, conti_incassi, conti_banca, conti_trasferimenti,
--                                    conti_cashflow, conti_contanti, conti_bfm
--   scheda 'listino'              -> listino_elenco
--   scheda 'configuratore'        -> listino_configuratore e conti_configuratore (con le schede
--                                    listino e conti, se non le aveva)
-- Le schede 'configuratore' e 'cashflow' e le sottoschede cashflow_* si tolgono: il codice non le
-- legge più. Si può rieseguire.
-- ============================================================

begin;

do $$
declare
  r record;
  schede text[];
  sotto text[];
begin
  for r in select id, permessi from ruoli where permessi ? 'albatros' loop
    schede := coalesce(array(select jsonb_array_elements_text(r.permessi->'albatros'->'schede')), '{}');
    sotto := coalesce(array(select jsonb_array_elements_text(r.permessi->'albatros'->'sottoschede')), '{}');

    if 'spese' = any(schede) then
      sotto := sotto || array['cassa_spese', 'cassa_dettagliare', 'cassa_trasferimenti'];
    end if;
    if 'conti' = any(schede) then
      sotto := sotto || array['conti_spese', 'conti_incassi', 'conti_banca', 'conti_trasferimenti', 'conti_cashflow', 'conti_contanti', 'conti_bfm'];
    end if;
    if 'listino' = any(schede) then
      sotto := sotto || array['listino_elenco'];
    end if;
    if 'configuratore' = any(schede) then
      schede := schede || array['listino', 'conti'];
      sotto := sotto || array['listino_configuratore', 'conti_configuratore'];
    end if;

    schede := array(select distinct x from unnest(schede) x where x not in ('configuratore', 'cashflow'));
    sotto := array(select distinct x from unnest(sotto) x where x not like 'cashflow\_%' and x <> 'cassa_contanti');

    update ruoli
       set permessi = jsonb_set(permessi, '{albatros}',
             coalesce(permessi->'albatros', '{}'::jsonb)
             || jsonb_build_object('schede', to_jsonb(schede), 'sottoschede', to_jsonb(sotto)))
     where id = r.id;
  end loop;
end $$;

commit;

-- Controllo: i permessi di Albatros di ogni ruolo.
select nome, permessi->'albatros' as albatros from ruoli order by nome;
