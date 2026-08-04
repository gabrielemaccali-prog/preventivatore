-- ============================================================
-- Preventivi: prezzo concordato con il fornitore
-- Schema da eseguire nell'SQL Editor di Supabase.
-- ============================================================

-- Flag del preventivo: sblocca nella tabella di vendita la scelta della sede e il costo digitato
-- a mano, per riscrivere quanto calcolato dal sistema quando con un fornitore è stato pattuito
-- un importo diverso. Sta accanto a "mostraComeOpzioni"/"mostraGiocoOfferta", che sono
-- anch'esse opzioni di presentazione del preventivo.
alter table preventivi add column if not exists "prezzoConcordato" boolean not null default false;

-- Il dettaglio per riga NON richiede nuove colonne: sede e costo pattuiti finiscono negli elementi
-- della colonna jsonb "gonfiabili", che già trasporta "sedePartenza" e "costoNoleggio". Le righe
-- concordate si riconoscono dal campo "concordato": true, aggiunto dall'app al salvataggio.
-- Sulle righe concordate "costoLogistica" e "kmCalcolati" restano a zero, perché l'importo
-- pattuito è il costo pieno e comprende già il trasporto.
