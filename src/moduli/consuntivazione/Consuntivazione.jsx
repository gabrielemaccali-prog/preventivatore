import { useState, useEffect, useMemo, useRef, Fragment } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabaseClient'
import { puoVedere } from '../../lib/permessi'
import Icona from '../../components/Icona'
import { fineEventoDi, formattaDataGGMMAAAA } from '../../lib/utils'
import { STATO_PREN } from '../../lib/costanti'
import {
  sommaImporti, statoFatturazione, daFatturarePrenotazione, daFatturareVoucher,
  righeClientiExport, leggiExportFatture, abbinaFatture,
} from '../../lib/fatturazione'
import Controparti from './Controparti'

// ============================================================
// Consuntivazione: quello che è davvero successo, dopo il preventivo.
// Tre schede: Fatture, i ricavi fatturati di prenotazioni e voucher; Fornitori e Campi, i costi
// pagati a chi ci noleggia i giochi e ai centri sportivi. Qui dentro arriveranno anche i servizi.
// ============================================================

const oggiIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const euro = (n) => `€${(Number(n) || 0).toFixed(2)}`;
const ETICHETTA_STATO = { daFatturare: 'Da fatturare', parziale: 'Fatturata in parte', fatturata: 'Fatturata', nonDovuta: 'Coperta da voucher' };
const COLORE_STATO = { daFatturare: '#b91c1c', parziale: '#b45309', fatturata: '#0284c7', nonDovuta: '#64748b' };
const FATTURA_VUOTA = { data: '', numero: '', importo: '' };
const stileEtichettaFattura = { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.8rem', fontWeight: 600, color: '#334155' };
const stileCampoFattura = { width: '100%', height: '38px', boxSizing: 'border-box', padding: '6px 10px', margin: 0, fontSize: '0.9rem', borderRadius: '6px' };

// L'intestatario come comparirà in fattura: ragione sociale, oppure cognome e nome, oppure il
// nominativo se l'anagrafica non c'è ancora.
const intestatarioPren = (p) => (p.fattTipo === 'azienda'
  ? (p.ragioneSociale || p.nominativo)
  : ([p.fattCognome, p.fattNome].filter(Boolean).join(' ') || p.nominativo)) || '—';
const SCHEDE = [
  { id: 'fatture', label: 'Fatture', icona: 'fatture' },
  { id: 'fornitori', label: 'Fornitori', icona: 'fornitori' },
  { id: 'campi', label: 'Campi', icona: 'campi' },
];

const intestatarioVoucher = (v) => [v.fattCognome, v.fattNome].filter(Boolean).join(' ') || v.nominativo || '—';

function Consuntivazione({ user }) {
  const [scheda, setScheda] = useState('fatture');
  const [prenotazioni, setPrenotazioni] = useState([]);
  const [voucher, setVoucher] = useState([]);
  const [fatture, setFatture] = useState([]);
  // Finché sql/fatture.sql non è stato eseguito la tabella non esiste: senza avviso la pagina
  // sembrerebbe solo vuota.
  const [schemaMancante, setSchemaMancante] = useState(null);

  // Di norma si guarda il lavoro da fare: le partite già giocate non ancora fatturate per intero.
  const [filtroTipo, setFiltroTipo] = useState('');
  const [filtroStato, setFiltroStato] = useState('aperte');
  const [soloPassate, setSoloPassate] = useState(true);
  const [cerca, setCerca] = useState('');

  const [espansa, setEspansa] = useState(null);
  const [nuova, setNuova] = useState(FATTURA_VUOTA);
  // La data di oggi e l'importo che resta da fatturare sono proposte, non valori confermati: si
  // vedono chiare e in corsivo come i segnaposto, e valgono se non si scrive altro.
  const [dataProposta, setDataProposta] = useState(true);
  const [inCorso, setInCorso] = useState(false);
  const [proposta, setProposta] = useState(null);
  const inputFile = useRef(null);

  const fetchTutto = async () => {
    const [pr, vc, ft] = await Promise.all([
      supabase.from('prenotazioni').select('*').order('data', { ascending: false }),
      supabase.from('voucher').select('*'),
      supabase.from('fatture').select('*').order('data'),
    ]);
    setSchemaMancante(ft.error ? ft.error.message : null);
    if (pr.data) setPrenotazioni(pr.data);
    if (vc.data) setVoucher(vc.data);
    setFatture(ft.data || []);
  };

  useEffect(() => { fetchTutto(); }, []);

  const oggi = oggiIso();
  const voucherPerCodice = useMemo(() => Object.fromEntries(voucher.map(v => [String(v.codice), v])), [voucher]);
  const valoreVoucher = (codice) => parseFloat(voucherPerCodice[String(codice)]?.importo) || 0;

  const fatturePer = useMemo(() => {
    const m = {};
    fatture.forEach(f => { const k = `${f.tipo}|${f.riferimento}`; (m[k] = m[k] || []).push(f); });
    return m;
  }, [fatture]);

  // Tutto ciò che si può fatturare: le prenotazioni confermate e i voucher venduti con l'app.
  // Una partita commissionata da un fornitore o da un campo no: non si fattura, si compensa nella
  // sua scheda di consuntivazione.
  const fatturabili = useMemo(() => prenotazioni.filter(p => p.stato === STATO_PREN.CONFERMATO && !p.clienteSedeId && !p.clienteCampoId), [prenotazioni]);
  const voci = useMemo(() => {
    const valore = (codice) => parseFloat(voucherPerCodice[String(codice)]?.importo) || 0;
    const daPrenotazioni = fatturabili.map(p => {
      const lista = fatturePer[`prenotazione|${p.id}`] || [];
      const dovuto = daFatturarePrenotazione(p, p.voucherCodice ? valore(p.voucherCodice) : 0);
      const fatturato = sommaImporti(lista);
      return {
        tipo: 'prenotazione', codice: String(p.id), data: p.data, fine: fineEventoDi(p), intestatario: intestatarioPren(p),
        descrizione: p.pacchettoNome || '', totale: parseFloat(p.prezzoVendita) || 0,
        voucher: p.voucherCodice ? { codice: p.voucherCodice, valore: valore(p.voucherCodice) } : null,
        dovuto, fatturato, fatture: lista, stato: statoFatturazione(dovuto, fatturato), origine: p,
      };
    });
    const daVoucher = voucher.filter(v => !v.pregresso).map(v => {
      const lista = fatturePer[`voucher|${v.codice}`] || [];
      const dovuto = daFatturareVoucher(v);
      const fatturato = sommaImporti(lista);
      const data = String(v.dataEmissione || '').slice(0, 10);
      return {
        tipo: 'voucher', codice: String(v.codice), data, fine: data, intestatario: intestatarioVoucher(v),
        descrizione: v.pacchettoNome || 'Voucher', totale: parseFloat(v.importo) || 0, voucher: null,
        dovuto, fatturato, fatture: lista, stato: statoFatturazione(dovuto, fatturato), origine: v,
      };
    });
    return [...daPrenotazioni, ...daVoucher].sort((a, b) => String(b.data).localeCompare(String(a.data)));
  }, [fatturabili, voucher, fatturePer, voucherPerCodice]);

  const visibili = voci.filter(x => {
    if (filtroTipo && x.tipo !== filtroTipo) return false;
    // "Già giocate" vale per le partite; un voucher, una volta venduto, è già fatturabile.
    if (soloPassate && x.tipo === 'prenotazione' && !(x.fine < oggi)) return false;
    if (filtroStato === 'aperte' && !(x.stato === 'daFatturare' || x.stato === 'parziale')) return false;
    if (filtroStato === 'fatturata' && x.stato !== 'fatturata') return false;
    const testo = cerca.trim().toLowerCase();
    if (testo && !`${x.codice} ${x.intestatario} ${x.origine.nominativo || ''}`.toLowerCase().includes(testo)) return false;
    return true;
  });
  const totali = visibili.reduce((a, x) => ({ dovuto: a.dovuto + x.dovuto, fatturato: a.fatturato + x.fatturato }), { dovuto: 0, fatturato: 0 });

  const chiave = (x) => `${x.tipo}|${x.codice}`;
  const apriRiga = (x) => {
    if (espansa === chiave(x)) { setEspansa(null); return; }
    setEspansa(chiave(x));
    setNuova({ data: oggi, numero: '', importo: '' });
    setDataProposta(true);
  };

  const aggiungiFattura = async (x) => {
    const numero = nuova.numero.trim();
    const residuo = Math.max(x.dovuto - x.fatturato, 0);
    const importo = String(nuova.importo).trim() === ''
      ? Math.round(residuo * 100) / 100
      : parseFloat(String(nuova.importo).replace(',', '.'));
    if (!nuova.data || !numero || !(importo > 0)) return alert('Servono data, numero e importo della fattura.');
    setInCorso(true);
    const { error } = await supabase.from('fatture').insert([{ tipo: x.tipo, riferimento: x.codice, data: nuova.data, numero, importo, origine: 'manuale' }]);
    setInCorso(false);
    if (error) {
      return alert(error.code === '23505'
        ? `La fattura ${numero} del ${formattaDataGGMMAAAA(nuova.data)} è già registrata su ${x.codice}.`
        : `Errore nel salvataggio della fattura: ${error.message}`);
    }
    setNuova({ data: oggi, numero: '', importo: '' });
    setDataProposta(true);
    fetchTutto();
  };

  const eliminaFattura = async (f) => {
    if (!window.confirm(`Togliere la fattura ${f.numero} del ${formattaDataGGMMAAAA(f.data)} da ${f.riferimento}?`)) return;
    const { error } = await supabase.from('fatture').delete().eq('id', f.id);
    if (error) return alert(`Errore nella cancellazione: ${error.message}`);
    fetchTutto();
  };

  // --- Import dall'export di Fatture in Cloud ---
  const leggiFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const lette = leggiExportFatture(XLSX, await file.arrayBuffer());
      const esito = abbinaFatture(lette, {
        prenotazioni: fatturabili,
        voucher: voucher.filter(v => !v.pregresso),
        fatture,
        valoreVoucher,
      });
      setProposta({ nomeFile: file.name, lette: lette.length, ...esito, scelte: esito.proposte.map(pr => pr.certa) });
    } catch (err) {
      alert(`Non riesco a leggere il file: ${err.message}`);
    }
  };

  const confermaImport = async () => {
    const righe = proposta.proposte
      .filter((_, i) => proposta.scelte[i])
      .map(pr => ({ tipo: pr.tipo, riferimento: pr.riferimento, data: pr.fattura.data, numero: pr.fattura.numero, importo: pr.fattura.importo, origine: 'import' }));
    if (righe.length === 0) return alert('Nessuna fattura selezionata.');
    setInCorso(true);
    const { error } = await supabase.from('fatture').upsert(righe, { onConflict: 'tipo,riferimento,numero,data', ignoreDuplicates: true });
    setInCorso(false);
    if (error) return alert(`Errore nell'import: ${error.message}`);
    setProposta(null);
    await fetchTutto();
    alert(`${righe.length} ${righe.length === 1 ? 'fattura importata' : 'fatture importate'}.`);
  };

  const esportaClienti = () => {
    const righe = righeClientiExport(
      visibili.filter(x => x.tipo === 'prenotazione').map(x => x.origine),
      visibili.filter(x => x.tipo === 'voucher').map(x => x.origine),
    );
    if (righe.length === 0) return alert('Nessun cliente da esportare fra le voci filtrate.');
    const ws = XLSX.utils.json_to_sheet(righe);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Export');
    XLSX.writeFile(wb, `Clienti_${oggi}.xlsx`);
  };

  const schedeVisibili = SCHEDE.filter(s => puoVedere(user, 'consuntivazione', s.id));
  if (schedeVisibili.length === 0) return null;
  // Chi non vede la scheda scelta per ultima atterra sulla prima che vede.
  const attiva = (schedeVisibili.find(s => s.id === scheda) || schedeVisibili[0]).id;

  const cella = { padding: '8px 10px' };
  const destra = { ...cella, textAlign: 'right', whiteSpace: 'nowrap' };

  const barraSchede = (
    <nav className="modulo-subnav no-print subnav-segmented">
      {schedeVisibili.map(s => (
        <button key={s.id} className={`nav-btn ${attiva === s.id ? 'active' : ''}`} onClick={() => setScheda(s.id)}><Icona nome={s.icona} />{s.label}</button>
      ))}
    </nav>
  );

  // Fornitori e campi sono la stessa pagina con due controparti diverse. La chiave la rimonta
  // passando dall'una all'altra, così filtri e righe aperte non si trascinano da una scheda all'altra.
  if (attiva === 'fornitori') return <>{barraSchede}<Controparti key="fornitore" tipo="fornitore" /></>;
  if (attiva === 'campi') return <>{barraSchede}<Controparti key="campo" tipo="campo" /></>;

  return (
    <>
      {barraSchede}

      <div className="schermata-storico no-print">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <h2 style={{ margin: 0 }}>Fatture</h2>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button onClick={() => inputFile.current?.click()} disabled={!!schemaMancante} style={{ padding: '8px 16px', backgroundColor: '#0284c7', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>📥 Importa export Fatture in Cloud</button>
            <button onClick={esportaClienti} title="Anagrafica dei clienti delle voci filtrate, prenotazioni e voucher, nel formato del gestionale di fatturazione" style={{ padding: '8px 16px', backgroundColor: '#10b981', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>👥 Esporta clienti</button>
            <input ref={inputFile} type="file" accept=".xls,.xlsx" onChange={leggiFile} style={{ display: 'none' }} />
          </div>
        </div>
        <p className="descrizione-pagina">
          Le fatture emesse per le prenotazioni confermate e per i voucher. Una partita pagata tutta col voucher non si fattura; pagata in parte, si fattura il saldo.
          La spunta blu nelle tabelle di prenotazioni e voucher compare solo quando è fatturato tutto.
        </p>

        {schemaMancante && (
          <p style={{ padding: '10px 14px', borderRadius: '6px', border: '1px solid #f59e0b', background: '#fffbeb', color: '#92400e' }}>
            La tabella delle fatture non esiste ancora: esegui <strong>sql/fatture.sql</strong> nell'SQL Editor di Supabase. ({schemaMancante})
          </p>
        )}

        <div className="filtri-storico" style={{ flexWrap: 'wrap' }}>
          <div className="filtro-group" style={{ flex: '1 1 150px' }}>
            <label>Tipo:</label>
            <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}>
              <option value="">Tutti</option>
              <option value="prenotazione">Prenotazioni</option>
              <option value="voucher">Voucher</option>
            </select>
          </div>
          <div className="filtro-group" style={{ flex: '1 1 180px' }}>
            <label>Fatturazione:</label>
            <select value={filtroStato} onChange={(e) => setFiltroStato(e.target.value)}>
              <option value="aperte">Da fatturare o in parte</option>
              <option value="fatturata">Fatturate</option>
              <option value="tutte">Tutte</option>
            </select>
          </div>
          <div className="filtro-group" style={{ flex: '1 1 200px' }}>
            <label>Cerca:</label>
            <input type="text" placeholder="Codice o cliente" value={cerca} onChange={(e) => setCerca(e.target.value)} />
          </div>
          <div className="filtro-group" style={{ flex: '0 1 auto', justifyContent: 'flex-end' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={soloPassate} onChange={(e) => setSoloPassate(e.target.checked)} /> Solo partite già giocate
            </label>
          </div>
        </div>

        <div className="admin-table-box-full" style={{ marginTop: '20px', overflowX: 'auto' }}>
          <table className="storico-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem', background: '#fff' }}>
            <thead>
              <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                <th style={cella}>Codice</th>
                <th style={cella}>Data</th>
                <th style={cella}>Intestatario</th>
                <th style={cella}>Descrizione</th>
                <th style={{ ...cella, textAlign: 'right' }}>Da fatturare</th>
                <th style={{ ...cella, textAlign: 'right' }}>Fatturato</th>
                <th style={cella}>Stato</th>
              </tr>
            </thead>
            <tbody>
              {visibili.length === 0 && (
                <tr><td colSpan={7} style={{ ...cella, textAlign: 'center', color: '#666', padding: '20px' }}>Nessuna voce con questi filtri.</td></tr>
              )}
              {visibili.map(x => {
                const aperta = espansa === chiave(x);
                return (
                  <Fragment key={chiave(x)}>
                    <tr onClick={() => apriRiga(x)} style={{ cursor: 'pointer', borderBottom: aperta ? 'none' : '1px solid #eee', background: aperta ? '#f8fafc' : undefined, borderLeft: `3px solid ${COLORE_STATO[x.stato]}` }}>
                      <td style={cella}><strong>{x.codice}</strong></td>
                      <td style={{ ...cella, whiteSpace: 'nowrap' }}>{formattaDataGGMMAAAA(x.data)}</td>
                      <td style={cella}>{x.intestatario}</td>
                      <td style={{ ...cella, color: '#475569' }}>
                        {x.descrizione}
                        {x.voucher && <span style={{ color: '#94a3b8' }}> · voucher {x.voucher.codice} −{euro(x.voucher.valore)}</span>}
                      </td>
                      <td style={destra}>{euro(x.dovuto)}</td>
                      <td style={destra}>{euro(x.fatturato)}</td>
                      <td style={{ ...cella, whiteSpace: 'nowrap', color: COLORE_STATO[x.stato], fontWeight: 600 }}>
                        {x.stato === 'fatturata' && '✓ '}{ETICHETTA_STATO[x.stato]}
                      </td>
                    </tr>
                    {aperta && (
                      <tr className="riga-espandibile-dettaglio">
                        <td colSpan={7} onClick={(e) => e.stopPropagation()} style={{ padding: '10px 14px', borderBottom: '1px solid #eee' }}>
                          {x.fatture.length === 0
                            ? <p style={{ margin: '0 0 10px 0', color: '#94a3b8' }}>Nessuna fattura registrata.</p>
                            : (
                              <table style={{ borderCollapse: 'collapse', fontSize: '0.82rem', marginBottom: '10px' }}>
                                <thead><tr style={{ color: '#64748b', textAlign: 'left' }}><th style={{ padding: '4px 10px 4px 0' }}>Data</th><th style={{ padding: '4px 10px' }}>Numero</th><th style={{ padding: '4px 10px', textAlign: 'right' }}>Importo</th><th style={{ padding: '4px 10px' }}>Origine</th><th></th></tr></thead>
                                <tbody>
                                  {x.fatture.map(f => (
                                    <tr key={f.id}>
                                      <td style={{ padding: '4px 10px 4px 0' }}>{formattaDataGGMMAAAA(f.data)}</td>
                                      <td style={{ padding: '4px 10px' }}>{f.numero}</td>
                                      <td style={{ padding: '4px 10px', textAlign: 'right' }}>{euro(f.importo)}</td>
                                      <td style={{ padding: '4px 10px', color: '#94a3b8' }}>{f.origine === 'import' ? 'da export' : 'a mano'}</td>
                                      <td style={{ padding: '4px 0 4px 10px' }}><button type="button" className="btn-icon-action danger" title="Togli la fattura" onClick={() => eliminaFattura(f)}><Icona nome="elimina" size={14} style={{ marginRight: 0 }} /></button></td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          {!schemaMancante && (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(120px, 170px)) auto', gap: '10px', alignItems: 'end', maxWidth: '640px' }}>
                              {/* Data, numero e importo sulla stessa riga e alla stessa altezza. Lo stile generale degli input
                                  non vale per i campi numerici e da' a data e testo misure sue: senza fissarle qui le tre
                                  caselle venivano alte 49, 47 e 21 pixel, ognuna su una riga diversa. */}
                              <label style={stileEtichettaFattura}>Data fattura
                                <input type="date" value={nuova.data} onChange={(e) => { setNuova({ ...nuova, data: e.target.value }); setDataProposta(false); }} className={dataProposta ? 'valore-proposto' : undefined} title={dataProposta ? 'Proposta: la data di oggi' : undefined} style={stileCampoFattura} />
                              </label>
                              <label style={stileEtichettaFattura}>Numero
                                <input type="text" value={nuova.numero} onChange={(e) => setNuova({ ...nuova, numero: e.target.value })} placeholder="Es. 247" style={stileCampoFattura} />
                              </label>
                              <label style={stileEtichettaFattura}>Importo lordo €
                                <input type="number" step="0.01" min="0" value={nuova.importo} onChange={(e) => setNuova({ ...nuova, importo: e.target.value })} placeholder={Math.max(x.dovuto - x.fatturato, 0).toFixed(2)} style={stileCampoFattura} />
                              </label>
                              <button type="button" className="btn-accent-inline" disabled={inCorso} onClick={() => aggiungiFattura(x)} style={{ height: '38px', padding: '0 16px', whiteSpace: 'nowrap' }}>+ Fattura</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
            {visibili.length > 0 && (
              <tfoot>
                <tr style={{ borderTop: '2px solid #ddd', background: '#f8fafc', fontWeight: 'bold' }}>
                  <td style={cella} colSpan={4}>TOTALE ({visibili.length})</td>
                  <td style={destra}>{euro(totali.dovuto)}</td>
                  <td style={destra}>{euro(totali.fatturato)}</td>
                  <td style={cella}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {proposta && (
        <div className="modal-form-backdrop" onClick={() => setProposta(null)}>
          <div className="modal-form-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '1100px', width: '95%' }}>
            <button type="button" className="modal-form-close" aria-label="Chiudi" onClick={() => setProposta(null)}>✕</button>
            <h3 style={{ margin: '0 0 6px 0', fontSize: '1.1rem', color: '#0288d1' }}>Import da {proposta.nomeFile}</h3>
            <p style={{ margin: '0 0 12px 0', fontSize: '0.85rem', color: '#475569' }}>
              Lette <strong>{proposta.lette}</strong> fatture: <strong>{proposta.proposte.filter(p => p.certa).length}</strong> abbinate con certezza,{' '}
              <strong>{proposta.proposte.filter(p => !p.certa).length}</strong> da verificare, <strong>{proposta.giaPresenti}</strong> già registrate,{' '}
              <strong>{proposta.suGiaFatturate}</strong> su prenotazioni o voucher già fatturati per intero (non si toccano),{' '}
              <strong>{proposta.senzaAbbinamento}</strong> senza nessuna prenotazione o voucher (pregresso: si ignorano).
              Quelle certe sono già spuntate; le altre spuntale solo se l'abbinamento è giusto.
            </p>
            {proposta.proposte.length === 0 ? (
              <p style={{ color: '#666' }}>Niente da importare.</p>
            ) : (
              <div style={{ maxHeight: '55vh', overflow: 'auto', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                  <thead>
                    <tr style={{ background: '#f5f5f5', textAlign: 'left', position: 'sticky', top: 0 }}>
                      <th style={cella}></th><th style={cella}>Fattura</th><th style={cella}>Data</th><th style={cella}>Cliente in fattura</th>
                      <th style={{ ...cella, textAlign: 'right' }}>Lordo</th><th style={cella}>→ Abbinata a</th><th style={cella}>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proposta.proposte.map((pr, i) => (
                      <tr key={`${pr.fattura.numero}-${pr.fattura.data}-${i}`} style={{ borderTop: '1px solid #eee', background: pr.certa ? undefined : '#fffbeb' }}>
                        <td style={cella}><input type="checkbox" checked={!!proposta.scelte[i]} onChange={(e) => setProposta({ ...proposta, scelte: proposta.scelte.map((s, k) => (k === i ? e.target.checked : s)) })} /></td>
                        <td style={cella}><strong>{pr.fattura.numero}</strong></td>
                        <td style={{ ...cella, whiteSpace: 'nowrap' }}>{formattaDataGGMMAAAA(pr.fattura.data)}</td>
                        <td style={cella}>{pr.fattura.cliente}</td>
                        <td style={destra}>{euro(pr.fattura.importo)}</td>
                        <td style={cella}>{pr.riferimento} · {pr.nome} <span style={{ color: '#94a3b8' }}>({formattaDataGGMMAAAA(pr.dataRiferimento)}, da fatturare {euro(pr.daFatturare)})</span></td>
                        <td style={{ ...cella, color: pr.certa ? '#15803d' : '#b45309' }}>{pr.motivi.join(' · ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ display: 'flex', gap: '10px', marginTop: '14px', justifyContent: 'flex-end' }}>
              <button type="button" className="btn-outline-annulla" onClick={() => setProposta(null)} style={{ padding: '8px 16px' }}>Annulla</button>
              <button type="button" className="btn-accent-inline" disabled={inCorso || proposta.proposte.length === 0} onClick={confermaImport} style={{ padding: '8px 16px' }}>
                Importa {proposta.scelte.filter(Boolean).length} {proposta.scelte.filter(Boolean).length === 1 ? 'fattura' : 'fatture'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default Consuntivazione
