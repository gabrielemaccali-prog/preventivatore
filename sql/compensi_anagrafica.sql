-- Anagrafica fiscale del bubbler e data del documento di rimborso.
--
-- I dati di residenza e il codice fiscale stanno su "utenti" e non su una tabella a parte:
-- il bubbler è già un utente, e op_periodi.operatore contiene proprio il suo username.
-- Servono al documento di rimborso, che senza di essi non è consegnabile.
alter table utenti
  add column if not exists indirizzo      text,
  add column if not exists cap            text,
  add column if not exists citta          text,
  add column if not exists provincia      text,
  add column if not exists codice_fiscale text;

-- La data del documento. Fino a ieri era implicita: si stampava la data di oggi e in tabella si
-- mostrava il timestamp di creazione della riga. Ora si decide elaborando il rimborso, perché il
-- documento può essere datato al giorno in cui il compenso è stato concordato, non a quello in
-- cui lo si stampa. Resta una data, non un timestamp: sul documento l'ora non c'entra.
alter table op_periodi
  add column if not exists data_consuntivo date;

-- I periodi già chiusi tengono la data che avevano di fatto, così la colonna non nasce vuota.
update op_periodi
   set data_consuntivo = creato_il::date
 where data_consuntivo is null;
