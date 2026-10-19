-- ============================================================
-- Pagamenti: incassi in contanti e chi li ritira
-- Schema da eseguire nell'SQL Editor di Supabase.
-- ============================================================

-- Un pagamento nasce elettronico. Quando invece il cliente paga in contanti i soldi non passano
-- dall'azienda: li ritira l'operatore sul posto, e da lì in poi sono una partita aperta con lui.
-- Due conseguenze, ed entrambe hanno bisogno di questi due campi:
--   - quella quota non si fattura (il contante non entra nel giro delle fatture elettroniche);
--   - nella consuntivazione dei bubbler va saputo chi li ha in mano, partita per partita.
alter table pagamenti add column if not exists contanti boolean not null default false;

-- Chi ritira i soldi: utenti.id dell'operatore, scelto fra quelli assegnati alla prenotazione.
-- Resta nullo sui pagamenti elettronici, e su un contante registrato prima di aver assegnato
-- gli operatori -- in quel caso la prenotazione lo segnala come "da attribuire".
alter table pagamenti add column if not exists ritirato_da bigint;

create index if not exists pagamenti_contanti_idx on pagamenti (ritirato_da) where contanti;

-- Controllo: quanti incassi in contanti e quanti senza operatore indicato.
-- select count(*) filter (where contanti) as in_contanti,
--        count(*) filter (where contanti and ritirato_da is null) as da_attribuire
--   from pagamenti;
