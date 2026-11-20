import { useState, useEffect, useMemo, Fragment } from 'react'
import { supabase, leggiTutte } from '../../lib/supabaseClient'
import { formattaDataGGMMAAAA } from '../../lib/utils'
import Icona from '../../components/Icona'
import { euro, r2, eFoglia, percorsoCategoria } from '../../lib/banca'
import { SceltaCategoria } from './Classificazione'
import { leggiCategorieIncassi } from './CategorieIncassi'
import FiltroPeriodo from '../albatros/FiltroPeriodo'
import { periodoIniziale, intervalloPeriodo } from '../albatros/calcolo'
import Paginazione, { usePaginazione } from '../../components/Paginazione'
import {
  eIncasso, ordinanteDi, causaleDi, parole, unitaDiPagamento, proposteIncassi, statoIncasso, controllaAbbinamento, STATI_INCASSO, GIORNI_INCASSO, GIORNI_INCASSO_CON_NOME, PAROLE_NOME_SICURO,
} from '../../lib/incassi'

// ============================================================
// Incassi: gli accrediti dell'estratto conto, classificati come le spese.
//   operativi  abbinati al pagamento (o ai pagamenti) di una prenotazione o di un voucher;
//   generali   tutto il resto (capitale versato, vendite, rimborsi), con una categoria all'ultimo
//              livello dell'albero deciso nel Configuratore.
// Finché non è né l'uno né l'altro un incasso è da completare. La regola degli abbinamenti sta in
// lib/incassi: qui si mostrano le proposte, si confermano e si abbina a mano quello che non trovano.
// Abbinando, la data del pagamento registrato a mano si allinea a quella della banca: è quella vera.
// Il layout è quello delle spese: gli stati come pulsanti sopra la tabella, la natura in una colonna,
// e la modifica in linea, una riga per volta, con Salva e Annulla.
// ============================================================

// Le celle dell'elenco, basse come nelle spese.
const CELLA = { padding: '5px 8px', verticalAlign: 'middle' };
// I pulsanti degli stati, sopra la tabella.
const PULSANTI_STATO = [
  { stato: STATI_INCASSO.DA_ABBINARE, testo: 'Da completare', avviso: true },
  { stato: STATI_INCASSO.PROPOSTO, testo: 'Proposti' },
  { stato: STATI_INCASSO.ABBINATO, testo: 'Operativi' },
  { stato: STATI_INCASSO.CATEGORIA, testo: 'Generali' },
  { stato: STATI_INCASSO.IGNORATO, testo: 'Ignorati' },
];

const ETICHETTA_STATO = {
  [STATI_INCASSO.ABBINATO]: { testo: 'Operativo', classe: 'chiusa' },
  [STATI_INCASSO.CATEGORIA]: { testo: 'Generale', classe: 'chiusa' },
  [STATI_INCASSO.PROPOSTO]: { testo: 'Proposto', classe: 'da-specificare' },
  [STATI_INCASSO.DA_ABBINARE]: { testo: 'Da completare', classe: 'oltre' },
  [STATI_INCASSO.IGNORATO]: { testo: 'Ignorato', classe: '' },
};

const leggiPagamenti = () => Promise.all([
  leggiTutte(() => supabase.from('pagamenti').select('*').order('id')),
  leggiTutte(() => supabase.from('prenotazioni').select('id, data, nominativo, ragioneSociale, fattNome, fattCognome').order('id')),
  supabase.from('voucher').select('codice, nominativo, ragioneSociale, fattNome, fattCognome'),
  leggiCategorieIncassi(),
]);

function Incassi({ movimenti, ricaricaDati, vaiA }) {
  const [pagamenti, setPagamenti] = useState([]);
  const [prenotazioni, setPrenotazioni] = useState([]);
  const [voucher, setVoucher] = useState([]);
  const [categorie, setCategorie] = useState([]);
  const [schemaMancante, setSchemaMancante] = useState(null);
  // Finché i pagamenti non sono arrivati nessun accredito risulta abbinato: mostrare l'elenco vorrebbe
  // dire farli sembrare tutti da completare per mezzo secondo.
  const [caricato, setCaricato] = useState(false);
  const [inCorso, setInCorso] = useState(false);
  const [stato, setStato] = useState(''); // si parte da tutti gli accrediti
  // Il periodo come in Albatros (anno, mese, settimana); si parte da tutti gli accrediti.
  const [periodo, setPeriodo] = useState(() => ({ ...periodoIniziale(), tipo: 'tutto' }));
  const intervallo = periodo.tipo === 'tutto' ? null : intervalloPeriodo(periodo);
  const nelPeriodo = (data) => !intervallo || (String(data).slice(0, 10) >= intervallo[0] && String(data).slice(0, 10) <= intervallo[1]);
  const [cerca, setCerca] = useState('');
  // La riga in modifica, come nelle spese: una per volta, si scrive solo premendo Salva.
  //   natura   'operativo' (abbinato a dei pagamenti), 'generale' (con una categoria) o '' (da completare)
  //   scelte   le unità di pagamento scelte, per un operativo; cerca: la ricerca fra i pagamenti
  //   categoria  per un generale
  const [riga, setRiga] = useState(null);

  const ricarica = async () => {
    const [pg, pr, vc, cat] = await leggiPagamenti();
    const colonna = (pg.data || []).length === 0 || 'movimento_id' in pg.data[0];
    setSchemaMancante(cat.error?.message || (colonna ? null : 'manca la colonna pagamenti.movimento_id'));
    setPagamenti(pg.data || []);
    setPrenotazioni(pr.data || []);
    setVoucher(vc.data || []);
    setCategorie(cat.data || []);
    setCaricato(true);
  };
  useEffect(() => { ricarica(); }, []);

  // Di chi è un pagamento: la prenotazione o il voucher, con i loro nomi. Chi paga non è sempre chi ha
  // prenotato, e il nome che si legge in banca può essere l'uno o l'altro.
  const prenPerId = useMemo(() => new Map(prenotazioni.map(p => [p.id, p])), [prenotazioni]);
  const voucherPerCodice = useMemo(() => new Map(voucher.map(v => [v.codice, v])), [voucher]);
  const proprietario = (pg) => (pg.tipo === 'voucher' ? voucherPerCodice.get(pg.riferimento) : prenPerId.get(pg.riferimento)) || null;
  const nomiDi = (pg) => {
    const x = proprietario(pg);
    return x ? [x.nominativo, x.ragioneSociale, `${x.fattNome || ''} ${x.fattCognome || ''}`] : [];
  };
  const unita = useMemo(() => unitaDiPagamento(pagamenti, nomiDi), [pagamenti, prenPerId, voucherPerCodice]);
  const unitaPerChiave = useMemo(() => new Map(unita.map(u => [u.chiave, u])), [unita]);
  const proposte = useMemo(() => proposteIncassi({ movimenti, unita }), [movimenti, unita]);
  const abbinateA = useMemo(() => {
    const per = new Map();
    unita.forEach(u => {
      u.righe.forEach(r => {
        if (r.movimento_id == null) return;
        if (!per.has(r.movimento_id)) per.set(r.movimento_id, new Map());
        per.get(r.movimento_id).set(u.chiave, u);
      });
    });
    return per;
  }, [unita]);

  const accrediti = movimenti.filter(m => Number(m.importo) > 0);
  // Come per le spese: una categoria che nel frattempo ha preso delle sottocategorie non basta più,
  // e l'incasso torna da completare finché non si sceglie la sottocategoria.
  const statoDi = (m) => statoIncasso(
    m.incasso_categoria_id != null && !eFoglia(categorie, m.incasso_categoria_id) ? { ...m, incasso_categoria_id: null } : m,
    { unitaAbbinate: [...(abbinateA.get(m.id)?.values() || [])], proposta: proposte[m.id] },
  );
  const conta = (s) => accrediti.filter(m => statoDi(m) === s).length;
  const t = cerca.trim().toLowerCase();
  const visibili = accrediti
    .filter(m => nelPeriodo(m.data_contabile))
    .filter(m => !stato || statoDi(m) === stato)
    .filter(m => !t || [m.descrizione, String(m.importo)].some(v => (v || '').toLowerCase().includes(t)))
    .sort((a, b) => b.data_contabile.localeCompare(a.data_contabile) || b.id - a.id);
  // Il totale in alto è di tutti gli accrediti filtrati; la tabella li mostra 50 per volta.
  const totale = r2(visibili.reduce((s, m) => s + Number(m.importo), 0));
  const pagine = usePaginazione(visibili.length, [periodo, stato, cerca]);

  // Cosa ha portato un'unità, in una riga: i codici, e il nome di chi ha prenotato.
  const descriviUnita = (u) => {
    const codici = [...new Set(u.righe.map(r => r.riferimento))];
    const nome = proprietario(u.righe[0]);
    return `${codici.join(' + ')}${nome ? ` · ${nome.ragioneSociale || nome.nominativo || ''}` : ''}`;
  };

  const scrivi = async (fn) => {
    setInCorso(true);
    try {
      await fn();
      await ricarica();
      await ricaricaDati();
    } catch (err) {
      alert(`Errore: ${err.message}`);
    } finally {
      setInCorso(false);
    }
  };
  const esegui = async (q) => { const { error } = await q; if (error) throw error; };

  // Abbina un accredito alle unità scelte. Le date diverse da quella della banca si allineano, se lo si
  // conferma: la data scritta a mano è quella che ha detto il cliente, quella della banca è il fatto.
  const abbina = (m, unitaScelte, { chiedi = true } = {}) => scrivi(async () => {
    const { torna, dateDiverse } = controllaAbbinamento(m, unitaScelte);
    if (!torna) throw new Error("i pagamenti scelti non fanno l'importo dell'accredito");
    const allinea = dateDiverse.length > 0 && (!chiedi || window.confirm(
      `La data registrata (${[...new Set(dateDiverse.map(r => formattaDataGGMMAAAA(r.data)))].join(', ')}) non è quella della banca (${formattaDataGGMMAAAA(m.data_contabile)}). La allineo a quella della banca?`
    ));
    const ids = unitaScelte.flatMap(u => u.righe.map(r => r.id));
    await esegui(supabase.from('pagamenti').update({ movimento_id: m.id, ...(allinea ? { data: m.data_contabile } : {}) }).in('id', ids));
    setRiga(null);
  });

  // La modifica in linea parte da com'è l'accredito adesso: abbinato o proposto è operativo, con una
  // categoria è generale. Una proposta si porta dietro il suo pagamento, già scelto.
  const modificaRiga = (m) => {
    const s = statoDi(m);
    const legate = [...(abbinateA.get(m.id)?.keys() || [])];
    const natura = s === STATI_INCASSO.ABBINATO || s === STATI_INCASSO.PROPOSTO ? 'operativo'
      : m.incasso_categoria_id != null ? 'generale' : '';
    const scelte = new Set(s === STATI_INCASSO.ABBINATO ? legate : proposte[m.id] ? [proposte[m.id]] : []);
    setRiga({ id: m.id, natura, scelte, cerca: '', categoria: m.incasso_categoria_id ?? null });
  };
  // Si salva tutto insieme. Cambiando natura quello di prima si toglie: i pagamenti scollegati restano,
  // tornano soltanto da abbinare; la categoria si toglie da un operativo.
  const salvaRiga = (m) => {
    const legateOra = abbinateA.has(m.id);
    const scollegaPagamenti = () => esegui(supabase.from('pagamenti').update({ movimento_id: null }).eq('movimento_id', m.id));
    const categoria = (id) => esegui(supabase.from('banca_movimenti').update({ incasso_categoria_id: id }).eq('id', m.id));
    if (riga.natura === 'operativo') {
      const scelte = unita.filter(u => riga.scelte.has(u.chiave));
      const { torna, dateDiverse } = controllaAbbinamento(m, scelte);
      if (!scelte.length || !torna) return alert("I pagamenti scelti non fanno l'importo dell'accredito.");
      const allinea = dateDiverse.length > 0 && window.confirm(
        `La data registrata (${[...new Set(dateDiverse.map(r => formattaDataGGMMAAAA(r.data)))].join(', ')}) non è quella della banca (${formattaDataGGMMAAAA(m.data_contabile)}). La allineo a quella della banca?`
      );
      return scrivi(async () => {
        if (legateOra) await scollegaPagamenti();
        if (m.incasso_categoria_id != null) await categoria(null);
        await esegui(supabase.from('pagamenti').update({ movimento_id: m.id, ...(allinea ? { data: m.data_contabile } : {}) }).in('id', scelte.flatMap(u => u.righe.map(r => r.id))));
        setRiga(null);
      });
    }
    if (legateOra && !window.confirm("L'accredito è abbinato a dei pagamenti: salvando si scollega. I pagamenti restano, tornano soltanto da abbinare.")) return;
    if (riga.natura === 'generale') {
      if (riga.categoria == null || !eFoglia(categorie, riga.categoria)) return alert("Scegli la categoria, fino all'ultimo livello.");
      return scrivi(async () => {
        if (legateOra) await scollegaPagamenti();
        await categoria(riga.categoria);
        setRiga(null);
      });
    }
    return scrivi(async () => {
      if (legateOra) await scollegaPagamenti();
      if (m.incasso_categoria_id != null) await categoria(null);
      setRiga(null);
    });
  };

  // Tutte le proposte in un colpo: sono centinaia, e confermarle una per una non aggiunge niente.
  // Le date si allineano tutte insieme, se lo si vuole.
  const daConfermare = accrediti.filter(m => statoDi(m) === STATI_INCASSO.PROPOSTO);
  const confermaTutte = () => scrivi(async () => {
    const coppie = daConfermare.map(m => ({ m, u: unitaPerChiave.get(proposte[m.id]) })).filter(x => x.u);
    const conDateDiverse = coppie.filter(({ m, u }) => u.righe.some(r => r.data !== m.data_contabile)).length;
    if (!window.confirm(`Confermare ${coppie.length} abbinamenti proposti?`)) return;
    const allinea = conDateDiverse > 0 && window.confirm(`In ${conDateDiverse} la data registrata non è quella della banca. Le allineo a quella della banca?`);
    for (let i = 0; i < coppie.length; i += 10) {
      await Promise.all(coppie.slice(i, i + 10).map(({ m, u }) => esegui(supabase.from('pagamenti')
        .update({ movimento_id: m.id, ...(allinea ? { data: m.data_contabile } : {}) }).in('id', u.righe.map(r => r.id)))));
    }
  });

  // Le unità fra cui scegliere a mano: libere; prima quelle con lo stesso importo e la data vicina.
  // A chi è già stata proposta un'unità: nell'elenco a mano si dice, perché sceglierla qui la toglie
  // all'altro accredito.
  const propostaA = useMemo(() => new Map(Object.entries(proposte).map(([id, chiave]) => [chiave, Number(id)])), [proposte]);
  const movimentoPerId = useMemo(() => new Map(movimenti.map(x => [x.id, x])), [movimenti]);
  // Le unità fra cui scegliere a mano, con il motivo per cui compaiono. Solo quelle libere. Senza
  // ricerca: la proposta di questo accredito per prima, poi quelle con un nome in comune, poi quelle con
  // lo stesso importo, tutte entro un mese. Con la ricerca: tutte quelle che la contengono.
  const candidate = (m) => {
    const testo = (riga?.cerca || '').trim().toLowerCase();
    const suoNome = new Set(parole(`${ordinanteDi(m)} ${causaleDi(m)}`));
    const libere = unita.filter(u => u.movimentoId == null && !u.inParte);
    const giorniDa = (u) => Math.abs((new Date(u.data) - new Date(m.data_contabile)) / 86400000);
    const conMotivo = (u) => {
      const nomi = parole(u.nomi.join(' ')).filter(p => suoNome.has(p));
      const stessoImporto = Math.abs(u.importo - Number(m.importo)) <= 0.005;
      const altro = propostaA.get(u.chiave);
      return {
        u, nomi, stessoImporto,
        proposta: proposte[m.id] === u.chiave,
        // Proposta per un altro accredito: si può prendere lo stesso, ma va detto.
        altrove: altro != null && altro !== m.id ? movimentoPerId.get(altro) : null,
        // Le libere vengono sempre prima: le altre hanno già un accredito che le aspetta.
        punti: (proposte[m.id] === u.chiave ? 1000 : 0) + (altro != null && altro !== m.id ? 0 : 100) + nomi.length * 10 + (stessoImporto ? 5 : 0) - giorniDa(u) / 100,
      };
    };
    const elenco = testo
      ? libere.filter(u => [descriviUnita(u), ...u.nomi, String(u.importo)].some(v => String(v || '').toLowerCase().includes(testo)))
      : libere.filter(u => u.importo <= Number(m.importo) + 0.005);
    // Senza ricerca: un mese per chi ha solo l'importo, tre per chi ha il nome che torna bene.
    return elenco.map(conMotivo)
      .filter(c => testo || c.proposta
        || (c.nomi.length >= PAROLE_NOME_SICURO && giorniDa(c.u) <= GIORNI_INCASSO_CON_NOME)
        || ((c.nomi.length > 0 || c.stessoImporto) && giorniDa(c.u) <= GIORNI_INCASSO * 2))
      .sort((a, b) => b.punti - a.punti)
      .slice(0, 12);
  };

  if (!caricato) {
    return <div className="albatros-pagina no-print"><p className="albatros-vuoto">Caricamento degli incassi…</p></div>;
  }

  if (schemaMancante) {
    return (
      <div className="albatros-pagina no-print">
        <p className="albatros-avviso">Per gli incassi esegui <strong>sql/incassi_banca.sql</strong> e <strong>sql/incassi_categorie_due_livelli.sql</strong> nell'SQL Editor di Supabase. ({schemaMancante})</p>
      </div>
    );
  }

  return (
    <div className="albatros-pagina no-print">
      {daConfermare.length > 0 && (
        <div className="albatros-avviso" style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span>
            <strong>{daConfermare.length === 1 ? 'Un abbinamento proposto' : `${daConfermare.length} abbinamenti proposti`}</strong>: accrediti della banca per cui c'è già, nell'app, un pagamento con lo stesso importo, la data vicina e il nome che torna.
            Confermare non crea pagamenti e non cambia gli importi: lega l'accredito a quel pagamento. Se la data registrata è diversa, ti chiede se allinearla a quella della banca.
          </span>
          <button type="button" className="albatros-chip albatros-chip-avviso" disabled={inCorso} onClick={confermaTutte}>Conferma tutti</button>
          <button type="button" className="albatros-chip" disabled={inCorso} onClick={() => setStato(STATI_INCASSO.PROPOSTO)}>Mostrali</button>
        </div>
      )}

      <div className="albatros-card">
        <div className="albatros-testata filtri-telefono">
          <div className="albatros-etichetta" style={{ flex: '0 1 auto' }}>Periodo
            <div><FiltroPeriodo periodo={periodo} onChange={setPeriodo} conTutto /></div>
          </div>
          <label className="albatros-etichetta filtro-largo" style={{ flex: '1 1 180px' }}>Cerca
            <input type="search" value={cerca} placeholder="Nome, causale, importo…" onChange={(e) => setCerca(e.target.value)} className="albatros-campo" />
          </label>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '12px' }}>
          <button type="button" className={`albatros-chip ${stato === '' ? 'attivo' : ''}`} onClick={() => setStato('')}>Tutti</button>
          {PULSANTI_STATO.map(p => (
            <button key={p.stato} type="button" className={`albatros-chip ${p.avviso ? 'albatros-chip-avviso' : ''} ${stato === p.stato ? 'attivo' : ''}`}
              disabled={!conta(p.stato) && stato !== p.stato} onClick={() => setStato(p.stato)}>{p.testo} ({conta(p.stato)})</button>
          ))}
          <div style={{ marginLeft: 'auto', textAlign: 'right', fontSize: '0.88rem' }}>
            <div>Totale: <strong style={{ color: '#15803d' }}>{euro(totale)}</strong></div>
            <div className="albatros-tenue">{visibili.length} accrediti</div>
          </div>
        </div>
        {visibili.length === 0 && <p className="albatros-vuoto" style={{ marginTop: '12px' }}>Nessun accredito.</p>}
        {visibili.length > 0 && (
          <div style={{ overflowX: 'auto', marginTop: '12px' }}>
            <table className="albatros-tabella tabella-schede">
              <thead><tr><th>Data</th><th>Mittente</th><th>Causale</th><th>Natura</th><th>Destinazione</th><th className="num">Importo</th><th></th></tr></thead>
              <tbody>
                {pagine.fetta(visibili).map(m => {
                  const s = statoDi(m);
                  const etichetta = ETICHETTA_STATO[s];
                  const legate = [...(abbinateA.get(m.id)?.values() || [])];
                  const proposta = proposte[m.id] ? unitaPerChiave.get(proposte[m.id]) : null;
                  const inModifica = riga?.id === m.id;
                  // Operativo in modifica: sotto la riga si scelgono i pagamenti.
                  const aperto = inModifica && riga.natura === 'operativo';
                  const elencoAMano = aperto ? (() => {
                    const trovate = candidate(m);
                    const fuori = unita.filter(u => riga.scelte.has(u.chiave) && !trovate.some(c => c.u.chiave === u.chiave)).map(u => ({ u, nomi: [], stessoImporto: false, proposta: false, altrove: null }));
                    return [...trovate, ...fuori];
                  })() : [];
                  const prova = aperto ? controllaAbbinamento(m, unita.filter(u => riga.scelte.has(u.chiave))) : null;
                  return (
                    <Fragment key={m.id}>
                      <tr className={inModifica ? 'selezionata' : ''} style={{ cursor: 'default', opacity: m.ignorato ? 0.55 : 1 }}>
                        <td className="sk-sx" style={{ ...CELLA, whiteSpace: 'nowrap' }}>{formattaDataGGMMAAAA(m.data_contabile)}</td>
                        <td style={{ ...CELLA, maxWidth: '200px', fontSize: '0.8rem', fontWeight: 600 }}>{ordinanteDi(m) || m.tipo}</td>
                        <td className="sk-testo" style={{ ...CELLA, maxWidth: '300px', fontSize: '0.78rem', color: '#475569' }} title={m.descrizione}>{causaleDi(m).slice(0, 110)}</td>
                        <td data-etichetta="Natura" style={CELLA}>
                          {inModifica ? (
                            <select className="table-input" value={riga.natura} onChange={(e) => setRiga({ ...riga, natura: e.target.value })} style={{ height: '26px', padding: '2px 6px', fontSize: '0.8rem', minWidth: '125px' }}>
                              <option value="">Da completare</option>
                              <option value="operativo">Operativo</option>
                              <option value="generale">Generale</option>
                            </select>
                          ) : (
                            <span className={`albatros-badge mini ${etichetta.classe}`} style={etichetta.classe ? undefined : { background: '#f1f5f9', color: '#64748b' }}>{etichetta.testo}</span>
                          )}
                        </td>
                        <td data-etichetta="Destinazione" style={{ ...CELLA, fontSize: '0.8rem', maxWidth: '300px' }}>
                          {inModifica ? (
                            riga.natura === 'generale' ? (categorie.some(c => c.attiva)
                              ? <SceltaCategoria categorie={categorie} valore={riga.categoria} compatta vuoto="Categoria…" onChange={(id) => setRiga({ ...riga, categoria: id })} />
                              : <button type="button" className="albatros-chip" title="Nessuna categoria degli incassi: si creano nel Configuratore, sottoscheda Categorie incassi" onClick={() => vaiA('configuratore', 'incassi')}>Crea categorie</button>)
                              : riga.natura === 'operativo'
                                ? <span className="albatros-tenue">Scegli i pagamenti qui sotto</span>
                                : <span className="albatros-tenue">Resta da completare</span>
                          ) : (<>
                            {s === STATI_INCASSO.ABBINATO && legate.map(u => (
                              <div key={u.chiave}>{descriviUnita(u)} <span className="albatros-tenue" style={{ fontSize: '0.75rem' }}>· {euro(u.importo)} del {formattaDataGGMMAAAA(u.data)}</span></div>
                            ))}
                            {s === STATI_INCASSO.CATEGORIA && percorsoCategoria(categorie, m.incasso_categoria_id)}
                            {s === STATI_INCASSO.DA_ABBINARE && m.incasso_categoria_id != null && <span className="albatros-tenue">{percorsoCategoria(categorie, m.incasso_categoria_id)}: manca la sottocategoria</span>}
                            {/* Cosa fa la conferma, detto per esteso: il pagamento c'è già, si lega soltanto. */}
                            {s === STATI_INCASSO.PROPOSTO && proposta && (
                              <span>
                                <span className="albatros-tenue">Pagamento già registrato:</span> {descriviUnita(proposta)}
                                <div className="albatros-tenue" style={{ fontSize: '0.75rem' }}>
                                  {euro(proposta.importo)} del {formattaDataGGMMAAAA(proposta.data)}
                                  {proposta.righe.length > 1 && ` · bonifico in ${proposta.righe.length} quote`}
                                </div>
                                {proposta.data !== m.data_contabile && (
                                  <div style={{ fontSize: '0.75rem', color: '#b45309' }}>la data registrata è diversa: confermando puoi allinearla al {formattaDataGGMMAAAA(m.data_contabile)}</div>
                                )}
                              </span>
                            )}
                          </>)}
                        </td>
                        <td className="num sk-dx" style={{ ...CELLA, color: '#15803d', fontWeight: 600, whiteSpace: 'nowrap' }}>{euro(m.importo)}</td>
                        <td className="sk-azioni" style={{ ...CELLA, whiteSpace: 'nowrap', textAlign: 'right' }}>
                          {inModifica ? (
                            <>
                              <button type="button" className="btn-accent-inline" disabled={inCorso || (aperto && !prova?.torna)} onClick={() => salvaRiga(m)} style={{ display: 'inline-flex', alignItems: 'center', fontSize: '0.78rem', padding: '3px 8px', marginRight: '4px' }}><Icona nome="salva" size={13} style={{ marginRight: '4px' }} />Salva</button>
                              <button type="button" className="btn-outline-annulla" disabled={inCorso} onClick={() => setRiga(null)} style={{ display: 'inline-flex', alignItems: 'center', fontSize: '0.78rem', padding: '3px 8px', borderRadius: '4px' }}><Icona nome="annulla" size={13} style={{ marginRight: '4px' }} />Annulla</button>
                            </>
                          ) : (
                            <>
                              {s === STATI_INCASSO.PROPOSTO && proposta && <button type="button" className="albatros-chip albatros-chip-avviso" disabled={inCorso || !!riga} onClick={() => abbina(m, [proposta])} style={{ marginRight: '4px' }}>Conferma</button>}
                              {!m.ignorato && <button type="button" className="btn-icon-action" title={riga ? 'Finisci prima la riga che stai modificando' : 'Modifica natura e destinazione'} disabled={!!riga || inCorso} onClick={() => modificaRiga(m)}><Icona nome="modifica" size={14} style={{ marginRight: 0 }} /></button>}
                            </>
                          )}
                        </td>
                      </tr>
                      {aperto && (
                        <tr style={{ cursor: 'default', background: '#f8fafc' }}>
                          <td colSpan={7} style={{ padding: '10px 12px' }}>
                            <input type="search" value={riga.cerca} placeholder="Cerca per codice, nome o importo" onChange={(e) => setRiga({ ...riga, cerca: e.target.value })} className="albatros-campo" style={{ maxWidth: '360px', height: '32px' }} />
                            <p className="albatros-tenue" style={{ margin: '6px 0 0', fontSize: '0.78rem' }}>
                              Scegli il pagamento (o i pagamenti) registrati nell'app che questo accredito ha portato, poi premi Salva sulla riga. Compaiono quelli non ancora legati alla banca, entro un mese,
                              con lo stesso importo o un nome in comune (fino a tre mesi quando il nome torna bene); per gli altri usa la ricerca.
                            </p>
                            {elencoAMano.length === 0 && <p className="albatros-tenue" style={{ margin: '8px 0 0', fontSize: '0.8rem' }}>Nessun pagamento libero che somigli a questo accredito: cercalo per nome o codice. Se non viene da una prenotazione né da un voucher, è un incasso generale: dagli una categoria.</p>}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '8px' }}>
                              {elencoAMano.map(({ u, nomi, stessoImporto, proposta: suaProposta, altrove }) => (
                                <label key={u.chiave} style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '0.8rem', cursor: 'pointer' }}>
                                  <input type="checkbox" checked={riga.scelte.has(u.chiave)} onChange={(e) => {
                                    const n = new Set(riga.scelte);
                                    if (e.target.checked) n.add(u.chiave); else n.delete(u.chiave);
                                    setRiga({ ...riga, scelte: n });
                                  }} />
                                  <span style={{ minWidth: '80px', fontWeight: 600 }}>{euro(u.importo)}</span>
                                  <span className="albatros-tenue" style={{ minWidth: '80px' }}>{formattaDataGGMMAAAA(u.data)}</span>
                                  <span>
                                    {descriviUnita(u)}{u.righe[0].nominativo ? <span className="albatros-tenue"> · pagato da {u.righe[0].nominativo}</span> : null}
                                    <span style={{ display: 'block', fontSize: '0.72rem', color: '#64748b' }}>
                                      {[
                                        suaProposta && 'proposta per questo accredito',
                                        nomi.length > 0 && `nome in comune: ${nomi.map(p => p.charAt(0) + p.slice(1).toLowerCase()).join(', ')}`,
                                        stessoImporto && 'stesso importo',
                                      ].filter(Boolean).join(' · ')}
                                      {altrove && <span style={{ color: '#b45309' }}>{' · '}proposta per l'accredito del {formattaDataGGMMAAAA(altrove.data_contabile)} di {ordinanteDi(altrove) || 'un altro mittente'}</span>}
                                    </span>
                                  </span>
                                </label>
                              ))}
                            </div>
                            {prova && riga.scelte.size > 0 && (
                              <p style={{ margin: '8px 0 0', fontSize: '0.8rem', color: prova.torna ? '#166534' : '#b45309' }}>
                                Scelti {euro(prova.somma)} su {euro(m.importo)}{prova.torna ? ' · tornano' : ` · ${prova.differenza > 0 ? 'mancano' : 'avanzano'} ${euro(Math.abs(prova.differenza))}`}
                              </p>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Paginazione {...pagine} />
      </div>
    </div>
  );
}

export default Incassi
