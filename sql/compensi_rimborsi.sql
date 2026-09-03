-- ============================================================
-- Modulo Compensi — elaborazione del rimborso.
-- Da eseguire nell'SQL Editor di Supabase, dopo compensi_consuntivi.sql.
--
-- Un periodo consuntivato attraversa due stati: prima aspetta che se ne elabori il rimborso,
-- poi è evaso. Non serve una colonna "stato": basta la data di evasione, perché null significa
-- "non ancora" e uno stato separato potrebbe contraddirla.
-- ============================================================

-- Quando il rimborso è stato elaborato. Null = periodo ancora da elaborare.
alter table op_periodi add column if not exists evaso_il timestamptz;

-- Fotografia dell'elaborazione, congelata come tutto il resto del periodo:
--   giornate   [{ data, luogo }]  righe "per animazione svolta nei giorni", modificabili a mano
--   trasferte  { numero, importo } rimborso trasferta forfait, es. 2 x 10
--   imponibile / ritenuta / netto / rimborsi / totale  gli importi stampati sul documento
-- Sta in jsonb e non in colonne perché è il contenuto di un documento già emesso: si rilegge
-- per ristamparlo, non si interroga per farci conti.
alter table op_periodi add column if not exists rimborso jsonb;

create index if not exists op_periodi_evaso_idx on op_periodi (evaso_il);
