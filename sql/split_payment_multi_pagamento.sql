-- ============================================================
-- Split payment e pagamenti su più prenotazioni.
-- Da eseguire nell'SQL Editor di Supabase.
--
-- 1. prenotazioni."splitPayment": l'ente (di norma pubblico) paga solo l'imponibile e versa l'IVA
--    all'erario. Da incassare c'è il netto, e con quello la partita è saldata. Sta sulla
--    prenotazione perché il cliente non ha una tabella sua: l'app la propone quando lo stesso
--    cliente (stessa P.IVA o stesso codice fiscale) l'ha già avuta.
--
-- 2. pagamenti.gruppo: le quote di uno stesso bonifico che salda più prenotazioni portano lo
--    stesso codice. Ogni prenotazione continua ad avere la sua riga, con la sua quota: stato del
--    pagamento, Da saldare e Cruscotto non cambiano. Il codice serve a tenerle insieme -- si
--    modificano solo tutte insieme -- e alla riconciliazione con la banca, dove un accredito
--    si confronta con il totale del bonifico e non con le singole quote.
--
-- Additive, con default: niente di quello che c'è cambia.
-- ============================================================

begin;
set local lock_timeout = '3s';

alter table prenotazioni add column if not exists "splitPayment" boolean not null default false;
alter table pagamenti add column if not exists gruppo text;
create index if not exists pagamenti_gruppo_idx on pagamenti (gruppo) where gruppo is not null;

commit;

-- Il caso che ha fatto nascere lo split payment: il Comune di Pieve Emanuele (fattura 178, €488),
-- che ha versato i €400 dell'imponibile. Si segna a mano dall'app, nei dati di fatturazione della
-- prenotazione; per trovarla:
-- select id, data, nominativo, "ragioneSociale", "prezzoVendita", "statoPagamento" from prenotazioni
--  where "ragioneSociale" ilike '%pieve emanuele%';

-- Controllo: le due colonne ci sono.
select
  (select count(*) from prenotazioni where "splitPayment") as prenotazioni_split,
  (select count(*) from pagamenti where gruppo is not null) as quote_di_bonifici;
