-- ============================================================
-- Albatros: le voci del listino non hanno piu' un ordine manuale.
-- Da eseguire nell'SQL Editor di Supabase. Facoltativo: l'app la colonna non la usa piu'.
--
-- Griglia e listino ordinano le voci per categoria (nell'ordine deciso dal Configuratore) e poi
-- per nome. L'ordine delle categorie resta.
-- ============================================================

alter table albatros_listino drop column if exists ordine;
