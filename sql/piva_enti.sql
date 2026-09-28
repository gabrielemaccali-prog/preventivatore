-- ============================================================
-- Prenotazioni: numeri che iniziano per 9 tolti dal campo partita IVA
-- Da eseguire nell'SQL Editor di Supabase.
-- ============================================================

-- Gli 11 numeri che iniziano per 9 sono codici fiscali di enti (associazioni, parrocchie, oratori,
-- condomini), non partite IVA: il gestionale rifiuta la fattura se li trova in quel campo e chiede
-- di indicarli come codice fiscale, lasciando vuota la partita IVA.
-- L'app ora lo impedisce in fase di inserimento; qui si sistema quello che era già stato salvato.

-- 1) Dove il codice fiscale è vuoto, il numero ci viene spostato.
update prenotazioni
   set "cfAzienda" = "pIva"
 where "pIva" like '9%'
   and coalesce(trim("cfAzienda"), '') = '';

-- 2) Poi il campo partita IVA si svuota (a quel punto il numero è già nel codice fiscale).
update prenotazioni
   set "pIva" = ''
 where "pIva" like '9%';

-- Controllo: deve restituire zero righe.
-- select id, "pIva", "cfAzienda" from prenotazioni where "pIva" like '9%';
