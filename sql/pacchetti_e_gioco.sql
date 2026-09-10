-- ============================================================
-- Pacchetti e gioco sulla prenotazione — fase 4.
-- Da eseguire nell'SQL Editor di Supabase.
--
-- Oggi il nome del pacchetto tiene insieme tre cose: la modalità (solo gioco, party, noleggio),
-- il gioco (Bubble, Dark) e la durata. Da qui i nove pacchetti che hai, e la certezza che
-- diventino quindici il giorno che l'Archery si potrà prenotare. Con il gioco su una colonna
-- sua, al pacchetto resta la sola modalità e l'elenco smette di moltiplicarsi.
--
-- Questa migrazione fa solo la parte invisibile: aggiunge la colonna che permette di togliere un
-- pacchetto dalle tendine senza cancellarlo. Cancellarlo non si può — 38 prenotazioni ci puntano
-- per id, e perderebbero il riferimento.
--
-- LA RIORGANIZZAZIONE DEI PACCHETTI NON È QUI: sta in fondo, commentata, e va eseguita
-- soltanto quando il codice nuovo è online. Prima di allora la versione in produzione non
-- conosce "attivo", mostrerebbe vecchi e nuovi insieme e l'elenco raddoppierebbe sotto gli
-- occhi di chi sta lavorando.
-- ============================================================

-- ------------------------------------------------------------
-- 1) LA PARTE DA ESEGUIRE ORA. Invisibile: tutti i pacchetti nascono attivi, e il codice in
--    produzione non legge la colonna.
-- ------------------------------------------------------------
begin;
set local lock_timeout = '3s';

alter table pren_pacchetti add column if not exists attivo boolean not null default true;

commit;

-- Controllo: tutti attivi, nessuno perso.
select count(*) as pacchetti, count(*) filter (where attivo) as attivi from pren_pacchetti;


-- ============================================================
-- 2) DA ESEGUIRE SOLO DOPO IL PUSH DEL CODICE NUOVO.
--
-- Crea i sei pacchetti di sola modalità e spegne i nove vecchi. I vecchi restano a database
-- perché le prenotazioni passate continuino a sapere come sono state vendute: spariscono dalle
-- tendine, non dalla storia.
--
-- I prezzi e le durate sono quelli che hai oggi. "Noleggio" nasce senza prezzo, come i tre
-- noleggi attuali: l'importo arriva dal preventivo collegato.
--
-- Toglila dal commento e rileggila prima di eseguirla: il centro di ricavo non lo riporto,
-- perché da qui in avanti viaggia sul gioco.
-- ============================================================

-- begin;
--
-- insert into pren_pacchetti (id, nome, "durataOre", "locationTipo", prezzo, "prevedeRinfresco", "numeroPartecipanti", attivo) values
--   ('ppk_solo_1h',      'Solo gioco 1h', 1,    'campi',  220,  false, null, true),
--   ('ppk_solo_2h',      'Solo gioco 2h', 2,    'campi',  350,  false, null, true),
--   ('ppk_party_basic',  'Party Basic',   1,    'campi',  300,  true,  10,   true),
--   ('ppk_party_plus',   'Party Plus',    1,    'campi',  400,  true,  15,   true),
--   ('ppk_party_deluxe', 'Party Deluxe',  2,    'campi',  550,  true,  20,   true),
--   ('ppk_noleggio',     'Noleggio',      null, 'libera', null, false, null, true)
-- on conflict (id) do nothing;
--
-- update pren_pacchetti set attivo = false where id not like 'ppk_solo%' and id not like 'ppk_party%' and id <> 'ppk_noleggio';
--
-- commit;
--
-- -- Controllo: 6 attivi, 9 spenti, e nessuna prenotazione rimasta senza pacchetto.
-- select nome, attivo, "durataOre", prezzo from pren_pacchetti order by attivo desc, nome;
-- select count(*) as prenotazioni_orfane
--   from prenotazioni p left join pren_pacchetti k on k.id = p."pacchettoId"
--  where k.id is null;
