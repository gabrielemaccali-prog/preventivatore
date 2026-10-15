-- ============================================================
-- Albatros: chi fa il pagamento.
-- Da eseguire nell'SQL Editor di Supabase, dopo sql/albatros_pagamenti.sql.
--
-- I pagamenti a Lama li fa Albatros oppure BFM: pagante 'albatros' | 'bfm'. I pagamenti in
-- contanti di Albatros abbassano i contanti che Albatros ha in mano; quelli di BFM no.
-- I pagamenti gia' registrati sono stati fatti da Albatros (contanti di Albatros).
-- ============================================================

begin;
set local lock_timeout = '3s';

alter table albatros_pagamenti add column if not exists pagante text not null default 'albatros';
alter table albatros_pagamenti alter column pagante drop default;

commit;

select id, data, pagante, beneficiario, causale, importo, metodo from albatros_pagamenti order by data, id;
