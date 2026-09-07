-- ============================================================
-- Due strascichi rimasti dopo il passaggio a utenti.id.
-- Da eseguire nell'SQL Editor di Supabase.
--
-- Il grosso è già fatto: disp_calendario, disp_conferme, op_voci e op_periodi hanno la foreign
-- key su utenti(id) e non hanno più un solo riferimento appeso. Restano due residui isolati,
-- che nessuna delle due migrazioni ha raccolto.
-- ============================================================

-- ------------------------------------------------------------
-- 1) L'ULTIMA PRENOTAZIONE CON L'OPERATORE SCRITTO PER NOME.
--
-- PRN-2026-1031 (12/09/2026, confermata) ha ancora operatori = [{"id": "Lorenzo Negrisoli", ...}]
-- invece dell'id numerico. È l'unica rimasta su 13 riferimenti: le prenotazioni salvate dopo di
-- lei hanno tutte l'id, quindi il codice in produzione scrive già correttamente e questa è una
-- riga rimasta indietro, non una perdita ancora in corso.
--
-- Il campo "nome" dentro il json non si tocca: è la fotografia di come si chiamava l'operatore
-- il giorno della partita, ed è giusto che resti quella anche se oggi si chiama diversamente.
-- ------------------------------------------------------------

-- Prima: quali sono, e a quale utente corrisponderebbero.
select p.id, p.data, p.stato, e->>'id' as id_scritto, e->>'nome' as nome_congelato, u.id as utente_id
  from prenotazioni p,
       lateral jsonb_array_elements(p.operatori::jsonb) e
       left join utenti u on u.username = e->>'id'
 where jsonb_typeof(p.operatori::jsonb) = 'array'
   and jsonb_typeof(e->'id') = 'string';

do $$
declare
  tipo_colonna text;
  non_risolti  int;
begin
  -- Uno username che non esiste in utenti non si può convertire: meglio fermarsi e guardarlo,
  -- che scrivere un null al posto del riferimento.
  select count(*) into non_risolti
    from prenotazioni p, lateral jsonb_array_elements(p.operatori::jsonb) e
   where jsonb_typeof(p.operatori::jsonb) = 'array'
     and jsonb_typeof(e->'id') = 'string'
     and not exists (select 1 from utenti u where u.username = e->>'id');
  if non_risolti > 0 then
    raise exception 'Ci sono % operatori con uno username che non esiste in utenti: guardali prima di convertire.', non_risolti;
  end if;

  select data_type into tipo_colonna
    from information_schema.columns
   where table_schema = 'public' and table_name = 'prenotazioni' and column_name = 'operatori';

  execute format(
    'update prenotazioni p
        set operatori = (
              select jsonb_agg(
                       case when jsonb_typeof(e->''id'') = ''string'' and u.id is not null
                            then jsonb_set(e, ''{id}'', to_jsonb(u.id))
                            else e end
                       order by ord)
                from jsonb_array_elements(p.operatori::jsonb) with ordinality as t(e, ord)
                left join utenti u on u.username = e->>''id''
            )::%s
      where jsonb_typeof(p.operatori::jsonb) = ''array''
        and exists (select 1 from jsonb_array_elements(p.operatori::jsonb) x
                     where jsonb_typeof(x->''id'') = ''string'')',
    tipo_colonna
  );
end $$;

-- ------------------------------------------------------------
-- 2) LE VOCI COMPENSO APPESE A UNA PRENOTAZIONE CANCELLATA.
--
-- Cancellando le prenotazioni di prova sono rimaste tre voci che puntano a PRN-2026-1019, che
-- non esiste più: una recensione da 5 €, due spese da 5 e 10 €, tutte del 21/08 e tutte di
-- Diego. Il codice ripulisce "pagamenti" quando si cancella una prenotazione, ma non "op_voci":
-- nessuno le ha portate via.
--
-- Si tolgono, non si riattaccano: la partita a cui si riferivano non c'è più, e una spesa senza
-- la giornata che la giustifica non è recuperabile — è solo un importo che gonfia un compenso.
-- Si può fare senza remore perché op_periodi è oggi vuota: nessuna di queste voci è dentro un
-- consuntivo già chiuso, quindi non si sta riscrivendo niente di congelato.
-- ------------------------------------------------------------

-- Prima: cosa verrebbe eliminato. Guardala, prima di eseguire la delete.
select v.id, v.data, v.tipo, v.descrizione, v.importo, v.riferimento, u.username as operatore
  from op_voci v left join utenti u on u.id = v.operatore_id
 where v.riferimento is not null
   and not exists (select 1 from prenotazioni p where p.id = v.riferimento);

-- La rete di sicurezza: se nel frattempo qualcuno ha consuntivato un periodo che contiene una di
-- queste voci, la cancellazione toglierebbe righe da sotto un documento già chiuso. In quel caso
-- ci si ferma e si decide a mano (riaprire il periodo, oppure lasciarle dove sono).
do $$
declare dentro_un_periodo int;
begin
  select count(*) into dentro_un_periodo
    from op_voci v
   where v.riferimento is not null
     and not exists (select 1 from prenotazioni p where p.id = v.riferimento)
     and exists (select 1 from op_periodi pe
                  where pe.operatore_id = v.operatore_id
                    and v.data between pe.dal and pe.al);
  if dentro_un_periodo > 0 then
    raise exception '% di queste voci stanno dentro un periodo già consuntivato: vanno decise a mano.', dentro_un_periodo;
  end if;
end $$;

delete from op_voci v
 where v.riferimento is not null
   and not exists (select 1 from prenotazioni p where p.id = v.riferimento);

-- ------------------------------------------------------------
-- 3) DOPO — tutte e due le query devono tornare vuote.
-- ------------------------------------------------------------
select 'operatore ancora per nome' as problema, p.id, e->>'id' as valore
  from prenotazioni p, lateral jsonb_array_elements(p.operatori::jsonb) e
 where jsonb_typeof(p.operatori::jsonb) = 'array'
   and jsonb_typeof(e->'id') <> 'number'
union all
select 'voce senza prenotazione', v.id::text, v.riferimento
  from op_voci v
 where v.riferimento is not null
   and not exists (select 1 from prenotazioni p where p.id = v.riferimento);
