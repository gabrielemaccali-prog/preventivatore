-- ============================================================
-- Il posticipo diventa un voucher
-- Schema da eseguire nell'SQL Editor di Supabase.
--
-- Una partita con un acconto che salta non si annulla e basta: quei soldi restano del cliente e
-- tornano sotto forma di voucher, che userà quando riprenoterà. La prenotazione va in ANNULLATA
-- -- così si possono segnare i costi già sostenuti -- ma non conta fra le partite perse, perché
-- il ricavo non è perso: è parcheggiato nel voucher.
--
-- Additiva: niente si riscrive, le colonne nuove nascono vuote o col valore di sempre.
-- ============================================================

begin;
set local lock_timeout = '3s';

-- --- Il voucher sa da dove viene ---
-- Non è un campo che si compila emettendo un voucher nuovo: lo scrive solo la trasformazione di
-- una prenotazione, ed è quello che fa comparire il segno "POST" accanto allo stato.
alter table voucher add column if not exists "daPosticipo" boolean not null default false;
alter table voucher add column if not exists "prenotazioneOrigine" text;

-- --- E la prenotazione sa in che voucher si è trasformata ---
alter table prenotazioni add column if not exists "voucherGenerato" text;

-- --- I dati di fatturazione di un voucher sono quelli di una prenotazione ---
-- Finora il voucher conosceva solo le persone fisiche (nome, cognome, CF): un regalo di Natale lo
-- compra una persona. Ma un posticipo eredita il cliente della partita, che può essere un'azienda,
-- e la fattura va fatta a lei con le sue regole. Stessi nomi delle colonne di "prenotazioni", così
-- la regola che dice quali dati mancano è una sola, scritta una volta (campiFatturazioneMancanti).
alter table voucher add column if not exists "fattTipo" text not null default 'privato';
alter table voucher add column if not exists "fattStraniero" boolean not null default false;
alter table voucher add column if not exists "fattStato" text;
alter table voucher add column if not exists "ragioneSociale" text;
alter table voucher add column if not exists "aziIndirizzo" text;
alter table voucher add column if not exists "aziCap" text;
alter table voucher add column if not exists "aziCitta" text;
alter table voucher add column if not exists "aziProvincia" text;
alter table voucher add column if not exists "pIva" text;
alter table voucher add column if not exists "cfAzienda" text;
alter table voucher add column if not exists "sdi" text;

commit;

-- Controllo: i voucher nati da un posticipo e le prenotazioni che li hanno generati.
-- select codice, "daPosticipo", "prenotazioneOrigine", importo, stato from voucher where "daPosticipo";
-- select id, data, stato, "voucherGenerato" from prenotazioni where "voucherGenerato" is not null;
