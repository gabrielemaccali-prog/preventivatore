-- ============================================================
-- Le prenotazioni passano ai pacchetti nuovi, i vecchi si cancellano.
-- Da eseguire nell'SQL Editor di Supabase.
--
-- NON È UNA COSA CHE SI RIFÀ. Riscrive con che cosa sono state vendute 38 prenotazioni già
-- chiuse, e si può fare solo perché siamo all'inizio e quelle 38 sono ancora tutte nostre. Da qui
-- in avanti un pacchetto che non si usa più si spegne e basta: la storia di come è stata venduta
-- una partita è un dato, non un residuo da ripulire.
--
-- Si può fare senza perdere niente perché il gioco non sta più nel nome del pacchetto: sta sulla
-- colonna "giocoId", che tutte e 38 hanno già piena. "Bubble Party Basic" non diventa "Party
-- Basic" perdendo il Bubble: diventa il gioco Bubble Football venduto in modalità Party Basic,
-- che è la stessa cosa detta nel modo nuovo.
--
-- L'unico caso che meritava un controllo era PRN-2026-1046, "Noleggio Bubble+Archery": il nome
-- cita due giochi e la colonna ne tiene uno solo. Ha già il dettaglio per gioco con dentro tutti
-- e due -- Bubble Football 500 e Archery Tag 600 -- quindi il "+Archery" non se ne va con il nome.
--
-- Nessuna prenotazione era sul pacchetto "Dark Soccer", e i voucher non c'entrano: stanno su
-- un'altra tabella ("pacchetti"), e l'unico emesso non cita niente di tutto questo.
-- ============================================================

begin;
set local lock_timeout = '3s';

-- La corrispondenza va per id e non per nome: i due pacchetti chiamati "Bubble Football" sono uno
-- da un'ora e uno da due, e finiscono in due posti diversi.

-- Bubble Football 1h (220) -> Solo gioco 1h   [16 prenotazioni]
update prenotazioni set "pacchettoId" = 'ppk_solo_1h', "pacchettoNome" = 'Solo gioco 1h'
 where "pacchettoId" = 'ppk_1782928670138';

-- Bubble Football 2h (350) -> Solo gioco 2h   [3]
update prenotazioni set "pacchettoId" = 'ppk_solo_2h', "pacchettoNome" = 'Solo gioco 2h'
 where "pacchettoId" = 'ppk_1783010254781';

-- Bubble Party Basic -> Party Basic           [8]
update prenotazioni set "pacchettoId" = 'ppk_party_basic', "pacchettoNome" = 'Party Basic'
 where "pacchettoId" = 'ppk_1782928910406';

-- Bubble Party Plus -> Party Plus             [5]
update prenotazioni set "pacchettoId" = 'ppk_party_plus', "pacchettoNome" = 'Party Plus'
 where "pacchettoId" = 'ppk_1783010209776';

-- Bubble Party Deluxe -> Party Deluxe         [1]
update prenotazioni set "pacchettoId" = 'ppk_party_deluxe', "pacchettoNome" = 'Party Deluxe'
 where "pacchettoId" = 'ppk_1783010224244';

-- I tre noleggi -> Noleggio                   [2 + 1 + 2]
update prenotazioni set "pacchettoId" = 'ppk_noleggio', "pacchettoNome" = 'Noleggio'
 where "pacchettoId" in ('ppk_1783008520511', 'ppk_1788774602614', 'ppk_1785858424894');

-- Adesso i vecchi non li cita più nessuno e se ne possono andare. Se qui Postgres si lamenta di
-- una chiave esterna vuol dire che qualcosa li cita ancora: la transazione si annulla da sola e
-- non resta niente a metà.
delete from pren_pacchetti
 where id not in ('ppk_solo_1h', 'ppk_solo_2h', 'ppk_party_basic', 'ppk_party_plus', 'ppk_party_deluxe', 'ppk_noleggio');

commit;

-- Controllo 1: restano i sei, tutti attivi.
select nome, "durataOre", prezzo, attivo from pren_pacchetti order by nome;

-- Controllo 2: 38 prenotazioni, nessuna senza pacchetto e nessuna senza gioco.
select count(*) as prenotazioni,
       count(*) filter (where k.id is null) as senza_pacchetto,
       count(*) filter (where p."giocoId" is null) as senza_gioco
  from prenotazioni p
  left join pren_pacchetti k on k.id = p."pacchettoId";

-- Controllo 3: come si distribuiscono adesso, gioco per modalità.
select g.nome as gioco, p."pacchettoNome" as modalita, count(*) as partite
  from prenotazioni p
  join giochi g on g.id = p."giocoId"
 group by 1, 2
 order by 3 desc;
