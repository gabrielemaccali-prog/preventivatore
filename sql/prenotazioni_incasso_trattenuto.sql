-- ============================================================
-- L'annullamento fuori termine
-- Schema da eseguire nell'SQL Editor di Supabase.
--
-- Quando una partita salta ci sono due storie diverse, e finora l'app ne conosceva una sola.
-- Se i termini di annullamento sono ancora aperti i soldi gia' incassati restano del cliente e
-- diventano un voucher (sql/voucher_da_posticipo.sql). Se invece i termini sono scaduti quei
-- soldi restano a noi: niente voucher, e il cliente che un giorno tornera' riprenotera' da capo.
--
-- "incassoTrattenuto" dice quanto si e' trattenuto. E' l'unica cosa che distingue questa annullata
-- da una qualsiasi, e serve a tre cose: la fattura (si fattura il trattenuto, non il prezzo della
-- partita che non si e' giocata), il cruscotto (quel denaro e' un ricavo vero, e la partita non
-- va fra le perse) e la memoria di chi leggera' la riga fra sei mesi.
--
-- Additiva: nasce vuota, e vuota vuol dire "annullata normale", come sono tutte quelle di prima.
-- ============================================================

begin;
set local lock_timeout = '3s';

alter table prenotazioni add column if not exists "incassoTrattenuto" numeric;

commit;

-- Controllo: le partite annullate fuori termine e quanto si e' trattenuto.
-- select id, data, "prezzoVendita", "incassoTrattenuto", "categoriaAnnullamento"
--   from prenotazioni where "incassoTrattenuto" is not null order by data desc;
