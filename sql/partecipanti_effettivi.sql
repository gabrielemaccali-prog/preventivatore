-- ============================================================
-- Prenotazioni: quanti si sono presentati davvero
-- Schema da eseguire nell'SQL Editor di Supabase.
-- ============================================================

-- Sono due numeri diversi e non vanno confusi:
--   "numeroPartecipanti"   = le persone previste dal pacchetto (il deluxe è studiato per 20).
--                            È questo che moltiplica il prezzo a persona del rinfresco, perché al
--                            campo si pagano sempre le persone pattuite, non quelle presenti.
--   "partecipantiEffettivi" = quante ne sono venute davvero: possono essere 19 o 21.
--                            Informazione per chi va in campo e per il calendario; non tocca i costi.
alter table prenotazioni add column if not exists "partecipantiEffettivi" integer;
