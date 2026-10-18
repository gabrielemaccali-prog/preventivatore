-- ============================================================
-- I campi sportivi passano da Prenotazioni > Configuratore > Campi ad Anagrafiche > Campi.
-- Da eseguire nell'SQL Editor di Supabase, insieme al rilascio del codice che li sposta.
--
-- I permessi dei ruoli sono salvati per modulo. Il modulo Anagrafiche ha ancora l'id 'catalogo'
-- (vedi src/lib/permessi.js). Senza questo script chi oggi gestisce i campi dal Configuratore
-- non li troverebbe più, senza nessun errore: qui riceve la scheda nuova.
--   prenotazioni.sottoschede 'campi'  ->  catalogo.schede 'campi'
-- La sottoscheda vecchia si toglie: il codice non la legge più.
-- Si può rieseguire: chi ha già la scheda non la riceve due volte.
-- ============================================================

begin;

update ruoli r
   set permessi = jsonb_set(
         jsonb_set(
           coalesce(r.permessi, '{}'::jsonb),
           '{catalogo}',
           coalesce(r.permessi->'catalogo', '{}'::jsonb) || jsonb_build_object(
             'schede', (
               select jsonb_agg(distinct x)
                 from jsonb_array_elements_text(
                        coalesce(r.permessi->'catalogo'->'schede', '[]'::jsonb) || '["campi"]'::jsonb) as x)
           ),
           true),
         '{prenotazioni,sottoschede}',
         coalesce((
           select jsonb_agg(x)
             from jsonb_array_elements_text(r.permessi->'prenotazioni'->'sottoschede') as x
            where x <> 'campi'
         ), '[]'::jsonb),
         true)
 where coalesce(r.permessi->'prenotazioni'->'schede', '[]'::jsonb) ? 'config'
   and coalesce(r.permessi->'prenotazioni'->'sottoschede', '[]'::jsonb) ? 'campi';

commit;
