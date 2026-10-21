-- ============================================================
-- Un bubbler si può disattivare.
-- Da eseguire nell'SQL Editor di Supabase.
--
-- Disattivo vuol dire che non lavora: non si propone come operatore in Prenotazioni e non si
-- aspettano le sue disponibilità. Resta sulle partite a cui era già assegnato e sui compensi che
-- ha maturato, e si riattiva quando serve. Un bubbler nuovo può nascere disattivo con il solo
-- nome e cognome: residenza, codice fiscale, telefono ed email si chiedono quando lo si attiva.
--
-- Tutti quelli di oggi restano attivi. Si può rieseguire.
-- ============================================================

alter table utenti add column if not exists attivo boolean not null default true;

-- Controllo: quanti bubbler attivi e quanti no. Subito dopo la migrazione sono tutti attivi.
select count(*) filter (where attivo)     as attivi,
       count(*) filter (where not attivo) as disattivi
  from utenti
 where bubbler;
