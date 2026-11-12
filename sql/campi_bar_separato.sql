-- ============================================================
-- Campi col bar di un'altra società.
-- Da eseguire nell'SQL Editor di Supabase.
--
-- In alcuni centri sportivi il bar (merende e aperitivi) è un'azienda diversa da chi affitta i
-- campi. Le prenotazioni non cambiano; in consuntivazione affitto e rinfreschi diventano due voci
-- da pagare a parte: "Comasina campi" e "Comasina rinfreschi: <società del bar>".
-- I rinfreschi si consuntivano con controparte_id '<id campo>:bar' in cons_periodi e cons_voci:
-- la colonna è testo, e non serve nient'altro.
--
-- Additiva: un campo senza la spunta resta com'era.
-- ============================================================

alter table pren_campi add column if not exists "barSeparato" boolean not null default false;
alter table pren_campi add column if not exists "barSocieta" text;

-- Controllo: le colonne ci sono e nessun campo ha ancora il bar separato.
select count(*) as campi, count(*) filter (where "barSeparato") as con_bar_separato from pren_campi;
