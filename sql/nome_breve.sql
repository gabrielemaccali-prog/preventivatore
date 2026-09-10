-- ============================================================
-- Il nome breve di un gioco.
-- Da eseguire nell'SQL Editor di Supabase.
--
-- "Calcio Balilla Umano · Noleggio" in una cella di calendario larga due centimetri non si legge:
-- si tronca a meta' parola, e quello che resta non dice piu' di che gioco si tratta. Nelle tabelle
-- fitte succede lo stesso, e il problema peggiora adesso che una prenotazione puo' portarne piu'
-- d'uno.
--
-- Quindi ogni gioco puo' avere un nome corto da usare dove lo spazio e' poco -- "Cbu", "Bubble" --
-- restando quello per esteso dove lo spazio c'e': i documenti al cliente, la mail di conferma,
-- l'evento su Google Calendar. E' una preferenza di visualizzazione, non un secondo nome: se
-- manca si usa quello lungo, e non c'e' niente da riempire perche' tutto continui a funzionare.
--
-- Additiva e nullable: nasce vuota su tutti i giochi e il codice in produzione la ignora.
-- ============================================================

begin;
set local lock_timeout = '3s';

alter table giochi add column if not exists nome_breve text;

commit;

-- Controllo: la colonna c'e' e nessun gioco e' stato toccato.
select count(*) as giochi, count(nome_breve) as con_nome_breve from giochi;
