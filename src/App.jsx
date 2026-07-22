import { useState, useCallback, useEffect } from 'react'
import './App.css'
import { supabase } from './lib/supabaseClient';
import Preventivatore from './moduli/preventivatore/Preventivatore';
import Voucher from './moduli/voucher/Voucher';
import Prenotazioni from './moduli/prenotazioni/Prenotazioni';
import CostiRicavi from './moduli/costiricavi/CostiRicavi';
import Impostazioni from './moduli/impostazioni/Impostazioni';
import { MODULI_REGISTRY, moduloVisibile } from './lib/permessi';

function App() {
  // --- AUTENTICAZIONE ---
  const [user, setUser] = useState(null);
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");

  // --- NAVIGAZIONE TRA MODULI ---
  const [currentModule, setCurrentModule] = useState("preventivatore");
  const [sidebarAperta, setSidebarAperta] = useState(false);

  // --- CONFIGURAZIONE MODULI (flag sperimentale, badge SP in sidebar) ---
  const [moduliConfig, setModuliConfig] = useState({});

  // --- ACCESSO RAPIDO (solo sviluppo locale, nessuna password) ---
  const [utentiDev, setUtentiDev] = useState([]);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    supabase.from('utenti').select('username, ruolo').order('username').then(({ data }) => { if (data) setUtentiDev(data); });
  }, []);

  const fetchModuliConfig = useCallback(async () => {
    const { data } = await supabase.from('moduli_config').select('*');
    const mappa = {};
    (data || []).forEach(r => { mappa[r.modulo_id] = r.sperimentale; });
    setModuliConfig(mappa);
  }, []);

  const fetchPermessiRuolo = useCallback(async (ruolo) => {
    const { data } = await supabase.from('ruoli').select('*').eq('nome', ruolo).maybeSingle();
    return data?.permessi || {};
  }, []);

  const refreshPermessiUtenteCorrente = useCallback(async () => {
    if (!user) return;
    const permessi = await fetchPermessiRuolo(user.ruolo);
    setUser(u => u ? { ...u, permessi } : u);
  }, [user, fetchPermessiRuolo]);

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const { data } = await supabase
        .from('utenti')
        .select('*')
        .eq('username', loginUser)
        .eq('password', loginPass)
        .maybeSingle();

      if (data) {
        const permessi = await fetchPermessiRuolo(data.ruolo);
        setUser({ username: data.username, ruolo: data.ruolo, permessi });
        fetchModuliConfig();
      } else {
        alert("Credenziali errate o utente non trovato!");
      }
    } catch (err) {
      alert("Errore di connessione al database. Controlla la console.");
      console.error(err);
    }
  };

  const handleQuickLogin = async (u) => {
    const permessi = await fetchPermessiRuolo(u.ruolo);
    setUser({ username: u.username, ruolo: u.ruolo, permessi });
    fetchModuliConfig();
  };

  const handleLogout = () => {
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

  if (!user) {
    return (
      <div className="login-container">
        <div className="login-card">
          <img src="/logo.png" alt="Logo Azienda" style={{ maxWidth: '140px', display: 'block', margin: '0 auto 15px auto' }} />
          <h2>Accesso Gestionale</h2>
          <form onSubmit={handleLogin}>
            <input type="text" placeholder="Username" value={loginUser} onChange={(e) => setLoginUser(e.target.value)} />
            <input type="password" placeholder="Password" value={loginPass} onChange={(e) => setLoginPass(e.target.value)} />
            <button type="submit">Accedi</button>
          </form>

          {import.meta.env.DEV && utentiDev.length > 0 && (
            <div style={{ marginTop: '20px', paddingTop: '15px', borderTop: '1px dashed #cbd5e1' }}>
              <p style={{ fontSize: '0.75rem', color: '#94a3b8', textAlign: 'center', margin: '0 0 8px 0' }}>🛠️ Accesso rapido (solo sviluppo locale, senza password)</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', justifyContent: 'center' }}>
                {utentiDev.map(u => (
                  <button key={u.username} type="button" onClick={() => handleQuickLogin(u)} style={{ padding: '6px 12px', fontSize: '0.8rem', background: '#e2e8f0', color: '#334155', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
                    {u.username} <span style={{ opacity: 0.6 }}>({u.ruolo})</span>
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
  const isAdmin = user.ruolo === "admin";
  const IMPOSTAZIONI_VOCE = { id: 'impostazioni', label: 'Impostazioni', icon: '🛠️' };
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
              <span className="sidebar-icona">{m.icon}</span> {m.label}
              {moduliConfig[m.id] && <span className="badge-sp">SP</span>}
            </button>
          ))}
          {isAdmin && (
            <>
              <div className="sidebar-separatore"></div>
              <button
                className={`sidebar-voce ${currentModule === 'impostazioni' ? 'active' : ''}`}
                onClick={() => cambiaModulo('impostazioni')}
              >
                <span className="sidebar-icona">{IMPOSTAZIONI_VOCE.icon}</span> {IMPOSTAZIONI_VOCE.label}
              </button>
            </>
          )}
        </nav>
      </aside>

      {/* --- TESTATA GLOBALE --- */}
      <header className="main-header no-print">
        <div className="header-brand" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button className="btn-hamburger" onClick={() => setSidebarAperta(true)} aria-label="Apri menu moduli">☰</button>
          <img src="/logo.png" alt="Logo" style={{ height: '45px', width: 'auto', objectFit: 'contain' }} />
          <div>
            <h1>{moduloCorrente?.icon} {moduloCorrente?.label}</h1>
            <p>Connesso come: <strong>{user.username}</strong></p>
          </div>
        </div>
        <div className="header-menu">
          <button className="btn-logout" onClick={handleLogout}>Esci</button>
        </div>
      </header>

      {/* --- MODULO ATTIVO --- */}
      {currentModule === "preventivatore" && <Preventivatore user={user} />}

      {currentModule === "voucher" && <Voucher user={user} />}

      {currentModule === "prenotazioni" && <Prenotazioni user={user} />}

      {currentModule === "costiricavi" && <CostiRicavi user={user} />}

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
