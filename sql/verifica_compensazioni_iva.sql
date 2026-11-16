-- ============================================================
-- Le partite in compensazione e l'IVA
-- Da eseguire nell'SQL Editor di Supabase. Non modifica niente: guarda e basta.
--
-- Una partita commissionata da un fornitore o da un campo non si fattura a un cliente: si compensa
-- con quello che gli dobbiamo, e una compensazione non e' un'operazione soggetta a IVA. Il prezzo
-- concordato e' quello che e': lordo e netto devono coincidere.
--
-- Da oggi le nuove nascono cosi'. Queste due query servono per quelle di prima, inserite quando
-- l'app ci aggiungeva il 22% come su una vendita qualsiasi.
-- ============================================================

-- 1) Il riassunto: quante sono e come stanno.
select
  case
    when "prezzoVenditaNetto" is null then 'netto mancante'
    when abs(coalesce("prezzoVendita", 0) - "prezzoVenditaNetto") < 0.01 then 'senza IVA (a posto)'
    when abs(coalesce("prezzoVendita", 0) - "prezzoVenditaNetto" * 1.22) < 0.05 then 'con IVA 22% (da sistemare)'
    else 'altro rapporto (da guardare)'
  end as come_sta,
  count(*) as quante,
  round(sum(coalesce("prezzoVendita", 0))::numeric, 2) as totale_lordo,
  round(sum(coalesce("prezzoVenditaNetto", 0))::numeric, 2) as totale_netto
from prenotazioni
where "clienteSedeId" is not null or "clienteCampoId" is not null
group by 1
order by 2 desc;

-- 2) Riga per riga, per decidere cosa segnare.
select
  p.id,
  p.data,
  p.stato,
  p.nominativo,
  p."pacchettoNome",
  p."clienteSedeId",
  p."clienteCampoId",
  round(coalesce(p."prezzoVendita", 0)::numeric, 2)      as lordo,
  round(coalesce(p."prezzoVenditaNetto", 0)::numeric, 2) as netto,
  case
    when p."prezzoVenditaNetto" is null then 'netto mancante'
    when abs(coalesce(p."prezzoVendita", 0) - p."prezzoVenditaNetto") < 0.01 then 'senza IVA'
    when abs(coalesce(p."prezzoVendita", 0) - p."prezzoVenditaNetto" * 1.22) < 0.05 then 'con IVA 22%'
    else 'altro rapporto'
  end as come_sta
from prenotazioni p
where p."clienteSedeId" is not null or p."clienteCampoId" is not null
order by p.data desc;

-- 3) La correzione, gia' decisa: il netto e' l'importo concordato, quello che va in
--    compensazione. Il lordo lo raggiunge, perche' su una compensazione non c'e' IVA da aggiungere.
--    Gli id sono le otto righe lette il 16 novembre 2026: scritti per esteso, cosi' questo update
--    vale solo per loro e non puo' prendersi righe arrivate dopo.
-- update prenotazioni
--   set "prezzoVendita" = "prezzoVenditaNetto",
--       "prezzoVenditaLordo" = "prezzoVenditaNetto"
--   where id in ('PRN-2026-1132', 'PRN-2026-1102', 'PRN-2026-1107', 'PRN-2026-1047',
--                'PRG-2026-0121', 'PRG-2026-0083', 'PRG-2026-0088', 'PRG-2026-0022');
