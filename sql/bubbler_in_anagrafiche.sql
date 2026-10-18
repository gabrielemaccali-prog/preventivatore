-- ============================================================
-- L'anagrafica dei bubbler passa da Disponibilità > Configuratore ad Anagrafiche > Bubbler.
-- Da eseguire nell'SQL Editor di Supabase, insieme al rilascio del codice che la sposta.
--
-- I permessi dei ruoli sono salvati per modulo. Il modulo Anagrafiche ha ancora l'id 'catalogo'
-- (vedi src/lib/permessi.js). Senza questo script chi oggi gestisce i bubbler dal Configuratore
-- non li troverebbe più, senza nessun errore: qui riceve la scheda nuova.
--   disponibilita.schede 'config'  ->  catalogo.schede 'bubbler'
-- Il Configuratore resta dov'è, con le fasce orario: il permesso di prima non si toglie.
-- Si può rieseguire: chi ha già la scheda non la riceve due volte.
-- ============================================================

begin;

update ruoli r
   set permessi = jsonb_set(
         coalesce(r.permessi, '{}'::jsonb),
         '{catalogo}',
         coalesce(r.permessi->'catalogo', '{}'::jsonb) || jsonb_build_object(
           'schede', (
             select jsonb_agg(distinct x)
               from jsonb_array_elements_text(
                      coalesce(r.permessi->'catalogo'->'schede', '[]'::jsonb) || '["bubbler"]'::jsonb) as x)
         ),
         true)
 where coalesce(r.permessi->'disponibilita'->'schede', '[]'::jsonb) ? 'config';

commit;
