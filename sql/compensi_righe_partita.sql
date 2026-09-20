-- ============================================================
-- Le righe per partita di un periodo di compensi, e le due colonne che restavano indietro.
-- Da eseguire nell'SQL Editor di Supabase.
--
-- IL PROBLEMA. Un periodo diceva quanto era stato pagato a un operatore, ma non di quali partite era
-- fatto. Costi/Ricavi ragiona per prenotazione, quindi la ripartizione se la ricostruiva ogni volta
-- dalle voci vive e dai parametri di oggi -- e un consuntivo ricostruito non e' un consuntivo:
-- bastava cancellare una rettifica o ritoccare una tariffa perche' cambiasse quanto "era stato
-- pagato" mesi prima. Ora la ripartizione si congela alla chiusura, come fanno gia' i periodi di
-- fornitori e campi in cons_periodi.righe.
--
--   righe [{ riferimento, data, ore, base, rettifiche, spese, trasferta, imponibile, ritenuta,
--            incassaOperatore, consuntivato }]
--
--     base        ore a tariffa piu' il bonus recensione: quanto la partita valeva da prevista
--     rettifiche  le correzioni scritte dopo (ore di viaggio, benzina)
--     spese       rimborsi vivi, esenti da ritenuta
--     trasferta   la fetta messa a rimborso trasferta dal documento, esente
--     ritenuta    calcolata sull'imponibile che resta
--
-- E LE DUE COLONNE. "ritenuta" e "costo_azienda" nascono alla consuntivazione, quando la ritenuta
-- non e' ancora decisa: restavano a zero e al costo del solo operatore anche dopo l'elaborazione del
-- rimborso, che le scriveva solo dentro il jsonb del documento. Chi leggeva le colonne vedeva un
-- costo piu' basso del vero. Da adesso l'app le allinea; qui si sistemano quelle gia' scritte.
--
-- Additiva: nessuna riga viene persa, e i periodi senza "righe" continuano a funzionare (il
-- cruscotto li ricostruisce come prima, dicendolo). Per riempirli davvero, dopo questo script:
--   npm run riempi:righe
-- che li ricalcola con i parametri congelati in ognuno e li scrive.
-- ============================================================

begin;
set local lock_timeout = '3s';

alter table op_periodi add column if not exists righe jsonb not null default '[]'::jsonb;

-- Le due colonne dei periodi gia' evasi, dal documento congelato.
update op_periodi
   set ritenuta = coalesce((rimborso->>'ritenuta')::numeric, ritenuta),
       costo_azienda = coalesce((rimborso->>'totale')::numeric, costo_azienda)
                     + coalesce((rimborso->>'ritenuta')::numeric, 0)
 where evaso_il is not null
   and rimborso ? 'ritenuta'
   and coalesce(ritenuta, 0) = 0;

commit;

-- Controllo: quanti periodi hanno le righe, e come stanno le due colonne.
select count(*) as periodi,
       count(*) filter (where jsonb_array_length(righe) > 0) as con_righe,
       count(*) filter (where evaso_il is not null) as evasi,
       count(*) filter (where evaso_il is not null and coalesce(ritenuta, 0) > 0) as evasi_con_ritenuta,
       sum(costo_azienda) as costo_azienda_totale
  from op_periodi;
