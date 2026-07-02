import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabaseClient'
import RicercaIndirizzo from '../../components/RicercaIndirizzo'

const GIORNI = [
  { n: 1, l: 'Lun' }, { n: 2, l: 'Mar' }, { n: 3, l: 'Mer' }, { n: 4, l: 'Gio' },
  { n: 5, l: 'Ven' }, { n: 6, l: 'Sab' }, { n: 7, l: 'Dom' }
];

const PACCHETTO_VUOTO = { nome: "", durataOre: "", locationTipo: "libera", prezzo: "", centroRicavo: "", prevedeRinfresco: false, numeroPartecipanti: "" };
const OPERATORE_VUOTO = { nome: "", email: "", telefono: "" };
const CAMPO_VUOTO = { nome: "", indirizzo: "", cap: "", citta: "", provincia: "", centroCosto: "", costoFlat: "", ivaInclusa: false, costoMerenda: "", costoAperitivo: "" };

const ivaLabel = (incl) => incl ? 'IVA inclusa' : 'IVA esclusa';
const numOrNull = (v) => v === "" || v == null ? null : parseFloat(v);

// Normalizza un orario in formato 24h "HH:MM". Accetta "1900" o "19:00". Ritorna null se non valido.
const normalizzaOra24 = (raw) => {
  const s = (raw || "").trim();
  if (s === "") return "";
  const soloCifre = s.replace(/[^\d]/g, "");
  if (soloCifre.length !== 4) return null;
  const hh = parseInt(soloCifre.slice(0, 2), 10);
  const mm = parseInt(soloCifre.slice(2, 4), 10);
  if (hh > 23 || mm > 59) return null;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};

// MODULO SPERIMENTALE — non visibile nella build online.
function Prenotazioni({ user }) {
  const [currentView, setCurrentView] = useState("nuova"); // config | nuova | storico | calendario
  const [configTab, setConfigTab] = useState("pacchetti");  // pacchetti | operatori | campi

  const [pacchetti, setPacchetti] = useState([]);
  const [operatori, setOperatori] = useState([]);
  const [campi, setCampi] = useState([]);
  const [tariffe, setTariffe] = useState([]);

  // visibilità dei form (aperti da "Nuovo" o "Modifica")
  const [showFormPacchetto, setShowFormPacchetto] = useState(false);
  const [showFormOperatore, setShowFormOperatore] = useState(false);
  const [showFormCampo, setShowFormCampo] = useState(false);

  // visibilità elenchi (collassabili, aperti di default)
  const [showListaPacchetti, setShowListaPacchetti] = useState(true);
  const [showListaOperatori, setShowListaOperatori] = useState(true);
  const [showListaCampi, setShowListaCampi] = useState(true);

  // form (usati sia per creare sia per modificare)
  const [formPacchetto, setFormPacchetto] = useState(PACCHETTO_VUOTO);
  const [editPacchetto, setEditPacchetto] = useState(null);
  const [formOperatore, setFormOperatore] = useState(OPERATORE_VUOTO);
  const [editOperatore, setEditOperatore] = useState(null);
  // editing inline in tabella
  const [idPacchettoInline, setIdPacchettoInline] = useState(null);
  const [datiPacchettoInline, setDatiPacchettoInline] = useState(PACCHETTO_VUOTO);
  const [idOperatoreInline, setIdOperatoreInline] = useState(null);
  const [datiOperatoreInline, setDatiOperatoreInline] = useState(OPERATORE_VUOTO);
  const [formCampo, setFormCampo] = useState(CAMPO_VUOTO);
  const [editCampo, setEditCampo] = useState(null);
  const [nuovaTariffa, setNuovaTariffa] = useState({ campoId: "", giorni: [], oraInizio: "", oraFine: "", costo: "" });

  useEffect(() => { fetchTutto(); }, []);

  const fetchTutto = async () => {
    const [p, o, c, t] = await Promise.all([
      supabase.from('pren_pacchetti').select('*').order('nome'),
      supabase.from('pren_operatori').select('*').order('nome'),
      supabase.from('pren_campi').select('*').order('nome'),
      supabase.from('pren_campi_tariffe').select('*')
    ]);
    if (p.data) setPacchetti(p.data);
    if (o.data) setOperatori(o.data);
    if (c.data) setCampi(c.data);
    if (t.data) setTariffe(t.data);
  };

  const inputStyle = { width: '100%', boxSizing: 'border-box', height: '36px', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px' };
  const btnSalva = { padding: '9px 18px', background: '#0288d1', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' };
  const btnNuovo = { width: 'auto', marginTop: 0, padding: '8px 16px', background: '#10b981' };
  const lblStyle = { display: 'block', fontSize: '0.78rem', fontWeight: 'bold', color: '#555', marginBottom: '3px' };
  const boxForm = { background: '#f9f9f9', padding: '18px', borderRadius: '8px', border: '1px solid #e0e0e0', marginBottom: '15px' };
  const boxTabella = { background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', maxHeight: 'none', overflowY: 'visible' };
  const headerElenco = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '15px 0' };
  const btnCollassa = { width: 'auto', marginTop: 0, padding: '6px 12px', fontSize: '0.85rem', background: '#e2e8f0', color: '#334155' };
  const btnBarraNuovo = { display: 'flex', justifyContent: 'flex-end', margin: '18px 0 12px 0' };

  const Campo = ({ label, children }) => (
    <div><label style={lblStyle}>{label}</label>{children}</div>
  );

  // ---------------- PACCHETTI ----------------
  const salvaPacchetto = async (e) => {
    e.preventDefault();
    if (!formPacchetto.nome) return alert("Inserisci il nome del pacchetto");
    const rec = {
      nome: formPacchetto.nome,
      durataOre: numOrNull(formPacchetto.durataOre),
      locationTipo: formPacchetto.locationTipo,
      prezzo: numOrNull(formPacchetto.prezzo),
      centroRicavo: formPacchetto.centroRicavo,
      prevedeRinfresco: formPacchetto.prevedeRinfresco,
      numeroPartecipanti: numOrNull(formPacchetto.numeroPartecipanti)
    };
    let error;
    if (editPacchetto) ({ error } = await supabase.from('pren_pacchetti').update(rec).eq('id', editPacchetto));
    else ({ error } = await supabase.from('pren_pacchetti').insert([{ id: "ppk_" + Date.now(), ...rec }]));
    if (error) { console.error(error); return alert("Errore salvataggio pacchetto"); }
    setFormPacchetto(PACCHETTO_VUOTO); setEditPacchetto(null); setShowFormPacchetto(false); fetchTutto();
  };
  const nuovoPacchetto = () => { setIdPacchettoInline(null); setEditPacchetto(null); setFormPacchetto(PACCHETTO_VUOTO); setShowFormPacchetto(true); };
  const modificaPacchetto = (p) => {
    setEditPacchetto(p.id);
    setFormPacchetto({
      nome: p.nome || "", durataOre: p.durataOre ?? "", locationTipo: p.locationTipo || "libera",
      prezzo: p.prezzo ?? "", centroRicavo: p.centroRicavo || "", prevedeRinfresco: !!p.prevedeRinfresco, numeroPartecipanti: p.numeroPartecipanti ?? ""
    });
    setShowFormPacchetto(true);
  };
  const rimuoviPacchetto = async (id) => { if (window.confirm("Eliminare il pacchetto?")) { await supabase.from('pren_pacchetti').delete().eq('id', id); fetchTutto(); } };
  const iniziaInlinePacchetto = (p) => {
    setShowFormPacchetto(false);
    setIdPacchettoInline(p.id);
    setDatiPacchettoInline({
      nome: p.nome || "", durataOre: p.durataOre ?? "", locationTipo: p.locationTipo || "libera",
      prezzo: p.prezzo ?? "", centroRicavo: p.centroRicavo || "", prevedeRinfresco: !!p.prevedeRinfresco, numeroPartecipanti: p.numeroPartecipanti ?? ""
    });
  };
  const salvaInlinePacchetto = async () => {
    const d = datiPacchettoInline;
    const { error } = await supabase.from('pren_pacchetti').update({
      nome: d.nome, durataOre: numOrNull(d.durataOre), locationTipo: d.locationTipo,
      prezzo: numOrNull(d.prezzo), centroRicavo: d.centroRicavo, prevedeRinfresco: d.prevedeRinfresco, numeroPartecipanti: numOrNull(d.numeroPartecipanti)
    }).eq('id', idPacchettoInline);
    if (error) { console.error(error); return alert("Errore salvataggio pacchetto"); }
    setIdPacchettoInline(null); fetchTutto();
  };

  // ---------------- OPERATORI ----------------
  const salvaOperatore = async (e) => {
    e.preventDefault();
    if (!formOperatore.nome) return alert("Inserisci il nome dell'operatore");
    let error;
    if (editOperatore) ({ error } = await supabase.from('pren_operatori').update(formOperatore).eq('id', editOperatore));
    else ({ error } = await supabase.from('pren_operatori').insert([{ id: "opr_" + Date.now(), ...formOperatore }]));
    if (error) { console.error(error); return alert("Errore salvataggio operatore"); }
    setFormOperatore(OPERATORE_VUOTO); setEditOperatore(null); setShowFormOperatore(false); fetchTutto();
  };
  const nuovoOperatore = () => { setIdOperatoreInline(null); setEditOperatore(null); setFormOperatore(OPERATORE_VUOTO); setShowFormOperatore(true); };
  const modificaOperatore = (o) => { setEditOperatore(o.id); setFormOperatore({ nome: o.nome || "", email: o.email || "", telefono: o.telefono || "" }); setShowFormOperatore(true); };
  const rimuoviOperatore = async (id) => { if (window.confirm("Eliminare l'operatore?")) { await supabase.from('pren_operatori').delete().eq('id', id); fetchTutto(); } };
  const iniziaInlineOperatore = (o) => { setShowFormOperatore(false); setIdOperatoreInline(o.id); setDatiOperatoreInline({ nome: o.nome || "", email: o.email || "", telefono: o.telefono || "" }); };
  const salvaInlineOperatore = async () => {
    const { error } = await supabase.from('pren_operatori').update(datiOperatoreInline).eq('id', idOperatoreInline);
    if (error) { console.error(error); return alert("Errore salvataggio operatore"); }
    setIdOperatoreInline(null); fetchTutto();
  };

  // ---------------- CAMPI ----------------
  const salvaCampo = async (e) => {
    e.preventDefault();
    if (!formCampo.nome) return alert("Inserisci il nome del campo");
    const rec = {
      nome: formCampo.nome, indirizzo: formCampo.indirizzo, cap: formCampo.cap, citta: formCampo.citta, provincia: formCampo.provincia,
      centroCosto: formCampo.centroCosto, costoFlat: numOrNull(formCampo.costoFlat), ivaInclusa: formCampo.ivaInclusa,
      costoMerenda: numOrNull(formCampo.costoMerenda), costoAperitivo: numOrNull(formCampo.costoAperitivo)
    };
    let error;
    if (editCampo) ({ error } = await supabase.from('pren_campi').update(rec).eq('id', editCampo));
    else ({ error } = await supabase.from('pren_campi').insert([{ id: "cmp_" + Date.now(), ...rec }]));
    if (error) { console.error(error); return alert("Errore salvataggio campo"); }
    setFormCampo(CAMPO_VUOTO); setEditCampo(null); setShowFormCampo(false); fetchTutto();
  };
  const nuovoCampo = () => { setEditCampo(null); setFormCampo(CAMPO_VUOTO); setShowFormCampo(true); };
  const modificaCampo = (c) => {
    setEditCampo(c.id);
    setFormCampo({
      nome: c.nome || "", indirizzo: c.indirizzo || "", cap: c.cap || "", citta: c.citta || "", provincia: c.provincia || "",
      centroCosto: c.centroCosto || "", costoFlat: c.costoFlat ?? "", ivaInclusa: !!c.ivaInclusa,
      costoMerenda: c.costoMerenda ?? "", costoAperitivo: c.costoAperitivo ?? ""
    });
    setShowFormCampo(true);
  };
  const rimuoviCampo = async (id) => {
    if (!window.confirm("Eliminare il campo e le sue tariffe?")) return;
    await supabase.from('pren_campi_tariffe').delete().eq('campoId', id);
    await supabase.from('pren_campi').delete().eq('id', id);
    if (editCampo === id) { setEditCampo(null); setFormCampo(CAMPO_VUOTO); setShowFormCampo(false); }
    fetchTutto();
  };

  const addTariffa = async (campoId) => {
    if (nuovaTariffa.giorni.length === 0 || nuovaTariffa.costo === "") return alert("Seleziona i giorni e inserisci il costo");
    const oraInizio = normalizzaOra24(nuovaTariffa.oraInizio);
    const oraFine = normalizzaOra24(nuovaTariffa.oraFine);
    if (oraInizio === null || oraFine === null) return alert("Orario non valido: usa il formato 24h HH:MM (es. 19:00).");
    const rec = { id: "trf_" + Date.now(), campoId, giorni: nuovaTariffa.giorni.join(','), oraInizio, oraFine, costo: parseFloat(nuovaTariffa.costo) || 0 };
    const { error } = await supabase.from('pren_campi_tariffe').insert([rec]);
    if (error) { console.error(error); return alert("Errore salvataggio tariffa"); }
    setNuovaTariffa({ campoId: "", giorni: [], oraInizio: "", oraFine: "", costo: "" });
    fetchTutto();
  };
  const rimuoviTariffa = async (id) => { await supabase.from('pren_campi_tariffe').delete().eq('id', id); fetchTutto(); };
  const toggleGiornoTariffa = (n) => setNuovaTariffa(prev => ({ ...prev, giorni: prev.giorni.includes(n) ? prev.giorni.filter(x => x !== n) : [...prev.giorni, n] }));
  const etichettaGiorni = (str) => (str || "").split(',').filter(Boolean).map(n => GIORNI.find(g => g.n === parseInt(n))?.l || n).join(' ');

  return (
    <>
      <nav className="modulo-subnav no-print">
        {user.ruolo === "admin" && (
          <button className={`nav-btn ${currentView === 'config' ? 'active' : ''}`} onClick={() => setCurrentView("config")}>⚙️ Configuratore</button>
        )}
        <button className={`nav-btn ${currentView === 'nuova' ? 'active' : ''}`} onClick={() => setCurrentView("nuova")}>➕ Nuova Prenotazione</button>
        <button className={`nav-btn ${currentView === 'storico' ? 'active' : ''}`} onClick={() => setCurrentView("storico")}>🗂️ Storico</button>
        <button className={`nav-btn ${currentView === 'calendario' ? 'active' : ''}`} onClick={() => setCurrentView("calendario")}>📅 Calendario</button>
      </nav>

      {/* ===================== CONFIGURATORE ===================== */}
      {currentView === "config" && user.ruolo === "admin" && (
        <div className="schermata-admin no-print" style={{ padding: '20px' }}>
          <h2>Configuratore Prenotazioni <span style={{ fontSize: '0.7rem', background: '#fde68a', color: '#92400e', padding: '3px 10px', borderRadius: '6px', verticalAlign: 'middle' }}>SPERIMENTALE</span></h2>

          <div className="modulo-subnav" style={{ marginTop: '15px' }}>
            <button className={`nav-btn ${configTab === 'pacchetti' ? 'active' : ''}`} onClick={() => setConfigTab("pacchetti")}>📦 Pacchetti</button>
            <button className={`nav-btn ${configTab === 'operatori' ? 'active' : ''}`} onClick={() => setConfigTab("operatori")}>👤 Operatori</button>
            <button className={`nav-btn ${configTab === 'campi' ? 'active' : ''}`} onClick={() => setConfigTab("campi")}>📍 Campi</button>
          </div>

          {/* --- PACCHETTI --- */}
          {configTab === "pacchetti" && (
            <div>
              <div style={headerElenco}>
                <h3 style={{ margin: 0 }}>Pacchetti ({pacchetti.length})</h3>
                <button className="nav-btn" style={btnCollassa} onClick={() => setShowListaPacchetti(v => !v)}>{showListaPacchetti ? '▼ Nascondi elenco' : '▶ Mostra elenco'}</button>
              </div>

              {showListaPacchetti && (
                <div className="admin-table-box" style={boxTabella}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                    <thead><tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                      <th style={{ padding: '10px 12px' }}>Nome</th><th style={{ padding: '10px 12px' }}>Durata</th><th style={{ padding: '10px 12px' }}>Location</th><th style={{ padding: '10px 12px' }}>Prezzo</th><th style={{ padding: '10px 12px' }}>C. Ricavo</th><th style={{ padding: '10px 12px' }}>N° Part.</th><th style={{ padding: '10px 12px' }}>Rinfresco</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Azioni</th>
                    </tr></thead>
                    <tbody>
                      {pacchetti.map(p => idPacchettoInline === p.id ? (
                        <tr key={p.id} style={{ borderBottom: '1px solid #eee', background: '#f0f9ff' }}>
                          <td style={{ padding: '8px' }}><input className="table-input" value={datiPacchettoInline.nome} onChange={(e) => setDatiPacchettoInline({ ...datiPacchettoInline, nome: e.target.value })} style={{ width: '100%', height: '28px', fontSize: '0.8rem' }} /></td>
                          <td style={{ padding: '8px' }}><input className="table-input" type="number" step="any" placeholder="Libera" value={datiPacchettoInline.durataOre} onChange={(e) => setDatiPacchettoInline({ ...datiPacchettoInline, durataOre: e.target.value })} style={{ width: '70px', height: '28px', fontSize: '0.8rem' }} /></td>
                          <td style={{ padding: '8px' }}><select className="table-input" value={datiPacchettoInline.locationTipo} onChange={(e) => setDatiPacchettoInline({ ...datiPacchettoInline, locationTipo: e.target.value })} style={{ height: '30px', fontSize: '0.8rem' }}><option value="libera">Libera</option><option value="campi">Dai campi</option></select></td>
                          <td style={{ padding: '8px' }}><input className="table-input" type="number" step="any" placeholder="Manuale" value={datiPacchettoInline.prezzo} onChange={(e) => setDatiPacchettoInline({ ...datiPacchettoInline, prezzo: e.target.value })} style={{ width: '80px', height: '28px', fontSize: '0.8rem' }} /></td>
                          <td style={{ padding: '8px' }}><input className="table-input" value={datiPacchettoInline.centroRicavo} onChange={(e) => setDatiPacchettoInline({ ...datiPacchettoInline, centroRicavo: e.target.value })} style={{ width: '100%', height: '28px', fontSize: '0.8rem' }} /></td>
                          <td style={{ padding: '8px' }}><input className="table-input" type="number" step="1" value={datiPacchettoInline.numeroPartecipanti} onChange={(e) => setDatiPacchettoInline({ ...datiPacchettoInline, numeroPartecipanti: e.target.value })} style={{ width: '60px', height: '28px', fontSize: '0.8rem' }} /></td>
                          <td style={{ padding: '8px', textAlign: 'center' }}><input type="checkbox" checked={datiPacchettoInline.prevedeRinfresco} onChange={(e) => setDatiPacchettoInline({ ...datiPacchettoInline, prevedeRinfresco: e.target.checked })} /></td>
                          <td style={{ padding: '8px', textAlign: 'center' }}>
                            <div style={{ display: 'flex', gap: '5px', justifyContent: 'center' }}>
                              <button className="btn-salva-inline" style={{ fontSize: '0.8rem', padding: '4px 8px' }} onClick={salvaInlinePacchetto}>Salva</button>
                              <button className="btn-annulla-inline" style={{ fontSize: '0.8rem', padding: '4px 8px' }} onClick={() => setIdPacchettoInline(null)}>Annulla</button>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        <tr key={p.id} style={{ borderBottom: '1px solid #eee' }}>
                          <td style={{ padding: '10px 12px' }}><strong>{p.nome}</strong></td>
                          <td style={{ padding: '10px 12px' }}>{p.durataOre ? `${p.durataOre}h` : 'Libera'}</td>
                          <td style={{ padding: '10px 12px' }}>{p.locationTipo === 'campi' ? 'Dai campi' : 'Libera'}</td>
                          <td style={{ padding: '10px 12px' }}>{p.prezzo != null ? `€${parseFloat(p.prezzo).toFixed(2)} IVA incl.` : 'Manuale (+IVA)'}</td>
                          <td style={{ padding: '10px 12px' }}>{p.centroRicavo || '—'}</td>
                          <td style={{ padding: '10px 12px' }}>{p.numeroPartecipanti || '—'}</td>
                          <td style={{ padding: '10px 12px' }}>{p.prevedeRinfresco ? 'Sì' : 'No'}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                            <div style={{ display: 'flex', gap: '5px', justifyContent: 'center' }}>
                              <button className="btn-modifica-inline" style={{ fontSize: '0.8rem', padding: '4px 8px' }} onClick={() => iniziaInlinePacchetto(p)}>Modifica</button>
                              <button className="btn-rimuovi" style={{ fontSize: '0.8rem', padding: '4px 8px' }} onClick={() => rimuoviPacchetto(p.id)}>Elimina</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {pacchetti.length === 0 && <tr><td colSpan="8" style={{ padding: '20px', textAlign: 'center', color: '#666' }}>Nessun pacchetto.</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}

              <div style={btnBarraNuovo}>
                <button className="btn-preventivo" style={btnNuovo} onClick={nuovoPacchetto}>➕ Nuovo pacchetto</button>
              </div>

              {showFormPacchetto && (
                <div className="admin-form-box" style={boxForm}>
                  <h3 style={{ margin: '0 0 15px 0', fontSize: '1.1rem', color: '#0288d1' }}>{editPacchetto ? 'Modifica Pacchetto' : 'Nuovo Pacchetto'}</h3>
                  <form onSubmit={salvaPacchetto} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <Campo label="Nome pacchetto"><input type="text" value={formPacchetto.nome} onChange={(e) => setFormPacchetto({ ...formPacchetto, nome: e.target.value })} style={inputStyle} /></Campo>
                    <Campo label="Durata ore (vuoto = libera)"><input type="number" step="any" value={formPacchetto.durataOre} onChange={(e) => setFormPacchetto({ ...formPacchetto, durataOre: e.target.value })} style={inputStyle} /></Campo>
                    <Campo label="Location"><select value={formPacchetto.locationTipo} onChange={(e) => setFormPacchetto({ ...formPacchetto, locationTipo: e.target.value })} style={inputStyle}>
                      <option value="libera">Libera (indirizzo manuale)</option>
                      <option value="campi">Dai campi</option>
                    </select></Campo>
                    <Campo label="Prezzo € (vuoto = manuale in prenotazione. Se fissato è IVA inclusa)"><input type="number" step="any" value={formPacchetto.prezzo} onChange={(e) => setFormPacchetto({ ...formPacchetto, prezzo: e.target.value })} style={inputStyle} /></Campo>
                    <Campo label="Centro di ricavo"><input type="text" value={formPacchetto.centroRicavo} onChange={(e) => setFormPacchetto({ ...formPacchetto, centroRicavo: e.target.value })} style={inputStyle} /></Campo>
                    <Campo label="N° partecipanti (se stabilito in anticipo)"><input type="number" step="1" value={formPacchetto.numeroPartecipanti} onChange={(e) => setFormPacchetto({ ...formPacchetto, numeroPartecipanti: e.target.value })} style={inputStyle} /></Campo>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem' }}>
                      <input type="checkbox" checked={formPacchetto.prevedeRinfresco} onChange={(e) => setFormPacchetto({ ...formPacchetto, prevedeRinfresco: e.target.checked })} /> Prevede rinfresco dopo partita
                    </label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button type="submit" style={btnSalva}>{editPacchetto ? 'Salva modifiche' : 'Salva Pacchetto'}</button>
                      <button type="button" className="btn-annulla-inline" onClick={() => { setEditPacchetto(null); setFormPacchetto(PACCHETTO_VUOTO); setShowFormPacchetto(false); }}>Annulla</button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          )}

          {/* --- OPERATORI --- */}
          {configTab === "operatori" && (
            <div>
              <div style={headerElenco}>
                <h3 style={{ margin: 0 }}>Operatori ({operatori.length})</h3>
                <button className="nav-btn" style={btnCollassa} onClick={() => setShowListaOperatori(v => !v)}>{showListaOperatori ? '▼ Nascondi elenco' : '▶ Mostra elenco'}</button>
              </div>

              {showListaOperatori && (
                <div className="admin-table-box" style={boxTabella}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                    <thead><tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                      <th style={{ padding: '10px 12px' }}>Nome</th><th style={{ padding: '10px 12px' }}>Email</th><th style={{ padding: '10px 12px' }}>Telefono</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Azioni</th>
                    </tr></thead>
                    <tbody>
                      {operatori.map(o => idOperatoreInline === o.id ? (
                        <tr key={o.id} style={{ borderBottom: '1px solid #eee', background: '#f0f9ff' }}>
                          <td style={{ padding: '8px' }}><input className="table-input" value={datiOperatoreInline.nome} onChange={(e) => setDatiOperatoreInline({ ...datiOperatoreInline, nome: e.target.value })} style={{ width: '100%', height: '28px', fontSize: '0.8rem' }} /></td>
                          <td style={{ padding: '8px' }}><input className="table-input" value={datiOperatoreInline.email} onChange={(e) => setDatiOperatoreInline({ ...datiOperatoreInline, email: e.target.value })} style={{ width: '100%', height: '28px', fontSize: '0.8rem' }} /></td>
                          <td style={{ padding: '8px' }}><input className="table-input" value={datiOperatoreInline.telefono} onChange={(e) => setDatiOperatoreInline({ ...datiOperatoreInline, telefono: e.target.value })} style={{ width: '100%', height: '28px', fontSize: '0.8rem' }} /></td>
                          <td style={{ padding: '8px', textAlign: 'center' }}>
                            <div style={{ display: 'flex', gap: '5px', justifyContent: 'center' }}>
                              <button className="btn-salva-inline" style={{ fontSize: '0.8rem', padding: '4px 8px' }} onClick={salvaInlineOperatore}>Salva</button>
                              <button className="btn-annulla-inline" style={{ fontSize: '0.8rem', padding: '4px 8px' }} onClick={() => setIdOperatoreInline(null)}>Annulla</button>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        <tr key={o.id} style={{ borderBottom: '1px solid #eee' }}>
                          <td style={{ padding: '10px 12px' }}><strong>{o.nome}</strong></td>
                          <td style={{ padding: '10px 12px' }}>{o.email}</td>
                          <td style={{ padding: '10px 12px' }}>{o.telefono}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                            <div style={{ display: 'flex', gap: '5px', justifyContent: 'center' }}>
                              <button className="btn-modifica-inline" style={{ fontSize: '0.8rem', padding: '4px 8px' }} onClick={() => iniziaInlineOperatore(o)}>Modifica</button>
                              <button className="btn-rimuovi" style={{ fontSize: '0.8rem', padding: '4px 8px' }} onClick={() => rimuoviOperatore(o.id)}>Elimina</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {operatori.length === 0 && <tr><td colSpan="4" style={{ padding: '20px', textAlign: 'center', color: '#666' }}>Nessun operatore.</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}

              <div style={btnBarraNuovo}>
                <button className="btn-preventivo" style={btnNuovo} onClick={nuovoOperatore}>➕ Nuovo operatore</button>
              </div>

              {showFormOperatore && (
                <div className="admin-form-box" style={boxForm}>
                  <h3 style={{ margin: '0 0 15px 0', fontSize: '1.1rem', color: '#0288d1' }}>{editOperatore ? 'Modifica Operatore' : 'Nuovo Operatore'}</h3>
                  <form onSubmit={salvaOperatore} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <Campo label="Nome"><input type="text" value={formOperatore.nome} onChange={(e) => setFormOperatore({ ...formOperatore, nome: e.target.value })} style={inputStyle} /></Campo>
                    <Campo label="Email"><input type="email" value={formOperatore.email} onChange={(e) => setFormOperatore({ ...formOperatore, email: e.target.value })} style={inputStyle} /></Campo>
                    <Campo label="Telefono"><input type="text" value={formOperatore.telefono} onChange={(e) => setFormOperatore({ ...formOperatore, telefono: e.target.value })} style={inputStyle} /></Campo>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button type="submit" style={btnSalva}>{editOperatore ? 'Salva modifiche' : 'Salva Operatore'}</button>
                      <button type="button" className="btn-annulla-inline" onClick={() => { setEditOperatore(null); setFormOperatore(OPERATORE_VUOTO); setShowFormOperatore(false); }}>Annulla</button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          )}

          {/* --- CAMPI --- */}
          {configTab === "campi" && (
            <div>
              <div style={headerElenco}>
                <h3 style={{ margin: 0 }}>Campi ({campi.length})</h3>
                <button className="nav-btn" style={btnCollassa} onClick={() => setShowListaCampi(v => !v)}>{showListaCampi ? '▼ Nascondi elenco' : '▶ Mostra elenco'}</button>
              </div>

              {showListaCampi && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                {campi.map(c => {
                  const tarCampo = tariffe.filter(t => t.campoId === c.id);
                  const inModifica = editCampo === c.id && showFormCampo;
                  return (
                    <div key={c.id} style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', padding: '15px', ...(inModifica ? { boxShadow: '0 0 0 2px #0288d1' } : {}) }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', flexWrap: 'wrap' }}>
                        <div>
                          <strong style={{ fontSize: '1rem' }}>📍 {c.nome}</strong>
                          <div style={{ fontSize: '0.85rem', color: '#555' }}>{[c.indirizzo, c.cap, c.citta, c.provincia].filter(Boolean).join(', ')}</div>
                          <div style={{ fontSize: '0.8rem', color: '#777' }}>
                            Centro di costo: {c.centroCosto || '—'} · Base €{parseFloat(c.costoFlat || 0).toFixed(2)}
                            {c.costoMerenda != null && ` · Merenda €${parseFloat(c.costoMerenda).toFixed(2)}/p`}
                            {c.costoAperitivo != null && ` · Aperitivo €${parseFloat(c.costoAperitivo).toFixed(2)}/p`}
                          </div>
                          <span style={{ display: 'inline-block', marginTop: '4px', fontSize: '0.72rem', fontWeight: 'bold', padding: '2px 8px', borderRadius: '10px', background: c.ivaInclusa ? '#dcfce7' : '#fee2e2', color: c.ivaInclusa ? '#166534' : '#991b1b' }}>{ivaLabel(c.ivaInclusa)}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '5px' }}>
                          <button className="btn-modifica-inline" style={{ fontSize: '0.8rem', padding: '4px 8px' }} onClick={() => modificaCampo(c)}>Modifica</button>
                          <button className="btn-rimuovi" style={{ fontSize: '0.8rem', padding: '4px 8px' }} onClick={() => rimuoviCampo(c.id)}>Elimina</button>
                        </div>
                      </div>

                      {tarCampo.length > 0 && (
                        <div style={{ marginTop: '12px', borderTop: '1px dashed #ddd', paddingTop: '12px' }}>
                          <div style={{ fontSize: '0.82rem', fontWeight: 'bold', color: '#555', marginBottom: '6px' }}>Tariffe variabili (sovrascrivono la flat)</div>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                            <thead><tr style={{ color: '#666' }}><th style={{ textAlign: 'left', padding: '4px' }}>Giorni</th><th style={{ textAlign: 'left', padding: '4px' }}>Fascia</th><th style={{ textAlign: 'left', padding: '4px' }}>Costo</th><th style={{ textAlign: 'right', padding: '4px' }}>Azioni</th></tr></thead>
                            <tbody>
                              {tarCampo.map(t => (
                                <tr key={t.id}>
                                  <td style={{ padding: '4px' }}>{etichettaGiorni(t.giorni)}</td>
                                  <td style={{ padding: '4px' }}>{t.oraInizio || '—'} - {t.oraFine || '—'}</td>
                                  <td style={{ padding: '4px' }}>€{parseFloat(t.costo).toFixed(2)}</td>
                                  <td style={{ padding: '4px', textAlign: 'right' }}>{inModifica && <button className="btn-rimuovi" style={{ fontSize: '0.72rem', padding: '3px 8px' }} onClick={() => rimuoviTariffa(t.id)}>🗑 Elimina</button>}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {inModifica && (
                        <div style={{ marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', background: '#f8fafc', padding: '10px', borderRadius: '6px' }}>
                          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                            {GIORNI.map(g => (
                              <label key={g.n} style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '3px', cursor: 'pointer' }}>
                                <input type="checkbox" checked={nuovaTariffa.campoId === c.id && nuovaTariffa.giorni.includes(g.n)} onChange={() => { if (nuovaTariffa.campoId !== c.id) setNuovaTariffa({ campoId: c.id, giorni: [g.n], oraInizio: "", oraFine: "", costo: "" }); else toggleGiornoTariffa(g.n); }} />
                                {g.l}
                              </label>
                            ))}
                          </div>
                          <input type="text" inputMode="numeric" placeholder="HH:MM" maxLength={5} title="Formato 24h, es. 19:00" value={nuovaTariffa.campoId === c.id ? nuovaTariffa.oraInizio : ""} onChange={(e) => setNuovaTariffa(prev => ({ ...prev, campoId: c.id, oraInizio: e.target.value }))} style={{ ...inputStyle, width: '80px', height: '32px' }} />
                          <input type="text" inputMode="numeric" placeholder="HH:MM" maxLength={5} title="Formato 24h, es. 00:00" value={nuovaTariffa.campoId === c.id ? nuovaTariffa.oraFine : ""} onChange={(e) => setNuovaTariffa(prev => ({ ...prev, campoId: c.id, oraFine: e.target.value }))} style={{ ...inputStyle, width: '80px', height: '32px' }} />
                          <input type="number" step="any" placeholder="€" value={nuovaTariffa.campoId === c.id ? nuovaTariffa.costo : ""} onChange={(e) => setNuovaTariffa(prev => ({ ...prev, campoId: c.id, costo: e.target.value }))} style={{ ...inputStyle, width: '80px', height: '32px' }} />
                          <button type="button" className="btn-conferma" style={{ padding: '6px 12px' }} onClick={() => addTariffa(c.id)}>+ Tariffa</button>
                        </div>
                      )}
                    </div>
                  );
                })}
                {campi.length === 0 && <p style={{ color: '#666' }}>Nessun campo configurato.</p>}
              </div>
              )}

              <div style={btnBarraNuovo}>
                <button className="btn-preventivo" style={btnNuovo} onClick={nuovoCampo}>➕ Nuovo campo</button>
              </div>

              {showFormCampo && (
                <div className="admin-form-box" style={boxForm}>
                  <h3 style={{ margin: '0 0 15px 0', fontSize: '1.1rem', color: '#0288d1' }}>{editCampo ? 'Modifica Campo' : 'Nuovo Campo'}</h3>
                  <form onSubmit={salvaCampo} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <Campo label="Nome campo"><input type="text" value={formCampo.nome} onChange={(e) => setFormCampo({ ...formCampo, nome: e.target.value })} style={inputStyle} /></Campo>
                    <Campo label="Cerca indirizzo"><RicercaIndirizzo onSelect={(a) => setFormCampo(prev => ({ ...prev, indirizzo: a.indirizzo, cap: a.cap, citta: a.citta, provincia: a.provincia }))} /></Campo>
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 0.8fr', gap: '8px' }}>
                      <Campo label="Indirizzo"><input type="text" value={formCampo.indirizzo} onChange={(e) => setFormCampo({ ...formCampo, indirizzo: e.target.value })} style={inputStyle} /></Campo>
                      <Campo label="CAP"><input type="text" value={formCampo.cap} onChange={(e) => setFormCampo({ ...formCampo, cap: e.target.value })} style={inputStyle} /></Campo>
                      <Campo label="Città"><input type="text" value={formCampo.citta} onChange={(e) => setFormCampo({ ...formCampo, citta: e.target.value })} style={inputStyle} /></Campo>
                      <Campo label="Prov"><input type="text" value={formCampo.provincia} onChange={(e) => setFormCampo({ ...formCampo, provincia: e.target.value })} style={inputStyle} /></Campo>
                    </div>
                    <Campo label="Centro di costo"><input type="text" value={formCampo.centroCosto} onChange={(e) => setFormCampo({ ...formCampo, centroCosto: e.target.value })} style={inputStyle} /></Campo>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                      <Campo label="Costo base flat €"><input type="number" step="any" value={formCampo.costoFlat} onChange={(e) => setFormCampo({ ...formCampo, costoFlat: e.target.value })} style={inputStyle} /></Campo>
                      <Campo label="Costo merenda €/pers"><input type="number" step="any" value={formCampo.costoMerenda} onChange={(e) => setFormCampo({ ...formCampo, costoMerenda: e.target.value })} style={inputStyle} /></Campo>
                      <Campo label="Costo aperitivo €/pers"><input type="number" step="any" value={formCampo.costoAperitivo} onChange={(e) => setFormCampo({ ...formCampo, costoAperitivo: e.target.value })} style={inputStyle} /></Campo>
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem' }}>
                      <input type="checkbox" checked={formCampo.ivaInclusa} onChange={(e) => setFormCampo({ ...formCampo, ivaInclusa: e.target.checked })} /> Costi IVA inclusa
                    </label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button type="submit" style={btnSalva}>{editCampo ? 'Salva modifiche' : 'Salva Campo'}</button>
                      <button type="button" className="btn-annulla-inline" onClick={() => { setEditCampo(null); setFormCampo(CAMPO_VUOTO); setShowFormCampo(false); }}>Annulla</button>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.8rem', color: '#666' }}>Il costo base (flat) vale sempre; le tariffe variabili (nella scheda del campo) lo sovrascrivono in certi giorni/orari.</p>
                  </form>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ===================== PLACEHOLDER ALTRE SCHEDE ===================== */}
      {currentView === "nuova" && (
        <div className="schermata-inserimento no-print" style={{ textAlign: 'center', padding: '50px 30px' }}>
          <h2>➕ Nuova Prenotazione</h2>
          <p className="descrizione-pagina">In arrivo nella prossima tappa. Configura prima pacchetti, operatori e campi.</p>
        </div>
      )}
      {currentView === "storico" && (
        <div className="schermata-inserimento no-print" style={{ textAlign: 'center', padding: '50px 30px' }}>
          <h2>🗂️ Storico Prenotazioni</h2>
          <p className="descrizione-pagina">In arrivo nella prossima tappa.</p>
        </div>
      )}
      {currentView === "calendario" && (
        <div className="schermata-inserimento no-print" style={{ textAlign: 'center', padding: '50px 30px' }}>
          <h2>📅 Calendario</h2>
          <p className="descrizione-pagina">In arrivo nella prossima tappa.</p>
        </div>
      )}
    </>
  );
}

export default Prenotazioni
