import { useState, useEffect } from 'react'
import { supabase, leggiTutte } from '../../lib/supabaseClient'
import { puoVedere } from '../../lib/permessi'
import Icona from '../../components/Icona'
import { formattaDataGGMMAAAA } from '../../lib/utils'
import {
  quadratura, euro, r2, num, nomeCategoria, giornataDiLavoro, etichettaEnte,
  CAUSALI_PAGAMENTO, METODI_PAGAMENTO, etichettaCausale, etichettaMetodo, posizioneEnte, contantiAlbatros,
} from './calcolo'

// ============================================================
// Cashflow: dove sono i soldi adesso, ente per ente. Niente filtri: conta tutto dalla prima chiusura.
// Una sotto-scheda per BFM, Albatros e Lama; chi vede quale lo decidono i ruoli (sottoschede
// cashflow_*).
//   Albatros   entrano gli incassi POS e i contanti ritirati alle chiusure (i ragazzi li ritirano,
//              ma sono di Albatros); escono le spese pagate da Albatros e i pagamenti che fa.
//   BFM        le spese pagate per il centro, i pagamenti che fa e quelli che riceve.
//   Lama       le spese pagate per il centro e i pagamenti ricevuti.
// I rimborsi abbassano il "da rimborsare" di chi li riceve. I pagamenti li registra
// l'amministratore dalla pagina di chi paga (Albatros o BFM).
// Le spese ancora da attribuire non sono di nessuno: si segnalano e basta.
// ============================================================

const SOTTOSCHEDE = [
  { id: 'cashflow_bfm', ente: 'bfm', label: 'BFM' },
  { id: 'cashflow_albatros', ente: 'albatros', label: 'Albatros' },
  { id: 'cashflow_lama', ente: 'lama', label: 'Lama' },
];

const leggiImporto = (v) => { const n = Number(String(v ?? '').trim().replace(',', '.')); return Number.isFinite(n) ? r2(n) : NaN; };
const descriviPagamento = (p) => `${etichettaCausale(p.causale)} · ${etichettaMetodo(p.metodo).toLowerCase()}${p.note ? ` · ${p.note}` : ''}`;
// Chi può pagare chi: Albatros paga Lama o BFM, BFM paga Lama.
const BENEFICIARI = { albatros: ['lama', 'bfm'], bfm: ['lama'] };

// I movimenti di un ente: entrate positive, uscite negative, dal più recente.
function movimentiDi(ente, chiusure, spese, pagamenti) {
  const righe = [];
  if (ente === 'albatros') {
    chiusure.filter(c => c.chiusa_il).forEach(c => {
      const q = quadratura(c, []);
      if (q.pos > 0) righe.push({ data: c.data, importo: q.pos, descrizione: 'Incasso POS', tipo: 'pos' });
      if (q.ritirato > 0) righe.push({ data: c.data, importo: q.ritirato, descrizione: 'Contanti ritirati alla chiusura', tipo: 'contanti' });
    });
  }
  pagamenti.filter(p => p.pagante === ente).forEach(p => righe.push({ data: p.data, importo: -r2(num(p.importo)), descrizione: `Pagamento a ${etichettaEnte(p.beneficiario)}: ${descriviPagamento(p)}`, tipo: 'pagamento', pagamento: p }));
  pagamenti.filter(p => p.beneficiario === ente).forEach(p => righe.push({ data: p.data, importo: r2(num(p.importo)), descrizione: `Da ${etichettaEnte(p.pagante)}: ${descriviPagamento(p)}`, tipo: 'ricevuto', pagamento: p }));
  spese.filter(s => s.ente === ente).forEach(s => righe.push({ data: s.data, importo: -r2(num(s.importo)), descrizione: s.descrizione, tipo: 'spesa', spesa: s }));
  return righe.sort((a, b) => b.data.localeCompare(a.data) || a.importo - b.importo);
}
const sommaTipo = (mov, tipo) => r2(mov.filter(m => m.tipo === tipo).reduce((t, m) => t + m.importo, 0));

function Cashflow({ user, categorie, puoCorreggere }) {
  const visibili = SOTTOSCHEDE.filter(s => puoVedere(user, 'albatros', 'cashflow', s.id));
  const [scelta, setScelta] = useState(null);
  const [chiusure, setChiusure] = useState([]);
  const [spese, setSpese] = useState([]);
  const [pagamenti, setPagamenti] = useState([]);
  // Finché sql/albatros_pagamenti.sql non è stato eseguito la tabella non c'è.
  const [pagamentiMancanti, setPagamentiMancanti] = useState(null);
  // Il pagamento nell'overlay: null = chiuso.
  const [modulo, setModulo] = useState(null);
  const [inCorso, setInCorso] = useState(false);

  // Si leggono tutte: il saldo parte dalla prima chiusura. Sono poche righe al giorno.
  const carica = async () => {
    const [ch, sp, pg] = await Promise.all([
      leggiTutte(() => supabase.from('albatros_chiusure').select('*').order('id')),
      leggiTutte(() => supabase.from('albatros_spese').select('*').order('id')),
      leggiTutte(() => supabase.from('albatros_pagamenti').select('*').order('id')),
    ]);
    setChiusure(ch.data || []);
    setSpese(sp.data || []);
    setPagamenti(pg.data || []);
    setPagamentiMancanti(pg.error ? pg.error.message : null);
  };
  useEffect(() => { carica(); }, []);

  if (visibili.length === 0) return null;
  const attiva = visibili.find(s => s.id === scelta) || visibili[0];
  const mov = movimentiDi(attiva.ente, chiusure, spese, pagamenti);
  const daAttribuire = spese.filter(s => !s.ente);
  const ultimaConFondo = [...chiusure].filter(c => c.chiusa_il && c.fondo_lasciato != null).sort((a, b) => b.data.localeCompare(a.data))[0];
  const cassa = contantiAlbatros(chiusure, spese, pagamenti);
  const posizione = attiva.ente === 'albatros' ? null : posizioneEnte(attiva.ente, spese, pagamenti);
  const beneficiari = BENEFICIARI[attiva.ente] || [];
  // La posizione di chi riceve il pagamento in corso: serve a proporre il rimborso.
  const posizioneDi = (ente) => posizioneEnte(ente, spese, pagamenti);

  const proposta = (beneficiario) => {
    const daRimborsare = posizioneDi(beneficiario).daRimborsare;
    return { causale: daRimborsare > 0 ? 'rimborso' : 'stipendio', importo: daRimborsare > 0 ? String(daRimborsare).replace('.', ',') : '' };
  };
  const nuovoPagamento = () => setModulo({ data: giornataDiLavoro(), beneficiario: beneficiari[0], ...proposta(beneficiari[0]), metodo: 'contanti', note: '' });

  const salvaPagamento = async () => {
    const importo = leggiImporto(modulo.importo);
    if (!modulo.data) return alert('Scegli la data.');
    if (!importo || importo <= 0) return alert('Importo non valido.');
    const dovuto = posizioneDi(modulo.beneficiario).daRimborsare;
    if (modulo.causale === 'rimborso' && importo > dovuto
      && !window.confirm(`Il rimborso (${euro(importo)}) supera quanto c'è da rimborsare a ${etichettaEnte(modulo.beneficiario)} (${euro(dovuto)}). Lo registro lo stesso?`)) return;
    if (attiva.ente === 'albatros' && modulo.metodo === 'contanti' && importo > cassa.inMano
      && !window.confirm(`Albatros ha in mano ${euro(cassa.inMano)} di contanti, meno di ${euro(importo)}. Lo registro lo stesso?`)) return;
    setInCorso(true);
    const { error } = await supabase.from('albatros_pagamenti').insert([{
      data: modulo.data, pagante: attiva.ente, beneficiario: modulo.beneficiario, causale: modulo.causale, importo, metodo: modulo.metodo,
      note: modulo.note.trim() || null, creato_da: user.id,
    }]);
    setInCorso(false);
    if (error) return alert(`Errore nel salvataggio: ${error.message}`);
    setModulo(null);
    carica();
  };

  const eliminaPagamento = async (p) => {
    if (!window.confirm(`Eliminare il pagamento di ${euro(p.importo)} del ${formattaDataGGMMAAAA(p.data)} da ${etichettaEnte(p.pagante)} a ${etichettaEnte(p.beneficiario)}?`)) return;
    const { error } = await supabase.from('albatros_pagamenti').delete().eq('id', p.id);
    if (error) return alert(`Errore: ${error.message}`);
    carica();
  };

  return (
    <div className="albatros-pagina no-print">
      <div className="albatros-card">
        <div className="albatros-testata">
          <div className="albatros-filtri-listino" style={{ marginBottom: 0, alignSelf: 'flex-end' }}>
            {visibili.map(s => (
              <button key={s.id} type="button" className={`albatros-chip ${attiva.id === s.id ? 'attivo' : ''}`} onClick={() => setScelta(s.id)}>{s.label}</button>
            ))}
          </div>
          {puoCorreggere && beneficiari.length > 0 && !pagamentiMancanti && (
            <button type="button" className="btn-accent-inline albatros-bottone" style={{ marginLeft: 'auto', alignSelf: 'flex-end' }} onClick={nuovoPagamento}>+ Pagamento a Lama</button>
          )}
        </div>

        {pagamentiMancanti && (
          <p className="albatros-avviso" style={{ marginTop: '12px' }}>
            Per registrare i pagamenti a Lama e BFM esegui <strong>sql/albatros_pagamenti.sql</strong> nell'SQL Editor di Supabase.
          </p>
        )}

        <div className="albatros-cifre">
          {attiva.ente === 'albatros' ? (
            <>
              <div className="albatros-cifra-saldo"><span>Saldo attuale</span><strong>{euro(mov.reduce((t, m) => t + m.importo, 0))}</strong><small>entrate − uscite</small></div>
              <div><span>Incassi POS</span><strong style={{ color: '#15803d' }}>{euro(sommaTipo(mov, 'pos'))}</strong><small>entrate</small></div>
              <div><span>Contanti ritirati</span><strong style={{ color: '#15803d' }}>{euro(sommaTipo(mov, 'contanti'))}</strong><small>entrate, dalle chiusure</small></div>
              <div><span>Spese pagate</span><strong style={{ color: '#b91c1c' }}>{euro(-sommaTipo(mov, 'spesa'))}</strong><small>uscite</small></div>
              <div><span>Pagamenti fatti</span><strong style={{ color: '#b91c1c' }}>{euro(-sommaTipo(mov, 'pagamento'))}</strong><small>uscite: rimborsi, stipendi, altro</small></div>
              <div><span>Fondo cassa</span><strong>{euro(ultimaConFondo?.fondo_lasciato)}</strong>
                <small>{ultimaConFondo ? `lasciato il ${formattaDataGGMMAAAA(ultimaConFondo.data)}` : 'nessuna chiusura col fondo'}</small></div>
            </>
          ) : (
            <>
              {posizione.daRimborsare > 0 && (
                <div className="albatros-cifra-saldo"><span>Da rimborsare a {attiva.label}</span><strong>{euro(posizione.daRimborsare)}</strong><small>spese pagate − rimborsi ricevuti</small></div>
              )}
              {attiva.ente === 'lama' && (
                <div><span>Contanti in mano ad Albatros</span><strong>{euro(cassa.inMano)}</strong></div>
              )}
            </>
          )}
        </div>

        {daAttribuire.length > 0 && (
          <p className="albatros-avviso" style={{ marginTop: '12px' }}>
            {daAttribuire.length} {daAttribuire.length === 1 ? 'spesa' : 'spese'} da attribuire ({euro(daAttribuire.reduce((t, s) => t + num(s.importo), 0))}): non sono contate per nessuno finché non si sceglie chi le ha pagate.
          </p>
        )}

        {mov.length === 0 && <p className="albatros-vuoto">Nessun movimento.</p>}
        {mov.length > 0 && (
          <div style={{ overflowX: 'auto', marginTop: '12px' }}>
            <table className="albatros-tabella">
              <thead>
                <tr><th>Data</th><th>Movimento</th><th className="num">Entrata</th><th className="num">Uscita</th>{puoCorreggere && <th></th>}</tr>
              </thead>
              <tbody>
                {mov.map((m, i) => (
                  <tr key={i} style={{ cursor: 'default' }}>
                    <td style={{ whiteSpace: 'nowrap' }}>{formattaDataGGMMAAAA(m.data)}</td>
                    <td>{m.descrizione}{m.spesa && <span className="albatros-tenue"> · {nomeCategoria(categorie, m.spesa.categoria_id)}</span>}</td>
                    <td className="num" style={{ color: '#15803d' }}>{m.importo > 0 ? euro(m.importo) : ''}</td>
                    <td className="num" style={{ color: '#b91c1c' }}>{m.importo < 0 ? euro(-m.importo) : ''}</td>
                    {puoCorreggere && (
                      <td style={{ textAlign: 'right' }}>
                        {m.pagamento && <button type="button" className="btn-icon-action danger" title="Elimina il pagamento" onClick={() => eliminaPagamento(m.pagamento)}><Icona nome="elimina" size={14} style={{ marginRight: 0 }} /></button>}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modulo && (
        <div className="modal-form-backdrop" onClick={() => setModulo(null)}>
          <div className="modal-form-box albatros-overlay" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-form-close" aria-label="Chiudi" onClick={() => setModulo(null)}>✕</button>
            <h3 style={{ margin: '0 0 4px 0', fontSize: '1.1rem', color: '#0f172a' }}>Pagamento da {attiva.label}</h3>
            <p className="albatros-nota" style={{ marginTop: 0 }}>
              Da rimborsare a {etichettaEnte(modulo.beneficiario)}: {euro(posizioneDi(modulo.beneficiario).daRimborsare)}
              {attiva.ente === 'albatros' && <> · contanti in mano ad Albatros: {euro(cassa.inMano)}</>}
            </p>
            <div className="albatros-griglia-2" style={{ marginTop: '12px' }}>
              <label className="albatros-etichetta">A chi
                <select value={modulo.beneficiario} onChange={(e) => setModulo({ ...modulo, beneficiario: e.target.value, ...proposta(e.target.value) })} className="albatros-campo" disabled={beneficiari.length < 2}>
                  {beneficiari.map(b => <option key={b} value={b}>{etichettaEnte(b)}</option>)}
                </select>
              </label>
              <label className="albatros-etichetta">Data
                <input type="date" value={modulo.data} onChange={(e) => setModulo({ ...modulo, data: e.target.value })} className="albatros-campo" />
              </label>
              <label className="albatros-etichetta">Importo €
                <input type="text" inputMode="decimal" value={modulo.importo} placeholder="0,00" autoFocus onChange={(e) => setModulo({ ...modulo, importo: e.target.value })} className="albatros-campo albatros-importo" />
              </label>
              <label className="albatros-etichetta">Per cosa
                <select value={modulo.causale} onChange={(e) => setModulo({ ...modulo, causale: e.target.value })} className="albatros-campo">
                  {CAUSALI_PAGAMENTO.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </label>
              <label className="albatros-etichetta">Pagato con
                <select value={modulo.metodo} onChange={(e) => setModulo({ ...modulo, metodo: e.target.value })} className="albatros-campo">
                  {METODI_PAGAMENTO.map(m => <option key={m.id} value={m.id}>{m.id === 'contanti' ? `Contanti di ${attiva.label}` : m.label}</option>)}
                </select>
              </label>
              <label className="albatros-etichetta" style={{ gridColumn: '1 / -1' }}>Note
                <input type="text" value={modulo.note} placeholder="Facoltative, es. stipendio di ottobre" onChange={(e) => setModulo({ ...modulo, note: e.target.value })} className="albatros-campo" />
              </label>
            </div>
            <div style={{ display: 'flex', gap: '10px', marginTop: '16px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button type="button" className="btn-outline-annulla albatros-bottone" onClick={() => setModulo(null)}>Annulla</button>
              <button type="button" className="btn-accent-inline albatros-bottone" disabled={inCorso} onClick={salvaPagamento}><Icona nome="salva" />Registra il pagamento</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Cashflow
