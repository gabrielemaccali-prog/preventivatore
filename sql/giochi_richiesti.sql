-- ============================================================
-- Quanti giochi vuole un pacchetto.
-- Da eseguire nell'SQL Editor di Supabase.
--
-- "Due giochi (2h)" -- un'ora di un gioco e un'ora di un altro, di fila, su un nostro campo -- e'
-- il primo pacchetto che ne chiede piu' d'uno. L'unico modo per saperlo senza questa colonna
-- sarebbe riconoscerlo dal nome, che e' esattamente il problema da cui siamo scappati quando il
-- gioco stava dentro il nome del pacchetto.
--
-- Con la colonna il pacchetto lo dichiara, e il giorno che ne servira' uno da tre non serve
-- toccare il codice: si scrive 3.
--
-- Additiva, con default: tutti i pacchetti di oggi ne vogliono uno, che e' quello che gia' fanno.
-- ============================================================

begin;
set local lock_timeout = '3s';

alter table pren_pacchetti add column if not exists giochi_richiesti smallint not null default 1;

commit;

-- Controllo: la colonna c'e' e nessun pacchetto e' cambiato.
select nome, giochi_richiesti, "durataOre", "locationTipo", prezzo from pren_pacchetti order by nome;
