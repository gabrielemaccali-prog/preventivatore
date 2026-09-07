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
const UTENTE_VUOTO = { username: "", nome: "", cognome: "", email: "", password: "", ruolo_id: "", bubbler: false, cambio_password: false };

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
  // Vero finché sql/cambio_password.sql non è stato eseguito: senza la colonna il flag non si può
  // né leggere né scrivere, e senza avviso il salvataggio fallirebbe senza dire perché.
  const [mancaCambioPassword, setMancaCambioPassword] = useState(false);

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
    // In ordine di cognome, che è come l'elenco presenta le persone.
    const { data } = await supabase.from('utenti').select('*').order('cognome');
    if (data) setUtenti(data);
    // La riga arriva con tutte le colonne che esistono davvero: se il flag non c'è, la migrazione
    // non è ancora passata. Si scopre così, senza una query in più solo per chiederlo.
    if (data?.length) setMancaCambioPassword(!('cambio_password' in data[0]));
  };

  const fetchRuoli = async () => {
    const { data } = await supabase.from('ruoli').select('*').order('nome');
    if (data) setRuoli(data);
  };

  // ====================== UTENTI ======================
  // Un account ha bisogno di un'email — è con quella che si entra — di una password e di un ruolo.
  // Nome, cognome ed email stanno qui e non in Disponibilità perché sono l'identità dell'utente,
  // non un dato del bubbler: sono ciò con cui compare ovunque, dalla sidebar al documento di
  // rimborso, anche per chi bubbler non è. Il configuratore di Disponibilità li rilegge da qui e
  // tiene il resto dell'anagrafica (nome breve, telefono, residenza, codice fiscale).
  //
  // Nome e cognome restano facoltativi: gli account di servizio non sono persone e non ne hanno
  // uno. Chi ne è privo compare col suo username, come è sempre stato.
  const utenteIncompleto = (u) => !u.email || !u.password || !u.ruolo_id;
  const AVVISO_INCOMPLETO = "Compila email, password e ruolo";

  // Un nome lasciato in bianco si scrive nullo, non stringa vuota: è così che stanno a database
  // gli account che non l'hanno mai avuto, e mescolare le due cose renderebbe le ricerche bugiarde.
  const testoONullo = (v) => (v || '').trim() || null;

  // Il ruolo si scrive per id. Finché la colonna testuale "ruolo" esiste le si tiene dietro il
  // nome corrispondente: così una versione dell'app rimasta aperta in un'altra scheda continua a
  // leggere quello che si aspetta, invece di trovare la colonna ferma a un ruolo vecchio.
  const ruoloDaId = (id) => ruoli.find(r => String(r.id) === String(id));
  const campiRuolo = (ruoloId) => ({ ruolo_id: ruoloId, ruolo: ruoloDaId(ruoloId)?.nome || null });

  // Finché la colonna non esiste il flag non si scrive: mandarlo lo stesso farebbe fallire anche
  // il salvataggio di tutto il resto, che invece deve continuare a funzionare.
  const campoCambioPassword = (valore) => mancaCambioPassword ? {} : { cambio_password: !!valore };

  const addUtente = async (e) => {
    e.preventDefault();
    if (utenteIncompleto(nuovoUtente)) return alert(AVVISO_INCOMPLETO);
    const { ruolo_id, cambio_password, ...resto } = nuovoUtente;
    const { error } = await supabase.from('utenti')
      .insert([{
        ...resto,
        nome: testoONullo(nuovoUtente.nome), cognome: testoONullo(nuovoUtente.cognome),
        username: nuovoUtente.username || nuovoUtente.email, ...campiRuolo(ruolo_id),
        ...campoCambioPassword(cambio_password),
      }]);
    if (!error) { setNuovoUtente(UTENTE_VUOTO); setShowFormUtente(false); fetchUtenti(); }
    else { console.error(error); alert("Errore salvataggio utente: email già usata da un altro account?"); }
  };

  const salvaModificaUtente = async () => {
    if (utenteIncompleto(datiUtenteInModifica)) return alert(AVVISO_INCOMPLETO);
    const { error } = await supabase.from('utenti').update({
      nome: testoONullo(datiUtenteInModifica.nome),
      cognome: testoONullo(datiUtenteInModifica.cognome),
      email: datiUtenteInModifica.email,
      password: datiUtenteInModifica.password,
      ...campiRuolo(datiUtenteInModifica.ruolo_id),
      bubbler: datiUtenteInModifica.bubbler,
      ...campoCambioPassword(datiUtenteInModifica.cambio_password),
    }).eq('id', idUtenteInModifica);
    if (!error) { setIdUtenteInModifica(null); fetchUtenti(); }
    else { console.error(error); alert("Errore salvataggio utente: email già usata da un altro account?"); }
  };

  const rimuoviUtente = async (u) => {
    if (u.id === user.id) return alert("Non puoi eliminare l'utente con cui hai effettuato l'accesso.");
    const nome = [u.nome, u.cognome].filter(Boolean).join(' ') || u.username;
    if (!window.confirm(`Eliminare l'utente ${nome}?`)) return;
    const { error } = await supabase.from('utenti').delete().eq('id', u.id);
    // Il database rifiuta di cancellare chi ha disponibilità, voci o compensi alle spalle: prima
    // quei dati andrebbero riassegnati o rimossi, altrimenti resterebbero senza padrone.
    if (error) {
      console.error(error);
      return alert(`Impossibile eliminare ${nome}: ha disponibilità o compensi collegati.\n\nPer togliergli l'accesso senza perdere lo storico, cambiagli la password o il ruolo.`);
    }
    fetchUtenti();
  };

  const toggleBubbler = async (u) => {
    const { error } = await supabase.from('utenti').update({ bubbler: !u.bubbler }).eq('id', u.id);
    if (!error) fetchUtenti();
    else { console.error(error); alert("Errore salvataggio bubbler"); }
  };

  // Chiedere il cambio password è la cosa che si fa subito dopo aver scritto una password a un
  // utente, quindi si spunta al volo dall'elenco come il flag Bubbler, senza entrare in modifica.
  // Il flag si spegne da solo quando l'utente sceglie la sua password: qui si può solo chiedere,
  // o revocare la richiesta se era stata fatta per sbaglio.
  const toggleCambioPassword = async (u) => {
    if (mancaCambioPassword) return;
    const { error } = await supabase.from('utenti').update({ cambio_password: !u.cambio_password }).eq('id', u.id);
    if (!error) fetchUtenti();
    else { console.error(error); alert("Errore salvataggio del cambio password"); }
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
    if (r.is_admin ?? r.nome === 'admin') return alert("Il ruolo amministratore non può essere eliminato.");
    const { count } = await supabase.from('utenti').select('id', { count: 'exact', head: true }).eq('ruolo_id', r.id);
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
          <p className="descrizione-pagina">Gestisci gli utenti dell'applicazione e assegna loro un ruolo. Spuntando <strong>Cambio psw</strong> l'utente, al primo accesso, dovrà scegliere una password nuova prima di entrare.</p>

          {mancaCambioPassword && (
            <div style={{ margin: '14px 0', padding: '14px 18px', background: '#fff8e1', border: '1px solid #f0d999', borderLeft: '4px solid #f0a000', borderRadius: '4px' }}>
              <strong style={{ display: 'block', marginBottom: '4px' }}>Schema del database non ancora aggiornato</strong>
              <span style={{ fontSize: '0.85rem', color: '#555' }}>
                Esegui <code>sql/cambio_password.sql</code> nell'SQL Editor di Supabase: finché manca la colonna,
                il cambio password non si può chiedere e la colonna qui sotto resta disattivata. Tutto il resto funziona.
              </span>
            </div>
          )}

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
                  {/* Nome e cognome per primi: è come la persona comparirà in tutta l'applicazione. */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <input type="text" placeholder="Nome" value={nuovoUtente.nome} onChange={(e) => setNuovoUtente({ ...nuovoUtente, nome: e.target.value })} style={{ width: '100%', boxSizing: 'border-box', height: '36px', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px' }} />
                    <input type="text" placeholder="Cognome" value={nuovoUtente.cognome} onChange={(e) => setNuovoUtente({ ...nuovoUtente, cognome: e.target.value })} style={{ width: '100%', boxSizing: 'border-box', height: '36px', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px' }} />
                  </div>
                  <input type="email" placeholder="Email" value={nuovoUtente.email} onChange={(e) => setNuovoUtente({ ...nuovoUtente, email: e.target.value })} style={{ width: '100%', boxSizing: 'border-box', height: '36px', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px' }} />
                  <input type="text" placeholder="Password" value={nuovoUtente.password} onChange={(e) => setNuovoUtente({ ...nuovoUtente, password: e.target.value })} style={{ width: '100%', boxSizing: 'border-box', height: '36px', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px' }} />
                  <select value={nuovoUtente.ruolo_id} onChange={(e) => setNuovoUtente({ ...nuovoUtente, ruolo_id: e.target.value })} style={{ width: '100%', boxSizing: 'border-box', height: '36px', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px' }}>
                    <option value="">Seleziona ruolo...</option>
                    {ruoli.map(r => <option key={r.id} value={r.id}>{r.nome}</option>)}
                  </select>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}>
                    <input type="checkbox" checked={!!nuovoUtente.bubbler} onChange={(e) => setNuovoUtente({ ...nuovoUtente, bubbler: e.target.checked })} /> Bubbler
                  </label>
                  {/* La password qui sopra la sceglie l'amministratore, quindi la conoscono in due:
                      spuntando questo l'utente se ne dà una sua al primo accesso. */}
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', color: mancaCambioPassword ? '#aaa' : 'inherit' }}>
                    <input type="checkbox" disabled={mancaCambioPassword} checked={!!nuovoUtente.cambio_password} onChange={(e) => setNuovoUtente({ ...nuovoUtente, cambio_password: e.target.checked })} /> Deve cambiare la password al primo accesso
                  </label>
                  <button type="submit" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '9px 18px', background: '#0288d1', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' }}><Icona nome="salva" size={16} style={{ marginRight: '6px' }} />Salva Utente</button>
                </form>
              </div>
            </div>
          )}

          <div className="admin-table-box" style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', maxHeight: 'none', overflowY: 'visible', overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: '900px', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                  <th style={{ padding: '10px 12px' }}>Nome</th>
                  <th style={{ padding: '10px 12px' }}>Cognome</th>
                  <th style={{ padding: '10px 12px' }}>Email</th>
                  <th style={{ padding: '10px 12px', width: '110px' }}>Password</th>
                  <th style={{ padding: '10px 12px', width: '130px' }}>Ruolo</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center', width: '80px' }}>Bubbler</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center', width: '100px' }} title="Al primo accesso l'utente deve scegliere una password nuova">Cambio psw</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center', width: '120px' }}>Azioni</th>
                </tr>
              </thead>
              <tbody>
                {utenti.map(u => (
                  <tr key={u.id} style={{ borderBottom: '1px solid #eee' }}>
                    {idUtenteInModifica === u.id ? (
                      <>
                        <td style={{ padding: '10px 12px' }}><input type="text" className="table-input" placeholder="Nome" value={datiUtenteInModifica.nome} onChange={(e) => setDatiUtenteInModifica({ ...datiUtenteInModifica, nome: e.target.value })} style={{ width: '100%', height: '30px' }} /></td>
                        <td style={{ padding: '10px 12px' }}><input type="text" className="table-input" placeholder="Cognome" value={datiUtenteInModifica.cognome} onChange={(e) => setDatiUtenteInModifica({ ...datiUtenteInModifica, cognome: e.target.value })} style={{ width: '100%', height: '30px' }} /></td>
                        <td style={{ padding: '10px 12px' }}><input type="email" className="table-input" placeholder="Email" value={datiUtenteInModifica.email} onChange={(e) => setDatiUtenteInModifica({ ...datiUtenteInModifica, email: e.target.value })} style={{ width: '100%', height: '30px' }} /></td>
                        <td style={{ padding: '10px 12px' }}><input type="text" className="table-input" value={datiUtenteInModifica.password} onChange={(e) => setDatiUtenteInModifica({ ...datiUtenteInModifica, password: e.target.value })} style={{ width: '100%', height: '30px' }} /></td>
                        <td style={{ padding: '10px 12px' }}>
                          <select className="table-input" value={datiUtenteInModifica.ruolo_id} onChange={(e) => setDatiUtenteInModifica({ ...datiUtenteInModifica, ruolo_id: e.target.value })} style={{ width: '100%', height: '30px' }}>
                            {ruoli.map(r => <option key={r.id} value={r.id}>{r.nome}</option>)}
                          </select>
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          <input type="checkbox" checked={!!datiUtenteInModifica.bubbler} onChange={(e) => setDatiUtenteInModifica({ ...datiUtenteInModifica, bubbler: e.target.checked })} />
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          <input type="checkbox" disabled={mancaCambioPassword} checked={!!datiUtenteInModifica.cambio_password} onChange={(e) => setDatiUtenteInModifica({ ...datiUtenteInModifica, cambio_password: e.target.checked })} />
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
                        {/* Chi non ha nome e cognome (gli account di servizio) si riconosce dal suo
                            username, che è l'unica cosa che ha: sta nella colonna del nome. */}
                        <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>
                          <strong>{u.nome || (u.cognome ? '' : u.username)}</strong>
                        </td>
                        <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}><strong>{u.cognome || <span style={{ color: '#ccc', fontWeight: 'normal' }}>—</span>}</strong></td>
                        <td style={{ padding: '10px 12px', verticalAlign: 'middle', color: '#555' }}>
                          {u.email || <span style={{ fontSize: '0.78rem', color: '#888' }}>nessuna email: entra ancora con l&apos;username</span>}
                        </td>
                        <td style={{ padding: '10px 12px', verticalAlign: 'middle', color: '#888' }}>••••••••</td>
                        <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>{ruoloDaId(u.ruolo_id)?.nome || u.ruolo || "—"}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'center', verticalAlign: 'middle' }}>
                          <input type="checkbox" checked={!!u.bubbler} onChange={() => toggleBubbler(u)} />
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'center', verticalAlign: 'middle' }}>
                          <input
                            type="checkbox" disabled={mancaCambioPassword} checked={!!u.cambio_password}
                            onChange={() => toggleCambioPassword(u)}
                            title={u.cambio_password ? "Al prossimo accesso dovrà scegliere una password nuova" : "Chiedi il cambio password al prossimo accesso"}
                          />
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'center', verticalAlign: 'middle' }}>
                          <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                            <button className="btn-icon-action" aria-label="Modifica" title="Modifica" onClick={() => { setIdUtenteInModifica(u.id); setDatiUtenteInModifica({ username: u.username, nome: u.nome || "", cognome: u.cognome || "", email: u.email || "", password: u.password, ruolo_id: u.ruolo_id ?? "", bubbler: !!u.bubbler, cambio_password: !!u.cambio_password }); }}><Icona nome="modifica" size={16} style={{ marginRight: 0 }} /></button>
                            <button className="btn-icon-action danger" aria-label="Elimina" title="Elimina" onClick={() => rimuoviUtente(u)}><Icona nome="elimina" size={16} style={{ marginRight: 0 }} /></button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
                {utenti.length === 0 && <tr><td colSpan="8" style={{ padding: '20px', textAlign: 'center', color: '#666' }}>Nessun utente.</td></tr>}
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
