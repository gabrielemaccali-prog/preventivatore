-- ============================================================
-- L'IBAN del bubbler.
-- Da eseguire nell'SQL Editor di Supabase.
--
-- Sta su "utenti" come il resto dell'anagrafica del bubbler (residenza, codice fiscale): è il
-- conto su cui gli arriva il rimborso, e si scrive nel configuratore di Disponibilità insieme
-- agli altri suoi dati.
--
-- Si conserva senza spazi e in maiuscolo, come lo vogliono banca e bonifico.
-- ============================================================

alter table utenti add column if not exists iban text;

-- Controllo: quanti bubbler hanno già l'IBAN. Subito dopo la migrazione sono zero.
select count(*) filter (where iban is not null and iban <> '') as con_iban,
       count(*)                                                as bubbler_totali
  from utenti
 where bubbler;
