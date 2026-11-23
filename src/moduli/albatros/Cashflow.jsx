import { useState, useEffect } from 'react'
import { supabase, leggiTutte } from '../../lib/supabaseClient'
import Icona from '../../components/Icona'
import { formattaDataGGMMAAAA } from '../../lib/utils'
import {
  quadratura, euro, r2, num, nomeCategoria, giornataDiLavoro, etichettaEnte,
  CAUSALI_PAGAMENTO, METODI_PAGAMENTO, etichettaCausale, etichettaMetodo, posizioneEnte, contantiAlbatros, contoAlbatros,
  spesaDaPagare, nonInBanca, etichettaMetodoSpesa, TASCHE, etichettaTasca, movimentiAcconti, etichettaMetodoAcconto,
} from './calcolo'

// ============================================================
// Cashflow: dove sono i soldi adesso, ente per ente. Niente filtri: conta tutto dalla prima chiusura.
// Due modi, uno per modulo:
//   conti      (modulo Conti, il responsabile) il cashflow di Albatros: entrano gli incassi POS e i
//              contanti ritirati alle chiusure; escono le spese pagate da Albatros e i pagamenti che
//              fa. Da qui si registrano pagamenti e trasferimenti.
//   contanti   (modulo Cassa, i ragazzi) solo i contanti in mano: ritirati, spese e pagamenti in
//              contanti, versamenti e prelievi, acconti in contanti; e quanto c'è da rimborsare a
//              Lama. Si guarda e basta.
// Il cashflow di BFM non c'è più.
// I rimborsi abbassano il "da rimborsare" di chi li riceve. I pagamenti li registra
// l'amministratore dalla pagina di chi paga (Albatros o BFM).
// Le spese ancora da attribuire non sono di nessuno: si segnalano e basta.
// Nella pagina di Albatros l'amministratore registra anche i trasferimenti fra contanti in mano e
// conto (versamenti e prelievi): spostano i soldi da una tasca all'altra, il saldo non cambia.
// Gli acconti dei clienti (scheda Chiusure) entrano il giorno in cui sono versati, nei contanti o
// sul conto; se rimborsati, il rimborso esce il giorno in cui è fatto.
// ============================================================

const leggiImporto = (v) => { const n = Number(String(v ?? '').trim().replace(',', '.')); return Number.isFinite(n) ? r2(n) : NaN; };
const descriviPagamento = (p) => `${etichettaCausale(p.causale)} · ${etichettaMetodo(p.metodo).toLowerCase()}${p.note ? ` · ${p.note}` : ''}`;
// Chi può pagare chi: Albatros paga Lama, BFM o i soci (utili, prelievi: chi fra i soci lo dicono
// le note), BFM paga Lama.
const BENEFICIARI = { albatros: ['lama', 'bfm', 'soci'], bfm: ['lama'] };

// I movimenti di un ente: entrate positive, uscite negative, dal più recente.
// Un trasferimento non è né entrata né uscita: ha importo 0 per il saldo, e la cifra spostata in
// "trasferito".
function movimentiDi(ente, chiusure, spese, pagamenti, trasferimenti, acconti, nomeVoce) {
  const righe = [];
  if (ente === 'albatros') {
    chiusure.filter(c => c.chiusa_il).forEach(c => {
      const q = quadratura(c, []);
      if (q.pos > 0) righe.push({ data: c.data, importo: q.pos, descrizione: 'Incasso POS', tipo: 'pos' });
      if (q.ritirato > 0) righe.push({ data: c.data, importo: q.ritirato, descrizione: 'Contanti ritirati alla chiusura', tipo: 'contanti', contanti: true });
    });
    acconti.forEach(a => {
      const cosa = `${nomeVoce(a.voce_id)} del ${formattaDataGGMMAAAA(a.data_riferimento)}, ${a.cliente}`;
      righe.push({ data: a.data_versamento, importo: r2(num(a.importo)), descrizione: `Acconto: ${cosa} · ${etichettaMetodoAcconto(a.metodo).toLowerCase()}`, tipo: 'acconto', contanti: a.metodo === 'contanti' });
      if (a.stato === 'rimborsato') righe.push({ data: a.rimborso_data, importo: -r2(num(a.importo)), descrizione: `Rimborso acconto: ${cosa} · ${a.rimborso_metodo === 'contanti' ? 'contanti' : 'dal conto'}`, tipo: 'rimborso_acconto', contanti: a.rimborso_metodo === 'contanti' });
    });
    trasferimenti.forEach(t => righe.push({
      // Per i contanti un trasferimento non è neutro: un versamento li fa scendere, un prelievo salire.
      data: t.data, importo: 0, trasferito: r2(num(t.importo)), tipo: 'trasferimento', trasferimento: t,
      contanti: true, suiContanti: t.da === 'contanti' ? -r2(num(t.importo)) : r2(num(t.importo)),
      descrizione: `${t.da === 'contanti' ? 'Versamento dei contanti sul conto' : 'Prelievo dal conto in contanti'}${t.note ? ` · ${t.note}` : ''}`,
    }));
  }
  pagamenti.filter(p => p.pagante === ente).forEach(p => righe.push({ data: p.data, importo: -r2(num(p.importo)), descrizione: `Pagamento a ${etichettaEnte(p.beneficiario)}: ${descriviPagamento(p)}`, tipo: 'pagamento', pagamento: p, contanti: p.metodo === 'contanti' }));
  pagamenti.filter(p => p.beneficiario === ente).forEach(p => righe.push({ data: p.data, importo: r2(num(p.importo)), descrizione: `Da ${etichettaEnte(p.pagante)}: ${descriviPagamento(p)}`, tipo: 'ricevuto', pagamento: p }));
  // Le spese ancora da pagare non sono uscite: si contano a parte (vedi la cifra "Da pagare").
  // Una spesa con carta scritta a mano che non è (ancora) in banca non conta: vedi nonInBanca.
  spese.filter(s => s.ente === ente && !spesaDaPagare(s) && !nonInBanca(s)).forEach(s => righe.push({ data: s.data, importo: -r2(num(s.importo)), descrizione: ente === 'albatros' ? `${s.descrizione} · ${etichettaMetodoSpesa(s)}` : s.descrizione, tipo: 'spesa', spesa: s, contanti: s.metodo !== 'carta' && s.metodo !== 'conto' }));
  return righe.sort((a, b) => b.data.localeCompare(a.data) || a.importo - b.importo);
}
const sommaTipo = (mov, tipo) => r2(mov.filter(m => m.tipo === tipo).reduce((t, m) => t + m.importo, 0));

function Cashflow({ user, categorie, listino, puoCorreggere, modo = 'conti' }) {
  const soloContanti = modo === 'contanti';
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

  const attiva = { ente: 'albatros', label: 'Albatros' };
  const nomeVoce = (id) => listino.find(v => v.id === id)?.nome || 'voce';
  const tutti = movimentiDi(attiva.ente, chiusure, spese, pagamenti, trasferimenti, acconti, nomeVoce);
  // Nei contanti un trasferimento conta col suo effetto sui contanti, come entrata o uscita.
  const mov = soloContanti ? tutti.filter(m => m.contanti).map(m => (m.trasferimento ? { ...m, importo: m.suiContanti, trasferimento: null, trasferimentoCassa: m.trasferimento } : m)) : tutti;
  const lama = posizioneEnte('lama', spese, pagamenti);
  const accontiInAttesa = movimentiAcconti(acconti).inAttesa;
  const daAttribuire = spese.filter(s => !s.ente);
  const ultimaConFondo = [...chiusure].filter(c => c.chiusa_il && c.fondo_lasciato != null).sort((a, b) => b.data.localeCompare(a.data))[0];
  const cassa = contantiAlbatros(chiusure, spese, pagamenti, trasferimenti, acconti);
  const conto = contoAlbatros(chiusure, spese, pagamenti, trasferimenti, acconti);
  const beneficiari = BENEFICIARI[attiva.ente] || [];
  // La posizione di chi riceve il pagamento in corso: serve a proporre il rimborso.
  const posizioneDi = (ente) => posizioneEnte(ente, spese, pagamenti);

  const proposta = (beneficiario) => {
    // Ai soci non si rimborsa niente: si propongono gli utili.
    if (beneficiario === 'soci') return { causale: 'utili', importo: '' };
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
    if (attiva.ente === 'albatros' && modulo.metodo !== 'contanti' && importo > conto.saldo
      && !window.confirm(`Sul conto di Albatros risultano ${euro(conto.saldo)}, meno di ${euro(importo)}. Lo registro lo stesso?`)) return;
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
          <div style={{ marginLeft: 'auto', alignSelf: 'flex-end', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {puoCorreggere && !soloContanti && !trasferimentiMancanti && (
              <button type="button" className="btn-outline-annulla albatros-bottone" onClick={nuovoTrasferimento} title="Sposta soldi fra i contanti in mano e il conto"><Icona nome="cashflow" />Trasferimento</button>
            )}
            {puoCorreggere && !soloContanti && beneficiari.length > 0 && !pagamentiMancanti && (
              <button type="button" className="btn-accent-inline albatros-bottone" onClick={nuovoPagamento}>+ Pagamento</button>
            )}
          </div>
        </div>

        {!soloContanti && pagamentiMancanti && (
          <p className="albatros-avviso" style={{ marginTop: '12px' }}>
            Per registrare i pagamenti a Lama e BFM esegui <strong>sql/albatros_pagamenti.sql</strong> nell'SQL Editor di Supabase.
          </p>
        )}

        {!soloContanti && trasferimentiMancanti && puoCorreggere && (
          <p className="albatros-avviso" style={{ marginTop: '12px' }}>
            Per registrare i trasferimenti fra contanti e conto esegui <strong>sql/albatros_trasferimenti.sql</strong> nell'SQL Editor di Supabase.
          </p>
        )}

        <div className="albatros-cifre">
          {soloContanti ? (
            <>
              <div className="albatros-cifra-saldo"><span>Contanti in mano</span><strong>{euro(cassa.inMano)}</strong><small>ritirati − spese e pagamenti in contanti ± versamenti, prelievi e acconti</small></div>
              <div><span>Contanti ritirati</span><strong style={{ color: '#15803d' }}>{euro(sommaTipo(mov, 'contanti'))}</strong><small>entrate, dalle chiusure</small></div>
              <div><span>Spese in contanti</span><strong style={{ color: '#b91c1c' }}>{euro(-sommaTipo(mov, 'spesa'))}</strong><small>uscite</small></div>
              <div><span>Pagamenti in contanti</span><strong style={{ color: '#b91c1c' }}>{euro(-sommaTipo(mov, 'pagamento'))}</strong><small>uscite: rimborsi, stipendi, soci</small></div>
              <div><span>Fondo cassa</span><strong>{euro(ultimaConFondo?.fondo_lasciato)}</strong>
                <small>{ultimaConFondo ? `lasciato il ${formattaDataGGMMAAAA(ultimaConFondo.data)}` : 'nessuna chiusura col fondo'}</small></div>
              {lama.daRimborsare > 0 && (
                <div><span>Da rimborsare a Lama</span><strong style={{ color: '#b45309' }}>{euro(lama.daRimborsare)}</strong><small>spese pagate da Lama − rimborsi ricevuti</small></div>
              )}
            </>
          ) : (
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
              <div><span>Incassi POS</span><strong style={{ color: '#15803d' }}>{euro(sommaTipo(mov, 'pos'))}</strong><small>entrate</small></div>
              <div><span>Contanti ritirati</span><strong style={{ color: '#15803d' }}>{euro(sommaTipo(mov, 'contanti'))}</strong><small>entrate, dalle chiusure</small></div>
              <div><span>Spese pagate</span><strong style={{ color: '#b91c1c' }}>{euro(-sommaTipo(mov, 'spesa'))}</strong><small>uscite</small></div>
              <div><span>Pagamenti fatti</span><strong style={{ color: '#b91c1c' }}>{euro(-sommaTipo(mov, 'pagamento'))}</strong><small>uscite: rimborsi, stipendi, soci, altro</small></div>
              <div><span>Fondo cassa</span><strong>{euro(ultimaConFondo?.fondo_lasciato)}</strong>
                <small>{ultimaConFondo ? `lasciato il ${formattaDataGGMMAAAA(ultimaConFondo.data)}` : 'nessuna chiusura col fondo'}</small></div>
              {lama.daRimborsare > 0 && (
                <div><span>Da rimborsare a Lama</span><strong style={{ color: '#b45309' }}>{euro(lama.daRimborsare)}</strong><small>spese pagate da Lama − rimborsi ricevuti</small></div>
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
                <tr><th>Data</th><th>Movimento</th><th className="num">Entrata</th><th className="num">Uscita</th>{puoCorreggere && !soloContanti && <th></th>}</tr>
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
                    {puoCorreggere && !soloContanti && (
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
              {modulo.beneficiario !== 'soci' && <>Da rimborsare a {etichettaEnte(modulo.beneficiario)}: {euro(posizioneDi(modulo.beneficiario).daRimborsare)} · </>}
              {attiva.ente === 'albatros' && <>contanti in mano ad Albatros: {euro(cassa.inMano)} · conto: {euro(conto.saldo)}</>}
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
              <label className="albatros-etichetta">Da dove si prendono
                <select value={modulo.metodo} onChange={(e) => setModulo({ ...modulo, metodo: e.target.value })} className="albatros-campo">
                  {METODI_PAGAMENTO.map(m => <option key={m.id} value={m.id}>{m.id === 'contanti' ? `Contanti di ${attiva.label}` : m.id === 'bonifico' ? 'Dal conto (bonifico)' : 'Dal conto (altro)'}</option>)}
                </select>
              </label>
              <label className="albatros-etichetta" style={{ gridColumn: '1 / -1' }}>Note
                <input type="text" value={modulo.note} placeholder={modulo.beneficiario === 'soci' ? 'A quale socio, es. Mario, utili di ottobre' : 'Facoltative, es. stipendio di ottobre'} onChange={(e) => setModulo({ ...modulo, note: e.target.value })} className="albatros-campo" />
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
