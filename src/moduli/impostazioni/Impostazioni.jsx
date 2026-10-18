import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabaseClient';
import { MODULI_REGISTRY, SCHEDE_REGISTRY } from '../../lib/permessi';
import Icona from '../../components/Icona';
import { haAccesso, generaPassword, LUNGHEZZA_MINIMA_PASSWORD } from '../../lib/utils';

const permessiVuoti = () => {
  const base = {};
  Object.keys(SCHEDE_REGISTRY).forEach(moduloId => { base[moduloId] = { schede: [], sottoschede: [] }; });
  return base;
};

const RUOLO_VUOTO = { nome: "", permessi: permessiVuoti() };
// La password di un account nuovo la sceglie l'amministratore: il cambio al primo accesso parte già spuntato.
const UTENTE_VUOTO = { username: "", nome: "", cognome: "", email: "", password: "", ruolo_id: "", bubbler: false, cambio_password: true };
const ACCESSO_VUOTO = { password: "", ruolo_id: "", cambio_password: true };

// Il campo della password che l'amministratore scrive o fa generare. È in chiaro perché va letta
// per comunicarla alla persona; salvata, non la rivede più nessuno.
function CampoPassword({ value, onChange, autoFocus }) {
  return (
    <div style={{ display: 'flex', gap: '6px' }}>
      <input
        type="text" placeholder={`Password (almeno ${LUNGHEZZA_MINIMA_PASSWORD} caratteri)`} autoComplete="off" autoFocus={autoFocus}
        value={value} onChange={(e) => onChange(e.target.value)}
        style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', height: '36px', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px', fontFamily: 'monospace' }}
      />
      <button type="button" className="btn-outline-annulla" onClick={() => onChange(generaPassword())} style={{ padding: '0 12px', fontSize: '0.8rem', borderRadius: '4px', whiteSpace: 'nowrap' }}>Genera</button>
    </div>
  );
}

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
  // L'utente a cui si sta dando una password: chi è senza accesso la riceve insieme al ruolo
  // (Abilita), chi ce l'ha già se la vede reimpostare (vedi impostaAccesso).
  const [utenteAccesso, setUtenteAccesso] = useState(null);
  const [datiAccesso, setDatiAccesso] = useState(ACCESSO_VUOTO);

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
  //
  // L'email, una volta scritta, non si cambia più da qui: è la credenziale con cui la persona entra
  // e il riferimento con cui la si riconosce. Se proprio va corretta si interviene sul database.
  // Si può solo dare a chi non l'ha mai avuta (gli account di servizio).
  //
  // Chi è senza accesso (vedi haAccesso) si modifica senza ruolo: glielo dà "Abilita".
  //
  // La password non si legge e non si modifica da qui: è in Supabase Auth, cifrata, e nessuno la
  // vede. Si può solo sostituirla con una nuova (Password), di norma chiedendo all'utente di
  // sceglierne una sua al primo accesso.
  const utenteIncompleto = (u, conAccesso = true) => !u.email || (conAccesso && !u.ruolo_id);
  const avvisoIncompleto = (conAccesso = true) => conAccesso ? "Compila email e ruolo" : "Compila l'email";
  const passwordTroppoCorta = (p) => (p || '').length < LUNGHEZZA_MINIMA_PASSWORD;

  // Un nome lasciato in bianco si scrive nullo, non stringa vuota: è così che stanno a database
  // gli account che non l'hanno mai avuto, e mescolare le due cose renderebbe le ricerche bugiarde.
  const testoONullo = (v) => (v || '').trim() || null;

  // Il ruolo si scrive per id. Finché la colonna testuale "ruolo" esiste le si tiene dietro il
  // nome corrispondente: così una versione dell'app rimasta aperta in un'altra scheda continua a
  // leggere quello che si aspetta, invece di trovare la colonna ferma a un ruolo vecchio.
  const ruoloDaId = (id) => ruoli.find(r => String(r.id) === String(id));
  const campiRuolo = (ruoloId) => ({ ruolo_id: ruoloId, ruolo: ruoloDaId(ruoloId)?.nome || null });

  // I rifiuti delle funzioni del database (sql/accesso_supabase_auth.sql) sono già in italiano.
  const messaggioErrore = (error, ripiego) => (error?.code === 'P0001' ? error.message : ripiego);

  // L'utente nasce in due passi: prima l'anagrafica, senza accesso, poi la credenziale col ruolo.
  // Se il secondo fallisce l'utente resta in elenco "senza accesso", e glielo si dà con Abilita.
  const addUtente = async (e) => {
    e.preventDefault();
    if (utenteIncompleto(nuovoUtente)) return alert(avvisoIncompleto());
    if (passwordTroppoCorta(nuovoUtente.password)) return alert(`La password deve avere almeno ${LUNGHEZZA_MINIMA_PASSWORD} caratteri.`);
    const { ruolo_id, cambio_password, password, ...resto } = nuovoUtente;
    const { data, error } = await supabase.from('utenti')
      .insert([{
        ...resto,
        email: nuovoUtente.email.trim().toLowerCase(),
        nome: testoONullo(nuovoUtente.nome), cognome: testoONullo(nuovoUtente.cognome),
        username: nuovoUtente.username || nuovoUtente.email.trim().toLowerCase(),
      }]).select('id').single();
    if (error) { console.error(error); return alert("Errore salvataggio utente: email già usata da un altro account?"); }
    const { error: erroreAccesso } = await supabase.rpc('admin_imposta_accesso', {
      p_utente_id: data.id, p_password: password, p_cambio_password: !!cambio_password, p_ruolo_id: Number(ruolo_id),
    });
    setNuovoUtente(UTENTE_VUOTO); setShowFormUtente(false); fetchUtenti();
    if (erroreAccesso) {
      console.error(erroreAccesso);
      alert(`L'utente è stato creato, ma senza accesso: ${messaggioErrore(erroreAccesso, "errore nel salvataggio della password")}.\n\nDaglielo con Abilita.`);
    }
  };

  const salvaModificaUtente = async () => {
    const originale = utenti.find(u => u.id === idUtenteInModifica);
    const conAccesso = haAccesso(originale);
    if (utenteIncompleto(datiUtenteInModifica, conAccesso)) return alert(avvisoIncompleto(conAccesso));
    const { error } = await supabase.from('utenti').update({
      nome: testoONullo(datiUtenteInModifica.nome),
      cognome: testoONullo(datiUtenteInModifica.cognome),
      // L'email si scrive solo se prima non c'era: quella esistente non si tocca.
      ...(originale?.email ? {} : { email: datiUtenteInModifica.email.trim() }),
      ...(conAccesso ? {
        ...campiRuolo(datiUtenteInModifica.ruolo_id),
        cambio_password: !!datiUtenteInModifica.cambio_password,
      } : {}),
      bubbler: datiUtenteInModifica.bubbler,
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
      return alert(`Impossibile eliminare ${nome}: ha disponibilità o compensi collegati.\n\nPer togliergli l'accesso senza perdere lo storico, usa Revoca.`);
    }
    fetchUtenti();
  };

  // Dare una password: a chi non ha l'accesso — tipicamente un bubbler creato in Anagrafiche, con
  // l'anagrafica già completa — insieme al ruolo (Abilita); a chi ce l'ha già, al posto di quella
  // che ha (Password), per esempio perché l'ha dimenticata. In tutti e due i casi le sue sessioni
  // aperte si chiudono, e di norma al primo accesso se ne sceglie una sua. Per la propria password
  // il cambio non parte spuntato: chiederlo a sé stessi chiuderebbe fuori dalla sessione in corso.
  const apriAccesso = (u) => {
    setUtenteAccesso(u);
    setDatiAccesso({ ...ACCESSO_VUOTO, cambio_password: u.id !== user.id });
  };
  const impostaAccesso = async (e) => {
    e.preventDefault();
    const abilitazione = !haAccesso(utenteAccesso);
    if (abilitazione && !datiAccesso.ruolo_id) return alert("Scegli il ruolo");
    if (passwordTroppoCorta(datiAccesso.password)) return alert(`La password deve avere almeno ${LUNGHEZZA_MINIMA_PASSWORD} caratteri.`);
    const { error } = await supabase.rpc('admin_imposta_accesso', {
      p_utente_id: utenteAccesso.id, p_password: datiAccesso.password, p_cambio_password: !!datiAccesso.cambio_password,
      p_ruolo_id: abilitazione ? Number(datiAccesso.ruolo_id) : null,
    });
    if (!error) { setUtenteAccesso(null); setDatiAccesso(ACCESSO_VUOTO); fetchUtenti(); }
    else { console.error(error); alert(messaggioErrore(error, abilitazione ? "Errore abilitazione utente" : "Errore salvataggio della password")); }
  };

  // Revocare l'accesso invece di eliminare: la persona resta, con le sue disponibilità e i suoi
  // compensi, ma non entra più. La credenziale si cancella e le sue sessioni aperte si chiudono.
  // Se è un bubbler resta anche selezionabile come operatore.
  const revocaAccesso = async (u) => {
    if (u.id === user.id) return alert("Non puoi revocare l'accesso all'utente con cui hai effettuato l'accesso.");
    const nome = [u.nome, u.cognome].filter(Boolean).join(' ') || u.username;
    if (!window.confirm(`Revocare l'accesso a ${nome}?\n\nPassword e ruolo vengono tolti, i suoi dati restano.`)) return;
    const { error } = await supabase.rpc('admin_revoca_accesso', { p_utente_id: u.id });
    if (!error) fetchUtenti();
    else { console.error(error); alert(messaggioErrore(error, "Errore revoca accesso")); }
  };

  // Chiedere il cambio password si spunta al volo dall'elenco, senza entrare in modifica.
  // Il flag si spegne da solo quando l'utente sceglie la sua password: qui si può solo chiedere,
  // o revocare la richiesta se era stata fatta per sbaglio. Chi ce l'ha in sospeso non lavora
  // finché non l'ha fatto: è il database a fermarlo, non solo la schermata.
  const toggleCambioPassword = async (u) => {
    if (u.id === user.id && !u.cambio_password && !window.confirm("Chiedere il cambio password a te stesso ti blocca subito: dovrai uscire, rientrare e sceglierne una nuova. Continuare?")) return;
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
          <p className="descrizione-pagina">Gestisci gli utenti dell'applicazione e assegna loro un ruolo. Le password sono cifrate e non le vede nessuno: con <strong>Password</strong> se ne assegna una nuova al posto di quella dimenticata. Spuntando <strong>Cambio psw</strong> l'utente, al prossimo accesso, dovrà scegliere una password sua prima di entrare. I bubbler si creano da Anagrafiche &gt; Bubbler e compaiono qui <strong>senza accesso</strong>: con <strong>Abilita</strong> gli si assegnano ruolo e password. L'email, una volta salvata, non si modifica più.</p>

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
                  <CampoPassword value={nuovoUtente.password} onChange={(password) => setNuovoUtente({ ...nuovoUtente, password })} />
                  <select value={nuovoUtente.ruolo_id} onChange={(e) => setNuovoUtente({ ...nuovoUtente, ruolo_id: e.target.value })} style={{ width: '100%', boxSizing: 'border-box', height: '36px', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px' }}>
                    <option value="">Seleziona ruolo...</option>
                    {ruoli.map(r => <option key={r.id} value={r.id}>{r.nome}</option>)}
                  </select>
                  {/* Niente flag Bubbler qui: i bubbler nascono in Disponibilità > Configuratore, con
                      l'anagrafica completa. Su un utente esistente il flag si cambia in modifica. */}
                  {/* La password qui sopra la sceglie l'amministratore, quindi la conoscono in due:
                      spuntando questo l'utente se ne dà una sua al primo accesso. */}
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}>
                    <input type="checkbox" checked={!!nuovoUtente.cambio_password} onChange={(e) => setNuovoUtente({ ...nuovoUtente, cambio_password: e.target.checked })} /> Deve cambiare la password al primo accesso
                  </label>
                  <button type="submit" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '9px 18px', background: '#0288d1', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' }}><Icona nome="salva" size={16} style={{ marginRight: '6px' }} />Salva Utente</button>
                </form>
              </div>
            </div>
          )}

          {utenteAccesso && (
            <div className="modal-form-backdrop" onClick={() => setUtenteAccesso(null)}>
              <div className="modal-form-box" onClick={(e) => e.stopPropagation()}>
                <button type="button" className="modal-form-close" onClick={() => setUtenteAccesso(null)} aria-label="Chiudi">✕</button>
                <h3 style={{ margin: '0 0 6px 0', fontSize: '1.1rem', color: '#0288d1' }}>{haAccesso(utenteAccesso) ? 'Reimposta password' : 'Abilita accesso'}</h3>
                <p style={{ margin: '0 0 15px 0', fontSize: '0.85rem', color: '#555' }}>
                  <strong>{[utenteAccesso.nome, utenteAccesso.cognome].filter(Boolean).join(' ') || utenteAccesso.username}</strong> entrerà con <strong>{utenteAccesso.email || utenteAccesso.username}</strong>.
                  {haAccesso(utenteAccesso) && ' La password attuale smette di funzionare e le sue sessioni aperte si chiudono.'}
                  {' '}Dopo il salvataggio la password non si potrà più rivedere: copiala prima di comunicargliela.
                </p>
                <form onSubmit={impostaAccesso} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <CampoPassword autoFocus value={datiAccesso.password} onChange={(password) => setDatiAccesso({ ...datiAccesso, password })} />
                  {!haAccesso(utenteAccesso) && (
                    <select value={datiAccesso.ruolo_id} onChange={(e) => setDatiAccesso({ ...datiAccesso, ruolo_id: e.target.value })} style={{ width: '100%', boxSizing: 'border-box', height: '36px', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px' }}>
                      <option value="">Seleziona ruolo...</option>
                      {ruoli.map(r => <option key={r.id} value={r.id}>{r.nome}</option>)}
                    </select>
                  )}
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}>
                    <input type="checkbox" checked={!!datiAccesso.cambio_password} onChange={(e) => setDatiAccesso({ ...datiAccesso, cambio_password: e.target.checked })} /> Deve cambiare la password al primo accesso
                  </label>
                  <button type="submit" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '9px 18px', background: '#0288d1', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' }}><Icona nome="salva" size={16} style={{ marginRight: '6px' }} />{haAccesso(utenteAccesso) ? 'Salva password' : 'Abilita'}</button>
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
                  <th style={{ padding: '10px 12px', width: '130px' }}>Ruolo</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center', width: '80px' }}>Bubbler</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center', width: '100px' }} title="Al prossimo accesso l'utente deve scegliere una password nuova">Cambio psw</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center', width: '230px' }}>Azioni</th>
                </tr>
              </thead>
              <tbody>
                {utenti.map(u => (
                  <tr key={u.id} style={{ borderBottom: '1px solid #eee' }}>
                    {idUtenteInModifica === u.id ? (
                      <>
                        <td style={{ padding: '10px 12px' }}><input type="text" className="table-input" placeholder="Nome" value={datiUtenteInModifica.nome} onChange={(e) => setDatiUtenteInModifica({ ...datiUtenteInModifica, nome: e.target.value })} style={{ width: '100%', height: '30px' }} /></td>
                        <td style={{ padding: '10px 12px' }}><input type="text" className="table-input" placeholder="Cognome" value={datiUtenteInModifica.cognome} onChange={(e) => setDatiUtenteInModifica({ ...datiUtenteInModifica, cognome: e.target.value })} style={{ width: '100%', height: '30px' }} /></td>
                        <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>
                          {u.email
                            ? <span style={{ color: '#64748b' }} title="L'email non si modifica: se va corretta si interviene sul database">{u.email}</span>
                            : <input type="email" className="table-input" placeholder="Email" value={datiUtenteInModifica.email} onChange={(e) => setDatiUtenteInModifica({ ...datiUtenteInModifica, email: e.target.value })} style={{ width: '100%', height: '30px' }} />}
                        </td>
                        {haAccesso(u) ? (
                          <td style={{ padding: '10px 12px' }}>
                            <select className="table-input" value={datiUtenteInModifica.ruolo_id} onChange={(e) => setDatiUtenteInModifica({ ...datiUtenteInModifica, ruolo_id: e.target.value })} style={{ width: '100%', height: '30px' }}>
                              {ruoli.map(r => <option key={r.id} value={r.id}>{r.nome}</option>)}
                            </select>
                          </td>
                        ) : (
                          <td style={{ padding: '10px 12px', verticalAlign: 'middle', color: '#94a3b8', fontSize: '0.78rem' }}>Senza accesso: si dà con Abilita</td>
                        )}
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          <input type="checkbox" checked={!!datiUtenteInModifica.bubbler} onChange={(e) => setDatiUtenteInModifica({ ...datiUtenteInModifica, bubbler: e.target.checked })} />
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          <input type="checkbox" disabled={!haAccesso(u)} checked={!!datiUtenteInModifica.cambio_password} onChange={(e) => setDatiUtenteInModifica({ ...datiUtenteInModifica, cambio_password: e.target.checked })} />
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
                        {haAccesso(u) ? (
                          <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>{ruoloDaId(u.ruolo_id)?.nome || u.ruolo || "—"}</td>
                        ) : (
                          <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>
                            <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '10px', background: '#fff8e1', border: '1px solid #f0d999', color: '#8a6d00', fontSize: '0.75rem', fontWeight: 600 }}>Senza accesso</span>
                          </td>
                        )}
                        <td style={{ padding: '10px 12px', textAlign: 'center', verticalAlign: 'middle' }}>
                          {/* Solo indicazione: cambiarlo con un clic dall'elenco è troppo facile per sbaglio,
                              si fa entrando in modifica. */}
                          <input type="checkbox" checked={!!u.bubbler} disabled title="Si cambia entrando in modifica" />
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'center', verticalAlign: 'middle' }}>
                          <input
                            type="checkbox" disabled={!haAccesso(u)} checked={!!u.cambio_password}
                            onChange={() => toggleCambioPassword(u)}
                            title={u.cambio_password ? "Al prossimo accesso dovrà scegliere una password nuova" : "Chiedi il cambio password al prossimo accesso"}
                          />
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'center', verticalAlign: 'middle' }}>
                          <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                            <button className="btn-icon-action" aria-label="Modifica" title="Modifica" onClick={() => { setIdUtenteInModifica(u.id); setDatiUtenteInModifica({ username: u.username, nome: u.nome || "", cognome: u.cognome || "", email: u.email || "", ruolo_id: u.ruolo_id ?? "", bubbler: !!u.bubbler, cambio_password: !!u.cambio_password }); }}><Icona nome="modifica" size={16} style={{ marginRight: 0 }} /></button>
                            {haAccesso(u) ? (
                              <>
                                <button className="btn-outline-annulla" title="Assegna una password nuova al posto di quella attuale" onClick={() => apriAccesso(u)} style={{ fontSize: '0.75rem', padding: '3px 8px', borderRadius: '4px' }}>Password</button>
                                <button className="btn-outline-annulla" title="Toglie password e ruolo, i dati dell'utente restano" onClick={() => revocaAccesso(u)} style={{ fontSize: '0.75rem', padding: '3px 8px', borderRadius: '4px' }}>Revoca</button>
                              </>
                            ) : <button className="btn-accent-inline" title="Assegna ruolo e password" onClick={() => apriAccesso(u)} style={{ fontSize: '0.75rem', padding: '3px 8px' }}>Abilita</button>}
                            <button className="btn-icon-action danger" aria-label="Elimina" title="Elimina" onClick={() => rimuoviUtente(u)}><Icona nome="elimina" size={16} style={{ marginRight: 0 }} /></button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
                {utenti.length === 0 && <tr><td colSpan="7" style={{ padding: '20px', textAlign: 'center', color: '#666' }}>Nessun utente.</td></tr>}
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
                  {/* L'amministratore vede sempre tutto (puoVedere in permessi.js): i suoi permessi non
                      si leggono mai, quindi non si mostrano nemmeno da configurare. E non si elimina. */}
                  {(r.is_admin ?? r.nome === 'admin') ? (
                    <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Amministratore: vede tutto</span>
                  ) : (
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button className="btn-icon-action" aria-label="Modifica" title="Modifica" onClick={() => { setIdRuoloInModifica(r.id); setDatiRuoloInModifica({ nome: r.nome, permessi: { ...permessiVuoti(), ...r.permessi } }); }}><Icona nome="modifica" size={16} style={{ marginRight: 0 }} /></button>
                      <button className="btn-icon-action danger" aria-label="Elimina" title="Elimina" onClick={() => rimuoviRuolo(r)}><Icona nome="elimina" size={16} style={{ marginRight: 0 }} /></button>
                    </div>
                  )}
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
