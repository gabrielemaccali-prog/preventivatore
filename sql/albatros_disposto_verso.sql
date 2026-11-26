-- ============================================================
-- Spese dalla banca il cui movimento dice "… disposto verso <beneficiario>": la descrizione presa
-- dalla banca diventa "tipo · beneficiario" ("Disposizione Sct · Wefor srl"), come per quelle nuove.
-- Si toccano SOLO le descrizioni rimaste quelle estratte dalla banca: chi l'ha scritta o corretta
-- a mano (o l'ha presa da una regola) resta com'è. Vale per Albatros e per il modulo Spese di BFM.
-- Da eseguire nell'SQL Editor di Supabase (si può rieseguire: le già sistemate non combaciano più).
-- ============================================================

begin;

-- Albatros: la descrizione estratta era il solo tipo del movimento ("Disposizione Sct").
update albatros_spese s
   set descrizione = left(btrim(s.descrizione) || ' · ' || btrim((regexp_match(m.descrizione, 'disposto verso:?\s*(.+)$', 'i'))[1]), 300)
  from albatros_banca_movimenti m
 where m.id = s.movimento_id
   and m.descrizione ~* 'disposto verso'
   and (regexp_match(m.descrizione, 'disposto verso:?\s*(.+)$', 'i'))[1] !~* 'beneficiari diversi'
   and lower(regexp_replace(btrim(s.descrizione), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(m.tipo), '\s+', ' ', 'g'));

-- BFM: la descrizione estratta era tutto il testo del movimento senza il primo codice.
update spese s
   set descrizione = initcap(regexp_replace(btrim(m.tipo), '\s+', ' ', 'g')) || ' · ' || btrim((regexp_match(m.descrizione, 'disposto verso:?\s*(.+)$', 'i'))[1])
  from banca_movimenti m
 where m.id = s.movimento_id
   and m.descrizione ~* 'disposto verso'
   and m.descrizione !~* 'a favore di:'
   and btrim(s.descrizione) = btrim(regexp_replace(m.descrizione, '^\S*\d{10,}\S*\s*', ''));

commit;

-- Controllo: tutte le spese con "disposto verso", di Albatros e di BFM. Quelle rimaste senza
-- il beneficiario hanno una descrizione scritta a mano o da una regola.
select 'Albatros' as modulo, s.data, s.importo, s.descrizione, m.descrizione as movimento
from albatros_spese s join albatros_banca_movimenti m on m.id = s.movimento_id
where m.descrizione ~* 'disposto verso'
union all
select 'BFM', s.data, s.importo, s.descrizione, m.descrizione
from spese s join banca_movimenti m on m.id = s.movimento_id
where m.descrizione ~* 'disposto verso'
order by 1, 2 desc;
