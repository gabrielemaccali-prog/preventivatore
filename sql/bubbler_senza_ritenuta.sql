-- ============================================================
-- Bubbler senza ritenuta d'acconto.
-- Da eseguire nell'SQL Editor di Supabase.
--
-- Non tutti i collaboratori vanno pagati con la ritenuta: per alcuni non c'è nessuna ritenuta da
-- versare e nessuna ricevuta da emettere. Per loro la fase intermedia del modulo Compensi --
-- "Elabora rimborsi", che esiste per calcolare la ritenuta e produrre il documento -- non ha senso:
-- il periodo si chiude e risulta pagato in un passaggio solo ("Consuntiva diretto"), finendo subito
-- fra i rimborsi evasi.
--
-- È una proprietà della persona, non della singola consuntivazione: si spunta una volta
-- nell'anagrafica (Disponibilità > Configuratore > Bubbler) e da lì in poi vale sempre.
--
-- Additiva e ripetibile: i bubbler esistenti nascono senza la spunta, cioè con il comportamento
-- di oggi, e nessun periodo già chiuso viene toccato.
-- ============================================================

alter table utenti
  add column if not exists senza_ritenuta boolean not null default false;

comment on column utenti.senza_ritenuta is
  'Il compenso si consuntiva in un passaggio solo, senza ritenuta d''acconto e senza documento di rimborso.';
