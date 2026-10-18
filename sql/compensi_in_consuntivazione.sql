-- ============================================================
-- Il modulo Compensi diventa la scheda Bubbler di Consuntivazione.
-- Da eseguire nell'SQL Editor di Supabase, insieme al rilascio del codice che lo sposta.
--
-- I permessi dei ruoli sono salvati per modulo: ruoli.permessi->'compensi'. Il codice nuovo non
-- legge piu' quella chiave, e senza questo script chi oggi vede i compensi entrerebbe e non li
-- troverebbe piu', senza nessun errore.
--
-- Le schede di prima diventano sotto-schede di Bubbler. La matrice dei permessi ha due livelli
-- soli, e allora le tre fasi della gestione salgono accanto a configuratore e indicatori:
--   compensi.schede 'config'                        -> bubbler / 'config'
--   compensi.schede 'indicatori'                    -> bubbler / 'indicatori'
--   compensi 'gestione' + sottoscheda 'daconsuntivare' -> bubbler / 'daconsuntivare'
--   compensi 'gestione' + sottoscheda 'rimborsi'       -> bubbler / 'rimborsi'
--   compensi 'gestione' + sottoscheda 'evasi'          -> bubbler / 'evasi'
-- Chi vedeva la gestione senza nessuna delle sue fasi non vedeva niente, e niente continua a vedere.
-- ============================================================

begin;

with vecchi as (
  select r.id,
         coalesce(r.permessi->'compensi'->'schede', '[]'::jsonb) as schede,
         coalesce(r.permessi->'compensi'->'sottoschede', '[]'::jsonb) as sotto
    from ruoli r
   where r.permessi ? 'compensi'
),
nuovi as (
  select v.id,
         coalesce((
           select jsonb_agg(s.id order by s.ordine)
             from (values ('config', 1), ('daconsuntivare', 2), ('rimborsi', 3), ('evasi', 4), ('indicatori', 5)) as s(id, ordine)
            where case
                    when s.id in ('config', 'indicatori') then v.schede ? s.id
                    else v.schede ? 'gestione' and v.sotto ? s.id
                  end
         ), '[]'::jsonb) as bubbler
    from vecchi v
)
update ruoli r
   set permessi = case
         when jsonb_array_length(n.bubbler) = 0 then r.permessi - 'compensi'
         else jsonb_set(
                r.permessi - 'compensi',
                '{consuntivazione}',
                jsonb_build_object(
                  'schede', (
                    select jsonb_agg(distinct x)
                      from jsonb_array_elements_text(
                             coalesce(r.permessi->'consuntivazione'->'schede', '[]'::jsonb) || '["bubbler"]'::jsonb) as x),
                  'sottoschede', (
                    select jsonb_agg(distinct x)
                      from jsonb_array_elements_text(
                             coalesce(r.permessi->'consuntivazione'->'sottoschede', '[]'::jsonb) || n.bubbler) as x)
                ),
                true)
       end
  from nuovi n
 where n.id = r.id;

-- Prima di confermare: nessun ruolo deve avere ancora la chiave vecchia.
do $$
begin
  if exists (select 1 from ruoli where permessi ? 'compensi') then
    raise exception 'Ci sono ancora ruoli con permessi->compensi';
  end if;
end $$;

commit;

-- Controllo: chi vede adesso la scheda Bubbler, e con quali sotto-schede.
-- select nome, permessi->'consuntivazione' from ruoli order by nome;
