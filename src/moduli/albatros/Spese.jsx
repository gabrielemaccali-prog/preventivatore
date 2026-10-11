import { useState, useEffect, useMemo, Fragment } from 'react'
import { supabase } from '../../lib/supabaseClient'
import Icona from '../../components/Icona'
import { formattaDataGGMMAAAA } from '../../lib/utils'
import {
  nomeCategoria, idCategoriaScelta, ENTI, etichettaEnte, num, r2, euro, giornataDiLavoro, periodoIniziale, intervalloPeriodo,
  dettaglioSpesa, rigaSpesaConsentita,
} from './calcolo'
import FiltroPeriodo from './FiltroPeriodo'
import SceltaCategoria from './SceltaCategoria'

// ============================================================
// Le uscite del centro, registrate solo qui: non entrano nella chiusura della serata. Ogni spesa
// la paga uno dei tre enti (Albatros, BFM, Lama); se non si sa ancora resta "da attribuire" e
// l'elenco la segnala. Attribuirla è riempire un campo vuoto: lo può fare chiunque.
// I ragazzi possono solo aggiungere; modificare ed eliminare spetta all'amministratore.
// Nuova spesa e modifica si fanno nello stesso overlay.
// Una spesa è uno scontrino col suo totale; toccandola si apre il dettaglio, dove si scrivono le
// voci che la compongono (anche dopo, anche in parte) senza superare il totale. Aggiungere voci lo
// può fare chiunque, toglierle solo l'amministratore.
// ============================================================

const leggiImporto = (v) => { const n = Number(String(v ?? '').trim().replace(',', '.')); return Number.isFinite(n) ? r2(n) : NaN; };
const VOCE_VUOTA = { descrizione: '', importo: '', categoria: null };
const SPESA_VUOTA = () => ({ id: null, data: giornataDiLavoro(), importo: '', descrizione: '', categoria: null, ente: '' });

function Spese({ user, categorie, utenti, puoCorreggere }) {
  const [spese, setSpese] = useState([]);
  const [periodo, setPeriodo] = useState(periodoIniziale);
  const [filtroEnte, setFiltroEnte] = useState('');
  // La spesa nell'overlay: null = chiuso; senza id è una spesa nuova.
  const [modulo, setModulo] = useState(null);
  const [inCorso, setInCorso] = useState(false);
  // Le voci di dettaglio, per spesa; la spesa aperta e la voce che si sta scrivendo dentro.
  const [vociPer, setVociPer] = useState({});
  const [espansa, setEspansa] = useState(null);
  const [nuovaVoce, setNuovaVoce] = useState(VOCE_VUOTA);

  const [da, al] = intervalloPeriodo(periodo);

  const carica = async () => {
    const { data } = await supabase.from('albatros_spese').select('*')
      .gte('data', da).lte('data', al)
      .order('data', { ascending: false }).order('id', { ascending: false });
    setSpese(data || []);
    const ids = (data || []).map(x => x.id);
    const { data: voci } = ids.length
      ? await supabase.from('albatros_spese_righe').select('*').in('spesa_id', ids).order('id')
      : { data: [] };
    const mappa = {};
    (voci || []).forEach(v => { (mappa[v.spesa_id] = mappa[v.spesa_id] || []).push(v); });
    setVociPer(mappa);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { carica(); }, [da, al]);

  // filtroEnte: '' = tutte, 'nessuno' = da attribuire, altrimenti l'id dell'ente.
  const visibili = useMemo(() => spese.filter(s => !filtroEnte || (filtroEnte === 'nessuno' ? !s.ente : s.ente === filtroEnte)), [spese, filtroEnte]);
  const daAttribuire = spese.filter(s => !s.ente);
  const totale = (elenco) => r2(elenco.reduce((t, s) => t + num(s.importo), 0));

  const salva = async () => {
    const importo = leggiImporto(modulo.importo);
    const descrizione = modulo.descrizione.trim();
    if (!modulo.data) return alert('Scegli la data.');
    if (!descrizione) return alert('Scrivi cosa è stato pagato.');
    if (!importo || importo <= 0) return alert('Importo non valido.');
    const giaDettagliato = modulo.id ? dettaglioSpesa({ importo }, vociPer[modulo.id]).dettagliato : 0;
    if (importo < giaDettagliato) return alert(`Il dettaglio di questa spesa arriva già a ${euro(giaDettagliato)}: il totale non può essere più basso.`);
    const record = { data: modulo.data, importo, descrizione, categoria_id: idCategoriaScelta(modulo.categoria, categorie, 'spesa'), ente: modulo.ente || null };
    setInCorso(true);
    try {
      const { error } = modulo.id
        ? await supabase.from('albatros_spese').update(record).eq('id', modulo.id)
        : await supabase.from('albatros_spese').insert([{ ...record, creato_da: user.id }]);
      if (error) return alert(`Errore nel salvataggio: ${error.message}`);
      setModulo(null);
      await carica();
    } finally {
      setInCorso(false);
    }
  };

  const elimina = async (s) => {
    if (!window.confirm(`Eliminare la spesa "${s.descrizione}" di ${euro(s.importo)}?`)) return;
    const { error } = await supabase.from('albatros_spese').delete().eq('id', s.id);
    if (error) return alert(`Errore: ${error.message}`);
    if (modulo?.id === s.id) setModulo(null);
    carica();
  };

  const attribuisci = async (s, ente) => {
    if (!ente) return;
    const { error } = await supabase.from('albatros_spese').update({ ente }).eq('id', s.id);
    if (error) return alert(`Errore: ${error.message}`);
    carica();
  };

  const apriDettaglio = (s) => {
    setEspansa(espansa === s.id ? null : s.id);
    setNuovaVoce(VOCE_VUOTA);
  };

  const aggiungiVoce = async (s) => {
    const descrizione = nuovaVoce.descrizione.trim();
    const importo = leggiImporto(nuovaVoce.importo);
    if (!descrizione) return alert('Scrivi cosa è stato comprato.');
    if (!importo || importo <= 0) return alert('Importo non valido.');
    const voci = vociPer[s.id] || [];
    if (!rigaSpesaConsentita(s, voci, importo)) return alert(`Così si supera il totale dello scontrino: restano ${euro(dettaglioSpesa(s, voci).nonDettagliato)} da dettagliare.`);
    setInCorso(true);
    const { error } = await supabase.from('albatros_spese_righe').insert([{
      spesa_id: s.id, descrizione, importo, creato_da: user.id,
      categoria_id: nuovaVoce.categoria == null ? s.categoria_id : idCategoriaScelta(nuovaVoce.categoria, categorie, 'spesa'),
    }]);
    setInCorso(false);
    if (error) return alert(`Errore nel salvataggio: ${error.message}`);
    setNuovaVoce(VOCE_VUOTA);
    carica();
  };

  const togliVoce = async (v) => {
    if (!window.confirm(`Togliere "${v.descrizione}" dal dettaglio?`)) return;
    const { error } = await supabase.from('albatros_spese_righe').delete().eq('id', v.id);
    if (error) return alert(`Errore: ${error.message}`);
    carica();
  };

  const modifica = (s) => {
    setModulo({ id: s.id, data: s.data, importo: String(r2(s.importo)).replace('.', ','), descrizione: s.descrizione, categoria: String(s.categoria_id ?? ''), ente: s.ente || '' });
  };

  return (
    <div className="albatros-pagina no-print">
      <div className="albatros-card">
        <div className="albatros-testata">
          <FiltroPeriodo periodo={periodo} onChange={setPeriodo} />
          <label className="albatros-etichetta" style={{ flex: '0 1 160px' }}>Pagata da
            <select value={filtroEnte} onChange={(e) => setFiltroEnte(e.target.value)} className="albatros-campo">
              <option value="">Tutti</option>
              {ENTI.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
              <option value="nessuno">Da attribuire</option>
            </select>
          </label>
          <button type="button" className={`albatros-chip albatros-chip-avviso ${filtroEnte === 'nessuno' ? 'attivo' : ''}`} style={{ alignSelf: 'flex-end' }}
            disabled={filtroEnte !== 'nessuno' && daAttribuire.length === 0} onClick={() => setFiltroEnte(filtroEnte === 'nessuno' ? '' : 'nessuno')}>
            Da attribuire ({daAttribuire.length})
          </button>
          <button type="button" className="btn-accent-inline albatros-bottone" style={{ alignSelf: 'flex-end' }} onClick={() => setModulo(SPESA_VUOTA())}>+ Nuova spesa</button>
          <div style={{ marginLeft: 'auto', textAlign: 'right', fontSize: '0.88rem' }}>
            <div>Spese {periodo.tipo === 'settimana' ? 'della settimana' : 'del mese'}: <strong>{euro(totale(visibili))}</strong></div>
            {!filtroEnte && (
              <div className="albatros-tenue">{[...ENTI.map(e => `${e.label} ${euro(totale(spese.filter(s => s.ente === e.id)))}`), ...(daAttribuire.length ? [`da attribuire ${euro(totale(daAttribuire))}`] : [])].join(' · ')}</div>
            )}
          </div>
        </div>

        {visibili.length === 0 && <p className="albatros-vuoto">Nessuna spesa.</p>}
        {visibili.length > 0 && (
          <div style={{ overflowX: 'auto', marginTop: '12px' }}>
            <table className="albatros-tabella">
              <thead>
                <tr><th>Data</th><th>Cosa</th><th>Categoria</th><th>Pagata da</th><th className="num">Importo</th>{puoCorreggere && <th></th>}</tr>
              </thead>
              <tbody>
                {visibili.map(s => {
                  const voci = vociPer[s.id] || [];
                  const det = dettaglioSpesa(s, voci);
                  const aperta = espansa === s.id;
                  return (
                  <Fragment key={s.id}>
                  <tr onClick={() => apriDettaglio(s)} className={aperta ? 'selezionata' : ''} title="Apri il dettaglio">
                    <td style={{ whiteSpace: 'nowrap' }}><span className={`riga-espandibile-chevron ${aperta ? 'aperta' : ''}`}>▸</span>{formattaDataGGMMAAAA(s.data)}</td>
                    <td>
                      {s.descrizione}
                      {voci.length > 0 && <span className={`albatros-badge mini ${det.nonDettagliato > 0 ? 'da-specificare' : 'chiusa'}`} style={{ marginLeft: '6px' }}>{voci.length} {voci.length === 1 ? 'voce' : 'voci'} · {Math.round(det.quota * 100)}%</span>}
                      <div className="albatros-tenue" style={{ fontSize: '0.75rem' }}>{utenti[s.creato_da] ? `scritta da ${utenti[s.creato_da]}` : ''}</div>
                    </td>
                    <td>{nomeCategoria(categorie, s.categoria_id)}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {s.ente ? etichettaEnte(s.ente) : (
                        <select value="" onChange={(e) => attribuisci(s, e.target.value)} className="albatros-badge-select" title="Scegli chi l'ha pagata">
                          <option value="">Da attribuire</option>
                          {ENTI.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
                        </select>
                      )}
                    </td>
                    <td className="num"><strong>{euro(s.importo)}</strong></td>
                    {puoCorreggere && (
                      <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                        <button type="button" className="btn-icon-action" title="Modifica" onClick={() => modifica(s)} style={{ marginRight: '4px' }}><Icona nome="modifica" size={14} style={{ marginRight: 0 }} /></button>
                        <button type="button" className="btn-icon-action danger" title="Elimina" onClick={() => elimina(s)}><Icona nome="elimina" size={14} style={{ marginRight: 0 }} /></button>
                      </td>
                    )}
                  </tr>
                  {aperta && (
                    <tr className="albatros-dettaglio-riga">
                      <td colSpan={puoCorreggere ? 6 : 5}>
                        {voci.length === 0 && <p className="albatros-vuoto" style={{ marginTop: 0 }}>Nessuna voce: aggiungi qui sotto cosa c'è nello scontrino.</p>}
                        {voci.map(v => (
                          <div key={v.id} className="albatros-riga">
                            <div className="albatros-riga-testo">{v.descrizione} <span className="albatros-tenue">· {nomeCategoria(categorie, v.categoria_id)}</span></div>
                            <div className="albatros-riga-importo">{euro(v.importo)}</div>
                            {puoCorreggere && <button type="button" className="btn-icon-action danger" title="Togli la voce" onClick={() => togliVoce(v)}><Icona nome="elimina" size={14} style={{ marginRight: 0 }} /></button>}
                          </div>
                        ))}
                        <div className="albatros-voce-q" style={{ marginTop: '6px' }}><span>Dettagliato</span><span>{euro(det.dettagliato)} di {euro(det.totale)}</span></div>
                        <div className="albatros-voce-q" style={{ fontWeight: 700, color: det.nonDettagliato > 0 ? '#b45309' : '#15803d' }}>
                          <span>{det.nonDettagliato > 0 ? 'Non dettagliato' : 'Tutto dettagliato'}</span><span>{euro(det.nonDettagliato)}</span>
                        </div>
                        {det.nonDettagliato > 0 && (
                          <div className="albatros-form-voce-spesa">
                            <input type="text" value={nuovaVoce.descrizione} placeholder="Cosa (es. detersivi)" autoFocus
                              onChange={(e) => setNuovaVoce({ ...nuovaVoce, descrizione: e.target.value })} className="albatros-campo" />
                            <input type="text" inputMode="decimal" value={nuovaVoce.importo} placeholder={String(det.nonDettagliato).replace('.', ',')}
                              onChange={(e) => setNuovaVoce({ ...nuovaVoce, importo: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && aggiungiVoce(s)} className="albatros-campo albatros-importo" />
                            <SceltaCategoria categorie={categorie} tipo="spesa" valore={nuovaVoce.categoria ?? String(s.categoria_id ?? '')} onChange={(v) => setNuovaVoce({ ...nuovaVoce, categoria: v })} />
                            <button type="button" className="btn-accent-inline albatros-bottone" disabled={inCorso} onClick={() => aggiungiVoce(s)}>+ Voce</button>
                          </div>
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
      </div>

      {modulo && (
        <div className="modal-form-backdrop" onClick={() => setModulo(null)}>
          <div className="modal-form-box albatros-overlay" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-form-close" aria-label="Chiudi" onClick={() => setModulo(null)}>✕</button>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '1.1rem', color: '#0f172a' }}>{modulo.id ? 'Modifica spesa' : 'Nuova spesa'}</h3>
            <div className="albatros-griglia-2">
              <label className="albatros-etichetta">Data
                <input type="date" value={modulo.data} onChange={(e) => setModulo({ ...modulo, data: e.target.value })} className="albatros-campo" />
              </label>
              <label className="albatros-etichetta">Importo €
                <input type="text" inputMode="decimal" value={modulo.importo} placeholder="0,00" onChange={(e) => setModulo({ ...modulo, importo: e.target.value })} className="albatros-campo albatros-importo" />
              </label>
              <label className="albatros-etichetta" style={{ gridColumn: '1 / -1' }}>Cosa
                <input type="text" value={modulo.descrizione} autoFocus placeholder="Es. spesa Esselunga, lampadina campo 2" onChange={(e) => setModulo({ ...modulo, descrizione: e.target.value })} className="albatros-campo" />
              </label>
              <label className="albatros-etichetta">Categoria
                <SceltaCategoria categorie={categorie} tipo="spesa" valore={modulo.categoria} onChange={(v) => setModulo({ ...modulo, categoria: v })} />
              </label>
              <label className="albatros-etichetta">Pagata da
                <select value={modulo.ente} onChange={(e) => setModulo({ ...modulo, ente: e.target.value })} className="albatros-campo">
                  <option value="">Da attribuire</option>
                  {ENTI.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
                </select>
              </label>
            </div>
            {!puoCorreggere && <p className="albatros-nota">Una spesa aggiunta non si può più cambiare né togliere: in caso di errore avvisa l'amministratore.</p>}
            <div style={{ display: 'flex', gap: '10px', marginTop: '16px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button type="button" className="btn-outline-annulla albatros-bottone" onClick={() => setModulo(null)}>Annulla</button>
              <button type="button" className="btn-accent-inline albatros-bottone" disabled={inCorso} onClick={salva}><Icona nome="salva" />{modulo.id ? 'Salva' : 'Aggiungi spesa'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Spese
