import { useState } from 'react'
import './App.css'
import { supabase } from './lib/supabaseClient';
import Preventivatore from './moduli/preventivatore/Preventivatore';

// --- ELENCO DEI MODULI DISPONIBILI ---
const MODULI = [
  { id: 'preventivatore', label: 'Preventivatore', icon: '🎈' },
  { id: 'voucher', label: 'Voucher', icon: '🎟️' },
];

function App() {
  // --- AUTENTICAZIONE ---
  const [user, setUser] = useState(null);
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");

  // --- NAVIGAZIONE TRA MODULI ---
  const [currentModule, setCurrentModule] = useState("preventivatore");
  const [sidebarAperta, setSidebarAperta] = useState(false);

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
        setUser({ username: data.username, ruolo: data.ruolo });
      } else {
        alert("Credenziali errate o utente non trovato!");
      }
    } catch (err) {
      alert("Errore di connessione al database. Controlla la console.");
      console.error(err);
    }
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
        </div>
      </div>
    );
  }

  const moduloCorrente = MODULI.find(m => m.id === currentModule);

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
          {MODULI.map(m => (
            <button
              key={m.id}
              className={`sidebar-voce ${currentModule === m.id ? 'active' : ''}`}
              onClick={() => cambiaModulo(m.id)}
            >
              <span className="sidebar-icona">{m.icon}</span> {m.label}
            </button>
          ))}
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

      {currentModule === "voucher" && (
        <div className="schermata-inserimento no-print" style={{ textAlign: 'center', padding: '50px 30px' }}>
          <h2>🎟️ Modulo Voucher</h2>
          <p className="descrizione-pagina">Questo modulo è in fase di sviluppo.</p>
        </div>
      )}
    </div>
  )
}

export default App
