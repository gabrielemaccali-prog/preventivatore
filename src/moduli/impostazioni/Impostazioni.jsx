import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabaseClient';
import { MODULI_REGISTRY, SCHEDE_REGISTRY } from '../../lib/permessi';
import Icona from '../../components/Icona';

const permessiVuoti = () => {
  const base = {};
  Object.keys(SCHEDE_REGISTRY).forEach(moduloId => { base[moduloId] = { schede: [], sottoschede: [] }; });
  return base;
};

const RUOLO_VUOTO = { nome: "", permessi: permessiVuoti() };
const UTENTE_VUOTO = { username: "", password: "", ruolo: "", bubbler: false };

function MatricePermessi({ permessi, onToggleScheda, onToggleSottoscheda }) {
  return (
    // Due colonne quando c'è spazio (modale da 700px), una sola su schermi stretti.
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px', alignItems: 'start' }}>
      {MODULI_REGISTRY.map(modulo => {
        const mod = permessi[modulo.id] || { schede: [], sottoschede: [] };
        return (
          <div key={modulo.id} style={{ border: '1px solid #e0e0e0', borderRadius: '6px', padding: '10px 12px' }}>
            <strong><Icona nome={modulo.icon} /> {modulo.label}</strong>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '8px' }}>
              {SCHEDE_REGISTRY[modulo.id].schede.map(scheda => (
                <div key={scheda.id}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}>
                    <input
                      type="checkbox"
                      checked={mod.schede.includes(scheda.id)}
                      onChange={() => onToggleScheda(modulo.id, scheda.id)}
                    /> {scheda.label}
                  </label>
                  {scheda.sottoschede && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginLeft: '26px', marginTop: '4px' }}>
                      {scheda.sottoschede.map(sotto => (
                        <label key={sotto.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: mod.schede.includes(scheda.id) ? 'inherit' : '#999' }}>
                          <input
                            type="checkbox"
                            disabled={!mod.schede.includes(scheda.id)}
                            checked={mod.sottoschede.includes(sotto.id)}
                            onChange={() => onToggleSottoscheda(modulo.id, sotto.id)}
                          /> {sotto.label}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Impostazioni({ user, moduliConfig, onModuliConfigChange, onRuoliChange }) {
  const [currentView, setCurrentView] = useState("utenti"); // utenti | ruoli | moduli

  // --- UTENTI ---
  const [utenti, setUtenti] = useState([]);
  const [nuovoUtente, setNuovoUtente] = useState(UTENTE_VUOTO);
  const [showFormUtente, setShowFormUtente] = useState(false);
  const [idUtenteInModifica, setIdUtenteInModifica] = useState(null);
  const [datiUtenteInModifica, setDatiUtenteInModifica] = useState(UTENTE_VUOTO);

  // --- RUOLI ---
  const [ruoli, setRuoli] = useState([]);
  const [nuovoRuolo, setNuovoRuolo] = useState(RUOLO_VUOTO);
  const [showFormRuolo, setShowFormRuolo] = useState(false);
  const [idRuoloInModifica, setIdRuoloInModifica] = useState(null);
  const [datiRuoloInModifica, setDatiRuoloInModifica] = useState(RUOLO_VUOTO);

  useEffect(() => {
    fetchUtenti();
    fetchRuoli();
  }, []);

  const fetchUtenti = async () => {
    const { data } = await supabase.from('utenti').select('*').order('username');
    if (data) setUtenti(data);
  };

  const fetchRuoli = async () => {
    const { data } = await supabase.from('ruoli').select('*').order('nome');
    if (data) setRuoli(data);
  };

  // ====================== UTENTI ======================
  const addUtente = async (e) => {
    e.preventDefault();
    if (!nuovoUtente.username || !nuovoUtente.password || !nuovoUtente.ruolo) return alert("Compila username, password e ruolo");
    const { error } = await supabase.from('utenti').insert([nuovoUtente]);
    if (!error) { setNuovoUtente(UTENTE_VUOTO); setShowFormUtente(false); fetchUtenti(); }
    else { console.error(error); alert("Errore salvataggio utente (username già esistente?)"); }
  };

  const salvaModificaUtente = async () => {
    if (!datiUtenteInModifica.username || !datiUtenteInModifica.password || !datiUtenteInModifica.ruolo) return alert("Compila username, password e ruolo");
    const { error } = await supabase.from('utenti').update({
      username: datiUtenteInModifica.username,
      password: datiUtenteInModifica.password,
      ruolo: datiUtenteInModifica.ruolo,
      bubbler: datiUtenteInModifica.bubbler
    }).eq('id', idUtenteInModifica);
    if (!error) { setIdUtenteInModifica(null); fetchUtenti(); }
    else { console.error(error); alert("Errore salvataggio utente"); }
  };

  const rimuoviUtente = async (u) => {
    if (u.username === user.username) return alert("Non puoi eliminare l'utente con cui hai effettuato l'accesso.");
    if (!window.confirm(`Eliminare l'utente ${u.username}?`)) return;
    await supabase.from('utenti').delete().eq('id', u.id);
    fetchUtenti();
  };

  const toggleBubbler = async (u) => {
    const { error } = await supabase.from('utenti').update({ bubbler: !u.bubbler }).eq('id', u.id);
    if (!error) fetchUtenti();
    else { console.error(error); alert("Errore salvataggio bubbler"); }
  };

  // ====================== RUOLI ======================
  const toggleSchedaForm = (setForm) => (moduloId, schedaId) => {
    setForm(f => {
      const mod = f.permessi[moduloId] || { schede: [], sottoschede: [] };
      const attiva = mod.schede.includes(schedaId);
      const schede = attiva ? mod.schede.filter(s => s !== schedaId) : [...mod.schede, schedaId];
      const schedaDef = SCHEDE_REGISTRY[moduloId].schede.find(s => s.id === schedaId);
      const idSottoschede = (schedaDef?.sottoschede || []).map(s => s.id);
      // Se disattivo la scheda, disattivo anche le sue sotto-schede.
      const sottoschede = attiva ? mod.sottoschede.filter(id => !idSottoschede.includes(id)) : mod.sottoschede;
      return { ...f, permessi: { ...f.permessi, [moduloId]: { schede, sottoschede } } };
    });
  };

  const toggleSottoschedaForm = (setForm) => (moduloId, sottoschedaId) => {
    setForm(f => {
      const mod = f.permessi[moduloId] || { schede: [], sottoschede: [] };
      const attiva = mod.sottoschede.includes(sottoschedaId);
      const sottoschede = attiva ? mod.sottoschede.filter(s => s !== sottoschedaId) : [...mod.sottoschede, sottoschedaId];
      return { ...f, permessi: { ...f.permessi, [moduloId]: { ...mod, sottoschede } } };
    });
  };

  const addRuolo = async (e) => {
    e.preventDefault();
    if (!nuovoRuolo.nome.trim()) return alert("Specifica il nome del ruolo");
    const { error } = await supabase.from('ruoli').insert([{ nome: nuovoRuolo.nome.trim(), permessi: nuovoRuolo.permessi }]);
    if (!error) { setNuovoRuolo(RUOLO_VUOTO); setShowFormRuolo(false); fetchRuoli(); }
    else { console.error(error); alert("Errore salvataggio ruolo (nome già esistente?)"); }
  };

  const salvaModificaRuolo = async () => {
    const { error } = await supabase.from('ruoli').update({ permessi: datiRuoloInModifica.permessi }).eq('id', idRuoloInModifica);
    if (!error) { setIdRuoloInModifica(null); fetchRuoli(); onRuoliChange?.(); }
    else { console.error(error); alert("Errore salvataggio ruolo"); }
  };

  const rimuoviRuolo = async (r) => {
    if (r.nome === 'admin') return alert("Il ruolo \"admin\" non può essere eliminato.");
    const { count } = await supabase.from('utenti').select('id', { count: 'exact', head: true }).eq('ruolo', r.nome);
    if (count > 0) return alert(`Non puoi eliminare questo ruolo: è assegnato a ${count} utente/i.`);
    if (!window.confirm(`Eliminare il ruolo ${r.nome}?`)) return;
    await supabase.from('ruoli').delete().eq('id', r.id);
    fetchRuoli();
  };

  // ====================== MODULI ======================
  const toggleSperimentale = async (moduloId, valoreAttuale) => {
    const { error } = await supabase.from('moduli_config').upsert({ modulo_id: moduloId, sperimentale: !valoreAttuale });
    if (!error) onModuliConfigChange?.();
    else { console.error(error); alert("Errore salvataggio configurazione modulo"); }
  };

  return (
    <>
      <nav className="modulo-subnav no-print subnav-segmented">
        <button className={`nav-btn ${currentView === 'utenti' ? 'active' : ''}`} onClick={() => setCurrentView("utenti")}><Icona nome="utenti" />Utenti</button>
        <button className={`nav-btn ${currentView === 'ruoli' ? 'active' : ''}`} onClick={() => setCurrentView("ruoli")}><Icona nome="ruoli" />Ruoli</button>
        <button className={`nav-btn ${currentView === 'moduli' ? 'active' : ''}`} onClick={() => setCurrentView("moduli")}><Icona nome="moduli" />Moduli</button>
      </nav>

      {/* ===================== UTENTI ===================== */}
      {currentView === "utenti" && (
        <div className="schermata-admin no-print" style={{ padding: '20px' }}>
          <h2>Utenti</h2>
          <p className="descrizione-pagina">Gestisci gli utenti dell'applicazione e assegna loro un ruolo.</p>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '15px 0', gap: '10px', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}>Elenco ({utenti.length})</h3>
            <button className="btn-preventivo btn-accent" style={{ width: 'auto', marginTop: 0, padding: '8px 16px' }} onClick={() => setShowFormUtente(true)}><Icona nome="nuovo" size={16} style={{ marginRight: '6px' }} />Nuovo</button>
          </div>

          {showFormUtente && (
            <div className="modal-form-backdrop" onClick={() => setShowFormUtente(false)}>
              <div className="modal-form-box" onClick={(e) => e.stopPropagation()}>
                <button type="button" className="modal-form-close" onClick={() => setShowFormUtente(false)} aria-label="Chiudi">✕</button>
                <h3 style={{ margin: '0 0 15px 0', fontSize: '1.1rem', color: '#0288d1' }}>Nuovo Utente</h3>
                <form onSubmit={addUtente} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <input type="text" placeholder="Username" value={nuovoUtente.username} onChange={(e) => setNuovoUtente({ ...nuovoUtente, username: e.target.value })} style={{ width: '100%', boxSizing: 'border-box', height: '36px', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px' }} />
                  <input type="text" placeholder="Password" value={nuovoUtente.password} onChange={(e) => setNuovoUtente({ ...nuovoUtente, password: e.target.value })} style={{ width: '100%', boxSizing: 'border-box', height: '36px', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px' }} />
                  <select value={nuovoUtente.ruolo} onChange={(e) => setNuovoUtente({ ...nuovoUtente, ruolo: e.target.value })} style={{ width: '100%', boxSizing: 'border-box', height: '36px', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px' }}>
                    <option value="">Seleziona ruolo...</option>
                    {ruoli.map(r => <option key={r.id} value={r.nome}>{r.nome}</option>)}
                  </select>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}>
                    <input type="checkbox" checked={!!nuovoUtente.bubbler} onChange={(e) => setNuovoUtente({ ...nuovoUtente, bubbler: e.target.checked })} /> Bubbler
                  </label>
                  <button type="submit" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '9px 18px', background: '#0288d1', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' }}><Icona nome="salva" size={16} style={{ marginRight: '6px' }} />Salva Utente</button>
                </form>
              </div>
            </div>
          )}

          <div className="admin-table-box" style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', maxHeight: 'none', overflowY: 'visible', overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: '550px', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                  <th style={{ padding: '10px 12px' }}>Username</th>
                  <th style={{ padding: '10px 12px' }}>Password</th>
                  <th style={{ padding: '10px 12px' }}>Ruolo</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center', width: '90px' }}>Bubbler</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center', width: '130px' }}>Azioni</th>
                </tr>
              </thead>
              <tbody>
                {utenti.map(u => (
                  <tr key={u.id} style={{ borderBottom: '1px solid #eee' }}>
                    {idUtenteInModifica === u.id ? (
                      <>
                        <td style={{ padding: '10px 12px' }}><input type="text" className="table-input" value={datiUtenteInModifica.username} onChange={(e) => setDatiUtenteInModifica({ ...datiUtenteInModifica, username: e.target.value })} style={{ width: '100%', height: '30px' }} /></td>
                        <td style={{ padding: '10px 12px' }}><input type="text" className="table-input" value={datiUtenteInModifica.password} onChange={(e) => setDatiUtenteInModifica({ ...datiUtenteInModifica, password: e.target.value })} style={{ width: '100%', height: '30px' }} /></td>
                        <td style={{ padding: '10px 12px' }}>
                          <select className="table-input" value={datiUtenteInModifica.ruolo} onChange={(e) => setDatiUtenteInModifica({ ...datiUtenteInModifica, ruolo: e.target.value })} style={{ width: '100%', height: '30px' }}>
                            {ruoli.map(r => <option key={r.id} value={r.nome}>{r.nome}</option>)}
                          </select>
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          <input type="checkbox" checked={!!datiUtenteInModifica.bubbler} onChange={(e) => setDatiUtenteInModifica({ ...datiUtenteInModifica, bubbler: e.target.checked })} />
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          <div style={{ display: 'flex', gap: '5px', justifyContent: 'center' }}>
                            <button className="btn-accent-inline" onClick={salvaModificaUtente} style={{ display: 'inline-flex', alignItems: 'center', fontSize: '0.8rem', padding: '4px 8px' }}><Icona nome="salva" size={14} style={{ marginRight: '4px' }} />Salva</button>
                            <button className="btn-outline-annulla" onClick={() => setIdUtenteInModifica(null)} style={{ display: 'inline-flex', alignItems: 'center', fontSize: '0.8rem', padding: '4px 8px', borderRadius: '4px' }}><Icona nome="annulla" size={14} style={{ marginRight: '4px' }} />Annulla</button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}><strong>{u.username}</strong></td>
                        <td style={{ padding: '10px 12px', verticalAlign: 'middle', color: '#888' }}>••••••••</td>
                        <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>{u.ruolo}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'center', verticalAlign: 'middle' }}>
                          <input type="checkbox" checked={!!u.bubbler} onChange={() => toggleBubbler(u)} />
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'center', verticalAlign: 'middle' }}>
                          <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                            <button className="btn-icon-action" aria-label="Modifica" title="Modifica" onClick={() => { setIdUtenteInModifica(u.id); setDatiUtenteInModifica({ username: u.username, password: u.password, ruolo: u.ruolo, bubbler: !!u.bubbler }); }}><Icona nome="modifica" size={16} style={{ marginRight: 0 }} /></button>
                            <button className="btn-icon-action danger" aria-label="Elimina" title="Elimina" onClick={() => rimuoviUtente(u)}><Icona nome="elimina" size={16} style={{ marginRight: 0 }} /></button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
                {utenti.length === 0 && <tr><td colSpan="5" style={{ padding: '20px', textAlign: 'center', color: '#666' }}>Nessun utente.</td></tr>}
              </tbody>
            </table>
          </div>

        </div>
      )}

      {/* ===================== RUOLI ===================== */}
      {currentView === "ruoli" && (
        <div className="schermata-admin no-print" style={{ padding: '20px' }}>
          <h2>Ruoli</h2>
          <p className="descrizione-pagina">Definisci i ruoli e quali moduli/schede/sotto-schede possono visualizzare.</p>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '15px 0', gap: '10px', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}>Elenco ({ruoli.length})</h3>
            <button className="btn-preventivo btn-accent" style={{ width: 'auto', marginTop: 0, padding: '8px 16px' }} onClick={() => setShowFormRuolo(true)}><Icona nome="nuovo" size={16} style={{ marginRight: '6px' }} />Nuovo</button>
          </div>

          {showFormRuolo && (
            <div className="modal-form-backdrop" onClick={() => setShowFormRuolo(false)}>
              <div className="modal-form-box" onClick={(e) => e.stopPropagation()}>
                <button type="button" className="modal-form-close" onClick={() => setShowFormRuolo(false)} aria-label="Chiudi">✕</button>
                <h3 style={{ margin: '0 0 15px 0', fontSize: '1.1rem', color: '#0288d1' }}>Nuovo Ruolo</h3>
                <form onSubmit={addRuolo} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <input type="text" placeholder="Nome ruolo" value={nuovoRuolo.nome} onChange={(e) => setNuovoRuolo({ ...nuovoRuolo, nome: e.target.value })} style={{ width: '100%', boxSizing: 'border-box', height: '36px', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px' }} />
                  <MatricePermessi
                    permessi={nuovoRuolo.permessi}
                    onToggleScheda={toggleSchedaForm(setNuovoRuolo)}
                    onToggleSottoscheda={toggleSottoschedaForm(setNuovoRuolo)}
                  />
                  <button type="submit" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '9px 18px', background: '#0288d1', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' }}><Icona nome="salva" size={16} style={{ marginRight: '6px' }} />Salva Ruolo</button>
                </form>
              </div>
            </div>
          )}

          {idRuoloInModifica !== null && (
            <div className="modal-form-backdrop" onClick={() => setIdRuoloInModifica(null)}>
              <div className="modal-form-box" onClick={(e) => e.stopPropagation()}>
                <button type="button" className="modal-form-close" onClick={() => setIdRuoloInModifica(null)} aria-label="Chiudi">✕</button>
                <h3 style={{ margin: '0 0 15px 0', fontSize: '1.1rem', color: '#0288d1' }}>Permessi ruolo: {datiRuoloInModifica.nome}</h3>
                <MatricePermessi
                  permessi={datiRuoloInModifica.permessi}
                  onToggleScheda={toggleSchedaForm(setDatiRuoloInModifica)}
                  onToggleSottoscheda={toggleSottoschedaForm(setDatiRuoloInModifica)}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
                  <button className="btn-outline-annulla" style={{ display: 'inline-flex', alignItems: 'center', padding: '9px 18px', fontSize: '0.85rem', borderRadius: '4px' }} onClick={() => setIdRuoloInModifica(null)}><Icona nome="annulla" size={16} style={{ marginRight: '6px' }} />Annulla</button>
                  <button style={{ display: 'inline-flex', alignItems: 'center', padding: '9px 18px', background: '#0288d1', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' }} onClick={salvaModificaRuolo}><Icona nome="salva" size={16} style={{ marginRight: '6px' }} />Salva Ruolo</button>
                </div>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {ruoli.map(r => (
              <div key={r.id} className="admin-table-box" style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', padding: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ fontSize: '1rem' }}>{r.nome}</strong>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button className="btn-icon-action" aria-label="Modifica" title="Modifica" onClick={() => { setIdRuoloInModifica(r.id); setDatiRuoloInModifica({ nome: r.nome, permessi: { ...permessiVuoti(), ...r.permessi } }); }}><Icona nome="modifica" size={16} style={{ marginRight: 0 }} /></button>
                    <button className="btn-icon-action danger" aria-label="Elimina" title="Elimina" onClick={() => rimuoviRuolo(r)}><Icona nome="elimina" size={16} style={{ marginRight: 0 }} /></button>
                  </div>
                </div>
              </div>
            ))}
            {ruoli.length === 0 && <p style={{ color: '#666' }}>Nessun ruolo configurato.</p>}
          </div>

        </div>
      )}

      {/* ===================== MODULI ===================== */}
      {currentView === "moduli" && (
        <div className="schermata-admin no-print" style={{ padding: '20px' }}>
          <h2>Moduli</h2>
          <p className="descrizione-pagina">Contrassegna un modulo come sperimentale: comparirà con il badge <strong>SP</strong> nel menu hamburger.</p>

          <div className="admin-table-box" style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', maxHeight: 'none', overflowY: 'visible', overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: '380px', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                  <th style={{ padding: '10px 12px' }}>Modulo</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center', width: '160px' }}>Sperimentale (SP)</th>
                </tr>
              </thead>
              <tbody>
                {MODULI_REGISTRY.map(m => (
                  <tr key={m.id} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}><Icona nome={m.icon} /> {m.label}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'center', verticalAlign: 'middle' }}>
                      <input type="checkbox" checked={!!moduliConfig[m.id]} onChange={() => toggleSperimentale(m.id, !!moduliConfig[m.id])} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

export default Impostazioni
