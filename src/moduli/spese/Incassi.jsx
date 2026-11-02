import { useState, useEffect, useMemo, Fragment } from 'react'
import { supabase, leggiTutte } from '../../lib/supabaseClient'
import { formattaDataGGMMAAAA } from '../../lib/utils'
import { euro, r2, eFoglia, percorsoCategoria } from '../../lib/banca'
import { SceltaCategoria } from './Classificazione'
import { leggiCategorieIncassi } from './CategorieIncassi'
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
// ============================================================

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
  const [inCorso, setInCorso] = useState(false);
  const [stato, setStato] = useState(STATI_INCASSO.DA_ABBINARE);
  const [mese, setMese] = useState('');
  const [cerca, setCerca] = useState('');
  // L'accredito che si sta abbinando a mano, con le unità scelte e la ricerca.
  const [aMano, setAMano] = useState(null); // { id, scelte: Set, cerca }

  const ricarica = async () => {
    const [pg, pr, vc, cat] = await leggiPagamenti();
    const colonna = (pg.data || []).length === 0 || 'movimento_id' in pg.data[0];
    setSchemaMancante(cat.error?.message || (colonna ? null : 'manca la colonna pagamenti.movimento_id'));
    setPagamenti(pg.data || []);
    setPrenotazioni(pr.data || []);
    setVoucher(vc.data || []);
    setCategorie(cat.data || []);
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
    .filter(m => !mese || m.data_contabile.startsWith(mese))
    .filter(m => !stato || statoDi(m) === stato)
    .filter(m => !t || [m.descrizione, String(m.importo)].some(v => (v || '').toLowerCase().includes(t)))
    .sort((a, b) => b.data_contabile.localeCompare(a.data_contabile) || b.id - a.id);
  const totale = r2(visibili.reduce((s, m) => s + Number(m.importo), 0));

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
    setAMano(null);
  });
  const scollega = (m) => scrivi(async () => {
    if (!window.confirm("Scollegare l'accredito dai suoi pagamenti? I pagamenti restano: tornano soltanto da abbinare.")) return;
    await esegui(supabase.from('pagamenti').update({ movimento_id: null }).eq('movimento_id', m.id));
  });
  const assegnaCategoria = (m, idCategoria) => scrivi(async () => {
    await esegui(supabase.from('banca_movimenti').update({ incasso_categoria_id: idCategoria || null }).eq('id', m.id));
  });

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
    const testo = (aMano?.cerca || '').trim().toLowerCase();
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
          <label className="albatros-etichetta" style={{ flex: '0 1 170px' }}>Mese
            <input type="month" value={mese} onChange={(e) => setMese(e.target.value)} className="albatros-campo" />
          </label>
          <label className="albatros-etichetta" style={{ flex: '0 1 200px' }}>Stato
            <select value={stato} onChange={(e) => setStato(e.target.value)} className="albatros-campo">
              <option value="">Tutti ({accrediti.length})</option>
              {[STATI_INCASSO.DA_ABBINARE, STATI_INCASSO.PROPOSTO, STATI_INCASSO.ABBINATO, STATI_INCASSO.CATEGORIA, STATI_INCASSO.IGNORATO].map(s => (
                <option key={s} value={s}>{ETICHETTA_STATO[s].testo} ({conta(s)})</option>
              ))}
            </select>
          </label>
          <label className="albatros-etichetta filtro-largo" style={{ flex: '1 1 180px' }}>Cerca
            <input type="search" value={cerca} placeholder="Nome, causale, importo…" onChange={(e) => setCerca(e.target.value)} className="albatros-campo" />
          </label>
          <div style={{ marginLeft: 'auto', textAlign: 'right', fontSize: '0.88rem' }}>
            <div>Incassi <strong style={{ color: '#15803d' }}>{euro(totale)}</strong></div>
            <div className="albatros-tenue">{visibili.length} accrediti</div>
          </div>
        </div>
        {visibili.length === 0 && <p className="albatros-vuoto" style={{ marginTop: '12px' }}>Nessun accredito.</p>}
        {visibili.length > 0 && (
          <div style={{ overflowX: 'auto', marginTop: '12px' }}>
            <table className="albatros-tabella tabella-schede">
              <thead><tr><th>Data</th><th>Mittente</th><th>Causale</th><th className="num">Importo</th><th>Natura</th><th>Destinazione</th><th></th></tr></thead>
              <tbody>
                {visibili.map(m => {
                  const s = statoDi(m);
                  const etichetta = ETICHETTA_STATO[s];
                  const legate = [...(abbinateA.get(m.id)?.values() || [])];
                  const proposta = proposte[m.id] ? unitaPerChiave.get(proposte[m.id]) : null;
                  const aperto = aMano?.id === m.id;
                  const elencoAMano = aperto ? (() => {
                    const trovate = candidate(m);
                    const fuori = unita.filter(u => aMano.scelte.has(u.chiave) && !trovate.some(c => c.u.chiave === u.chiave)).map(u => ({ u, nomi: [], stessoImporto: false, proposta: false, altrove: null }));
                    return [...trovate, ...fuori];
                  })() : [];
                  const prova = aperto ? controllaAbbinamento(m, unita.filter(u => aMano.scelte.has(u.chiave))) : null;
                  return (
                    <Fragment key={m.id}>
                      <tr style={{ cursor: 'default', opacity: m.ignorato ? 0.55 : 1 }}>
                        <td className="sk-sx" style={{ whiteSpace: 'nowrap' }}>{formattaDataGGMMAAAA(m.data_contabile)}</td>
                        <td style={{ maxWidth: '200px', fontSize: '0.8rem', fontWeight: 600 }}>{ordinanteDi(m) || m.tipo}</td>
                        <td className="sk-testo" style={{ maxWidth: '300px', fontSize: '0.78rem', color: '#475569' }} title={m.descrizione}>{causaleDi(m).slice(0, 110)}</td>
                        <td className="num" style={{ color: '#15803d', fontWeight: 600, whiteSpace: 'nowrap' }}>{euro(m.importo)}</td>
                        <td><span className={`albatros-badge mini ${etichetta.classe}`} style={etichetta.classe ? undefined : { background: '#f1f5f9', color: '#64748b' }}>{etichetta.testo}</span></td>
                        <td style={{ fontSize: '0.8rem', maxWidth: '300px' }}>
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
                        </td>
                        <td className="sk-azioni" style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                          {s === STATI_INCASSO.PROPOSTO && proposta && <button type="button" className="albatros-chip albatros-chip-avviso" disabled={inCorso} onClick={() => abbina(m, [proposta])}>Conferma</button>}
                          {(s === STATI_INCASSO.PROPOSTO || s === STATI_INCASSO.DA_ABBINARE) && (
                            <button type="button" className="albatros-chip" disabled={inCorso} onClick={() => setAMano(aperto ? null : { id: m.id, scelte: new Set(proposte[m.id] ? [proposte[m.id]] : []), cerca: '' })}>{aperto ? 'Chiudi' : 'Abbina'}</button>
                          )}
                          {/* Una categoria per quello che non viene da una prenotazione né da un voucher; anche
                              su una proposta, che può essere sbagliata. Senza categorie si dice dove crearle. */}
                          {(s === STATI_INCASSO.DA_ABBINARE || s === STATI_INCASSO.PROPOSTO) && (categorie.some(c => c.attiva) ? (
                            <span style={{ display: 'inline-block', marginLeft: '6px', verticalAlign: 'middle' }}>
                              <SceltaCategoria categorie={categorie} valore={null} compatta vuoto="Generale: categoria…" onChange={(id) => id != null && assegnaCategoria(m, id)} />
                            </span>
                          ) : (
                            <button type="button" className="albatros-chip" style={{ marginLeft: '6px' }} title="Nessuna categoria degli incassi: si creano nel Configuratore, sottoscheda Categorie incassi" onClick={() => vaiA('configuratore', 'incassi')}>Crea categorie</button>
                          ))}
                          {s === STATI_INCASSO.ABBINATO && <button type="button" className="albatros-chip" disabled={inCorso} onClick={() => scollega(m)}>Scollega</button>}
                          {s === STATI_INCASSO.CATEGORIA && (
                            <span style={{ display: 'inline-block', verticalAlign: 'middle' }}>
                              <SceltaCategoria categorie={categorie} valore={m.incasso_categoria_id} compatta onChange={(id) => assegnaCategoria(m, id)} vuoto="Togli la categoria" />
                            </span>
                          )}
                        </td>
                      </tr>
                      {aperto && (
                        <tr style={{ cursor: 'default', background: '#f8fafc' }}>
                          <td colSpan={7} style={{ padding: '10px 12px' }}>
                            <input type="search" value={aMano.cerca} placeholder="Cerca per codice, nome o importo" onChange={(e) => setAMano({ ...aMano, cerca: e.target.value })} className="albatros-campo" style={{ maxWidth: '360px', height: '32px' }} />
                            <p className="albatros-tenue" style={{ margin: '6px 0 0', fontSize: '0.78rem' }}>
                              Scegli il pagamento (o i pagamenti) registrati nell'app che questo accredito ha portato. Compaiono quelli non ancora legati alla banca, entro un mese,
                              con lo stesso importo o un nome in comune (fino a tre mesi quando il nome torna bene); per gli altri usa la ricerca.
                            </p>
                            {elencoAMano.length === 0 && <p className="albatros-tenue" style={{ margin: '8px 0 0', fontSize: '0.8rem' }}>Nessun pagamento libero che somigli a questo accredito: cercalo per nome o codice. Se non viene da una prenotazione né da un voucher, è un incasso generale: dagli una categoria.</p>}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '8px' }}>
                              {elencoAMano.map(({ u, nomi, stessoImporto, proposta: suaProposta, altrove }) => (
                                <label key={u.chiave} style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '0.8rem', cursor: 'pointer' }}>
                                  <input type="checkbox" checked={aMano.scelte.has(u.chiave)} onChange={(e) => {
                                    const n = new Set(aMano.scelte);
                                    if (e.target.checked) n.add(u.chiave); else n.delete(u.chiave);
                                    setAMano({ ...aMano, scelte: n });
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
                            {prova && aMano.scelte.size > 0 && (
                              <p style={{ margin: '8px 0 0', fontSize: '0.8rem', color: prova.torna ? '#166534' : '#b45309' }}>
                                Scelti {euro(prova.somma)} su {euro(m.importo)}{prova.torna ? ' · tornano' : ` · ${prova.differenza > 0 ? 'mancano' : 'avanzano'} ${euro(Math.abs(prova.differenza))}`}
                              </p>
                            )}
                            <button type="button" className="btn-accent-inline albatros-bottone" style={{ marginTop: '8px' }} disabled={inCorso || !prova?.torna} onClick={() => abbina(m, unita.filter(u => aMano.scelte.has(u.chiave)))}>Abbina</button>
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
      </div>
    </div>
  );
}

export default Incassi
