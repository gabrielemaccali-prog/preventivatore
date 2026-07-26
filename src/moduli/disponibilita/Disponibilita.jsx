import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { puoVedere } from '../../lib/permessi'

const MESI = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
const toISODate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addGiorni = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const inizioSettimana = (d) => { const x = new Date(d); const g = x.getDay(); x.setDate(x.getDate() - (g === 0 ? 6 : g - 1)); x.setHours(0, 0, 0, 0); return x; };
// "06:00:00" (formato time di Postgres) -> "06:00"
const oraHHMM = (t) => (t || '').slice(0, 5);
const oraValida = (s) => /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(s);
// Forza la digitazione in formato 24h "HH:MM": tiene solo le cifre e inserisce i due punti da solo.
const formattaInputOra = (raw) => {
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  return digits.length <= 2 ? digits : `${digits.slice(0, 2)}:${digits.slice(2)}`;
};

const FASCE_ORDINE = ['mattina', 'pomeriggio', 'sera'];
const FASCIA_COLORE = { mattina: { bg: '#fef3c7', bd: '#f59e0b', tx: '#92400e' }, pomeriggio: { bg: '#dbeafe', bd: '#0ea5e9', tx: '#075985' }, sera: { bg: '#e0e7ff', bd: '#6366f1', tx: '#3730a3' } };
const FASCIA_LETTERA = { mattina: 'M', pomeriggio: 'P', sera: 'S' };

function Disponibilita({ user }) {
  // Visibilità della scheda: segue i permessi del ruolo, come nel resto dell'app.
  const schedaConsentita = (s) => puoVedere(user, 'disponibilita', s);
  // "campi"/"calendario" sono dati personali del bubbler: anche con il permesso di scheda,
  // servono a poco senza il flag Bubbler sull'utente -> mostriamo un messaggio invece della pagina vuota.
  const richiedeBubbler = (s) => (s === 'campi' || s === 'calendario') && !user.bubbler;
  const primaSchedaDisp = ['config', 'campi', 'calendario', 'riepilogo'].find(schedaConsentita) || 'config';
  const [currentView, setCurrentView] = useState(primaSchedaDisp);

  const [fasce, setFasce] = useState([]);
  const [bubblers, setBubblers] = useState([]);
  const [campi, setCampi] = useState([]);
  const [dispCampi, setDispCampi] = useState([]);
  const [dispCalendario, setDispCalendario] = useState([]);

  useEffect(() => { fetchTutto(); }, []);

  const fetchTutto = async () => {
    const [fasceRes, bubblersRes, campiRes, dCampiRes, dCalRes] = await Promise.all([
      supabase.from('disp_fasce').select('*').order('ordine'),
      supabase.from('utenti').select('username, nome_breve, telefono, email, bubbler').eq('bubbler', true).order('username'),
      supabase.from('pren_campi').select('id, nome, citta, provincia').order('nome'),
      supabase.from('disp_campi').select('*'),
      supabase.from('disp_calendario').select('*'),
    ]);
    if (fasceRes.data) setFasce(fasceRes.data);
    if (bubblersRes.data) setBubblers(bubblersRes.data);
    if (campiRes.data) setCampi(campiRes.data);
    if (dCampiRes.data) setDispCampi(dCampiRes.data);
    if (dCalRes.data) setDispCalendario(dCalRes.data);
  };

  const nomeBubbler = (username) => bubblers.find(b => b.username === username)?.nome_breve || username;
  const fasciaInfo = (id) => fasce.find(f => f.id === id);
  const rigaDisp = (username, iso, fasciaId) => dispCalendario.find(d => d.utente_username === username && d.data === iso && d.fascia === fasciaId);

  // Raggruppa i campi per provincia (ordine alfabetico, "Senza provincia" sempre in coda)
  const gruppiCampiPerProvincia = (() => {
    const gruppi = {};
    campi.forEach(c => {
      const key = c.provincia || 'Senza provincia';
      if (!gruppi[key]) gruppi[key] = [];
      gruppi[key].push(c);
    });
    return Object.entries(gruppi).sort(([a], [b]) => a === 'Senza provincia' ? 1 : b === 'Senza provincia' ? -1 : a.localeCompare(b));
  })();

  // ====================== CONFIGURATORE: FASCE ======================
  const [idFasciaInline, setIdFasciaInline] = useState(null);
  const [datiFasciaInline, setDatiFasciaInline] = useState({ ora_inizio: '', ora_fine: '' });
  const iniziaInlineFascia = (f) => { setIdFasciaInline(f.id); setDatiFasciaInline({ ora_inizio: oraHHMM(f.ora_inizio), ora_fine: oraHHMM(f.ora_fine) }); };
  const salvaInlineFascia = async () => {
    if (!oraValida(datiFasciaInline.ora_inizio) || !oraValida(datiFasciaInline.ora_fine)) return alert('Orario non valido: usa il formato 24h HH:MM (es. 06:00).');
    if (datiFasciaInline.ora_inizio >= datiFasciaInline.ora_fine) return alert("L'orario di inizio deve essere precedente all'orario di fine.");
    const { error } = await supabase.from('disp_fasce').update(datiFasciaInline).eq('id', idFasciaInline);
    if (error) { console.error(error); return alert('Errore salvataggio fascia'); }
    setIdFasciaInline(null); fetchTutto();
  };

  // ====================== CONFIGURATORE: BUBBLER ======================
  const [idBubblerInline, setIdBubblerInline] = useState(null);
  const [datiBubblerInline, setDatiBubblerInline] = useState({ nome_breve: '', telefono: '', email: '' });
  const iniziaInlineBubbler = (b) => { setIdBubblerInline(b.username); setDatiBubblerInline({ nome_breve: b.nome_breve || '', telefono: b.telefono || '', email: b.email || '' }); };
  const salvaInlineBubbler = async () => {
    const { error } = await supabase.from('utenti').update(datiBubblerInline).eq('username', idBubblerInline);
    if (error) { console.error(error); return alert('Errore salvataggio bubbler'); }
    setIdBubblerInline(null); fetchTutto();
  };

  // ====================== DISPONIBILITA' CAMPI (utente collegato) ======================
  const mieiCampi = dispCampi.filter(d => d.utente_username === user.username).map(d => d.campo_id);
  const toggleMioCampo = async (campoId) => {
    if (mieiCampi.includes(campoId)) {
      await supabase.from('disp_campi').delete().eq('utente_username', user.username).eq('campo_id', campoId);
    } else {
      const { error } = await supabase.from('disp_campi').insert([{ utente_username: user.username, campo_id: campoId }]);
      if (error) { console.error(error); return alert('Errore salvataggio disponibilità campo'); }
    }
    fetchTutto();
  };

  // ====================== DISPONIBILITA' CALENDARIO (utente collegato) + RIEPILOGO ======================
  const [calDate, setCalDate] = useState(new Date());
  const vaiPrec = () => setCalDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  const vaiSucc = () => setCalDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  const oggiIso = toISODate(new Date());

  const [fasciaSelezionata, setFasciaSelezionata] = useState(null); // { data, fascia }
  const [formOverride, setFormOverride] = useState({ ora_inizio: '', ora_fine: '', note: '' });

  const onClickBadgeMio = async (iso, fasciaId) => {
    const riga = rigaDisp(user.username, iso, fasciaId);
    if (!riga) {
      const { error } = await supabase.from('disp_calendario').insert([{ utente_username: user.username, data: iso, fascia: fasciaId }]);
      if (error) { console.error(error); return alert('Errore salvataggio disponibilità'); }
      fetchTutto();
    } else {
      setFasciaSelezionata({ data: iso, fascia: fasciaId });
      setFormOverride({ ora_inizio: oraHHMM(riga.ora_inizio), ora_fine: oraHHMM(riga.ora_fine), note: riga.note || '' });
    }
  };

  const salvaOverride = async () => {
    const { data, fascia } = fasciaSelezionata;
    const f = fasciaInfo(fascia);
    const inizioFascia = oraHHMM(f?.ora_inizio);
    const fineFascia = oraHHMM(f?.ora_fine);
    if (formOverride.ora_inizio && !oraValida(formOverride.ora_inizio)) return alert('Orario di inizio non valido: usa il formato 24h HH:MM (es. 06:00).');
    if (formOverride.ora_fine && !oraValida(formOverride.ora_fine)) return alert('Orario di fine non valido: usa il formato 24h HH:MM (es. 12:00).');
    if (formOverride.ora_inizio && formOverride.ora_inizio < inizioFascia) return alert(`L'orario di inizio non può essere prima delle ${inizioFascia} (inizio fascia ${f?.label}).`);
    if (formOverride.ora_fine && formOverride.ora_fine > fineFascia) return alert(`L'orario di fine non può essere dopo le ${fineFascia} (fine fascia ${f?.label}).`);
    if (formOverride.ora_inizio && formOverride.ora_fine && formOverride.ora_inizio >= formOverride.ora_fine) return alert("L'orario di inizio deve essere precedente all'orario di fine.");
    const rec = { ora_inizio: formOverride.ora_inizio || null, ora_fine: formOverride.ora_fine || null, note: formOverride.note || null };
    const { error } = await supabase.from('disp_calendario').update(rec).eq('utente_username', user.username).eq('data', data).eq('fascia', fascia);
    if (error) { console.error(error); return alert('Errore salvataggio disponibilità'); }
    setFasciaSelezionata(null); fetchTutto();
  };
  const rimuoviDisponibilita = async () => {
    const { data, fascia } = fasciaSelezionata;
    await supabase.from('disp_calendario').delete().eq('utente_username', user.username).eq('data', data).eq('fascia', fascia);
    setFasciaSelezionata(null); fetchTutto();
  };

  // Griglia mensile (6 settimane x 7 giorni), usata sia da Calendario che da Riepilogo
  const settimaneMese = Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addGiorni(inizioSettimana(new Date(calDate.getFullYear(), calDate.getMonth(), 1)), w * 7 + d)));
  const giorniMese = Array.from({ length: new Date(calDate.getFullYear(), calDate.getMonth() + 1, 0).getDate() }, (_, i) => new Date(calDate.getFullYear(), calDate.getMonth(), i + 1));

  // ---------------- Azioni rapide: disponibilità su tutto il mese / su una settimana ----------------
  const [fasciaBulk, setFasciaBulk] = useState('mattina');
  const [settimanaBulk, setSettimanaBulk] = useState(0);

  const impostaDisponibilitaGiorni = async (giorni, fasciaId, disponibile) => {
    const isoList = giorni.filter(g => g.getMonth() === calDate.getMonth()).map(g => toISODate(g));
    if (isoList.length === 0) return;
    if (disponibile) {
      const daInserire = isoList.filter(iso => !rigaDisp(user.username, iso, fasciaId)).map(iso => ({ utente_username: user.username, data: iso, fascia: fasciaId }));
      if (daInserire.length === 0) return;
      const { error } = await supabase.from('disp_calendario').insert(daInserire);
      if (error) { console.error(error); return alert('Errore salvataggio disponibilità'); }
    } else {
      const { error } = await supabase.from('disp_calendario').delete().eq('utente_username', user.username).eq('fascia', fasciaId).in('data', isoList);
      if (error) { console.error(error); return alert('Errore rimozione disponibilità'); }
    }
    fetchTutto();
  };

  const applicaMese = (disponibile) => {
    const label = fasciaInfo(fasciaBulk)?.label;
    if (!disponibile && !window.confirm(`Rimuovere la disponibilità "${label}" per tutto ${MESI[calDate.getMonth()]} ${calDate.getFullYear()}?`)) return;
    impostaDisponibilitaGiorni(giorniMese, fasciaBulk, disponibile);
  };
  const applicaSettimana = (disponibile) => {
    const giorni = settimaneMese[settimanaBulk] || [];
    const label = fasciaInfo(fasciaBulk)?.label;
    if (!disponibile && !window.confirm(`Rimuovere la disponibilità "${label}" per la settimana selezionata?`)) return;
    impostaDisponibilitaGiorni(giorni, fasciaBulk, disponibile);
  };

  const BadgeFascia = ({ attiva, fasciaId, onClick, title, size = 16, particolare = false }) => {
    const c = FASCIA_COLORE[fasciaId];
    return (
      <span className="badge-fascia" onClick={onClick} title={title} style={{ cursor: onClick ? 'pointer' : 'default', display: 'inline-block', boxSizing: 'border-box', minWidth: `${size}px`, height: `${size}px`, lineHeight: `${size}px`, textAlign: 'center', padding: particolare ? `0 ${size * 0.12}px` : 0, borderRadius: '5px', fontSize: `${size * 0.62}px`, fontWeight: 'bold', background: attiva ? c.bg : '#f1f5f9', border: `1px solid ${attiva ? c.bd : '#e2e8f0'}`, color: attiva ? c.tx : '#94a3b8' }}>
        {FASCIA_LETTERA[fasciaId]}{particolare ? '*' : ''}
      </span>
    );
  };

  // Campo orario testuale HH:MM (24h): niente widget nativo, niente AM/PM possibile in nessun sistema/browser.
  const InputOra24 = ({ value, onChange, style }) => (
    <input type="text" inputMode="numeric" placeholder="HH:MM" maxLength={5} value={value} onChange={(e) => onChange(formattaInputOra(e.target.value))} style={style} />
  );

  // ====================== RIEPILOGO ======================
  const [dettaglioRiepilogo, setDettaglioRiepilogo] = useState(null); // { username, iso }
  const [filtroProvincia, setFiltroProvincia] = useState("");
  const [filtroCampo, setFiltroCampo] = useState("");
  const bubblersOrdinati = [...bubblers].sort((a, b) => (a.nome_breve || a.username).localeCompare(b.nome_breve || b.username));
  const campiDiBubbler = (username) => dispCampi.filter(d => d.utente_username === username).map(d => campi.find(c => c.id === d.campo_id)).filter(Boolean);

  const campiFiltroDisponibili = filtroProvincia ? campi.filter(c => (c.provincia || 'Senza provincia') === filtroProvincia) : campi;
  const bubblersFiltrati = (!filtroProvincia && !filtroCampo) ? bubblersOrdinati : bubblersOrdinati.filter(b => {
    const idCampiBubbler = campiDiBubbler(b.username).map(c => c.id);
    if (filtroCampo) return idCampiBubbler.includes(filtroCampo);
    return campiDiBubbler(b.username).some(c => (c.provincia || 'Senza provincia') === filtroProvincia);
  });

  return (
    <>
      <nav className="modulo-subnav no-print">
        {schedaConsentita('config') && <button className={`nav-btn ${currentView === 'config' ? 'active' : ''}`} onClick={() => setCurrentView('config')}>⚙️ Configuratore</button>}
        {schedaConsentita('campi') && <button className={`nav-btn ${currentView === 'campi' ? 'active' : ''}`} onClick={() => setCurrentView('campi')}>📍 Disponibilità Campi</button>}
        {schedaConsentita('calendario') && <button className={`nav-btn ${currentView === 'calendario' ? 'active' : ''}`} onClick={() => setCurrentView('calendario')}>📅 Disponibilità Calendario</button>}
        {schedaConsentita('riepilogo') && <button className={`nav-btn ${currentView === 'riepilogo' ? 'active' : ''}`} onClick={() => setCurrentView('riepilogo')}>📊 Riepilogo</button>}
      </nav>

      {/* ===================== CONFIGURATORE ===================== */}
      {currentView === 'config' && schedaConsentita('config') && (
        <div className="schermata-admin no-print" style={{ padding: '20px' }}>
          <h2>Fasce orario</h2>
          <p className="descrizione-pagina">Orari di default delle 3 fasce; ogni bubbler può poi sovrascriverli per singolo giorno.</p>
          <div className="admin-table-box" style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', maxHeight: 'none', overflowY: 'visible', overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: '480px', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                  <th style={{ padding: '10px 12px' }}>Fascia</th>
                  <th style={{ padding: '10px 12px' }}>Inizio</th>
                  <th style={{ padding: '10px 12px' }}>Fine</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center', width: '130px' }}>Azioni</th>
                </tr>
              </thead>
              <tbody>
                {fasce.map(f => (
                  <tr key={f.id} style={{ borderBottom: '1px solid #eee' }}>
                    {idFasciaInline === f.id ? (
                      <>
                        <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}><strong>{f.label}</strong></td>
                        <td style={{ padding: '10px 12px' }}><InputOra24 value={datiFasciaInline.ora_inizio} onChange={(v) => setDatiFasciaInline({ ...datiFasciaInline, ora_inizio: v })} style={{ height: '30px', width: '70px', padding: '4px 8px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.85rem' }} /></td>
                        <td style={{ padding: '10px 12px' }}><InputOra24 value={datiFasciaInline.ora_fine} onChange={(v) => setDatiFasciaInline({ ...datiFasciaInline, ora_fine: v })} style={{ height: '30px', width: '70px', padding: '4px 8px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.85rem' }} /></td>
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          <div style={{ display: 'flex', gap: '5px', justifyContent: 'center' }}>
                            <button className="btn-salva-inline" style={{ fontSize: '0.8rem', padding: '4px 8px' }} onClick={salvaInlineFascia}>Salva</button>
                            <button className="btn-annulla-inline" style={{ fontSize: '0.8rem', padding: '4px 8px' }} onClick={() => setIdFasciaInline(null)}>Annulla</button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}><strong>{f.label}</strong></td>
                        <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>{oraHHMM(f.ora_inizio)}</td>
                        <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>{oraHHMM(f.ora_fine)}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          <button className="btn-modifica-inline" style={{ fontSize: '0.8rem', padding: '4px 8px' }} onClick={() => iniziaInlineFascia(f)}>Modifica</button>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
                {fasce.length === 0 && <tr><td colSpan="4" style={{ padding: '20px', textAlign: 'center', color: '#666' }}>Nessuna fascia configurata.</td></tr>}
              </tbody>
            </table>
          </div>

          <h2 style={{ marginTop: '30px' }}>Bubbler</h2>
          <p className="descrizione-pagina">Nome breve, telefono ed email dei bubbler (l'account e il ruolo si gestiscono in Impostazioni &gt; Utenti). Questo elenco è la fonte degli operatori selezionabili in Prenotazioni.</p>
          <div className="admin-table-box" style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', maxHeight: 'none', overflowY: 'visible', overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: '650px', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                  <th style={{ padding: '10px 12px' }}>Username</th>
                  <th style={{ padding: '10px 12px' }}>Nome breve</th>
                  <th style={{ padding: '10px 12px' }}>Telefono</th>
                  <th style={{ padding: '10px 12px' }}>Email</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center', width: '130px' }}>Azioni</th>
                </tr>
              </thead>
              <tbody>
                {bubblers.map(b => (
                  <tr key={b.username} style={{ borderBottom: '1px solid #eee' }}>
                    {idBubblerInline === b.username ? (
                      <>
                        <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}><strong>{b.username}</strong></td>
                        <td style={{ padding: '10px 12px' }}><input type="text" className="table-input" value={datiBubblerInline.nome_breve} onChange={(e) => setDatiBubblerInline({ ...datiBubblerInline, nome_breve: e.target.value })} style={{ width: '100%', height: '30px' }} /></td>
                        <td style={{ padding: '10px 12px' }}><input type="text" className="table-input" value={datiBubblerInline.telefono} onChange={(e) => setDatiBubblerInline({ ...datiBubblerInline, telefono: e.target.value })} style={{ width: '100%', height: '30px' }} /></td>
                        <td style={{ padding: '10px 12px' }}><input type="email" className="table-input" value={datiBubblerInline.email} onChange={(e) => setDatiBubblerInline({ ...datiBubblerInline, email: e.target.value })} style={{ width: '100%', height: '30px' }} /></td>
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          <div style={{ display: 'flex', gap: '5px', justifyContent: 'center' }}>
                            <button className="btn-salva-inline" style={{ fontSize: '0.8rem', padding: '4px 8px' }} onClick={salvaInlineBubbler}>Salva</button>
                            <button className="btn-annulla-inline" style={{ fontSize: '0.8rem', padding: '4px 8px' }} onClick={() => setIdBubblerInline(null)}>Annulla</button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}><strong>{b.username}</strong></td>
                        <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>{b.nome_breve || '—'}</td>
                        <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>{b.telefono || '—'}</td>
                        <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>{b.email || '—'}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          <button className="btn-modifica-inline" style={{ fontSize: '0.8rem', padding: '4px 8px' }} onClick={() => iniziaInlineBubbler(b)}>Modifica</button>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
                {bubblers.length === 0 && <tr><td colSpan="5" style={{ padding: '20px', textAlign: 'center', color: '#666' }}>Nessun utente bubbler. Attiva il flag "Bubbler" in Impostazioni &gt; Utenti.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===================== DISPONIBILITA' CAMPI ===================== */}
      {currentView === 'campi' && schedaConsentita('campi') && richiedeBubbler('campi') && (
        <div className="schermata-admin no-print" style={{ padding: '20px' }}>
          <h2>Disponibilità Campi</h2>
          <p style={{ color: '#666' }}>Questa sezione è riservata agli utenti bubbler. Chiedi a un amministratore di attivare il flag "Bubbler" sul tuo utente (Impostazioni &gt; Utenti, oppure Disponibilità &gt; Configuratore).</p>
        </div>
      )}
      {currentView === 'campi' && schedaConsentita('campi') && !richiedeBubbler('campi') && (
        <div className="schermata-admin no-print" style={{ padding: '20px' }}>
          <h2>Disponibilità Campi</h2>
          <p className="descrizione-pagina">Seleziona i campi registrati in cui sei disponibile a lavorare.</p>
          {gruppiCampiPerProvincia.map(([provincia, campiGruppo]) => (
            <div key={provincia} style={{ marginBottom: '18px' }}>
              <h3 style={{ fontSize: '0.85rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.03em', margin: '0 0 8px 0' }}>
                📌 {provincia} <span style={{ fontWeight: 'normal', color: '#888', textTransform: 'none' }}>({campiGruppo.length})</span>
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '8px' }}>
                {campiGruppo.map(c => (
                  <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#fff', border: '1px solid #e0e0e0', borderRadius: '6px', padding: '9px 12px', fontSize: '0.85rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={mieiCampi.includes(c.id)} onChange={() => toggleMioCampo(c.id)} />
                    {c.nome}{c.citta ? <span style={{ color: '#888' }}> — {c.citta}</span> : ''}
                  </label>
                ))}
              </div>
            </div>
          ))}
          {campi.length === 0 && <p style={{ color: '#666' }}>Nessun campo configurato in Prenotazioni &gt; Configuratore &gt; Campi.</p>}
        </div>
      )}

      {/* ===================== DISPONIBILITA' CALENDARIO ===================== */}
      {currentView === 'calendario' && schedaConsentita('calendario') && richiedeBubbler('calendario') && (
        <div className="schermata-admin no-print" style={{ padding: '20px' }}>
          <h2>Disponibilità Calendario</h2>
          <p style={{ color: '#666' }}>Questa sezione è riservata agli utenti bubbler. Chiedi a un amministratore di attivare il flag "Bubbler" sul tuo utente (Impostazioni &gt; Utenti, oppure Disponibilità &gt; Configuratore).</p>
        </div>
      )}
      {currentView === 'calendario' && schedaConsentita('calendario') && !richiedeBubbler('calendario') && (
        <div className="schermata-storico no-print">
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '12px' }}>
            {FASCE_ORDINE.map(fid => (
              <span key={fid} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem' }}>
                <BadgeFascia attiva fasciaId={fid} />
                <strong>{fasciaInfo(fid)?.label}</strong>
                <span style={{ color: '#888' }}>{oraHHMM(fasciaInfo(fid)?.ora_inizio)}–{oraHHMM(fasciaInfo(fid)?.ora_fine)}</span>
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button className="btn-chiudi" style={{ float: 'none', padding: '6px 12px' }} onClick={vaiPrec}>‹</button>
              <button className="btn-chiudi" style={{ float: 'none', padding: '6px 12px' }} onClick={() => setCalDate(new Date())}>Oggi</button>
              <button className="btn-chiudi" style={{ float: 'none', padding: '6px 12px' }} onClick={vaiSucc}>›</button>
              <h2 style={{ margin: 0, textTransform: 'capitalize' }}>{MESI[calDate.getMonth()]} {calDate.getFullYear()}</h2>
            </div>
          </div>
          <p className="descrizione-pagina">Clic su una lettera spenta per attivarla; clic su una lettera già attiva per modificarne l'orario o aggiungere una nota.</p>

          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px', margin: '0 0 14px 0', padding: '10px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem' }}>
              Fascia
              <select value={fasciaBulk} onChange={(e) => setFasciaBulk(e.target.value)} style={{ height: '30px', padding: '2px 6px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.8rem' }}>
                {FASCE_ORDINE.map(fid => <option key={fid} value={fid}>{fasciaInfo(fid)?.label}</option>)}
              </select>
            </label>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button className="btn-modifica-inline" style={{ fontSize: '0.78rem', padding: '5px 10px' }} onClick={() => applicaMese(true)}>➕ Tutto il mese</button>
              <button className="btn-rimuovi" style={{ fontSize: '0.78rem', padding: '5px 10px' }} onClick={() => applicaMese(false)}>➖ Tutto il mese</button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <select value={settimanaBulk} onChange={(e) => setSettimanaBulk(parseInt(e.target.value))} style={{ height: '30px', padding: '2px 6px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.8rem' }}>
                {settimaneMese.map((settimana, wi) => {
                  const giorniValidi = settimana.filter(g => g.getMonth() === calDate.getMonth());
                  if (giorniValidi.length === 0) return null;
                  const etichetta = `${giorniValidi[0].getDate()}–${giorniValidi[giorniValidi.length - 1].getDate()} ${MESI[calDate.getMonth()].slice(0, 3)}`;
                  return <option key={wi} value={wi}>{etichetta}</option>;
                })}
              </select>
              <button className="btn-modifica-inline" style={{ fontSize: '0.78rem', padding: '5px 10px' }} onClick={() => applicaSettimana(true)}>➕ Settimana</button>
              <button className="btn-rimuovi" style={{ fontSize: '0.78rem', padding: '5px 10px' }} onClick={() => applicaSettimana(false)}>➖ Settimana</button>
            </div>
          </div>

          <div className="cal-mese-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '3px' }}>
            {['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'].map(g => <div key={g} style={{ fontWeight: 'bold', fontSize: '0.75rem', color: '#64748b', textAlign: 'center', padding: '4px 0' }}>{g}</div>)}
            {settimaneMese.flat().map((giorno, di) => {
              const iso = toISODate(giorno);
              const fuoriMese = giorno.getMonth() !== calDate.getMonth();
              return (
                <div key={di} style={{ minWidth: 0, border: iso === oggiIso ? '2px solid #2563eb' : '1px solid #e2e8f0', borderRadius: '6px', padding: '3px', background: iso === oggiIso ? '#eff6ff' : (fuoriMese ? '#f8fafc' : '#fff'), opacity: fuoriMese ? 0.5 : 1 }}>
                  <div style={{ textAlign: 'right', fontSize: '0.68rem', color: '#475569', marginBottom: '3px' }}>{giorno.getDate()}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'center' }}>
                    {FASCE_ORDINE.map(fid => {
                      const riga = rigaDisp(user.username, iso, fid);
                      const orario = riga ? `${oraHHMM(riga.ora_inizio) || oraHHMM(fasciaInfo(fid)?.ora_inizio)}–${oraHHMM(riga.ora_fine) || oraHHMM(fasciaInfo(fid)?.ora_fine)}` : '';
                      const particolare = !!(riga && (riga.ora_inizio || riga.ora_fine || riga.note));
                      return <BadgeFascia key={fid} attiva={!!riga} fasciaId={fid} size={28} particolare={particolare} onClick={() => onClickBadgeMio(iso, fid)} title={riga ? `${fasciaInfo(fid)?.label} ${orario}${riga.note ? ` · ${riga.note}` : ''}${particolare ? ' *' : ''} (clic per modificare)` : `${fasciaInfo(fid)?.label} non disponibile (clic per attivare)`} />;
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* MODALE OVERRIDE ORARIO/NOTE */}
          {fasciaSelezionata && (() => {
            const f = fasciaInfo(fasciaSelezionata.fascia);
            return (
              <div className="modal-preventivo-backdrop" onClick={() => setFasciaSelezionata(null)}>
                <div style={{ background: '#fff', maxWidth: '380px', margin: '90px auto', borderRadius: '10px', padding: '22px' }} onClick={e => e.stopPropagation()}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                    <h3 style={{ margin: 0 }}>{f?.label} · {new Date(fasciaSelezionata.data).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
                    <button className="btn-chiudi" title="Chiudi" style={{ float: 'none', padding: '4px 9px' }} onClick={() => setFasciaSelezionata(null)}>✕</button>
                  </div>
                  <p style={{ fontSize: '0.8rem', color: '#666', margin: '0 0 14px 0' }}>Orario di default: {oraHHMM(f?.ora_inizio)}–{oraHHMM(f?.ora_fine)}. Lascia vuoto per usarlo, oppure specifica un orario personalizzato per questo giorno.</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <label style={{ flex: 1, fontSize: '0.8rem' }}>Da<InputOra24 value={formOverride.ora_inizio} onChange={(v) => setFormOverride({ ...formOverride, ora_inizio: v })} style={{ width: '100%', boxSizing: 'border-box', height: '34px', padding: '4px 8px', border: '1px solid #ccc', borderRadius: '4px', marginTop: '3px' }} /></label>
                      <label style={{ flex: 1, fontSize: '0.8rem' }}>A<InputOra24 value={formOverride.ora_fine} onChange={(v) => setFormOverride({ ...formOverride, ora_fine: v })} style={{ width: '100%', boxSizing: 'border-box', height: '34px', padding: '4px 8px', border: '1px solid #ccc', borderRadius: '4px', marginTop: '3px' }} /></label>
                    </div>
                    <label style={{ fontSize: '0.8rem' }}>Note<textarea value={formOverride.note} onChange={(e) => setFormOverride({ ...formOverride, note: e.target.value })} rows={2} style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', border: '1px solid #ccc', borderRadius: '4px', marginTop: '3px', fontFamily: 'inherit', fontSize: '0.85rem' }} /></label>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginTop: '18px' }}>
                    <button className="btn-rimuovi" style={{ fontSize: '0.8rem', padding: '8px 12px' }} onClick={rimuoviDisponibilita}>Rimuovi disponibilità</button>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button className="btn-annulla-inline" style={{ fontSize: '0.8rem', padding: '8px 12px' }} onClick={() => setFasciaSelezionata(null)}>Annulla</button>
                      <button className="btn-salva-inline" style={{ fontSize: '0.8rem', padding: '8px 12px' }} onClick={salvaOverride}>Salva</button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ===================== RIEPILOGO ===================== */}
      {currentView === 'riepilogo' && schedaConsentita('riepilogo') && (
        <div className="schermata-storico no-print">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button className="btn-chiudi" style={{ float: 'none', padding: '6px 12px' }} onClick={vaiPrec}>‹</button>
              <button className="btn-chiudi" style={{ float: 'none', padding: '6px 12px' }} onClick={() => setCalDate(new Date())}>Oggi</button>
              <button className="btn-chiudi" style={{ float: 'none', padding: '6px 12px' }} onClick={vaiSucc}>›</button>
              <h2 style={{ margin: 0, textTransform: 'capitalize' }}>{MESI[calDate.getMonth()]} {calDate.getFullYear()}</h2>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <select value={filtroProvincia} onChange={(e) => { setFiltroProvincia(e.target.value); setFiltroCampo(""); }} style={{ height: '32px', padding: '4px 8px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.82rem' }}>
                <option value="">Tutte le province</option>
                {gruppiCampiPerProvincia.map(([provincia]) => <option key={provincia} value={provincia}>{provincia}</option>)}
              </select>
              <select value={filtroCampo} onChange={(e) => setFiltroCampo(e.target.value)} style={{ height: '32px', padding: '4px 8px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.82rem' }}>
                <option value="">Tutti i campi</option>
                {campiFiltroDisponibili.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
              {(filtroProvincia || filtroCampo) && <button className="btn-annulla-inline" style={{ fontSize: '0.8rem', padding: '5px 10px' }} onClick={() => { setFiltroProvincia(""); setFiltroCampo(""); }}>Azzera filtri</button>}
            </div>
          </div>

          {bubblersOrdinati.length === 0 && <p style={{ color: '#666', marginTop: '10px' }}>Nessun bubbler configurato.</p>}
          {bubblersOrdinati.length > 0 && bubblersFiltrati.length === 0 && <p style={{ color: '#666', marginTop: '10px' }}>Nessun bubbler disponibile per il filtro selezionato.</p>}

          {bubblersFiltrati.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '10px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '4px' }}>
                {['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'].map(g => <div key={g} style={{ fontWeight: 'bold', fontSize: '0.75rem', color: '#64748b', textAlign: 'center', padding: '4px 0' }}>{g}</div>)}
              </div>
              {settimaneMese.map((settimana, wi) => (
                <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: '3px', paddingBottom: '10px', borderBottom: '1px solid #e2e8f0' }}>
                  {/* numeri dei giorni della settimana */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '4px' }}>
                    {settimana.map((giorno, di) => {
                      const iso = toISODate(giorno);
                      const fuoriMese = giorno.getMonth() !== calDate.getMonth();
                      return (
                        <div key={di} style={{ textAlign: 'right', fontSize: '0.72rem', padding: '0 4px', opacity: fuoriMese ? 0.4 : 1, color: iso === oggiIso ? '#2563eb' : '#475569', fontWeight: iso === oggiIso ? 'bold' : 'normal' }}>
                          {giorno.getDate()}
                        </div>
                      );
                    })}
                  </div>
                  {/* una riga a griglia per ciascuna fascia: allineata su tutti i 7 giorni della settimana */}
                  {FASCE_ORDINE.map(fid => {
                    const c = FASCIA_COLORE[fid];
                    return (
                      <div key={fid} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '4px' }}>
                        {settimana.map((giorno, di) => {
                          const iso = toISODate(giorno);
                          const fuoriMese = giorno.getMonth() !== calDate.getMonth();
                          const disponibili = bubblersFiltrati.filter(b => rigaDisp(b.username, iso, fid));
                          return (
                            <div key={di} style={{ minWidth: 0, minHeight: '22px', opacity: fuoriMese ? 0.35 : 1, background: disponibili.length > 0 ? c.bg : '#f8fafc', border: `1px solid ${disponibili.length > 0 ? c.bd : '#e2e8f0'}`, boxShadow: iso === oggiIso ? 'inset 0 0 0 2px #2563eb' : 'none', borderRadius: '4px', padding: '2px 4px' }}>
                              {disponibili.length > 0 && (
                                <>
                                  <div style={{ fontSize: '0.58rem', fontWeight: 'bold', color: c.tx, marginBottom: '2px' }}>{FASCIA_LETTERA[fid]}</div>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px' }}>
                                    {disponibili.map(b => {
                                      const riga = rigaDisp(b.username, iso, fid);
                                      const orario = `${oraHHMM(riga.ora_inizio) || oraHHMM(fasciaInfo(fid)?.ora_inizio)}–${oraHHMM(riga.ora_fine) || oraHHMM(fasciaInfo(fid)?.ora_fine)}`;
                                      const particolare = !!(riga.ora_inizio || riga.ora_fine || riga.note);
                                      return (
                                        <span key={b.username} onClick={() => setDettaglioRiepilogo({ username: b.username, iso })} title={`${b.nome_breve || b.username} · ${orario}${riga.note ? ` · ${riga.note}` : ''}`} style={{ cursor: 'pointer', fontSize: '0.7rem', padding: '1px 4px', borderRadius: '3px', background: '#fff', border: `1px solid ${c.bd}`, color: c.tx, whiteSpace: 'nowrap' }}>
                                          {b.nome_breve || b.username}{particolare ? ' *' : ''}
                                        </span>
                                      );
                                    })}
                                  </div>
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          {/* MODALE DETTAGLIO GIORNO/BUBBLER */}
          {dettaglioRiepilogo && (() => {
            const { username, iso } = dettaglioRiepilogo;
            const campiBubbler = campiDiBubbler(username);
            return (
              <div className="modal-preventivo-backdrop" onClick={() => setDettaglioRiepilogo(null)}>
                <div style={{ background: '#fff', maxWidth: '420px', margin: '80px auto', borderRadius: '10px', padding: '22px' }} onClick={e => e.stopPropagation()}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <h3 style={{ margin: 0 }}>{nomeBubbler(username)} · {new Date(iso).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
                    <button className="btn-chiudi" title="Chiudi" style={{ float: 'none', padding: '4px 9px' }} onClick={() => setDettaglioRiepilogo(null)}>✕</button>
                  </div>
                  <p style={{ fontSize: '0.8rem', color: '#666', margin: '0 0 14px 0' }}>
                    📍 Campi: {campiBubbler.length > 0 ? campiBubbler.map(c => c.nome).join(', ') : 'nessuno configurato'}
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {FASCE_ORDINE.map(fid => {
                      const riga = rigaDisp(username, iso, fid);
                      const f = fasciaInfo(fid);
                      const c = FASCIA_COLORE[fid];
                      return (
                        <div key={fid} style={{ display: 'flex', alignItems: 'center', gap: '10px', background: riga ? c.bg : '#f8fafc', border: `1px solid ${riga ? c.bd : '#e2e8f0'}`, borderRadius: '6px', padding: '8px 10px' }}>
                          <strong style={{ color: riga ? c.tx : '#94a3b8', minWidth: '80px' }}>{f?.label}</strong>
                          {riga ? (
                            <span style={{ fontSize: '0.82rem', color: c.tx }}>
                              {oraHHMM(riga.ora_inizio) || oraHHMM(f?.ora_inizio)}–{oraHHMM(riga.ora_fine) || oraHHMM(f?.ora_fine)}
                              {riga.note && <><br /><em>📝 {riga.note}</em></>}
                            </span>
                          ) : <span style={{ fontSize: '0.82rem', color: '#94a3b8' }}>non disponibile</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </>
  );
}

export default Disponibilita
