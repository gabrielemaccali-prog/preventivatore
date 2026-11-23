-- ============================================================
-- Albatros: le voci di uno scontrino si correggono finché non si salva il dettaglio.
-- Da eseguire nell'SQL Editor di Supabase.
--
-- Una voce appena scritta (salvata = false) la può cambiare o togliere chiunque: si sta ancora
-- copiando lo scontrino. Il tasto "Salva il dettaglio" la fissa (salvata = true), e da lì la
-- corregge solo l'amministratore. Le voci già scritte prima di questo script sono fissate.
-- ============================================================

begin;
set local lock_timeout = '3s';

-- Le voci che ci sono già nascono salvate; quelle nuove, da salvare.
alter table albatros_spese_righe add column if not exists salvata boolean not null default true;
alter table albatros_spese_righe alter column salvata set default false;

commit;
