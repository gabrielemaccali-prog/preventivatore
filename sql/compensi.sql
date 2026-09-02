-- ============================================================
-- Modulo Compensi — parametri di calcolo dei compensi operatori (bubbler).
-- Schema da eseguire nell'SQL Editor di Supabase.
--
-- Questo file copre solo il passo 1 (configuratore): le tabelle op_periodi e op_voci,
-- che nascono con la consuntivazione, arriveranno con i passi successivi.
-- ============================================================

-- Parametri globali del calcolo: una riga sola, sempre id = 1.
-- Il vincolo sull'id evita che qualcuno inserisca una seconda riga di parametri e l'app
-- si ritrovi a scegliere fra due configurazioni contraddittorie.
create table if not exists compensi_parametri (
  id int primary key default 1,
  prima_ora numeric not null default 30,          -- € per la prima ora di ogni blocco
  ora_successiva numeric not null default 10,     -- € per ogni ora oltre la prima (la mezz'ora vale metà)
  tetto_giornaliero numeric not null default 120, -- tetto sul solo compenso orario, sulla somma dei blocchi del giorno
  bonus_recensione numeric not null default 5,    -- € per recensione positiva, una per operatore per partita
  aliquota_ritenuta numeric not null default 20,  -- % di ritenuta d'acconto (prestazione occasionale)
  gap_consecutivita_min int not null default 60,  -- minuti di stacco entro cui due partite restano nello stesso blocco
  aggiornato_il timestamptz not null default now(),
  constraint compensi_parametri_riga_unica check (id = 1)
);

-- La riga di default: ripetibile senza sovrascrivere i valori già impostati.
insert into compensi_parametri (id) values (1) on conflict (id) do nothing;

-- Nota: il compenso concordato (importo pattuito che sostituisce il calcolo a ore e si ripartisce
-- sulle ore del periodo) non è una proprietà dell'operatore e non sta qui: è una scelta fatta in
-- fase di consuntivazione, quindi vivrà su op_periodi insieme agli altri valori congelati.
-- Il preventivo si calcola sempre a ore, per tutti.
