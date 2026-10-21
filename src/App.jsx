import { useState, useCallback, useEffect } from 'react'
import './App.css'
import { supabase } from './lib/supabaseClient';
import Anagrafiche from './moduli/anagrafiche/Anagrafiche';
import Preventivatore from './moduli/preventivatore/Preventivatore';
import Voucher from './moduli/voucher/Voucher';
import Prenotazioni from './moduli/prenotazioni/Prenotazioni';
import Cruscotto from './moduli/cruscotto/Cruscotto';
import Disponibilita from './moduli/disponibilita/Disponibilita';
import Consuntivazione from './moduli/consuntivazione/Consuntivazione';
import Albatros from './moduli/albatros/Albatros';
import Spese from './moduli/spese/Spese';
import Impostazioni from './moduli/impostazioni/Impostazioni';
import { MODULI_REGISTRY, GRUPPI_MODULI, MONDI, moduloVisibile, mondoDi, puoVedere } from './lib/permessi';
import { SCHEDE_ALBATROS } from './moduli/albatros/schede';
import { haAccesso, emailDiAccesso, LUNGHEZZA_MINIMA_PASSWORD } from './lib/utils';
import Icona from './components/Icona';

// Chi è entrato lo sa Supabase Auth, che tiene la sua sessione in sessionStorage (supabaseClient.js).
// Qui resta solo il modulo aperto, per riaprire la pagina dov'era dopo un aggiornamento (F5).
// Ruolo e permessi si rileggono dal database a ogni ripristino, così un ruolo modificato o un
// accesso revocato hanno effetto subito.
const CHIAVE_SESSIONE = 'bfm_sessione';

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
  // Vero mentre la richiesta di accesso è in viaggio: un secondo invio (Invio e clic insieme, o la
  // compilazione automatica del browser che invia da sé) non parte finché il primo non ha risposto.
  const [accessoInCorso, setAccessoInCorso] = useState(false);
  // Utente riconosciuto ma non ancora dentro: l'amministratore gli ha chiesto di cambiare la
  // password, e finché non lo fa la sessione non nasce. Tenerlo fuori da `user` significa che
  // nessun modulo lo vede e che un F5 lo riporta all'accesso, senza stati a metà da governare.
  const [utenteDaAggiornare, setUtenteDaAggiornare] = useState(null);
  const [nuovaPassword, setNuovaPassword] = useState("");
  const [confermaPassword, setConfermaPassword] = useState("");
  const [salvataggioPassword, setSalvataggioPassword] = useState(false);
  // Al primo montaggio si cerca la sessione di Supabase: finché la ricerca è in corso non si mostra
  // nulla, altrimenti a ogni F5 comparirebbe un lampo della schermata di accesso.
  const [ripristinoInCorso, setRipristinoInCorso] = useState(true);

  // --- NAVIGAZIONE TRA MODULI ---
  const [currentModule, setCurrentModule] = useState("preventivatore");
  // Il preventivo che il Preventivatore ha chiesto di trasformare in prenotazione: lo consuma il
  // modulo Prenotazioni appena montato, e poi si azzera.
  const [preventivoDaTrasformare, setPreventivoDaTrasformare] = useState(null);
  const [sidebarAperta, setSidebarAperta] = useState(false);
  // --- MONDI: BFM e Albatros ---
  // Nel mondo Albatros le voci del menu sono le schede di Albatros: quella aperta la tiene qui,
  // insieme all'ultimo modulo di BFM, a cui si torna cambiando mondo. La scheda e il mondo si
  // ricordano nel browser (comodità per chi usa sempre lo stesso: se non si può, si riparte da capo).
  const [schedaAlbatros, setSchedaAlbatros] = useState(() => { try { return localStorage.getItem('albatros_scheda') || 'chiusure'; } catch { return 'chiusure'; } });
  const [ultimoModuloBfm, setUltimoModuloBfm] = useState(null);

  // --- CONFIGURAZIONE MODULI (flag sperimentale, badge SP in sidebar) ---
  const [moduliConfig, setModuliConfig] = useState({});

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

  // Porta dentro l'utente riconosciuto: ruolo, modulo di atterraggio e configurazione moduli.
  // Ci passano tutte le strade d'ingresso — accesso, ripristino dopo un F5 e cambio password —
  // così non possono divergere. Il modulo indicato (quello aperto prima del F5) si riapre solo se
  // l'utente lo vede ancora.
  const entra = useCallback(async (u, modulo) => {
    const nuovoUser = datiSessione(u, await fetchRuolo(u.ruolo_id, u.ruolo));
    const moduloAncoraVisibile = modulo === 'impostazioni' ? nuovoUser.isAdmin : !!modulo && moduloVisibile(nuovoUser, modulo);
    setUser(nuovoUser);
    // Senza un modulo da riaprire, chi l'ultima volta stava in Albatros ci rientra.
    let ultimoMondo = null;
    try { ultimoMondo = localStorage.getItem('bfm_mondo'); } catch { /* niente da ricordare */ }
    const atterraggio = ultimoMondo === 'albatros' && moduloVisibile(nuovoUser, 'albatros') ? 'albatros' : primoModuloVisibile(nuovoUser);
    setCurrentModule(moduloAncoraVisibile ? modulo : atterraggio);
    fetchModuliConfig();
  }, [fetchRuolo, fetchModuliConfig]);

  // La credenziale è valida: si cerca la riga dell'anagrafica che le è legata. Chi è senza
  // accesso — bubbler non ancora abilitato, o accesso revocato — esce subito, e chi ha il cambio
  // password in sospeso si ferma alla schermata che lo chiede: la sessione c'è, ma finché non
  // sceglie la sua password il database non gli dà nient'altro che la sua riga.
  // Restituisce falso se l'utente non può entrare.
  const apriSessione = useCallback(async (authId, modulo) => {
    const { data, error } = await supabase.from('utenti').select('*').eq('auth_id', authId).maybeSingle();
    if (error) throw error;
    if (!data || !haAccesso(data)) { await supabase.auth.signOut(); return false; }
    if (data.cambio_password) setUtenteDaAggiornare(data);
    else await entra(data, modulo);
    return true;
  }, [entra]);

  // Riporta l'app alla schermata di accesso, senza toccare la sessione di Supabase: la usa chi
  // l'ha già chiusa (uscita, o sessione scaduta o revocata dall'amministratore).
  const azzeraSessione = useCallback(() => {
    sessionStorage.removeItem(CHIAVE_SESSIONE);
    setUser(null);
    setUtenteDaAggiornare(null);
    setNuovaPassword("");
    setConfermaPassword("");
    setCurrentModule("preventivatore");
    setSidebarAperta(false);
  }, []);

  // --- RIPRISTINO DELLA SESSIONE DOPO UN AGGIORNAMENTO DELLA PAGINA ---
  useEffect(() => {
    let annullato = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session && !annullato) {
          let modulo;
          try { modulo = JSON.parse(sessionStorage.getItem(CHIAVE_SESSIONE))?.modulo; } catch { /* nessun modulo salvato */ }
          await apriSessione(session.user.id, modulo);
        }
      } catch (err) {
        console.error(err);
      }
      if (!annullato) setRipristinoInCorso(false);
    })();
    return () => { annullato = true; };
  }, [apriSessione]);

  // Quando la sessione si chiude da sé — scaduta, o revocata perché l'amministratore ha
  // reimpostato la password o tolto l'accesso — l'app torna alla schermata di accesso invece di
  // restare aperta su un database che non risponde più.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((evento) => {
      if (evento === 'SIGNED_OUT') azzeraSessione();
    });
    return () => subscription.unsubscribe();
  }, [azzeraSessione]);

  // Tiene allineato il modulo a video, per riaprire la pagina dov'era.
  useEffect(() => {
    if (user) sessionStorage.setItem(CHIAVE_SESSIONE, JSON.stringify({ modulo: currentModule }));
  }, [user, currentModule]);

  // Email e password si leggono dal modulo al momento dell'invio, non da uno stato tenuto a ogni
  // tasto: i campi compilati in automatico dal browser non avvisano React finché non si tocca la
  // pagina, e il primo invio partiva vuoto — "credenziali errate", e al secondo si entrava.
  const handleLogin = async (e) => {
    e.preventDefault();
    if (accessoInCorso) return;
    const modulo = new FormData(e.currentTarget);
    const credenziale = String(modulo.get('email') || '').trim();
    const password = String(modulo.get('password') || '');
    if (!credenziale || !password) return alert("Scrivi email e password.");

    setAccessoInCorso(true);
    try {
      // Si entra con l'email. Chi non ne ha una (un account di servizio) scrive il suo username,
      // che emailDiAccesso trasforma nell'indirizzo con cui la sua credenziale è registrata.
      const { data, error } = await supabase.auth.signInWithPassword({ email: emailDiAccesso(credenziale), password });
      if (error) {
        if (error.code === 'invalid_credentials') return alert("Credenziali errate o utente non trovato!");
        if (error.status === 429) return alert("Troppi tentativi di accesso: riprova tra qualche minuto.");
        throw error;
      }
      if (!(await apriSessione(data.user.id))) alert("Questo account non ha accesso all'applicazione.");
    } catch (err) {
      alert("Errore di connessione al database. Controlla la console.");
      console.error(err);
    } finally {
      setAccessoInCorso(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    azzeraSessione();
  };

  // Tornare all'accesso dalla scelta della password chiude la sessione appena aperta.
  const annullaCambioPassword = handleLogout;

  // La password nuova la sceglie l'utente e la conosce solo lui. La scrive il database
  // (cambia_mia_password), che controlla che sia davvero nuova e solo allora spegne la richiesta
  // dell'amministratore: l'accesso prosegue senza doverlo rifare.
  const salvaNuovaPassword = async (e) => {
    e.preventDefault();
    const nuova = nuovaPassword.trim();
    if (nuova.length < LUNGHEZZA_MINIMA_PASSWORD) return alert(`La nuova password deve avere almeno ${LUNGHEZZA_MINIMA_PASSWORD} caratteri.`);
    if (nuova !== confermaPassword.trim()) return alert("Le due password non coincidono.");

    setSalvataggioPassword(true);
    const { error } = await supabase.rpc('cambia_mia_password', { p_nuova: nuova });
    setSalvataggioPassword(false);
    if (error) {
      console.error(error);
      // I rifiuti del database (password uguale a quella di prima, troppo corta) sono già in italiano.
      return alert(error.code === 'P0001' ? error.message : "Non è stato possibile salvare la nuova password. Riprova.");
    }

    const aggiornato = { ...utenteDaAggiornare, cambio_password: false };
    setUtenteDaAggiornare(null);
    setNuovaPassword("");
    setConfermaPassword("");
    await entra(aggiornato);
  };

  const cambiaModulo = (idModulo) => {
    setCurrentModule(idModulo);
    setSidebarAperta(false);
  };

  const scegliSchedaAlbatros = (id) => {
    setSchedaAlbatros(id);
    try { localStorage.setItem('albatros_scheda', id); } catch { /* resta per questa sessione */ }
    setSidebarAperta(false);
  };

  // Cambiando mondo si torna dove si era: in Albatros alla sua scheda, in BFM all'ultimo modulo.
  const cambiaMondo = (mondo) => {
    try { localStorage.setItem('bfm_mondo', mondo); } catch { /* resta per questa sessione */ }
    if (mondo === 'albatros') {
      if (mondoDi(currentModule) === 'bfm') setUltimoModuloBfm(currentModule);
      setCurrentModule('albatros');
      return;
    }
    const visibile = (id) => id === 'impostazioni' ? user.isAdmin : moduloVisibile(user, id);
    const primoBfm = MODULI_REGISTRY.find(m => mondoDi(m.id) === 'bfm' && moduloVisibile(user, m.id))?.id || 'impostazioni';
    setCurrentModule(ultimoModuloBfm && visibile(ultimoModuloBfm) ? ultimoModuloBfm : primoBfm);
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
            <input type="password" placeholder="Nuova password" autoComplete="new-password" autoFocus value={nuovaPassword} onChange={(e) => setNuovaPassword(e.target.value)} />
            <input type="password" placeholder="Ripeti la nuova password" autoComplete="new-password" value={confermaPassword} onChange={(e) => setConfermaPassword(e.target.value)} />
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
            <input type="text" name="email" placeholder="Email" autoComplete="username" />
            <input type="password" name="password" placeholder="Password" autoComplete="current-password" />
            <button type="submit" disabled={accessoInCorso}>{accessoInCorso ? 'Accesso…' : 'Accedi'}</button>
          </form>
        </div>
      </div>
    );
  }

  const moduliVisibili = MODULI_REGISTRY.filter(m => moduloVisibile(user, m.id));
  const isAdmin = user.isAdmin;
  const IMPOSTAZIONI_VOCE = { id: 'impostazioni', label: 'Impostazioni', icon: 'impostazioni' };
  // Il mondo in cui si è: Albatros quando è aperto il suo modulo, BFM per tutto il resto.
  const mondo = currentModule === 'impostazioni' ? 'bfm' : mondoDi(currentModule);
  const inAlbatros = mondo === 'albatros';
  const mondiVisibili = MONDI.filter(w => (w.id === 'bfm'
    ? isAdmin || moduliVisibili.some(m => mondoDi(m.id) === 'bfm')
    : moduliVisibili.some(m => mondoDi(m.id) === w.id)));
  const schedeAlbatros = SCHEDE_ALBATROS.filter(s => puoVedere(user, 'albatros', s.id));
  const schedaAlbatrosAttiva = schedeAlbatros.find(s => s.id === schedaAlbatros) || schedeAlbatros[0];
  const moduloCorrente = currentModule === 'impostazioni'
    ? IMPOSTAZIONI_VOCE
    : inAlbatros
      ? schedaAlbatrosAttiva && { label: schedaAlbatrosAttiva.label, icon: schedaAlbatrosAttiva.icona }
      : MODULI_REGISTRY.find(m => m.id === currentModule);

  return (
    <div className={`app-container ${inAlbatros ? 'mondo-albatros' : ''}`}>
      {/* --- SIDEBAR LATERALE (MENU MODULI) --- */}
      {sidebarAperta && <div className="sidebar-backdrop no-print" onClick={() => setSidebarAperta(false)}></div>}
      <aside className={`sidebar-moduli no-print ${sidebarAperta ? 'aperta' : ''}`}>
        <div className="sidebar-header">
          {inAlbatros
            ? <span className="marchio-albatros"><Icona nome="albatros" size={26} />Albatros</span>
            : <img src="/logo.png" alt="Logo" style={{ maxWidth: '110px', height: 'auto' }} />}
          <button className="sidebar-chiudi" onClick={() => setSidebarAperta(false)}>✕</button>
        </div>
        {mondiVisibili.length > 1 && (
          <div className="selettore-mondo" role="tablist" aria-label="Mondo">
            {mondiVisibili.map(w => (
              <button key={w.id} type="button" role="tab" aria-selected={mondo === w.id}
                className={mondo === w.id ? 'attivo' : ''} onClick={() => mondo !== w.id && cambiaMondo(w.id)}>{w.label}</button>
            ))}
          </div>
        )}
        <nav className="sidebar-nav">
          {inAlbatros && schedeAlbatros.map(s => (
            <button key={s.id} className={`sidebar-voce ${schedaAlbatrosAttiva?.id === s.id ? 'active' : ''}`} onClick={() => scegliSchedaAlbatros(s.id)}>
              <span className="sidebar-icona"><Icona nome={s.icona} /></span> {s.label}
            </button>
          ))}
          {!inAlbatros && GRUPPI_MODULI.map(g => {
            const moduliDelGruppo = moduliVisibili.filter(m => m.gruppo === g.id && mondoDi(m.id) === 'bfm');
            if (moduliDelGruppo.length === 0) return null;
            return (
              <div key={g.id} className="sidebar-gruppo">
                <div className="sidebar-gruppo-titolo">{g.label}</div>
                {moduliDelGruppo.map(m => (
                  <button
                    key={m.id}
                    className={`sidebar-voce ${currentModule === m.id ? 'active' : ''}`}
                    onClick={() => cambiaModulo(m.id)}
                  >
                    <span className="sidebar-icona"><Icona nome={m.icon} /></span> {m.label}
                    {moduliConfig[m.id] && <span className="badge-sp">SP</span>}
                  </button>
                ))}
              </div>
            );
          })}
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
          {inAlbatros
            ? <span className="marchio-albatros marchio-testata"><Icona nome="albatros" size={24} />Albatros</span>
            : <img src="/logo.png" alt="Logo" style={{ height: '45px', width: 'auto', objectFit: 'contain' }} />}
          <h1>{moduloCorrente && <Icona nome={moduloCorrente.icon} size={20} />} {moduloCorrente?.label}</h1>
        </div>
      </header>

      {/* --- MODULO ATTIVO --- */}
      {currentModule === "catalogo" && <Anagrafiche user={user} />}

      {currentModule === "preventivatore" && (
        <Preventivatore
          user={user}
          onTrasformaInPrenotazione={moduloVisibile(user, 'prenotazioni')
            ? (codice) => { setPreventivoDaTrasformare(codice); setCurrentModule("prenotazioni"); }
            : undefined}
        />
      )}

      {currentModule === "voucher" && <Voucher user={user} />}

      {currentModule === "prenotazioni" && (
        <Prenotazioni
          user={user}
          preventivoDaTrasformare={preventivoDaTrasformare}
          onPreventivoTrasformato={() => setPreventivoDaTrasformare(null)}
        />
      )}

      {currentModule === "costiricavi" && <Cruscotto user={user} />}

      {currentModule === "disponibilita" && <Disponibilita user={user} />}

      {currentModule === "spese" && <Spese user={user} />}

      {currentModule === "consuntivazione" && <Consuntivazione user={user} />}

      {currentModule === "albatros" && <Albatros user={user} scheda={schedaAlbatrosAttiva?.id} onScheda={scegliSchedaAlbatros} />}

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
