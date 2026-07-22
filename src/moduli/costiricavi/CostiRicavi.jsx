import { useState, useEffect, useMemo, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabaseClient'
import { puoVedere } from '../../lib/permessi'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell
} from 'recharts'

const MESI = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

// Palette categoriale validata (dataviz skill): ordine fisso, mai riassegnata in base al filtro attivo.
const PALETTE_CATEGORICA = ['#2a78d6', '#1baf7a', '#eda100', '#008300', '#4a3aa7', '#e34948', '#e87ba4', '#eb6834'];
const COLORE_ALTRO = '#898781'; // ink muted, per "Non assegnato" / "Altro"
const COLORE_RICAVO = '#2a78d6';
const COLORE_COSTO = '#e34948';
const COLORE_MARGINE = '#008300';
const STROKE_ASSE = '#c3c2b7';
const STROKE_GRIGLIA = '#e1e0d9';
const INK_MUTED = '#898781';

const nettoRicavo = (p) => p.prezzoVenditaNetto != null ? parseFloat(p.prezzoVenditaNetto) : (parseFloat(p.prezzoVendita) || 0) / 1.22;
const nettoCampo = (p) => p.costoCampoNetto != null ? parseFloat(p.costoCampoNetto) : (parseFloat(p.costoCampo) || 0) / 1.22;
const nettoRinf = (p) => p.costoRinfrescoNetto != null ? parseFloat(p.costoRinfrescoNetto) : (parseFloat(p.costoRinfresco) || 0) / 1.22;
const nettoEreditato = (p) => p.ereditaCosti ? (parseFloat(p.costoEreditato) || 0) : 0;
const costoTotaleNetto = (p) => nettoCampo(p) + nettoRinf(p) + nettoEreditato(p);

// Assegna un colore stabile per nome-centro in base alla posizione nell'elenco completo (ordine alfabetico),
// cosi' un centro mantiene sempre lo stesso colore anche cambiando i filtri attivi.
const mappaColoriCentri = (nomi) => {
  const ordinati = [...new Set(nomi.filter(Boolean))].sort();
  const mappa = {};
  ordinati.forEach((nome, i) => { mappa[nome] = PALETTE_CATEGORICA[i % PALETTE_CATEGORICA.length]; });
  return mappa;
};

const coloreCentro = (mappa, nome) => (nome === 'Non assegnato' || nome === 'Altro') ? COLORE_ALTRO : (mappa[nome] || COLORE_ALTRO);

// Raggruppa le righe per centro, ordina per valore decrescente e piega la coda oltre le prime 7 voci in "Altro".
const raggruppaPerCentro = (righe, getCentro, getValore) => {
  const somme = {};
  righe.forEach(p => {
    const nome = getCentro(p);
    somme[nome] = (somme[nome] || 0) + getValore(p);
  });
  const voci = Object.entries(somme)
    .map(([nome, valore]) => ({ nome, valore }))
    .filter(v => v.valore > 0.001)
    .sort((a, b) => b.valore - a.valore);
  if (voci.length <= 7) return voci;
  const top = voci.slice(0, 7);
  const restoValore = voci.slice(7).reduce((s, v) => s + v.valore, 0);
  return [...top, { nome: 'Altro', valore: restoValore }];
};

const formattaEuro = (v) => `€${(+v || 0).toFixed(2)}`;

function CostiRicavi({ user }) {
  const primaSchedaCR = ['tabella', 'andamento'].find(s => puoVedere(user, 'costiricavi', s)) || 'tabella';
  const [currentView, setCurrentView] = useState(primaSchedaCR);

  const [prenotazioni, setPrenotazioni] = useState([]);
  const [pacchetti, setPacchetti] = useState([]);
  const [campi, setCampi] = useState([]);

  useEffect(() => { fetchTutto(); }, []);

  const fetchTutto = async () => {
    const [pr, pa, ca] = await Promise.all([
      supabase.from('prenotazioni').select('*').order('data', { ascending: false }),
      supabase.from('pren_pacchetti').select('*').order('nome'),
      supabase.from('pren_campi').select('*').order('nome'),
    ]);
    if (pr.data) setPrenotazioni(pr.data);
    if (pa.data) setPacchetti(pa.data);
    if (ca.data) setCampi(ca.data);
  };

  const centroRicavoDi = useCallback((p) => pacchetti.find(x => x.id === p.pacchettoId)?.centroRicavo || 'Non assegnato', [pacchetti]);
  const centroCostoDi = useCallback((p) => campi.find(c => c.id === p.campoId)?.centroCosto || 'Non assegnato', [campi]);
  const campoNomeDi = useCallback((p) => campi.find(c => c.id === p.campoId)?.nome || '—', [campi]);

  // ====================== TABELLA (dettaglio partite, filtri e export) ======================
  const [filtroData, setFiltroData] = useState("");
  const [filtroStato, setFiltroStato] = useState("");
  const [filtroNome, setFiltroNome] = useState("");

  const righeTabella = prenotazioni.filter(p => {
    const mData = !filtroData || p.data === filtroData;
    const mStato = !filtroStato || p.stato === filtroStato;
    const mNome = (p.nominativo || "").toLowerCase().includes(filtroNome.toLowerCase());
    return mData && mStato && mNome;
  });

  const totTabella = righeTabella.reduce((a, p) => {
    const r = nettoRicavo(p), c = costoTotaleNetto(p);
    return { ricavo: a.ricavo + r, costo: a.costo + c, margine: a.margine + (r - c) };
  }, { ricavo: 0, costo: 0, margine: 0 });

  const esportaExcel = () => {
    if (righeTabella.length === 0) return alert("Nessuna partita da esportare.");
    const righe = righeTabella.map(p => {
      const r = {};
      Object.keys(p).forEach(k => {
        const v = p[k];
        if (k === 'operatori') r['operatori'] = (v || []).map(o => o.nome).join(', ');
        else if (k === 'pagamenti') r['pagamenti'] = (v || []).map(pg => `${pg.data}: €${(parseFloat(pg.importo) || 0).toFixed(2)}${pg.nominativo ? ` (${pg.nominativo})` : ''}`).join(' | ');
        else if (v !== null && typeof v === 'object') r[k] = JSON.stringify(v);
        else r[k] = v;
      });
      return r;
    });
    const ws = XLSX.utils.json_to_sheet(righe);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "CostiRicavi");
    XLSX.writeFile(wb, "Costi_Ricavi.xlsx");
  };

  // ====================== ANDAMENTO (grafici) ======================
  const annoCorrente = String(new Date().getFullYear());
  const anniDisponibili = useMemo(() => {
    const anni = new Set(prenotazioni.filter(p => p.data).map(p => p.data.slice(0, 4)));
    return [...anni].sort().reverse();
  }, [prenotazioni]);

  // null = l'utente non ha ancora scelto esplicitamente un anno -> si applica il default calcolato
  const [annoSelManuale, setAnnoSelManuale] = useState(null);
  const annoDefault = anniDisponibili.includes(annoCorrente) ? annoCorrente : (anniDisponibili[0] || "");
  const annoSel = annoSelManuale ?? annoDefault; // "" = Tutti gli anni
  const setAnnoSel = setAnnoSelManuale;
  const [meseSel, setMeseSel] = useState(""); // "" = Tutti i mesi (attivo solo se annoSel è specifico)
  const [centroCostoSel, setCentroCostoSel] = useState("");
  const [centroRicavoSel, setCentroRicavoSel] = useState("");

  const centriCostoDisponibili = useMemo(() => [...new Set(campi.map(c => c.centroCosto).filter(Boolean))].sort(), [campi]);
  const centriRicavoDisponibili = useMemo(() => [...new Set(pacchetti.map(p => p.centroRicavo).filter(Boolean))].sort(), [pacchetti]);

  const righeAndamento = useMemo(() => prenotazioni.filter(p => {
    if (!p.data) return false;
    if (annoSel && p.data.slice(0, 4) !== annoSel) return false;
    if (annoSel && meseSel && parseInt(p.data.slice(5, 7), 10) !== parseInt(meseSel, 10)) return false;
    if (centroCostoSel && centroCostoDi(p) !== centroCostoSel) return false;
    if (centroRicavoSel && centroRicavoDi(p) !== centroRicavoSel) return false;
    return true;
  }), [prenotazioni, annoSel, meseSel, centroCostoSel, centroRicavoSel, centroCostoDi, centroRicavoDi]);

  const datiBarre = useMemo(() => {
    if (!annoSel) {
      const per = {};
      righeAndamento.forEach(p => {
        const anno = p.data.slice(0, 4);
        const r = nettoRicavo(p), c = costoTotaleNetto(p);
        if (!per[anno]) per[anno] = { periodo: anno, ricavo: 0, costo: 0, margine: 0 };
        per[anno].ricavo += r; per[anno].costo += c; per[anno].margine += (r - c);
      });
      return Object.values(per).sort((a, b) => a.periodo.localeCompare(b.periodo));
    }
    const per = MESI.map(label => ({ periodo: label, ricavo: 0, costo: 0, margine: 0 }));
    righeAndamento.forEach(p => {
      const mIdx = parseInt(p.data.slice(5, 7), 10) - 1;
      if (mIdx < 0 || mIdx > 11) return;
      const r = nettoRicavo(p), c = costoTotaleNetto(p);
      per[mIdx].ricavo += r; per[mIdx].costo += c; per[mIdx].margine += (r - c);
    });
    return per;
  }, [righeAndamento, annoSel]);

  const mappaColoriRicavo = useMemo(() => mappaColoriCentri(pacchetti.map(x => x.centroRicavo)), [pacchetti]);
  const mappaColoriCosto = useMemo(() => mappaColoriCentri(campi.map(c => c.centroCosto)), [campi]);
  const datiTortaRicavi = useMemo(() => raggruppaPerCentro(righeAndamento, centroRicavoDi, nettoRicavo), [righeAndamento, centroRicavoDi]);
  const datiTortaCosti = useMemo(() => raggruppaPerCentro(righeAndamento, centroCostoDi, costoTotaleNetto), [righeAndamento, centroCostoDi]);

  const etichettaFetta = ({ nome, percent }) => percent > 0.08 ? `${nome} ${(percent * 100).toFixed(0)}%` : '';

  return (
    <>
      <nav className="modulo-subnav no-print">
        {puoVedere(user, 'costiricavi', 'tabella') && (
          <button className={`nav-btn ${currentView === 'tabella' ? 'active' : ''}`} onClick={() => setCurrentView("tabella")}>🗂️ Tabella</button>
        )}
        {puoVedere(user, 'costiricavi', 'andamento') && (
          <button className={`nav-btn ${currentView === 'andamento' ? 'active' : ''}`} onClick={() => setCurrentView("andamento")}>📈 Andamento</button>
        )}
      </nav>

      {/* ===================== TABELLA ===================== */}
      {currentView === "tabella" && puoVedere(user, 'costiricavi', 'tabella') && (
        <div className="schermata-storico no-print">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <h2 style={{ margin: 0 }}>💰 Costi / Ricavi <span style={{ fontSize: '0.75rem', fontWeight: 'normal', color: '#777' }}>(valori senza IVA)</span></h2>
            <button onClick={esportaExcel} style={{ padding: '8px 16px', backgroundColor: '#10b981', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>📊 Esporta Excel</button>
          </div>
          <div className="filtri-storico" style={{ flexWrap: 'wrap' }}>
            <div className="filtro-group" style={{ flex: '1 1 160px' }}><label>Data:</label><input type="date" value={filtroData} onChange={(e) => setFiltroData(e.target.value)} /></div>
            <div className="filtro-group" style={{ flex: '1 1 160px' }}><label>Stato:</label><select value={filtroStato} onChange={(e) => setFiltroStato(e.target.value)}><option value="">Tutti</option><option value="FORSE">FORSE</option><option value="CONF">CONF</option></select></div>
            <div className="filtro-group" style={{ flex: '1 1 180px' }}><label>Nominativo:</label><input type="text" value={filtroNome} onChange={(e) => setFiltroNome(e.target.value)} /></div>
          </div>

          <div className="admin-table-box-full" style={{ marginTop: '20px', overflowX: 'auto' }}>
            <table className="storico-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem', background: '#fff' }}>
              <thead>
                <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                  <th style={{ padding: '10px' }}>Codice / Data</th>
                  <th style={{ padding: '10px' }}>Nominativo</th>
                  <th style={{ padding: '10px' }}>Campo</th>
                  <th style={{ padding: '10px' }}>Stato</th>
                  <th style={{ padding: '10px', textAlign: 'right' }}>Ricavo</th>
                  <th style={{ padding: '10px', textAlign: 'right' }}>Costo campo</th>
                  <th style={{ padding: '10px', textAlign: 'right' }}>Costo rinfresco</th>
                  <th style={{ padding: '10px', textAlign: 'right' }}>Costo ereditato</th>
                  <th style={{ padding: '10px', textAlign: 'right' }}>Margine</th>
                </tr>
              </thead>
              <tbody>
                {righeTabella.length === 0 ? (
                  <tr><td colSpan="9" style={{ textAlign: 'center', padding: '20px', color: '#666' }}>Nessuna partita.</td></tr>
                ) : righeTabella.map(p => {
                  const r = nettoRicavo(p), cc = nettoCampo(p), cr = nettoRinf(p), ce = nettoEreditato(p), m = r - cc - cr - ce;
                  return (
                    <tr key={p.id} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '10px' }}><strong>{p.id}</strong><br /><span style={{ color: '#777', fontSize: '0.8rem' }}>{p.data}</span></td>
                      <td style={{ padding: '10px' }}>{p.nominativo}</td>
                      <td style={{ padding: '10px' }}>{campoNomeDi(p)}</td>
                      <td style={{ padding: '10px' }}><span className={`badge-stato ${(p.stato || '').toLowerCase()}`}>{p.stato}</span></td>
                      <td style={{ padding: '10px', textAlign: 'right' }}>€{r.toFixed(2)}</td>
                      <td style={{ padding: '10px', textAlign: 'right', color: '#c62828' }}>€{cc.toFixed(2)}</td>
                      <td style={{ padding: '10px', textAlign: 'right', color: '#c62828' }}>€{cr.toFixed(2)}</td>
                      <td style={{ padding: '10px', textAlign: 'right', color: '#c62828' }}>{p.ereditaCosti ? `€${ce.toFixed(2)}` : '—'}</td>
                      <td style={{ padding: '10px', textAlign: 'right', fontWeight: 'bold', color: m >= 0 ? '#2e7d32' : '#c62828' }}>€{m.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid #ddd', background: '#f8fafc', fontWeight: 'bold' }}>
                  <td style={{ padding: '10px' }} colSpan="4">TOTALE ({righeTabella.length})</td>
                  <td style={{ padding: '10px', textAlign: 'right' }}>€{totTabella.ricavo.toFixed(2)}</td>
                  <td style={{ padding: '10px', textAlign: 'right', color: '#c62828' }} colSpan="3">€{totTabella.costo.toFixed(2)}</td>
                  <td style={{ padding: '10px', textAlign: 'right', color: totTabella.margine >= 0 ? '#2e7d32' : '#c62828' }}>€{totTabella.margine.toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ===================== ANDAMENTO ===================== */}
      {currentView === "andamento" && puoVedere(user, 'costiricavi', 'andamento') && (
        <div className="schermata-storico no-print">
          <h2 style={{ margin: '0 0 15px 0' }}>📈 Andamento Costi / Ricavi <span style={{ fontSize: '0.75rem', fontWeight: 'normal', color: '#777' }}>(valori senza IVA)</span></h2>

          <div className="filtri-storico" style={{ flexWrap: 'wrap' }}>
            <div className="filtro-group" style={{ flex: '1 1 140px' }}>
              <label>Anno:</label>
              <select value={annoSel} onChange={(e) => { setAnnoSel(e.target.value); setMeseSel(""); }}>
                <option value="">Tutti gli anni</option>
                {anniDisponibili.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div className="filtro-group" style={{ flex: '1 1 140px' }}>
              <label>Mese:</label>
              <select value={meseSel} onChange={(e) => setMeseSel(e.target.value)} disabled={!annoSel}>
                <option value="">Tutti i mesi</option>
                {MESI.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
              </select>
            </div>
            <div className="filtro-group" style={{ flex: '1 1 180px' }}>
              <label>Centro di costo:</label>
              <select value={centroCostoSel} onChange={(e) => setCentroCostoSel(e.target.value)}>
                <option value="">Tutti</option>
                {centriCostoDisponibili.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="filtro-group" style={{ flex: '1 1 180px' }}>
              <label>Centro di ricavo:</label>
              <select value={centroRicavoSel} onChange={(e) => setCentroRicavoSel(e.target.value)}>
                <option value="">Tutti</option>
                {centriRicavoDisponibili.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div className="admin-table-box-full" style={{ marginTop: '20px', padding: '16px 8px' }}>
            <h3 style={{ margin: '0 0 10px 14px', fontSize: '1rem' }}>Ricavi, costi e margine {annoSel ? `per mese (${annoSel})` : 'per anno'}</h3>
            <ResponsiveContainer width="100%" height={340}>
              <BarChart data={datiBarre} margin={{ top: 10, right: 20, left: 0, bottom: 0 }} barCategoryGap="20%">
                <CartesianGrid vertical={false} stroke={STROKE_GRIGLIA} />
                <XAxis dataKey="periodo" stroke={STROKE_ASSE} tick={{ fill: INK_MUTED, fontSize: 12 }} axisLine={{ stroke: STROKE_ASSE }} tickLine={false} />
                <YAxis stroke={STROKE_ASSE} tick={{ fill: INK_MUTED, fontSize: 12 }} axisLine={{ stroke: STROKE_ASSE }} tickLine={false} tickFormatter={(v) => `€${v}`} />
                <Tooltip formatter={(value) => formattaEuro(value)} contentStyle={{ fontSize: '0.85rem' }} />
                <Legend wrapperStyle={{ fontSize: '0.85rem' }} />
                <Bar dataKey="ricavo" name="Ricavo" fill={COLORE_RICAVO} radius={[4, 4, 0, 0]} maxBarSize={24} />
                <Bar dataKey="costo" name="Costo" fill={COLORE_COSTO} radius={[4, 4, 0, 0]} maxBarSize={24} />
                <Bar dataKey="margine" name="Margine" fill={COLORE_MARGINE} radius={[4, 4, 0, 0]} maxBarSize={24} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', marginTop: '20px' }}>
            <div className="admin-table-box-full" style={{ flex: '1 1 380px', padding: '16px 8px' }}>
              <h3 style={{ margin: '0 0 10px 14px', fontSize: '1rem' }}>Distribuzione ricavi per centro di ricavo</h3>
              {datiTortaRicavi.length === 0 ? (
                <p style={{ textAlign: 'center', color: '#666', padding: '20px' }}>Nessun dato nel periodo selezionato.</p>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <PieChart>
                    <Pie data={datiTortaRicavi} dataKey="valore" nameKey="nome" cx="50%" cy="50%" outerRadius={100} label={etichettaFetta}>
                      {datiTortaRicavi.map(v => <Cell key={v.nome} fill={coloreCentro(mappaColoriRicavo, v.nome)} />)}
                    </Pie>
                    <Tooltip formatter={(value) => formattaEuro(value)} />
                    <Legend wrapperStyle={{ fontSize: '0.8rem' }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="admin-table-box-full" style={{ flex: '1 1 380px', padding: '16px 8px' }}>
              <h3 style={{ margin: '0 0 10px 14px', fontSize: '1rem' }}>Distribuzione costi per centro di costo</h3>
              {datiTortaCosti.length === 0 ? (
                <p style={{ textAlign: 'center', color: '#666', padding: '20px' }}>Nessun dato nel periodo selezionato.</p>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <PieChart>
                    <Pie data={datiTortaCosti} dataKey="valore" nameKey="nome" cx="50%" cy="50%" outerRadius={100} label={etichettaFetta}>
                      {datiTortaCosti.map(v => <Cell key={v.nome} fill={coloreCentro(mappaColoriCosto, v.nome)} />)}
                    </Pie>
                    <Tooltip formatter={(value) => formattaEuro(value)} />
                    <Legend wrapperStyle={{ fontSize: '0.8rem' }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default CostiRicavi
