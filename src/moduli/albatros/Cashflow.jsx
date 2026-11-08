import { useState, useEffect } from 'react'
import { supabase, leggiTutte } from '../../lib/supabaseClient'
import { puoVedere } from '../../lib/permessi'
import Icona from '../../components/Icona'
import { formattaDataGGMMAAAA } from '../../lib/utils'
import {
  quadratura, euro, r2, num, nomeCategoria, giornataDiLavoro, etichettaEnte,
  CAUSALI_PAGAMENTO, METODI_PAGAMENTO, etichettaCausale, etichettaMetodo, posizioneEnte, contantiAlbatros, contoAlbatros,
  spesaDaPagare, TASCHE, etichettaTasca, movimentiAcconti, etichettaMetodoAcconto,
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
// Nella pagina di Albatros l'amministratore registra anche i trasferimenti fra contanti in mano e
// conto (versamenti e prelievi): spostano i soldi da una tasca all'altra, il saldo non cambia.
// Gli acconti dei clienti (scheda Chiusure) entrano il giorno in cui sono versati, nei contanti o
// sul conto; se rimborsati, il rimborso esce il giorno in cui è fatto.
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
// Un trasferimento non è né entrata né uscita: ha importo 0 per il saldo, e la cifra spostata in
// "trasferito".
function movimentiDi(ente, chiusure, spese, pagamenti, trasferimenti, acconti, nomeVoce) {
  const righe = [];
  if (ente === 'albatros') {
    chiusure.filter(c => c.chiusa_il).forEach(c => {
      const q = quadratura(c, []);
      if (q.pos > 0) righe.push({ data: c.data, importo: q.pos, descrizione: 'Incasso POS', tipo: 'pos' });
      if (q.ritirato > 0) righe.push({ data: c.data, importo: q.ritirato, descrizione: 'Contanti ritirati alla chiusura', tipo: 'contanti' });
    });
    acconti.forEach(a => {
      const cosa = `${nomeVoce(a.voce_id)} del ${formattaDataGGMMAAAA(a.data_riferimento)}, ${a.cliente}`;
      righe.push({ data: a.data_versamento, importo: r2(num(a.importo)), descrizione: `Acconto: ${cosa} · ${etichettaMetodoAcconto(a.metodo).toLowerCase()}`, tipo: 'acconto' });
      if (a.stato === 'rimborsato') righe.push({ data: a.rimborso_data, importo: -r2(num(a.importo)), descrizione: `Rimborso acconto: ${cosa} · ${a.rimborso_metodo === 'contanti' ? 'contanti' : 'dal conto'}`, tipo: 'rimborso_acconto' });
    });
    trasferimenti.forEach(t => righe.push({
      data: t.data, importo: 0, trasferito: r2(num(t.importo)), tipo: 'trasferimento', trasferimento: t,
      descrizione: `${t.da === 'contanti' ? 'Versamento dei contanti sul conto' : 'Prelievo dal conto in contanti'}${t.note ? ` · ${t.note}` : ''}`,
    }));
  }
  pagamenti.filter(p => p.pagante === ente).forEach(p => righe.push({ data: p.data, importo: -r2(num(p.importo)), descrizione: `Pagamento a ${etichettaEnte(p.beneficiario)}: ${descriviPagamento(p)}`, tipo: 'pagamento', pagamento: p }));
  pagamenti.filter(p => p.beneficiario === ente).forEach(p => righe.push({ data: p.data, importo: r2(num(p.importo)), descrizione: `Da ${etichettaEnte(p.pagante)}: ${descriviPagamento(p)}`, tipo: 'ricevuto', pagamento: p }));
  // Le spese ancora da pagare non sono uscite: si contano a parte (vedi la cifra "Da pagare").
  spese.filter(s => s.ente === ente && !spesaDaPagare(s)).forEach(s => righe.push({ data: s.data, importo: -r2(num(s.importo)), descrizione: ente === 'albatros' ? `${s.descrizione} · ${s.metodo === 'carta' ? 'carta' : 'contanti'}` : s.descrizione, tipo: 'spesa', spesa: s }));
  return righe.sort((a, b) => b.data.localeCompare(a.data) || a.importo - b.importo);
}
const sommaTipo = (mov, tipo) => r2(mov.filter(m => m.tipo === tipo).reduce((t, m) => t + m.importo, 0));

function Cashflow({ user, categorie, listino, puoCorreggere }) {
  const visibili = SOTTOSCHEDE.filter(s => puoVedere(user, 'albatros', 'cashflow', s.id));
  const [scelta, setScelta] = useState(null);
  const [chiusure, setChiusure] = useState([]);
  const [spese, setSpese] = useState([]);
  const [pagamenti, setPagamenti] = useState([]);
  // Finché sql/albatros_pagamenti.sql non è stato eseguito la tabella non c'è.
  const [pagamentiMancanti, setPagamentiMancanti] = useState(null);
  // Il pagamento nell'overlay: null = chiuso.
  const [modulo, setModulo] = useState(null);
  const [trasferimenti, setTrasferimenti] = useState([]);
  const [acconti, setAcconti] = useState([]);
  // Finché sql/albatros_trasferimenti.sql non è stato eseguito la tabella non c'è.
  const [trasferimentiMancanti, setTrasferimentiMancanti] = useState(null);
  // Il trasferimento nell'overlay: null = chiuso.
  const [trasferimento, setTrasferimento] = useState(null);
  const [inCorso, setInCorso] = useState(false);

  // Si leggono tutte: il saldo parte dalla prima chiusura. Sono poche righe al giorno.
  const carica = async () => {
    const [ch, sp, pg, tr, ac] = await Promise.all([
      leggiTutte(() => supabase.from('albatros_chiusure').select('*').order('id')),
      leggiTutte(() => supabase.from('albatros_spese').select('*').order('id')),
      leggiTutte(() => supabase.from('albatros_pagamenti').select('*').order('id')),
      leggiTutte(() => supabase.from('albatros_trasferimenti').select('*').order('id')),
      // Senza sql/albatros_acconti.sql la tabella non c'è: si conta senza acconti.
      leggiTutte(() => supabase.from('albatros_acconti').select('*').order('id')),
    ]);
    setAcconti(ac.data || []);
    setTrasferimenti(tr.data || []);
    setTrasferimentiMancanti(tr.error ? tr.error.message : null);
    setChiusure(ch.data || []);
    setSpese(sp.data || []);
    setPagamenti(pg.data || []);
    setPagamentiMancanti(pg.error ? pg.error.message : null);
  };
  useEffect(() => { carica(); }, []);

  if (visibili.length === 0) return null;
  const attiva = visibili.find(s => s.id === scelta) || visibili[0];
  const nomeVoce = (id) => listino.find(v => v.id === id)?.nome || 'voce';
  const mov = movimentiDi(attiva.ente, chiusure, spese, pagamenti, trasferimenti, acconti, nomeVoce);
  const accontiInAttesa = movimentiAcconti(acconti).inAttesa;
  const daAttribuire = spese.filter(s => !s.ente);
  const ultimaConFondo = [...chiusure].filter(c => c.chiusa_il && c.fondo_lasciato != null).sort((a, b) => b.data.localeCompare(a.data))[0];
  const cassa = contantiAlbatros(chiusure, spese, pagamenti, trasferimenti, acconti);
  const conto = contoAlbatros(chiusure, spese, pagamenti, trasferimenti, acconti);
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

  // Si parte dai contanti verso il conto, il caso più frequente: si versano gli incassi in banca.
  const nuovoTrasferimento = () => setTrasferimento({ data: giornataDiLavoro(), da: 'contanti', importo: '', note: '' });
  const disponibile = (da) => (da === 'contanti' ? cassa.inMano : conto.saldo);

  const salvaTrasferimento = async () => {
    const importo = leggiImporto(trasferimento.importo);
    if (!trasferimento.data) return alert('Scegli la data.');
    if (!importo || importo <= 0) return alert('Importo non valido.');
    const presenti = disponibile(trasferimento.da);
    if (importo > presenti
      && !window.confirm(`In ${etichettaTasca(trasferimento.da).toLowerCase()} risultano ${euro(presenti)}, meno di ${euro(importo)}. Lo registro lo stesso?`)) return;
    setInCorso(true);
    const { error } = await supabase.from('albatros_trasferimenti').insert([{
      data: trasferimento.data, da: trasferimento.da, importo, note: trasferimento.note.trim() || null, creato_da: user.id,
    }]);
    setInCorso(false);
    if (error) return alert(`Errore nel salvataggio: ${error.message}`);
    setTrasferimento(null);
    carica();
  };

  const eliminaTrasferimento = async (t) => {
    if (!window.confirm(`Eliminare il trasferimento di ${euro(t.importo)} del ${formattaDataGGMMAAAA(t.data)}?`)) return;
    const { error } = await supabase.from('albatros_trasferimenti').delete().eq('id', t.id);
    if (error) return alert(`Errore: ${error.message}`);
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
          <div style={{ marginLeft: 'auto', alignSelf: 'flex-end', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {puoCorreggere && attiva.ente === 'albatros' && !trasferimentiMancanti && (
              <button type="button" className="btn-outline-annulla albatros-bottone" onClick={nuovoTrasferimento} title="Sposta soldi fra i contanti in mano e il conto"><Icona nome="cashflow" />Trasferimento</button>
            )}
            {puoCorreggere && beneficiari.length > 0 && !pagamentiMancanti && (
              <button type="button" className="btn-accent-inline albatros-bottone" onClick={nuovoPagamento}>+ Pagamento a Lama</button>
            )}
          </div>
        </div>

        {pagamentiMancanti && (
          <p className="albatros-avviso" style={{ marginTop: '12px' }}>
            Per registrare i pagamenti a Lama e BFM esegui <strong>sql/albatros_pagamenti.sql</strong> nell'SQL Editor di Supabase.
          </p>
        )}

        {attiva.ente === 'albatros' && trasferimentiMancanti && puoCorreggere && (
          <p className="albatros-avviso" style={{ marginTop: '12px' }}>
            Per registrare i trasferimenti fra contanti e conto esegui <strong>sql/albatros_trasferimenti.sql</strong> nell'SQL Editor di Supabase.
          </p>
        )}

        <div className="albatros-cifre">
          {attiva.ente === 'albatros' ? (
            <>
              <div className="albatros-cifra-saldo"><span>Saldo attuale</span><strong>{euro(mov.reduce((t, m) => t + m.importo, 0))}</strong><small>contanti in mano + conto</small></div>
              <div><span>Contanti in mano</span><strong>{euro(cassa.inMano)}</strong><small>ritirati − spese e pagamenti in contanti ± trasferimenti e acconti</small></div>
              <div><span>Conto (carta e POS)</span><strong>{euro(conto.saldo)}</strong><small>POS − spese con carta − pagamenti non in contanti ± trasferimenti e acconti</small></div>
              {spese.some(spesaDaPagare) && (
                <div><span>Da pagare</span><strong style={{ color: '#b45309' }}>{euro(spese.filter(spesaDaPagare).reduce((t, s) => t + num(s.importo), 0))}</strong>
                  <small>{spese.filter(spesaDaPagare).length} spese non ancora pagate, fuori dal saldo</small></div>
              )}
              {accontiInAttesa > 0 && (
                <div><span>Acconti da confermare</span><strong style={{ color: '#b45309' }}>{euro(accontiInAttesa)}</strong><small>già nel saldo, l'evento deve ancora arrivare</small></div>
              )}
              {acconti.length > 0 && (
                <div><span>Acconti</span><strong style={{ color: '#15803d' }}>{euro(sommaTipo(mov, 'acconto') + sommaTipo(mov, 'rimborso_acconto'))}</strong><small>versati − rimborsati</small></div>
              )}
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
                    <td>{m.descrizione}{m.spesa && <span className="albatros-tenue"> · {m.spesa.multicategoria ? 'scontrino' : nomeCategoria(categorie, m.spesa.categoria_id)}</span>}</td>
                    {m.trasferimento ? (
                      <td colSpan={2} className="num albatros-tenue" title="Fra contanti e conto: il saldo non cambia">{m.trasferimento.da === 'contanti' ? 'contanti → conto' : 'conto → contanti'} {euro(m.trasferito)}</td>
                    ) : (
                    <>
                    <td className="num" style={{ color: '#15803d' }}>{m.importo > 0 ? euro(m.importo) : ''}</td>
                    <td className="num" style={{ color: '#b91c1c' }}>{m.importo < 0 ? euro(-m.importo) : ''}</td>
                    </>
                    )}
                    {puoCorreggere && (
                      <td style={{ textAlign: 'right' }}>
                        {m.pagamento && <button type="button" className="btn-icon-action danger" title="Elimina il pagamento" onClick={() => eliminaPagamento(m.pagamento)}><Icona nome="elimina" size={14} style={{ marginRight: 0 }} /></button>}
                        {m.trasferimento && <button type="button" className="btn-icon-action danger" title="Elimina il trasferimento" onClick={() => eliminaTrasferimento(m.trasferimento)}><Icona nome="elimina" size={14} style={{ marginRight: 0 }} /></button>}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {trasferimento && (
        <div className="modal-form-backdrop" onClick={() => setTrasferimento(null)}>
          <div className="modal-form-box albatros-overlay" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-form-close" aria-label="Chiudi" onClick={() => setTrasferimento(null)}>✕</button>
            <h3 style={{ margin: '0 0 4px 0', fontSize: '1.1rem', color: '#0f172a' }}>Trasferimento fra contanti e conto</h3>
            <p className="albatros-nota" style={{ marginTop: 0 }}>Contanti in mano: {euro(cassa.inMano)} · conto: {euro(conto.saldo)}. Il saldo di Albatros non cambia.</p>
            <div className="albatros-griglia-2" style={{ marginTop: '12px' }}>
              <label className="albatros-etichetta" style={{ gridColumn: '1 / -1' }}>Da dove a dove
                <select value={trasferimento.da} onChange={(e) => setTrasferimento({ ...trasferimento, da: e.target.value })} className="albatros-campo">
                  {TASCHE.map(t => <option key={t.id} value={t.id}>{t.label} → {etichettaTasca(TASCHE.find(x => x.id !== t.id).id).toLowerCase()}{t.id === 'contanti' ? ' (versamento)' : ' (prelievo)'}</option>)}
                </select>
              </label>
              <label className="albatros-etichetta">Data
                <input type="date" value={trasferimento.data} onChange={(e) => setTrasferimento({ ...trasferimento, data: e.target.value })} className="albatros-campo" />
              </label>
              <label className="albatros-etichetta">Importo €
                <input type="text" inputMode="decimal" value={trasferimento.importo} placeholder="0,00" autoFocus onChange={(e) => setTrasferimento({ ...trasferimento, importo: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && salvaTrasferimento()} className="albatros-campo albatros-importo" />
              </label>
              <label className="albatros-etichetta" style={{ gridColumn: '1 / -1' }}>Note
                <input type="text" value={trasferimento.note} placeholder="Facoltative, es. versamento in banca" onChange={(e) => setTrasferimento({ ...trasferimento, note: e.target.value })} className="albatros-campo" />
              </label>
            </div>
            <div style={{ display: 'flex', gap: '10px', marginTop: '16px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button type="button" className="btn-outline-annulla albatros-bottone" onClick={() => setTrasferimento(null)}>Annulla</button>
              <button type="button" className="btn-accent-inline albatros-bottone" disabled={inCorso} onClick={salvaTrasferimento}><Icona nome="salva" />Registra il trasferimento</button>
            </div>
          </div>
        </div>
      )}

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
