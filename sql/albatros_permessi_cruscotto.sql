-- ============================================================
-- Albatros: la scheda Incassi diventa Cruscotto, con tre viste (sottoschede).
-- Da eseguire nell'SQL Editor di Supabase, dopo sql/albatros_permessi_cassa_conti.sql e insieme
-- al rilascio del codice.
--
-- Il Cruscotto tiene l'id 'incassi'. Le sue viste:
--   cruscotto_incassi        gli incassi per categoria (la scheda di prima): a chi aveva Incassi
--   cruscotto_spese          le spese per categoria: a chi ha Conti (lavora con le spese)
--   cruscotto_elenco         tutte le spese in un elenco, da sistemare: a chi ha Conti
--   cruscotto_configuratore  le categorie delle spese, che prima stavano in Conti: a chi aveva
--                            la sottoscheda conti_configuratore, che si toglie
-- Chi riceve una vista del Cruscotto senza averne la scheda la riceve insieme. Si può rieseguire.
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

    if 'incassi' = any(schede) then
      sotto := sotto || array['cruscotto_incassi'];
    end if;
    if 'conti' = any(schede) then
      schede := schede || array['incassi'];
      sotto := sotto || array['cruscotto_spese', 'cruscotto_elenco'];
    end if;
    if 'conti_configuratore' = any(sotto) then
      schede := schede || array['incassi'];
      sotto := sotto || array['cruscotto_configuratore'];
    end if;

    schede := array(select distinct x from unnest(schede) x);
    sotto := array(select distinct x from unnest(sotto) x where x <> 'conti_configuratore');

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
