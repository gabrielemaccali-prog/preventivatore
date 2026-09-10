-- ============================================================
-- Il dettaglio per gioco di una prenotazione.
-- Da eseguire nell'SQL Editor di Supabase.
--
-- Finora un noleggio conservava due numeri soli: quanto è stato venduto e quanto è costato.
-- Da dove venissero lo sapeva solo il preventivo, e correggerli voleva dire scrivere a mano un
-- totale che non tornava più con le sue righe.
--
-- Qui la prenotazione si tiene le righe: una per gioco, con il suo ricavo e il suo costo. I due
-- totali diventano la loro somma invece che due campi a sé, e correggere una riga li aggiorna.
--
-- Le righe nascono copiate dal preventivo collegato — è lui a produrle — ma da quel momento sono
-- della prenotazione: se il preventivo viene ritoccato dopo, quello che è stato venduto non cambia
-- da sotto. È la stessa regola dei nomi congelati nei preventivi e dei parametri nei compensi.
--
-- Additiva e nullable: le prenotazioni che ci sono già restano senza righe e continuano a
-- funzionare con i loro totali, il codice in produzione ignora la colonna.
-- ============================================================

begin;
set local lock_timeout = '3s';

-- Una riga per gioco: [{ giocoId, nome, sede, quantita, ricavo, costo }, ...]
-- Sta in jsonb e non in una tabella a parte perché è il dettaglio di una prenotazione, non un
-- archivio da interrogare per conto suo: si legge sempre insieme a lei, come "operatori".
alter table prenotazioni add column if not exists voci jsonb;

commit;

-- Controllo: la colonna c'è e nessuna prenotazione è stata toccata.
select count(*) as prenotazioni,
       count(voci) as con_dettaglio
  from prenotazioni;
