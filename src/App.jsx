import { useState, useCallback, useEffect } from 'react'
import './App.css'
import { supabase } from './lib/supabaseClient';
import Preventivatore from './moduli/preventivatore/Preventivatore';
import Voucher from './moduli/voucher/Voucher';
import Prenotazioni from './moduli/prenotazioni/Prenotazioni';
import CostiRicavi from './moduli/costiricavi/CostiRicavi';
import Disponibilita from './moduli/disponibilita/Disponibilita';
import Compensi from './moduli/compensi/Compensi';
import Impostazioni from './moduli/impostazioni/Impostazioni';
import { MODULI_REGISTRY, moduloVisibile } from './lib/permessi';
import Icona from './components/Icona';

// Sessione conservata per sopravvivere a un aggiornamento della pagina (F5). Contiene solo
// l'id dell'utente e il modulo aperto: mai la password. Ruolo e permessi si rileggono dal database a
// ogni ripristino, così un ruolo modificato o un utente eliminato hanno effetto subito.
// È in sessionStorage e non in localStorage: vale per la scheda del browser e si chiude con essa.
const CHIAVE_SESSIONE = 'bfm_sessione';

// Lunghezza minima della password che l'utente si sceglie da sé. Non è una politica di sicurezza,
// è il minimo perché il cambio abbia senso: una password di due caratteri non protegge da niente.
const LUNGHEZZA_MINIMA_PASSWORD = 6;

// Primo modulo visibile per un utente (evita di atterrare su un modulo senza permessi)
const primoModuloVisibile = (u) => MODULI_REGISTRY.find(m => moduloVisibile(u, m.id))?.id || "preventivatore";

// Quello che dell'utente serve in giro per l'applicazione: l'id con cui i suoi dati sono
// agganciati, come si chiama e cosa può fare. L'username non è più una chiave, resta solo
// come vecchia credenziale di accesso.
const datiSessione = (u, ruolo) => ({
  id: u.id,
  username: u.username,
  email: u.email || '',
  nome: u.nome || '',
  cognome: u.cognome || '',
  nomeCompleto: [u.nome, u.cognome].filter(Boolean).join(' ') || u.username,
  // Il ruolo si porta dietro il suo id, che è il riferimento vero. Il nome resta per mostrarlo.
  ruoloId: u.ruolo_id,
  ruolo: ruolo.nome || u.ruolo,
  isAdmin: ruolo.isAdmin,
  permessi: ruolo.permessi,
  bubbler: !!u.bubbler,
});

function App() {
  // --- AUTENTICAZIONE ---
  const [user, setUser] = useState(null);
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  // Utente riconosciuto ma non ancora dentro: l'amministratore gli ha chiesto di cambiare la
  // password, e finché non lo fa la sessione non nasce. Tenerlo fuori da `user` significa che
  // nessun modulo lo vede e che un F5 lo riporta all'accesso, senza stati a metà da governare.
  const [utenteDaAggiornare, setUtenteDaAggiornare] = useState(null);
  const [nuovaPassword, setNuovaPassword] = useState("");
  const [confermaPassword, setConfermaPassword] = useState("");
  const [salvataggioPassword, setSalvataggioPassword] = useState(false);
  // Al primo montaggio si tenta il ripristino: finché è in corso non si mostra nulla, altrimenti
  // a ogni F5 comparirebbe un lampo della schermata di accesso.
  const [ripristinoInCorso, setRipristinoInCorso] = useState(() => !!sessionStorage.getItem(CHIAVE_SESSIONE));

  // --- NAVIGAZIONE TRA MODULI ---
  const [currentModule, setCurrentModule] = useState("preventivatore");
  const [sidebarAperta, setSidebarAperta] = useState(false);

  // --- CONFIGURAZIONE MODULI (flag sperimentale, badge SP in sidebar) ---
  const [moduliConfig, setModuliConfig] = useState({});

  // --- ACCESSO RAPIDO (solo sviluppo locale, nessuna password) ---
  const [utentiDev, setUtentiDev] = useState([]);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    supabase.from('utenti').select('*').order('username').then(({ data }) => { if (data) setUtentiDev(data); });
  }, []);

  // Evita che la rotella del mouse modifichi per sbaglio un campo numerico (prezzi, costi, sconti):
  // togliendo il focus, lo scroll continua a scorrere la pagina invece di cambiare il valore.
  useEffect(() => {
    const onWheel = () => {
      if (document.activeElement?.tagName === 'INPUT' && document.activeElement.type === 'number') {
        document.activeElement.blur();
      }
    };
    document.addEventListener('wheel', onWheel, { passive: true });
    return () => document.removeEventListener('wheel', onWheel);
  }, []);

  const fetchModuliConfig = useCallback(async () => {
    const { data } = await supabase.from('moduli_config').select('*');
    const mappa = {};
    (data || []).forEach(r => { mappa[r.modulo_id] = r.sperimentale; });
    setModuliConfig(mappa);
  }, []);

  // Il ruolo si cerca per id, non per nome. Il nome di un ruolo è un'etichetta che ha senso poter
  // cambiare — "adminlow" un giorno diventerà "responsabile" — e finché era lui la chiave,
  // rinominarlo lasciava i suoi utenti senza permessi: dentro l'applicazione, ma senza più niente
  // da vedere e senza nessun errore che lo dicesse. Per lo stesso motivo l'amministratore si
  // riconosce dal flag is_admin e non dal confronto con la stringa 'admin'.
  //
  // La ricerca per nome resta come ripiego per il caso in cui sql/ruolo_id.sql non sia ancora
  // stato eseguito: senza, questo codice messo in produzione per primo chiuderebbe fuori tutti,
  // amministratore compreso, e non ci sarebbe più modo di rientrare per rimediare.
  const fetchRuolo = useCallback(async (ruoloId, nomeRuolo) => {
    const query = supabase.from('ruoli').select('*');
    const { data } = await (ruoloId != null && ruoloId !== ''
      ? query.eq('id', ruoloId)
      : query.eq('nome', nomeRuolo)).maybeSingle();
    return {
      permessi: data?.permessi || {},
      // is_admin non esiste finché la migrazione non è passata: lì vale ancora il nome.
      isAdmin: data ? (data.is_admin ?? data.nome === 'admin') : false,
      nome: data?.nome || '',
    };
  }, []);

  const refreshPermessiUtenteCorrente = useCallback(async () => {
    if (!user) return;
    const ruolo = await fetchRuolo(user.ruoloId, user.ruolo);
    setUser(u => u ? { ...u, permessi: ruolo.permessi, isAdmin: ruolo.isAdmin, ruolo: ruolo.nome || u.ruolo } : u);
  }, [user, fetchRuolo]);

  // Una scheda rimasta aperta attraverso un aggiornamento dell'applicazione tiene in memoria un
  // utente nato col codice di prima, senza id — e senza id le sue disponibilità non si trovano e
  // non si salvano. Invece di chiedergli di uscire e rientrare, la sessione si ripara da sola:
  // l'utente si rilegge dal database e riprende il suo posto.
  useEffect(() => {
    if (!user || user.id) return;
    let annullato = false;
    (async () => {
      const { data } = await supabase.from('utenti').select('*').eq('username', user.username).maybeSingle();
      if (annullato) return;
      // I permessi già in sessione restano quelli: qui si sta riparando l'identità, non il ruolo.
      if (data) { setUser(u => (u && !u.id ? { ...u, ...datiSessione(data, { permessi: u.permessi, isAdmin: u.isAdmin, nome: u.ruolo }) } : u)); return; }
      // L'utente non esiste più: meglio la schermata di accesso di una sessione fantasma.
      sessionStorage.removeItem(CHIAVE_SESSIONE);
      setUser(null);
    })();
    return () => { annullato = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.username]);

  // --- RIPRISTINO DELLA SESSIONE DOPO UN AGGIORNAMENTO DELLA PAGINA ---
  useEffect(() => {
    if (!ripristinoInCorso) return;
    let annullato = false;
    (async () => {
      try {
        const { id, username, modulo } = JSON.parse(sessionStorage.getItem(CHIAVE_SESSIONE));
        // L'utente si rilegge sempre dal database: se nel frattempo è stato eliminato o gli è
        // cambiato ruolo, la sessione salvata non deve dargli accessi che non ha più.
        // Le sessioni aperte prima di questa versione contengono ancora solo l'username.
        const query = supabase.from('utenti').select('*');
        const { data } = await (id ? query.eq('id', id) : query.eq('username', username)).maybeSingle();
        if (annullato) return;
        if (data?.cambio_password) {
          // Il cambio password chiesto mentre la scheda era aperta vale dal ricaricamento
          // successivo: la sessione si chiude e si riparte dalla scelta della password.
          sessionStorage.removeItem(CHIAVE_SESSIONE);
          setUtenteDaAggiornare(data);
        } else if (data) {
          const ruolo = await fetchRuolo(data.ruolo_id, data.ruolo);
          if (annullato) return;
          const ripristinato = datiSessione(data, ruolo);
          const moduloAncoraVisibile = modulo === 'impostazioni'
            ? ripristinato.isAdmin
            : moduloVisibile(ripristinato, modulo);
          setUser(ripristinato);
          setCurrentModule(moduloAncoraVisibile ? modulo : primoModuloVisibile(ripristinato));
          fetchModuliConfig();
        } else {
          sessionStorage.removeItem(CHIAVE_SESSIONE);
        }
      } catch {
        sessionStorage.removeItem(CHIAVE_SESSIONE);
      }
      if (!annullato) setRipristinoInCorso(false);
    })();
    return () => { annullato = true; };
  }, [ripristinoInCorso, fetchRuolo, fetchModuliConfig]);

  // Tiene allineata la sessione salvata: bastano l'id e il modulo a video per riaprire la
  // pagina dov'era, senza conservare nulla di riservato.
  useEffect(() => {
    if (user) sessionStorage.setItem(CHIAVE_SESSIONE, JSON.stringify({ id: user.id, modulo: currentModule }));
  }, [user, currentModule]);

  // Porta dentro l'utente riconosciuto: ruolo, modulo di atterraggio e configurazione moduli.
  // Ci passano tutte le strade d'ingresso — accesso normale, accesso rapido e cambio password —
  // così non possono divergere.
  const entra = async (u) => {
    const nuovoUser = datiSessione(u, await fetchRuolo(u.ruolo_id, u.ruolo));
    setUser(nuovoUser);
    setCurrentModule(primoModuloVisibile(nuovoUser));
    fetchModuliConfig();
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      // Si entra con l'email. L'username resta accettato come ripiego finché non tutti hanno
      // un'email in anagrafica: i tre account di servizio ne sono ancora sprovvisti, e senza
      // questa seconda strada resterebbero fuori dalla loro stessa applicazione.
      const credenziale = loginUser.trim();
      let { data } = await supabase
        .from('utenti').select('*')
        .ilike('email', credenziale).eq('password', loginPass).maybeSingle();
      if (!data) {
        ({ data } = await supabase
          .from('utenti').select('*')
          .eq('username', credenziale).eq('password', loginPass).maybeSingle());
      }

      if (data?.cambio_password) {
        // Le credenziali sono giuste, ma la password è ancora quella scritta dall'amministratore:
        // prima di entrare l'utente se ne sceglie una sua.
        setLoginPass("");
        setUtenteDaAggiornare(data);
      } else if (data) {
        await entra(data);
      } else {
        alert("Credenziali errate o utente non trovato!");
      }
    } catch (err) {
      alert("Errore di connessione al database. Controlla la console.");
      console.error(err);
    }
  };

  // L'accesso rapido salta la password, non il cambio password: serve anche a provarlo.
  const handleQuickLogin = async (u) => {
    if (u.cambio_password) return setUtenteDaAggiornare(u);
    await entra(u);
  };

  const annullaCambioPassword = () => {
    setUtenteDaAggiornare(null);
    setNuovaPassword("");
    setConfermaPassword("");
    setLoginPass("");
  };

  // La password nuova la sceglie l'utente e la conosce solo lui: appena è salvata la richiesta
  // dell'amministratore si spegne da sola, e l'accesso prosegue senza doverlo rifare.
  const salvaNuovaPassword = async (e) => {
    e.preventDefault();
    const nuova = nuovaPassword.trim();
    if (nuova.length < LUNGHEZZA_MINIMA_PASSWORD) return alert(`La nuova password deve avere almeno ${LUNGHEZZA_MINIMA_PASSWORD} caratteri.`);
    if (nuova !== confermaPassword.trim()) return alert("Le due password non coincidono.");
    if (nuova === utenteDaAggiornare.password) return alert("La nuova password deve essere diversa da quella che ti è stata assegnata.");

    setSalvataggioPassword(true);
    const { error } = await supabase.from('utenti')
      .update({ password: nuova, cambio_password: false })
      .eq('id', utenteDaAggiornare.id);
    setSalvataggioPassword(false);
    if (error) {
      console.error(error);
      return alert("Non è stato possibile salvare la nuova password. Riprova.");
    }

    const aggiornato = { ...utenteDaAggiornare, password: nuova, cambio_password: false };
    annullaCambioPassword();
    setLoginUser("");
    await entra(aggiornato);
  };

  const handleLogout = () => {
    sessionStorage.removeItem(CHIAVE_SESSIONE);
    setUser(null);
    setLoginUser("");
    setLoginPass("");
    setCurrentModule("preventivatore");
    setSidebarAperta(false);
  };

  const cambiaModulo = (idModulo) => {
    setCurrentModule(idModulo);
    setSidebarAperta(false);
  };

  // Ripristino in corso: schermata vuota per un istante, invece del lampo della pagina di accesso
  if (ripristinoInCorso) return null;

  // Credenziali riconosciute, ma con il cambio password ancora da fare: si passa di qui e basta,
  // non c'è modo di saltare il passaggio perché la sessione non è ancora nata.
  if (utenteDaAggiornare) {
    return (
      <div className="login-container">
        <div className="login-card">
          <img src="/logo.png" alt="Logo Azienda" style={{ maxWidth: '140px', display: 'block', margin: '0 auto 15px auto' }} />
          <h2>Scegli la tua password</h2>
          <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '0 0 18px 0', lineHeight: 1.45 }}>
            Ciao <strong>{[utenteDaAggiornare.nome, utenteDaAggiornare.cognome].filter(Boolean).join(' ') || utenteDaAggiornare.username}</strong>,
            la password con cui sei entrato te l&apos;ha assegnata un amministratore. Scegline una tua per continuare:
            almeno {LUNGHEZZA_MINIMA_PASSWORD} caratteri.
          </p>
          <form onSubmit={salvaNuovaPassword}>
            <input type="password" placeholder="Nuova password" autoFocus value={nuovaPassword} onChange={(e) => setNuovaPassword(e.target.value)} />
            <input type="password" placeholder="Ripeti la nuova password" value={confermaPassword} onChange={(e) => setConfermaPassword(e.target.value)} />
            <button type="submit" disabled={salvataggioPassword}>{salvataggioPassword ? 'Salvataggio…' : 'Salva ed entra'}</button>
          </form>
          <button
            type="button" onClick={annullaCambioPassword}
            style={{ width: '100%', marginTop: '10px', padding: '10px', background: 'transparent', color: '#64748b', border: '1px solid #cbd5e1', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}
          >
            Torna all&apos;accesso
          </button>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="login-container">
        <div className="login-card">
          <img src="/logo.png" alt="Logo Azienda" style={{ maxWidth: '140px', display: 'block', margin: '0 auto 15px auto' }} />
          <h2>Accesso Gestionale</h2>
          <form onSubmit={handleLogin}>
            <input type="text" placeholder="Email" value={loginUser} onChange={(e) => setLoginUser(e.target.value)} />
            <input type="password" placeholder="Password" value={loginPass} onChange={(e) => setLoginPass(e.target.value)} />
            <button type="submit">Accedi</button>
          </form>

          {import.meta.env.DEV && utentiDev.length > 0 && (
            <div style={{ marginTop: '20px', paddingTop: '15px', borderTop: '1px dashed #cbd5e1' }}>
              <p style={{ fontSize: '0.75rem', color: '#94a3b8', textAlign: 'center', margin: '0 0 8px 0' }}>🛠️ Accesso rapido (solo sviluppo locale, senza password)</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', justifyContent: 'center' }}>
                {utentiDev.map(u => (
                  <button key={u.id} type="button" onClick={() => handleQuickLogin(u)} style={{ padding: '6px 12px', fontSize: '0.8rem', background: '#e2e8f0', color: '#334155', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
                    {[u.nome, u.cognome].filter(Boolean).join(" ") || u.username} <span style={{ opacity: 0.6 }}>({u.ruolo})</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const moduliVisibili = MODULI_REGISTRY.filter(m => moduloVisibile(user, m.id));
  const isAdmin = user.isAdmin;
  const IMPOSTAZIONI_VOCE = { id: 'impostazioni', label: 'Impostazioni', icon: 'impostazioni' };
  const moduloCorrente = currentModule === 'impostazioni'
    ? IMPOSTAZIONI_VOCE
    : MODULI_REGISTRY.find(m => m.id === currentModule);

  return (
    <div className="app-container">
      {/* --- SIDEBAR LATERALE (MENU MODULI) --- */}
      {sidebarAperta && <div className="sidebar-backdrop no-print" onClick={() => setSidebarAperta(false)}></div>}
      <aside className={`sidebar-moduli no-print ${sidebarAperta ? 'aperta' : ''}`}>
        <div className="sidebar-header">
          <img src="/logo.png" alt="Logo" style={{ maxWidth: '110px', height: 'auto' }} />
          <button className="sidebar-chiudi" onClick={() => setSidebarAperta(false)}>✕</button>
        </div>
        <nav className="sidebar-nav">
          {moduliVisibili.map(m => (
            <button
              key={m.id}
              className={`sidebar-voce ${currentModule === m.id ? 'active' : ''}`}
              onClick={() => cambiaModulo(m.id)}
            >
              <span className="sidebar-icona"><Icona nome={m.icon} /></span> {m.label}
              {moduliConfig[m.id] && <span className="badge-sp">SP</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          {isAdmin && (
            <button
              className={`sidebar-voce ${currentModule === 'impostazioni' ? 'active' : ''}`}
              onClick={() => cambiaModulo('impostazioni')}
            >
              <span className="sidebar-icona"><Icona nome={IMPOSTAZIONI_VOCE.icon} /></span> {IMPOSTAZIONI_VOCE.label}
            </button>
          )}
          <p>Connesso come: <strong>{user.nomeCompleto}</strong></p>
          <button className="btn-logout" onClick={handleLogout}><Icona nome="logout" />Esci</button>
        </div>
      </aside>

      {/* --- TESTATA GLOBALE --- */}
      <header className="main-header no-print">
        <div className="header-brand" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button className="btn-hamburger" onClick={() => setSidebarAperta(true)} aria-label="Apri menu moduli">☰</button>
          <img src="/logo.png" alt="Logo" style={{ height: '45px', width: 'auto', objectFit: 'contain' }} />
          <h1>{moduloCorrente && <Icona nome={moduloCorrente.icon} size={20} />} {moduloCorrente?.label}</h1>
        </div>
      </header>

      {/* --- MODULO ATTIVO --- */}
      {currentModule === "preventivatore" && <Preventivatore user={user} />}

      {currentModule === "voucher" && <Voucher user={user} />}

      {currentModule === "prenotazioni" && <Prenotazioni user={user} />}

      {currentModule === "costiricavi" && <CostiRicavi user={user} />}

      {currentModule === "disponibilita" && <Disponibilita user={user} />}

      {currentModule === "compensi" && <Compensi user={user} />}

      {currentModule === "impostazioni" && isAdmin && (
        <Impostazioni
          user={user}
          moduliConfig={moduliConfig}
          onModuliConfigChange={fetchModuliConfig}
          onRuoliChange={refreshPermessiUtenteCorrente}
        />
      )}
    </div>
  )
}

export default App
