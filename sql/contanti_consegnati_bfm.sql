-- ============================================================
-- Contanti consegnati a BFM.
-- Da eseguire nell'SQL Editor di Supabase.
--
-- I contanti che il cliente dà a un bubbler restano in mano sua (pagamenti.ritirato_da) finché
-- non li consegna: da Consuntivazione > Bubbler si ritirano con un clic, e da quel momento sono in
-- mano a BFM. Il bubbler resta scritto su chi li aveva ritirati dal cliente; la data dice solo che
-- non li ha più lui. Null = ancora in mano a chi li ha ritirati.
--
-- Additiva: nessun pagamento cambia.
-- ============================================================

alter table pagamenti add column if not exists consegnati_bfm_il date;

-- Controllo: la colonna c'e', e quanti contanti sono oggi in mano ai bubbler.
select count(*) filter (where contanti and ritirato_da is not null) as contanti_in_mano_ai_bubbler,
       count(*) filter (where consegnati_bfm_il is not null) as consegnati_a_bfm
  from pagamenti;
