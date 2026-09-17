-- ============================================================
-- Prenotazioni: lo stato "CONF" diventa "CONFERMATO"
-- Da eseguire nell'SQL Editor di Supabase INSIEME al deploy della versione che usa STATO_PREN
-- (src/lib/costanti.js): prima dell'uno o dell'altro le partite confermate non combaciano più e
-- spariscono da gestione, calendario, compensi e consuntivazione.
-- ============================================================

-- Il valore compare solo in questa colonna: nessun'altra tabella, vista o funzione lo ripete.
update prenotazioni set stato = 'CONFERMATO' where stato = 'CONF';

-- Se nel frattempo qualcuno ha confermato una partita dalla versione vecchia dell'app (una scheda
-- rimasta aperta), la riga sarà stata scritta ancora come 'CONF': rieseguire lo script la allinea.
-- Controllo: deve restituire zero righe.
-- select id, data, stato from prenotazioni where stato = 'CONF';

-- Riepilogo degli stati presenti dopo la migrazione.
-- select stato, count(*) from prenotazioni group by stato order by stato;
