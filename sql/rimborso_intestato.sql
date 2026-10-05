-- ============================================================
-- Rimborso intestato a un altro bubbler.
-- Da eseguire nell'SQL Editor di Supabase, dopo sql/bubbler_senza_ritenuta.sql.
--
-- IL CASO. Alcuni collaboratori lavorano ma non emettono una ricevuta propria: il loro compenso
-- finisce su quella di un altro, che la firma per il totale. Se a Diego spettano 355 euro e a Tiz
-- 75, la ricevuta di Diego ne dichiara 430 e la ritenuta si calcola su quel totale -- non su due
-- importi separati, perché il documento è uno solo ed è intestato a lui.
--
-- COSA NON CAMBIA. I costi restano attribuiti a chi ha lavorato: le righe per partita del periodo
-- di Tiz restano sue, e nel Cruscotto le sue partite continuano a costare quello che costano.
-- L'intestatario riguarda il solo documento di rimborso, non la contabilità per partita.
--
-- LE DUE COLONNE.
--   utenti.rimborso_intestato_a   l'utente su cui si intesta il rimborso; null = ricevuta propria
--   op_periodi.confluito_in       il periodo la cui ricevuta ha assorbito questo; null = a sé stante
--
-- Il periodo di chi ha un intestatario si consuntiva come gli altri ma non risulta pagato finché
-- la ricevuta che lo contiene non è stata emessa: è quel documento a renderlo evaso, e insieme a
-- valorizzargli confluito_in. Senza questo, lo stesso importo risulterebbe pagato due volte --
-- una sul periodo di Tiz e una dentro il totale di Diego.
--
-- Additiva e ripetibile: chi non ha intestatario si comporta esattamente come prima.
-- ============================================================

-- Chi ha un intestatario non emette ricevuta propria. Resta un bigint semplice senza foreign key,
-- come le altre relazioni di questo progetto: l'integrità la tiene l'applicazione, che del resto è
-- l'unica a conoscere le regole vere (niente catene, e l'intestatario non può essere a sua volta
-- uno a consuntivazione diretta).
alter table utenti
  add column if not exists rimborso_intestato_a bigint;

comment on column utenti.rimborso_intestato_a is
  'Utente sulla cui ricevuta finisce il compenso di questo bubbler. Null = ricevuta propria. Si esclude con senza_ritenuta.';

-- Il periodo che ha assorbito questo dentro la propria ricevuta.
alter table op_periodi
  add column if not exists confluito_in bigint;

comment on column op_periodi.confluito_in is
  'Periodo la cui ricevuta ha pagato anche questo. Null = periodo a sé stante.';

create index if not exists op_periodi_confluito_idx on op_periodi (confluito_in);
