-- Il valore del buono sul PDF diventa facoltativo.
--
-- Un voucher è un regalo: chi lo riceve non deve per forza leggere quanto è stato speso.
-- La scelta è per singolo voucher, non una regola globale, perché in qualche caso il valore
-- serve eccome — un buono usato come rimborso, per esempio.
--
-- Nasce nascosto: è il caso normale, e chi lo vuole in chiaro lo dice con una spunta.
-- La colonna vale anche per i voucher già emessi, che quindi da adesso stampano senza importo:
-- il PDF si rigenera ogni volta dai dati correnti, non è un documento congelato.
alter table voucher
  add column if not exists nascondi_importo boolean not null default true;
