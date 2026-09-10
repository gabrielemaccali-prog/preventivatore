-- ============================================================
-- I nove pacchetti diventano sei.
-- Da eseguire nell'SQL Editor di Supabase DOPO che il codice nuovo e' online.
--
-- Prima di adesso il nome del pacchetto teneva insieme tre cose: la modalita' (solo gioco, party,
-- noleggio), il gioco (Bubble, Dark) e la durata. Da li' venivano i nove pacchetti attuali, e la
-- certezza che diventassero quindici il giorno che l'Archery si potra' prenotare.
--
-- Ora il gioco sta su una colonna sua, quindi al pacchetto resta la sola modalita'. I nove di oggi
-- ci finiscono dentro senza perdere niente:
--
--   Bubble Football 1h  220  e  Dark Soccer 1h  220   ->  Solo gioco 1h    220
--   Bubble Football 2h  350                           ->  Solo gioco 2h    350
--   Bubble Party Basic  300, 10 persone               ->  Party Basic      300
--   Bubble Party Plus   400, 15 persone               ->  Party Plus       400
--   Bubble Party Deluxe 550, 20 persone               ->  Party Deluxe     550
--   Noleggio Bubble / Bubble+Archery / Gonfiabili     ->  Noleggio         (prezzo dal preventivo)
--
-- I nove vecchi NON si cancellano: 38 prenotazioni li citano per id e perderebbero il riferimento
-- a come sono state vendute. Si spengono soltanto: spariscono dalle tendine, non dalla storia. Una
-- prenotazione vecchia resta modificabile perche' la tendina tiene dentro il pacchetto gia' scritto
-- su di lei anche quando e' spento.
--
-- Il centro di ricavo non lo riporto sui pacchetti nuovi: da qui in avanti viaggia sul gioco. Fino
-- a che Costi/Ricavi non lo legge da li', le prenotazioni fatte con i pacchetti nuovi gli
-- risulteranno "Non assegnato". Le vecchie, che citano i pacchetti vecchi, restano raggruppate
-- come sempre.
-- ============================================================

begin;
set local lock_timeout = '3s';

insert into pren_pacchetti (id, nome, "durataOre", "locationTipo", prezzo, "prevedeRinfresco", "numeroPartecipanti", attivo) values
  ('ppk_solo_1h',      'Solo gioco 1h', 1,    'campi',  220,  false, null, true),
  ('ppk_solo_2h',      'Solo gioco 2h', 2,    'campi',  350,  false, null, true),
  ('ppk_party_basic',  'Party Basic',   1,    'campi',  300,  true,  10,   true),
  ('ppk_party_plus',   'Party Plus',    1,    'campi',  400,  true,  15,   true),
  ('ppk_party_deluxe', 'Party Deluxe',  2,    'campi',  550,  true,  20,   true),
  ('ppk_noleggio',     'Noleggio',      null, 'libera', null, false, null, true)
on conflict (id) do nothing;

-- Elenco esplicito e non un "like": un pacchetto nuovo aggiunto domani non deve spegnersi da solo
-- perche' il suo id assomiglia a questi.
update pren_pacchetti set attivo = false
 where id not in ('ppk_solo_1h', 'ppk_solo_2h', 'ppk_party_basic', 'ppk_party_plus', 'ppk_party_deluxe', 'ppk_noleggio');

commit;

-- Controllo 1: sei attivi, nove spenti.
select count(*) filter (where attivo) as attivi,
       count(*) filter (where not attivo) as spenti,
       count(*) as totali
  from pren_pacchetti;

-- Controllo 2: nessuna prenotazione ha perso il suo pacchetto, e tutte sanno di che gioco parlano.
select count(*) as prenotazioni,
       count(*) filter (where k.id is null) as senza_pacchetto,
       count(*) filter (where p."giocoId" is null) as senza_gioco
  from prenotazioni p
  left join pren_pacchetti k on k.id = p."pacchettoId";
