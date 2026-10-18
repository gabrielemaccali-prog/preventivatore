-- ============================================================
-- Bonifica dei nomi di sede congelati nelle righe di preventivi e prenotazioni.
-- Da eseguire nell'SQL Editor di Supabase.
--
-- IL PROBLEMA. Le righe di un preventivo e di una prenotazione scrivono la sede di partenza per
-- nome, e quel nome e' cambiato: prima era "referente - citta" ("Ezio - Bergamo"), oggi e' il nome
-- della sede ("Laquilone"). Le righe vecchie si sono portate dietro il nome di allora, quindi la
-- stessa sede compare due volte in ogni resoconto e i costi di quelle righe non si attribuiscono
-- piu' a nessuna controparte in consuntivazione.
--
-- LA CURA. Non si traduce il nome a ogni lettura: si scrive l'id della sede sulla riga -- "sedeId",
-- che il codice preferisce al nome perche' una rinomina non lo tocca -- e si riallinea il nome a
-- quello di adesso. Dopo questo script la prossima rinomina non lascera' indietro niente.
--
-- L'abbinamento prova prima il nome intero, poi la parte prima del trattino, contro i nomi e i
-- referenti dell'anagrafica. La citta' non si guarda: basta un refuso ("Beramo" per Bergamo) a far
-- fallire il confronto, e il referente da solo e' sufficiente. Le righe che non si riconoscono non
-- vengono toccate: restano scritte come sono, e si vedono.
--
-- Da eseguire una volta. E' ripetibile: la seconda volta non trova piu' niente da cambiare.
-- ============================================================

begin;
set local lock_timeout = '3s';

-- ------------------------------------------------------------
-- PREVENTIVI: le righe di listino portano "sedePartenza".
-- ------------------------------------------------------------
update preventivi p
   set gonfiabili = sub.nuovo
  from (
    select p2.codice,
           jsonb_agg(
             case when s.id is not null
                  then r.riga || jsonb_build_object('sedePartenza', s.nome, 'sedeId', s.id)
                  else r.riga
             end
             order by r.idx
           ) as nuovo
      from preventivi p2
      cross join lateral jsonb_array_elements(p2.gonfiabili) with ordinality as r(riga, idx)
      left join lateral (
        select sd.id, sd.nome
          from sedi sd
         where lower(trim(sd.nome)) = lower(trim(r.riga->>'sedePartenza'))
            or lower(trim(coalesce(sd.nome, ''))) = lower(trim(split_part(r.riga->>'sedePartenza', ' - ', 1)))
            or lower(trim(coalesce(sd.referente, ''))) = lower(trim(split_part(r.riga->>'sedePartenza', ' - ', 1)))
         order by case when lower(trim(sd.nome)) = lower(trim(r.riga->>'sedePartenza')) then 0 else 1 end
         limit 1
      ) s on r.riga->>'sedePartenza' is not null and r.riga->>'sedePartenza' <> '—'
     where jsonb_typeof(p2.gonfiabili) = 'array'
     group by p2.codice
  ) sub
 where p.codice = sub.codice
   and p.gonfiabili is distinct from sub.nuovo;

-- ------------------------------------------------------------
-- PRENOTAZIONI: le righe per gioco portano "sede". Il trattino "—" non e' una sede -- vuol dire
-- "non parte da nessun magazzino" -- e resta com'e'.
-- ------------------------------------------------------------
update prenotazioni p
   set voci = sub.nuovo
  from (
    select p2.id,
           jsonb_agg(
             case when s.id is not null
                  then r.riga || jsonb_build_object('sede', s.nome, 'sedeId', s.id)
                  else r.riga
             end
             order by r.idx
           ) as nuovo
      from prenotazioni p2
      cross join lateral jsonb_array_elements(p2.voci) with ordinality as r(riga, idx)
      left join lateral (
        select sd.id, sd.nome
          from sedi sd
         where lower(trim(sd.nome)) = lower(trim(r.riga->>'sede'))
            or lower(trim(coalesce(sd.nome, ''))) = lower(trim(split_part(r.riga->>'sede', ' - ', 1)))
            or lower(trim(coalesce(sd.referente, ''))) = lower(trim(split_part(r.riga->>'sede', ' - ', 1)))
         order by case when lower(trim(sd.nome)) = lower(trim(r.riga->>'sede')) then 0 else 1 end
         limit 1
      ) s on r.riga->>'sede' is not null and r.riga->>'sede' <> '—'
     where jsonb_typeof(p2.voci) = 'array'
     group by p2.id
  ) sub
 where p.id = sub.id
   and p.voci is distinct from sub.nuovo;

commit;

-- ------------------------------------------------------------
-- Controllo. I nomi elencati devono essere solo quelli dell'anagrafica (piu' "—" e gli eventuali
-- sconosciuti), e ogni riga riconosciuta ha adesso il suo sedeId. Questa query non scrive niente:
-- per il confronto col prima, si puo' lanciare da sola anche prima dell'aggiornamento.
-- ------------------------------------------------------------
select 'preventivi' as dove, r.riga->>'sedePartenza' as nome_scritto,
       count(*) as righe, count(r.riga->>'sedeId') as con_id
  from preventivi p
  cross join lateral jsonb_array_elements(case when jsonb_typeof(p.gonfiabili) = 'array' then p.gonfiabili else '[]'::jsonb end) as r(riga)
 where r.riga->>'sedePartenza' is not null
 group by 2
union all
select 'prenotazioni', r.riga->>'sede', count(*), count(r.riga->>'sedeId')
  from prenotazioni p
  cross join lateral jsonb_array_elements(case when jsonb_typeof(p.voci) = 'array' then p.voci else '[]'::jsonb end) as r(riga)
 where r.riga->>'sede' is not null
 group by 2
 order by 1, 3 desc;

-- Le righe che non si sono riconosciute: se ce ne sono, vanno guardate a mano.
select p.codice, r.riga->>'sedePartenza' as nome_scritto
  from preventivi p
  cross join lateral jsonb_array_elements(case when jsonb_typeof(p.gonfiabili) = 'array' then p.gonfiabili else '[]'::jsonb end) as r(riga)
 where r.riga->>'sedePartenza' is not null
   and r.riga->>'sedePartenza' <> '—'
   and r.riga->>'sedeId' is null;
