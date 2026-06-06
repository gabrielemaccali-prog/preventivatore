import { useState, useEffect } from 'react'
import './App.css'
import html2pdf from 'html2pdf.js';
import * as XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';

// --- CONFIGURAZIONE SUPABASE ---
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// --- CONFIGURAZIONI INTERNE ---
const COSTO_AL_KM = 1.20;
const MOLTIPLICATORE_TARGET = 1.5;

function App() {
  // --- STATI DI AUTENTICAZIONE E NAVIGAZIONE ---
  const [user, setUser] = useState(null); 
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [currentView, setCurrentView] = useState("calculator"); 

  // --- STATI DEI DATI (ORA INIZIANO VUOTI, VERRANNO CARICATI DAL DB) ---
  const [sedi, setSedi] = useState([]);
  const [gonfiabili, setGonfiabili] = useState([]);
  const [extras, setExtras] = useState([]);
  const [preventiviSalvati, setPreventiviSalvati] = useState([]);
  
  const [nomeRiferimento, setNomeRiferimento] = useState("");
  const [indirizzoEmail, setIndirizzoEmail] = useState("");

  // --- STATI DEL FORM DI INSERIMENTO ---
  const [nuovaSede, setNuovaSede] = useState({ nome: "", lat: "", lon: "" });
  const [nuovoGonfiabile, setNuovoGonfiabile] = useState({ 
    nome: "", prezzo: "", locationId: "", giocatori: "", etaConsigliata: "", 
    dimensioni: "", superficie: "", alimentazione: "", tempoMontaggio: ""
  });
  const [nuovoExtra, setNuovoExtra] = useState({ nome: "", prezzo: "" });

  // --- STATI DI MODIFICA IN LINEA ---
  const [idSedeInModifica, setIdSedeInModifica] = useState(null);
  const [datiSedeInModifica, setDatiSedeInModifica] = useState({ nome: "", lat: "", lon: "" });
  const [idGonfiabileInModifica, setIdGonfiabileInModifica] = useState(null);
  const [datiGonfiabileInModifica, setDatiGonfiabileInModifica] = useState({ 
    nome: "", prezzo: "", locationId: "", giocatori: "", etaConsigliata: "", 
    dimensioni: "", superficie: "", alimentazione: "", tempoMontaggio: ""
  });
  const [idExtraInModifica, setIdExtraInModifica] = useState(null);
  const [datiExtraInModifica, setDatiExtraInModifica] = useState({ nome: "", prezzo: "" });

  // --- STATI DEL PREVENTIVATORE ---
  const [serviziSelezionati, setServiziSelezionati] = useState([]); 
  const [dataInizio, setDataInizio] = useState("");
  const [dataFine, setDataFine] = useState("");
  const [unSoloTrasporto, setUnSoloTrasporto] = useState(false);
  const [extraSelezionati, setExtraSelezionati] = useState([]);
  const [queryIndirizzo, setQueryIndirizzo] = useState("");
  const [risultatiRicerca, setRisultatiRicerca] = useState([]);
  const [destinazione, setDestinazione] = useState(null);
  const [loadingCalcolo, setLoadingCalcolo] = useState(false);
  const [soluzioniMigliori, setSoluzioniMigliori] = useState({}); 
  const [mostraPreventivo, setMostraPreventivo] = useState(false);
  const [notePreventivo, setNotePreventivo] = useState("");
  const [idPreventivo, setIdPreventivo] = useState({ codice: "", dettagliLogistici: null });

  // --- STATI PER LA PAGINA VENDITA ---
  const [venditaGonfiabili, setVenditaGonfiabili] = useState({}); 
  const [venditaExtras, setVenditaExtras] = useState({});           

  // --- STATI PER I FILTRI DELLO STORICO ---
  const [filtroId, setFiltroId] = useState("");
  const [filtroDestinazione, setFiltroDestinazione] = useState("");
  const [filtroStato, setFiltroStato] = useState("");
  const [filtroReferente, setFiltroReferente] = useState("");
  const [filtroEmail, setFiltroEmail] = useState("");

  // --- 🔄 CARICAMENTO DATI DA SUPABASE AL LOGIN ---
  useEffect(() => {
    if (user) {
      fetchData();
    }
  }, [user]);

  const fetchData = async () => {
    const { data: sediData } = await supabase.from('sedi').select('*');
    if (sediData) setSedi(sediData);

    const { data: gonfiabiliData } = await supabase.from('gonfiabili').select('*');
    if (gonfiabiliData) setGonfiabili(gonfiabiliData);

    const { data: extrasData } = await supabase.from('extras').select('*');
    if (extrasData) setExtras(extrasData);

    const { data: preventiviData } = await supabase.from('preventivi').select('*').order('codice', { ascending: false });
    if (preventiviData) {
      // Ricostruiamo la struttura per farla combaciare con il front-end
      const prevFormattati = preventiviData.map(p => ({
        id: { codice: p.codice, dettagliLogistici: p.dettagliLogistici },
        dataEmissione: p.dataEmissione,
        destinazione: p.destinazione,
        periodo: p.periodo,
        giorni: p.giorni,
        gonfiabili: p.gonfiabili,
        extras: p.extras,
        totaleVendita: parseFloat(p.totaleVendita),
        note: p.note,
        stato: p.stato,
        nomeReferente: p.nomeReferente,
        emailReferente: p.emailReferente,
        costoVivoTotale: parseFloat(p.costoVivoTotale)
      }));
      setPreventiviSalvati(prevFormattati);
    }
  };

  // Reset del Preventivo
  useEffect(() => {
    setIdPreventivo({ codice: "", dettagliLogistici: null });
  }, [serviziSelezionati, destinazione, dataInizio, dataFine, extraSelezionati]);

  // Generazione codice preventivo
  useEffect(() => {
    if (mostraPreventivo && !idPreventivo.codice) {
      const counterCorrente = parseInt(localStorage.getItem("counter_preventivi") || "1001");
      
      const datiLogistici = serviziSelezionati.map(nome => ({
        nome,
        kmAndata: soluzioniMigliori[nome]?.kmAndata,
        costoVivoTotale: soluzioniMigliori[nome]?.totaleOpzione
      }));

      setIdPreventivo({ 
        codice: `PRV-2026-${counterCorrente}`,
        dettagliLogistici: datiLogistici 
      });
      
      localStorage.setItem("counter_preventivi", (counterCorrente + 1).toString());
    }
  }, [mostraPreventivo, idPreventivo.codice]);

  const formattaDataIT = (dataStr) => {
    if (!dataStr) return "N/D";
    const opzioni = { year: 'numeric', month: '2-digit', day: '2-digit' };
    return new Date(dataStr).toLocaleDateString('it-IT', opzioni);
  };

  const calcolaGiorni = () => {
    if (!dataInizio || !dataFine) return 1;
    const inizio = new Date(dataInizio);
    const fine = new Date(dataFine);
    const diffTime = fine - inizio;
    return diffTime < 0 ? 1 : Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  };
  const giorniNoleggio = calcolaGiorni();

  const formattaIndirizzoPulito = (luogo) => {
    const addr = luogo.address || {};
    const via = addr.road || addr.pedestrian || addr.suburb || "";
    const civico = addr.house_number ? ` ${addr.house_number}` : "";
    const cap = addr.postcode ? `, CAP ${addr.postcode}` : "";
    const citta = addr.city || addr.town || addr.village || "";
    let prov = addr.county || "";
    prov = prov.replace("Provincia di ", "").replace("Città Metropolitana di ", "");
    return `${via}${civico}${cap}, ${citta}${prov ? ` (${prov})` : ""}`.trim().replace(/^,/, '').trim();
  };

  // --- LOGICA DI AUTENTICAZIONE ---
  const handleLogin = (e) => {
    e.preventDefault();
    if (loginUser === "admin" && loginPass === "admin") {
      setUser({ username: "Amministratore", ruolo: "admin" });
      setCurrentView("admin");
    } else if (loginUser === "utente" && loginPass === "utente") {
      setUser({ username: "Operatore", ruolo: "utente" });
      setCurrentView("calculator");
    } else {
      alert("Credenziali errate!");
    }
  };

  const handleLogout = () => {
    setUser(null);
    setLoginUser("");
    setLoginPass("");
    setServiziSelezionati([]);
    setDestinazione(null);
    setVenditaGonfiabili({});
    setVenditaExtras({});
    setCurrentView("calculator");
  };

  // --- CALCOLO PERCORSI STRADALI ---
  const ricalcolaTuttiIPercorsi = async (nomiScelti, dest) => {
    if (!dest || nomiScelti.length === 0) {
      setSoluzioniMigliori({});
      return;
    }
    setLoadingCalcolo(true);
    const nuoveSoluzioni = {};

    try {
      for (const nomeGonfiabile of nomiScelti) {
        const istanzeProdotto = gonfiabili.filter(g => g.nome === nomeGonfiabile);
        const calcoliIstanze = istanzeProdotto.map(async (istanza) => {
          const sedePartenza = sedi.find(s => s.id === istanza.locationId);
          if (!sedePartenza) return null;

          const url = `https://router.project-osrm.org/route/v1/driving/${sedePartenza.lon},${sedePartenza.lat};${dest.lon},${dest.lat}?overview=false`;
          const response = await fetch(url);
          const data = await response.json();

          if (data.code === "Ok") {
            const kmAndata = data.routes[0].distance / 1000;
            const moltiplicatoreTrasporto = unSoloTrasporto ? 1 : giorniNoleggio;
            const costoKmTotale = (kmAndata * 2) * COSTO_AL_KM * moltiplicatoreTrasporto;
            const costoBaseMoltiplicato = istanza.prezzo * giorniNoleggio;
            
            return {
              prodotto: istanza,
              partenza: sedePartenza,
              kmAndata: kmAndata,
              costoKmTotale: costoKmTotale,
              costoBaseMoltiplicato: costoBaseMoltiplicato,
              totaleOpzione: costoBaseMoltiplicato + costoKmTotale
            };
          }
          return null;
        });

        const risultati = await Promise.all(calcoliIstanze);
        const validi = risultati.filter(r => r !== null);

        if (validi.length > 0) {
          nuoveSoluzioni[nomeGonfiabile] = validi.reduce((min, curr) => curr.totaleOpzione < min.totaleOpzione ? curr : min);
        }
      }
      setSoluzioniMigliori(nuoveSoluzioni);
    } catch (error) {
      console.error(error);
    }
    setLoadingCalcolo(false);
  };

  useEffect(() => {
    if (destinazione) {
      ricalcolaTuttiIPercorsi(serviziSelezionati, destinazione);
    }
  }, [serviziSelezionati, giorniNoleggio, unSoloTrasporto, gonfiabili, sedi]);

  const cercaIndirizzo = async () => {
    if (!queryIndirizzo) return;
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${queryIndirizzo}&addressdetails=1&countrycodes=it&limit=5`);
      const data = await response.json();
      setRisultatiRicerca(data);
    } catch (error) {
      console.error(error);
    }
  };

  const selezionaIndirizzo = (luogo) => {
    const nuovaDest = { lat: luogo.lat, lon: luogo.lon, nome: formattaIndirizzoPulito(luogo) };
    setDestinazione(nuovaDest);
    setRisultatiRicerca([]);
    ricalcolaTuttiIPercorsi(serviziSelezionati, nuovaDest);
  };

  const aggiungiNomeGonfiabile = (nome) => {
    if (!nome) return;
    if (!serviziSelezionati.includes(nome)) {
      setServiziSelezionati(prev => [...prev, nome]);
    }
  };

  const rimuoviNomeGonfiabile = (nome) => {
    setServiziSelezionati(prev => prev.filter(n => n !== nome));
    setSoluzioniMigliori(prev => {
      const clone = { ...prev };
      delete clone[nome];
      return clone;
    });
    setVenditaGonfiabili(prev => {
      const clone = { ...prev };
      delete clone[nome];
      return clone;
    });
  };

  let totaleComplessivoCostiBase = 0;
  serviziSelezionati.forEach(nome => {
    if (soluzioniMigliori[nome]) totaleComplessivoCostiBase += soluzioniMigliori[nome].totaleOpzione;
  });
  const costoExtraBase = extras.filter(e => extraSelezionati.includes(e.id)).reduce((acc, curr) => acc + curr.prezzo, 0);
  const totaleComplessivoCostoFlotta = totaleComplessivoCostiBase + costoExtraBase;

  let totaleVenditaComplessivo = 0;
  serviziSelezionati.forEach(nome => {
    const cost = soluzioniMigliori[nome]?.totaleOpzione || 0;
    const vPrezzo = venditaGonfiabili[nome]?.prezzo !== undefined && venditaGonfiabili[nome]?.prezzo !== "" ? parseFloat(venditaGonfiabili[nome].prezzo) : cost;
    const vSconto = parseFloat(venditaGonfiabili[nome]?.sconto) || 0;
    totaleVenditaComplessivo += vPrezzo * (1 - vSconto / 100);
  });
  extras.filter(e => extraSelezionati.includes(e.id)).forEach(ex => {
    const cost = ex.prezzo;
    const vPrezzo = venditaExtras[ex.id]?.prezzo !== undefined && venditaExtras[ex.id]?.prezzo !== "" ? parseFloat(venditaExtras[ex.id].prezzo) : cost;
    const vSconto = parseFloat(venditaExtras[ex.id]?.sconto) || 0;
    totaleVenditaComplessivo += vPrezzo * (1 - vSconto / 100);
  });

  const differenzaCostoVivo = totaleVenditaComplessivo - totaleComplessivoCostoFlotta;
  const percentualeMargine = totaleComplessivoCostoFlotta > 0 ? (differenzaCostoVivo / totaleComplessivoCostoFlotta) * 100 : 0;
  const prezzoVenditaTarget = totaleComplessivoCostoFlotta * MOLTIPLICATORE_TARGET;

  const scaricaPreventivoPDF = () => {
    const element = document.getElementById('sezione-da-stampare');
    const opt = {
      margin: 10,
      filename: `${idPreventivo.codice}.pdf`, 
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };
    html2pdf().set(opt).from(element).save();
  };

  // --- LOGICA DI SALVATAGGIO PREVENTIVO (ORA SU SUPABASE) ---
  const handleStampaESalva = async () => {
    const dettagliGonfiabili = serviziSelezionati.map(nome => {
      const sol = soluzioniMigliori[nome];
      const costTotal = sol ? sol.totaleOpzione : 0;
      const vPrezzo = venditaGonfiabili[nome]?.prezzo !== undefined && venditaGonfiabili[nome]?.prezzo !== "" ? parseFloat(venditaGonfiabili[nome].prezzo) : costTotal;
      const vSconto = parseFloat(venditaGonfiabili[nome]?.sconto) || 0;
      
      return {
        nome, costoNoleggio: sol?.costoBaseMoltiplicato || 0,
        costoLogistica: sol?.costoKmTotale || 0, kmCalcolati: sol?.kmAndata || 0,
        prezzoVendita: vPrezzo * (1 - vSconto / 100)
      };
    });

    const dettagliExtra = extras.filter(e => extraSelezionati.includes(e.id)).map(e => {
      const costTotal = e.prezzo;
      const vPrezzo = venditaExtras[e.id]?.prezzo !== undefined && venditaExtras[e.id]?.prezzo !== "" ? parseFloat(venditaExtras[e.id].prezzo) : costTotal;
      const vSconto = parseFloat(venditaExtras[e.id]?.sconto) || 0;
      return { nome: e.nome, costo: e.prezzo, prezzoVendita: vPrezzo * (1 - vSconto / 100) };
    });

    const nuovoPreventivoDB = {
      codice: idPreventivo.codice,
      dataEmissione: new Date().toISOString(),
      destinazione: destinazione?.nome || "N/D",
      periodo: `Dal ${formattaDataIT(dataInizio)} al ${formattaDataIT(dataFine)}`,
      giorni: giorniNoleggio,
      gonfiabili: dettagliGonfiabili,
      extras: dettagliExtra,
      totaleVendita: totaleVenditaComplessivo,
      note: notePreventivo,
      stato: "Registrato",
      nomeReferente: nomeRiferimento, 
      emailReferente: indirizzoEmail, 
      costoVivoTotale: totaleComplessivoCostoFlotta, 
      dettagliLogistici: idPreventivo.dettagliLogistici 
    };

    // Salva in DB Supabase
    const { error } = await supabase.from('preventivi').upsert([nuovoPreventivoDB], { onConflict: 'codice' });
    if (error) {
      console.error("Errore salvataggio DB:", error);
      alert("Errore durante il salvataggio nel Database!");
    } else {
      // Aggiorna anche la lista UI locale
      fetchData();
      scaricaPreventivoPDF();
    }
  };

  const eliminaPreventivo = async (idPrev) => {
    if(window.confirm("Sei sicuro di voler eliminare questo preventivo dallo storico?")) {
      const { error } = await supabase.from('preventivi').delete().eq('codice', idPrev);
      if (!error) fetchData();
    }
  };

  const cambiaStatoPreventivo = async (idPrev, nuovoStato) => {
    const { error } = await supabase.from('preventivi').update({ stato: nuovoStato }).eq('codice', idPrev);
    if (!error) fetchData();
  };

  // --- FILTRAGGIO STORICO PREVENTIVI ---
  const preventiviFiltrati = preventiviSalvati.filter(p => {
    const idDaConfrontare = (typeof p.id === 'object' ? p.id.codice : p.id) || "";
    const matchId = idDaConfrontare.toLowerCase().includes(filtroId.toLowerCase());
    const matchDest = (p.destinazione?.toLowerCase() || "").includes(filtroDestinazione.toLowerCase());
    const matchStato = filtroStato === "" || (p.stato || "") === filtroStato;
    const matchReferente = (p.nomeReferente?.toLowerCase() || "").includes(filtroReferente.toLowerCase());
    const matchEmail = (p.emailReferente?.toLowerCase() || "").includes(filtroEmail.toLowerCase());
    return matchId && matchDest && matchStato && matchReferente && matchEmail;
  });

  // --- ESPORTAZIONE EXCEL ---
  const esportaExcel = () => {
    const datiPerExcel = preventiviFiltrati.map(item => ({
      Codice: typeof item.id === 'object' ? item.id.codice : item.id,
      DataEmissione: formattaDataIT(item.dataEmissione),
      Referente: item.nomeReferente || "",
      Email: item.emailReferente || "",
      Destinazione: item.destinazione,
      Periodo: item.periodo,
      TotaleVendita: item.totaleVendita.toFixed(2),
      CostoVivoTotale: (item.costoVivoTotale || 0).toFixed(2),
      Stato: item.stato
    }));
    const worksheet = XLSX.utils.json_to_sheet(datiPerExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Storico Preventivi");
    XLSX.writeFile(workbook, "Storico_Preventivi.xlsx");
  };

  // --- FUNZIONI PANEL ADMIN (CON DB SUPABASE) ---
  const addSede = async (e) => {
    e.preventDefault();
    if (!nuovaSede.nome || !nuovaSede.lat || !nuovaSede.lon) return alert("Compila tutti i campi");
    const newSede = { id: "loc_" + Date.now(), nome: nuovaSede.nome, lat: parseFloat(nuovaSede.lat), lon: parseFloat(nuovaSede.lon) };
    const { error } = await supabase.from('sedi').insert([newSede]);
    if (!error) { setNuovaSede({ nome: "", lat: "", lon: "" }); fetchData(); }
  };

  const addGonfiabile = async (e) => {
    e.preventDefault();
    if (!nuovoGonfiabile.nome || !nuovoGonfiabile.prezzo || !nuovoGonfiabile.locationId) return alert("Compila tutti i campi principali");
    const newG = { 
      id: "g_" + Date.now(), nome: nuovoGonfiabile.nome, prezzo: parseFloat(nuovoGonfiabile.prezzo), locationId: nuovoGonfiabile.locationId,
      giocatori: nuovoGonfiabile.giocatori, etaConsigliata: nuovoGonfiabile.etaConsigliata, dimensioni: nuovoGonfiabile.dimensioni,
      superficie: nuovoGonfiabile.superficie, alimentazione: nuovoGonfiabile.alimentazione, tempoMontaggio: nuovoGonfiabile.tempoMontaggio
    };
    const { error } = await supabase.from('gonfiabili').insert([newG]);
    if (!error) { 
      setNuovoGonfiabile({ nome: "", prezzo: "", locationId: "", giocatori: "", etaConsigliata: "", dimensioni: "", superficie: "", alimentazione: "", tempoMontaggio: "" });
      fetchData(); 
    }
  };

  const addExtra = async (e) => {
    e.preventDefault();
    if (!nuovoExtra.nome || !nuovoExtra.prezzo) return alert("Compila tutti i campi");
    const newE = { id: "e_" + Date.now(), nome: nuovoExtra.nome, prezzo: parseFloat(nuovoExtra.prezzo) };
    const { error } = await supabase.from('extras').insert([newE]);
    if (!error) { setNuovoExtra({ nome: "", prezzo: "" }); fetchData(); }
  };

  const salvaModificaSede = async () => {
    await supabase.from('sedi').update({ nome: datiSedeInModifica.nome, lat: parseFloat(datiSedeInModifica.lat), lon: parseFloat(datiSedeInModifica.lon) }).eq('id', idSedeInModifica);
    setIdSedeInModifica(null); fetchData();
  };

  const salvaModificaGonfiabile = async () => {
    await supabase.from('gonfiabili').update({ 
      nome: datiGonfiabileInModifica.nome, prezzo: parseFloat(datiGonfiabileInModifica.prezzo), locationId: datiGonfiabileInModifica.locationId,
      giocatori: datiGonfiabileInModifica.giocatori, etaConsigliata: datiGonfiabileInModifica.etaConsigliata, dimensioni: datiGonfiabileInModifica.dimensioni,
      superficie: datiGonfiabileInModifica.superficie, alimentazione: datiGonfiabileInModifica.alimentazione, tempoMontaggio: datiGonfiabileInModifica.tempoMontaggio
    }).eq('id', idGonfiabileInModifica);
    setIdGonfiabileInModifica(null); fetchData();
  };

  const salvaModificaExtra = async () => {
    await supabase.from('extras').update({ nome: datiExtraInModifica.nome, prezzo: parseFloat(datiExtraInModifica.prezzo) }).eq('id', idExtraInModifica);
    setIdExtraInModifica(null); fetchData();
  };

  const rimuoviSede = async (id) => { await supabase.from('sedi').delete().eq('id', id); fetchData(); };
  const rimuoviGonfiabile = async (id) => { await supabase.from('gonfiabili').delete().eq('id', id); fetchData(); };
  const rimuoviExtra = async (id) => { await supabase.from('extras').delete().eq('id', id); fetchData(); };

  const nomiUniciGonfiabili = Array.from(new Set(gonfiabili.map(g => g.nome)));
  const gonfiabiliDisponibiliInDropdown = nomiUniciGonfiabili.filter(nome => !serviziSelezionati.includes(nome));

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

  return (
    <div className="app-container">
      <header className="main-header no-print">
        <div className="header-brand" style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <img src="/logo.png" alt="Logo" style={{ height: '45px', width: 'auto', objectFit: 'contain' }} />
          <div>
            <h1>LogiGonfiabili v2.6</h1>
            <p>Connesso come: <strong>{user.username}</strong></p>
          </div>
        </div>
        <div className="header-menu">
          {user.ruolo === "admin" && (
            <button className={`nav-btn ${currentView === 'admin' ? 'active' : ''}`} onClick={() => setCurrentView("admin")}>⚙️ Configurazione</button>
          )}
          <button className={`nav-btn ${currentView === 'calculator' ? 'active' : ''}`} onClick={() => setCurrentView("calculator")}>📋 Preventivatore</button>
          {user.ruolo === "admin" && (
            <button className={`nav-btn ${currentView === 'sales' ? 'active' : ''}`} onClick={() => setCurrentView("sales")}>💰 Vendita</button>
          )}
          {user.ruolo === "admin" && (
            <button className={`nav-btn ${currentView === 'storico' ? 'active' : ''}`} onClick={() => setCurrentView("storico")}>🗂️ Storico Preventivi</button>
          )}
          <button className="btn-logout" onClick={handleLogout}>Esci</button>
        </div>
      </header>

      {/* VIEW: ADMIN */}
      {currentView === "admin" && user.ruolo === "admin" && (
        <div className="schermata-admin no-print" style={{ padding: '20px', fontFamily: 'inherit' }}>
          <h2>Pannello di Controllo Risorse ed Infrastruttura</h2>
          <hr style={{ border: 'none', borderTop: '1px solid #ddd', margin: '20px 0' }} />
          
          {/* 1. SEZIONE SEDE / MAGAZZINO */}
          <div className="admin-grid-sezione" style={{ marginBottom: '25px' }}>
            <div className="admin-form-box" style={{ background: '#f9f9f9', padding: '18px', borderRadius: '8px', border: '1px solid #e0e0e0' }}>
              <h3 style={{ margin: '0 0 15px 0', fontSize: '1.1rem', color: '#0288d1' }}>1. Aggiungi Sede / Magazzino</h3>
              <form onSubmit={addSede} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <input type="text" placeholder="Nome Sede" value={nuovaSede.nome} onChange={(e) => setNuovaSede({...nuovaSede, nome: e.target.value})} style={{ width: '100%', boxSizing: 'border-box', height: '36px', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px' }} />
                <input type="number" step="any" placeholder="Latitudine" value={nuovaSede.lat} onChange={(e) => setNuovaSede({...nuovaSede, lat: e.target.value})} style={{ width: '100%', boxSizing: 'border-box', height: '36px', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px' }} />
                <input type="number" step="any" placeholder="Longitudine" value={nuovaSede.lon} onChange={(e) => setNuovaSede({...nuovaSede, lon: e.target.value})} style={{ width: '100%', boxSizing: 'border-box', height: '36px', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px' }} />
                <button type="submit" style={{ padding: '9px 18px', background: '#0288d1', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem', marginTop: '5px' }}>Salva Sede</button>
              </form>
            </div>
            <div className="admin-table-box" style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                    <th style={{ padding: '10px 12px', color: '#444' }}>Nome Sede</th>
                    <th style={{ padding: '10px 12px', color: '#444' }}>Coordinate</th>
                    <th style={{ padding: '10px 12px', textAlign: 'center', color: '#444', width: '130px' }}>Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {sedi.map(s => (
                    <tr key={s.id} style={{ borderBottom: '1px solid #eee' }}>
                      {idSedeInModifica === s.id ? (
                        <>
                          <td style={{ padding: '10px 12px' }}><input type="text" className="table-input" value={datiSedeInModifica.nome} onChange={(e)=>setDatiSedeInModifica({...datiSedeInModifica, nome: e.target.value})} style={{ width: '100%', fontSize: '0.85rem', height: '30px' }} /></td>
                          <td style={{ padding: '10px 12px' }}>
                            <input type="number" step="any" className="table-input coord-input" value={datiSedeInModifica.lat} onChange={(e)=>setDatiSedeInModifica({...datiSedeInModifica, lat: e.target.value})} style={{ width: '48%', marginRight: '4%', fontSize: '0.85rem', height: '30px' }} />
                            <input type="number" step="any" className="table-input coord-input" value={datiSedeInModifica.lon} onChange={(e)=>setDatiSedeInModifica({...datiSedeInModifica, lon: e.target.value})} style={{ width: '48%', fontSize: '0.85rem', height: '30px' }} />
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                            <div style={{ display: 'flex', gap: '5px', justifyContent: 'center' }}>
                              <button className="btn-salva-inline" onClick={salvaModificaSede} style={{ fontSize: '0.8rem', padding: '4px 8px' }}>Salva</button>
                              <button className="btn-annulla-inline" onClick={() => setIdSedeInModifica(null)} style={{ fontSize: '0.8rem', padding: '4px 8px' }}>Annulla</button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>{s.nome}</td>
                          <td style={{ padding: '10px 12px', verticalAlign: 'middle', color: '#555' }}>{parseFloat(s.lat).toFixed(4)}, {parseFloat(s.lon).toFixed(4)}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'center', verticalAlign: 'middle' }}>
                            <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                              <button className="btn-modifica-inline" style={{ fontSize: '0.8rem', padding: '4px 8px' }} onClick={() => { setIdSedeInModifica(s.id); setDatiSedeInModifica({ nome: s.nome, lat: s.lat, lon: s.lon }); }}>Modifica</button>
                              <button className="btn-rimuovi" style={{ fontSize: '0.8rem', padding: '4px 8px' }} onClick={() => rimuoviSede(s.id)}>Elimina</button>
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid #e0e0e0', margin: '25px 0' }} />

          {/* 2. SEZIONE GONFIABILI */}
          <div className="admin-sezione-fullwidth" style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div className="admin-form-box-top" style={{ background: '#f9f9f9', padding: '18px', borderRadius: '8px', border: '1px solid #e0e0e0' }}>
              <h3 style={{ margin: '0 0 15px 0', fontSize: '1.1rem' , color: '#0288d1' }}>2. Aggiungi Nuovo Gonfiabile</h3>
              <form onSubmit={addGonfiabile}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '15px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'end' }}>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '4px', color: '#555' }}>Nome Modello</label>
                    <input type="text" placeholder="Es. Scivolo Titanic" value={nuovoGonfiabile.nome} onChange={(e) => setNuovoGonfiabile({...nuovoGonfiabile, nome: e.target.value})} style={{ width: '100%', boxSizing: 'border-box', height: '36px', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px', margin: '0' }} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'end' }}>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '4px', color: '#555' }}>Prezzo (€)</label>
                    <input type="number" step="any" placeholder="Es. 350.00" value={nuovoGonfiabile.prezzo} onChange={(e) => setNuovoGonfiabile({...nuovoGonfiabile, prezzo: e.target.value})} style={{ width: '100%', boxSizing: 'border-box', height: '36px', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px', margin: '0' }} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'end' }}>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '4px', color: '#555' }}>Ubicazione / Sede</label>
                    <select value={nuovoGonfiabile.locationId} onChange={(e) => setNuovoGonfiabile({...nuovoGonfiabile, locationId: e.target.value})} style={{ width: '100%', boxSizing: 'border-box', height: '36px', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px', margin: '0' }}>
                      <option value="">-- Seleziona Sede --</option>
                      {sedi.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
                    </select>
                  </div>
                </div>

                <p style={{ margin: '0 0 8px 0', fontSize: '0.8rem', fontWeight: 'bold', color: '#0288d1' }}>Specifiche e Parametri Tecnici:</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px', marginBottom: '15px' }}>
                  <input type="text" placeholder="👥 Giocatori per partita" value={nuovoGonfiabile.giocatori} onChange={(e) => setNuovoGonfiabile({...nuovoGonfiabile, giocatori: e.target.value})} style={{ height: '36px', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box' }} />
                  <input type="text" placeholder="🎂 Età consigliata" value={nuovoGonfiabile.etaConsigliata} onChange={(e) => setNuovoGonfiabile({...nuovoGonfiabile, etaConsigliata: e.target.value})} style={{ height: '36px', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box' }} />
                  <input type="text" placeholder="📐 Dimensioni" value={nuovoGonfiabile.dimensioni} onChange={(e) => setNuovoGonfiabile({...nuovoGonfiabile, dimensioni: e.target.value})} style={{ height: '36px', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box' }} />
                  <input type="text" placeholder="🧱 Superficie di gioco" value={nuovoGonfiabile.superficie} onChange={(e) => setNuovoGonfiabile({...nuovoGonfiabile, superficie: e.target.value})} style={{ height: '36px', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box' }} />
                  <input type="text" placeholder="🔌 Alimentazione" value={nuovoGonfiabile.alimentazione} onChange={(e) => setNuovoGonfiabile({...nuovoGonfiabile, alimentazione: e.target.value})} style={{ height: '36px', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box' }} />
                  <input type="text" placeholder="⏱️ Tempo di montaggio" value={nuovoGonfiabile.tempoMontaggio} onChange={(e) => setNuovoGonfiabile({...nuovoGonfiabile, tempoMontaggio: e.target.value})} style={{ height: '36px', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box' }} />
                </div>
                
                <button type="submit" style={{ padding: '9px 18px', background: '#0288d1', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' }}>Salva Gonfiabile</button>
              </form>
            </div>

            <div className="admin-table-box-full" style={{ width: '100%', overflowX: 'auto', background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                    <th style={{ padding: '10px 12px', width: '22%', color: '#444' }}>Modello / Prezzo</th>
                    <th style={{ padding: '10px 12px', width: '15%', color: '#444' }}>Ubicazione</th>
                    <th style={{ padding: '10px 12px', width: '50%', color: '#444' }}>Specifiche Tecniche</th>
                    <th style={{ padding: '10px 12px', width: '13%', textAlign: 'center', color: '#444' }}>Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {gonfiabili.map(g => {
                    const sd = sedi.find(s => s.id === g.locationId);
                    return (
                      <tr key={g.id} style={{ borderBottom: '1px solid #eee' }}>
                        {idGonfiabileInModifica === g.id ? (
                          <>
                            <td style={{ padding: '10px 12px' }}>
                              <input type="text" className="table-input" value={datiGonfiabileInModifica.nome} onChange={(e)=>setDatiGonfiabileInModifica({...datiGonfiabileInModifica, nome: e.target.value})} style={{ marginBottom: '6px', width: '100%', fontSize: '0.85rem', height: '30px' }} />
                              <input type="number" step="any" className="table-input" value={datiGonfiabileInModifica.prezzo} onChange={(e)=>setDatiGonfiabileInModifica({...datiGonfiabileInModifica, prezzo: e.target.value})} style={{ width: '100%', fontSize: '0.85rem', height: '30px' }} />
                            </td>
                            <td style={{ padding: '10px 12px' }}>
                              <select className="table-input" value={datiGonfiabileInModifica.locationId} onChange={(e)=>setDatiGonfiabileInModifica({...datiGonfiabileInModifica, locationId: e.target.value})} style={{ width: '100%', height: '32px', fontSize: '0.85rem' }}>
                                {sedi.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
                              </select>
                            </td>
                            <td style={{ padding: '10px 12px' }}>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                                <input type="text" placeholder="👥 Giocatori" className="table-input" value={datiGonfiabileInModifica.giocatori} onChange={(e)=>setDatiGonfiabileInModifica({...datiGonfiabileInModifica, giocatori: e.target.value})} style={{ fontSize: '0.8rem', height: '28px' }} />
                                <input type="text" placeholder="🎂 Età" className="table-input" value={datiGonfiabileInModifica.etaConsigliata} onChange={(e)=>setDatiGonfiabileInModifica({...datiGonfiabileInModifica, etaConsigliata: e.target.value})} style={{ fontSize: '0.8rem', height: '28px' }} />
                                <input type="text" placeholder="📐 Dimensioni" className="table-input" value={datiGonfiabileInModifica.dimensioni} onChange={(e)=>setDatiGonfiabileInModifica({...datiGonfiabileInModifica, dimensioni: e.target.value})} style={{ fontSize: '0.8rem', height: '28px' }} />
                                <input type="text" placeholder="🧱 Superficie" className="table-input" value={datiGonfiabileInModifica.superficie} onChange={(e)=>setDatiGonfiabileInModifica({...datiGonfiabileInModifica, superficie: e.target.value})} style={{ fontSize: '0.8rem', height: '28px' }} />
                                <input type="text" placeholder="🔌 Alimentazione" className="table-input" value={datiGonfiabileInModifica.alimentazione} onChange={(e)=>setDatiGonfiabileInModifica({...datiGonfiabileInModifica, alimentazione: e.target.value})} style={{ fontSize: '0.8rem', height: '28px' }} />
                                <input type="text" placeholder="⏱️ Montaggio" className="table-input" value={datiGonfiabileInModifica.tempoMontaggio} onChange={(e)=>setDatiGonfiabileInModifica({...datiGonfiabileInModifica, tempoMontaggio: e.target.value})} style={{ fontSize: '0.8rem', height: '28px' }} />
                              </div>
                            </td>
                            <td style={{ padding: '10px 12px', textAlign: 'center', verticalAlign: 'middle' }}>
                              <div style={{ display: 'flex', gap: '5px', justifyContent: 'center' }}>
                                <button className="btn-salva-inline" onClick={salvaModificaGonfiabile} style={{ fontSize: '0.8rem', padding: '4px 8px' }}>Salva</button>
                                <button className="btn-annulla-inline" onClick={() => setIdGonfiabileInModifica(null)} style={{ fontSize: '0.8rem', padding: '4px 8px' }}>Annulla</button>
                              </div>
                            </td>
                          </>
                        ) : (
                          <>
                            <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>
                              <span style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#111' }}>{g.nome}</span><br />
                              <span style={{ color: '#2e7d32', fontSize: '0.85rem' }}>€{parseFloat(g.prezzo).toFixed(2)}</span>
                            </td>
                            <td style={{ padding: '10px 12px', verticalAlign: 'middle', color: '#555', fontSize: '0.85rem' }}>
                              {sd ? sd.nome : <em style={{ color: '#999' }}>Non assegnata</em>}
                            </td>
                            <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 10px', fontSize: '0.75rem', color: '#555' }}>
                                <div style={{ background: '#f5f5f5', padding: '3px 6px', borderRadius: '4px', whiteSpace: 'nowrap' }}>👥 Giocatori: {g.giocatori || '-'}</div>
                                <div style={{ background: '#f5f5f5', padding: '3px 6px', borderRadius: '4px', whiteSpace: 'nowrap' }}>🎂 Età: {g.etaConsigliata || '-'}</div>
                                <div style={{ background: '#f5f5f5', padding: '3px 6px', borderRadius: '4px', whiteSpace: 'nowrap' }}>📐 Dim: {g.dimensioni || '-'}</div>
                                <div style={{ background: '#f5f5f5', padding: '3px 6px', borderRadius: '4px', whiteSpace: 'nowrap' }}>🧱 Sup: {g.superficie || '-'}</div>
                                <div style={{ background: '#f5f5f5', padding: '3px 6px', borderRadius: '4px', whiteSpace: 'nowrap' }}>🔌 Alim: {g.alimentazione || '-'}</div>
                                <div style={{ background: '#f5f5f5', padding: '3px 6px', borderRadius: '4px', whiteSpace: 'nowrap' }}>⏱️ Montaggio: {g.tempoMontaggio || '-'}</div>
                              </div>
                            </td>
                            <td style={{ padding: '10px 12px', textAlign: 'center', verticalAlign: 'middle' }}>
                              <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                                <button className="btn-modifica-inline" style={{ fontSize: '0.8rem', padding: '4px 8px' }} onClick={() => { 
                                  setIdGonfiabileInModifica(g.id); 
                                  setDatiGonfiabileInModifica({ 
                                    nome: g.nome, prezzo: g.prezzo, locationId: g.locationId, giocatori: g.giocatori || "",
                                    etaConsigliata: g.etaConsigliata || "", dimensioni: g.dimensioni || "", superficie: g.superficie || "",
                                    alimentazione: g.alimentazione || "", tempoMontaggio: g.tempoMontaggio || ""
                                  }); 
                                }}>Modifica</button>
                                <button className="btn-rimuovi" style={{ fontSize: '0.8rem', padding: '4px 8px' }} onClick={() => rimuoviGonfiabile(g.id)}>Elimina</button>
                              </div>
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid #e0e0e0', margin: '25px 0' }} />

          {/* 3. SEZIONE SERVIZI EXTRA */}
          <div className="admin-grid-sezione">
            <div className="admin-form-box" style={{ background: '#f9f9f9', padding: '18px', borderRadius: '8px', border: '1px solid #e0e0e0' }}>
              <h3 style={{ margin: '0 0 15px 0', fontSize: '1.1rem', color: '#0288d1' }}>3. Configura Servizio Extra</h3>
              <form onSubmit={addExtra} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <input type="text" placeholder="Nome Servizio" value={nuovoExtra.nome} onChange={(e) => setNuovoExtra({...nuovoExtra, nome: e.target.value})} style={{ width: '100%', boxSizing: 'border-box', height: '36px', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px' }} />
                <input type="number" step="any" placeholder="Prezzo (€)" value={nuovoExtra.prezzo} onChange={(e) => setNuovoExtra({...nuovoExtra, prezzo: e.target.value})} style={{ width: '100%', boxSizing: 'border-box', height: '36px', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px' }} />
                <button type="submit" style={{ padding: '9px 18px', background: '#0288d1', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem', marginTop: '5px' }}>Salva Extra</button>
              </form>
            </div>
            <div className="admin-table-box" style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                    <th style={{ padding: '10px 12px', color: '#444' }}>Servizio Extra</th>
                    <th style={{ padding: '10px 12px', color: '#444' }}>Prezzo</th>
                    <th style={{ padding: '10px 12px', textAlign: 'center', color: '#444', width: '130px' }}>Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {extras.map(e => (
                    <tr key={e.id} style={{ borderBottom: '1px solid #eee' }}>
                      {idExtraInModifica === e.id ? (
                        <>
                          <td style={{ padding: '10px 12px' }}><input type="text" className="table-input" value={datiExtraInModifica.nome} onChange={(e)=>setDatiExtraInModifica({...datiExtraInModifica, nome: e.target.value})} style={{ width: '100%', fontSize: '0.85rem', height: '30px' }} /></td>
                          <td style={{ padding: '10px 12px' }}><input type="number" step="any" className="table-input" value={datiExtraInModifica.prezzo} onChange={(e)=>setDatiExtraInModifica({...datiExtraInModifica, prezzo: e.target.value})} style={{ width: '100%', fontSize: '0.85rem', height: '30px' }} /></td>
                          <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                            <div style={{ display: 'flex', gap: '5px', justifyContent: 'center' }}>
                              <button className="btn-salva-inline" onClick={salvaModificaExtra} style={{ fontSize: '0.8rem', padding: '4px 8px' }}>Salva</button>
                              <button className="btn-annulla-inline" onClick={() => setIdExtraInModifica(null)} style={{ fontSize: '0.8rem', padding: '4px 8px' }}>Annulla</button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>{e.nome}</td>
                          <td style={{ padding: '10px 12px', verticalAlign: 'middle', color: '#2e7d32' }}>€{parseFloat(e.prezzo).toFixed(2)}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'center', verticalAlign: 'middle' }}>
                            <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                              <button className="btn-modifica-inline" style={{ fontSize: '0.8rem', padding: '4px 8px' }} onClick={() => { setIdExtraInModifica(e.id); setDatiExtraInModifica({ nome: e.nome, prezzo: e.prezzo }); }}>Modifica</button>
                              <button className="btn-rimuovi" style={{ fontSize: '0.8rem', padding: '4px 8px' }} onClick={() => rimuoviExtra(e.id)}>Elimina</button>
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* VIEW: PREVENTIVATORE */}
      {currentView === "calculator" && (
        <div className="schermata-inserimento no-print">
          <h2>Modulo Calcolo Preventivi</h2>
          <div className="sezione">
            <h2>1. Date del Noleggio & Logistica</h2>
            <div className="date-grid">
              <label>Inizio: <input type="date" value={dataInizio} onChange={(e) => setDataInizio(e.target.value)} /></label>
              <label>Fine: <input type="date" value={dataFine} onChange={(e) => setDataFine(e.target.value)} /></label>
            </div>
            <p className="info-giorni">Durata: <strong>{giorniNoleggio} {giorniNoleggio === 1 ? 'giorno' : 'giorni'}</strong></p>
            <label className="checkbox-logistica">
              <input type="checkbox" checked={unSoloTrasporto} onChange={(e) => setUnSoloTrasporto(e.target.checked)} />
              <strong>Abilita "1 Solo Trasporto A/R"</strong>
            </label>
          </div>

          <div className="sezione">
            <h2>2. Seleziona Strutture Gonfiabili</h2>
            <select value="" onChange={(e) => aggiungiNomeGonfiabile(e.target.value)} className="dropdown-gonfiabili">
              <option value="">-- Seleziona modello --</option>
              {gonfiabiliDisponibiliInDropdown.map(nome => <option key={nome} value={nome}>{nome}</option>)}
            </select>
            {serviziSelezionati.length > 0 && (
              <div className="lista-scelti-container">
                <ul className="lista-scelti">
                  {serviziSelezionati.map(nome => (
                    <li key={nome} className="item-scelto">
                      <span>🎈 {nome}</span>
                      <button className="btn-rimuovi" onClick={() => rimuoviNomeGonfiabile(nome)}>Rimuovi</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="sezione">
            <h2>3. Luogo di Consegna</h2>
            <div className="ricerca-box">
              <input type="text" placeholder="Scrivi Indirizzo..." value={queryIndirizzo} onChange={(e) => setQueryIndirizzo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && cercaIndirizzo()} />
              <button onClick={cercaIndirizzo}>Cerca</button>
            </div>
            {risultatiRicerca.length > 0 && (
              <ul className="risultati-ricerca">
                {risultatiRicerca.map(luogo => (
                  <li key={luogo.place_id} onClick={() => selezionaIndirizzo(luogo)}>{formattaIndirizzoPulito(luogo)}</li>
                ))}
              </ul>
            )}
            {loadingCalcolo && <p className="loading">Calcolo in corso...</p>}
            {destinazione && !loadingCalcolo && <div className="info-percorso-riepilogo"><p>📍 Destinazione: {destinazione.nome}</p></div>}
          </div>

          <div className="sezione">
            <h2>4. Servizi Accessori Opzionali</h2>
            <div className="extra-grid">
              {extras.map(srv => (
                <label key={srv.id} className="extra-label">
                  <input type="checkbox" checked={extraSelezionati.includes(srv.id)} onChange={() => setExtraSelezionati(prev => prev.includes(srv.id) ? prev.filter(x=>x!==srv.id) : [...prev, srv.id])} />
                  {srv.nome} (+€{parseFloat(srv.prezzo).toFixed(2)})
                </label>
              ))}
            </div>
          </div>

          <div className="riepilogo">
            <h2>Dettaglio Analitico dei Costi</h2>
            <div className="blocco-dettaglio-calcolo">
              {serviziSelezionati.map(nome => {
                const sol = soluzioniMigliori[nome];
                return (
                  <div key={nome} className="scheda-riepilogo-prodotto">
                    <h4>{nome}</h4>
                    {sol ? (
                      <div className="voci-prezzo">
                        <p>Magazzino: <em>{sol.partenza.nome}</em></p>
                        <p>• Noleggio: <span>€{sol.costoBaseMoltiplicato.toFixed(2)}</span></p>
                        <p>• Logistica: ({sol.kmAndata.toFixed(1)} km):<span>€{sol.costoKmTotale.toFixed(2)}</span></p>
                        <p className="subtotale-prodotto">Subtotale: <strong>€{sol.totaleOpzione.toFixed(2)}</strong></p>
                      </div>
                    ) : <p className="avviso-calcolo">Inserisci la destinazione per calcolare i costi.</p>}
                  </div>
                );
              })}
              {extraSelezionati.length > 0 && (
                <div className="scheda-riepilogo-prodotto extra-box-dettaglio">
                  <h4>Accessori</h4>
                  {extras.filter(e => extraSelezionati.includes(e.id)).map(e => (
                    <p key={e.id}>• {e.nome}: <span>€{parseFloat(e.prezzo).toFixed(2)}</span></p>
                  ))}
                  <p className="subtotale-prodotto">Subtotale Extra: <strong>€{costoExtraBase.toFixed(2)}</strong></p>
                </div>
              )}
            </div>
            <div className="totale-box-finale">
              <h3>TOTALE COSTI STIMATO: <span>€{totaleComplessivoCostoFlotta.toFixed(2)}</span></h3>
            </div>

            {user.ruolo === "admin" && (
              <button className="btn-preventivo" onClick={() => setCurrentView("sales")}>➡️ Procedi alla Vendita</button>
            )}
          </div>
        </div>
      )}

      {/* VIEW: PAGINA VENDITA */}
      {currentView === "sales" && user.ruolo === "admin" && (
        <div className="schermata-vendita no-print">
          {(serviziSelezionati.length === 0 || !destinazione) ? (
            <div style={{ padding: '35px', textAlign: 'center', backgroundColor: '#fff3cd', color: '#856404', borderRadius: '8px', border: '1px solid #ffeeba', margin: '20px 0' }}>
              <h3>⚠️ Azione non consentita</h3>
              <p>Per poter configurare i prezzi finali di vendita, è necessario prima completare l'elaborazione del calcolo logistico. Torna alla schermata precedente ed inserisci almeno un gonfiabile ed il luogo di consegna.</p>
              <button className="btn-chiudi" style={{ marginTop: '15px', float: 'none', display: 'inline-block' }} onClick={() => setCurrentView("calculator")}>Ritorna al Preventivatore</button>
            </div>
          ) : (
            <>
              <h2>Pannello Definizione Prezzi di Vendita</h2>
              <p className="descrizione-pagina">Assegna i valori commerciali definitivi. I prezzi inseriti devono essere superiori rispetto ai costi vivi stimati.</p>

              <div className="blocco-vendita-articoli">
                {serviziSelezionati.map(nome => {
                  const sol = soluzioniMigliori[nome];
                  const costoCalcolato = sol ? sol.totaleOpzione : 0;
                  const currentPrezzo = venditaGonfiabili[nome]?.prezzo ?? "";
                  const currentSconto = venditaGonfiabili[nome]?.sconto ?? "0";
                  
                  const prezzoEffettivo = currentPrezzo !== "" ? parseFloat(currentPrezzo) : costoCalcolato;
                  const prezzoScontato = prezzoEffettivo * (1 - (parseFloat(currentSconto) || 0) / 100);
                  const isUnderCost = currentPrezzo !== "" && parseFloat(currentPrezzo) < costoCalcolato;

                  return (
                    <div key={nome} className="scheda-vendita-prodotto">
                      <div className="vendita-info-prodotto">
                        <h4>🎈 {nome}</h4>
                        <p>Costo Vivo di Base: <strong className="testo-costo-base">€{costoCalcolato.toFixed(2)}</strong></p>
                      </div>
                      <div className="vendita-inputs-prodotto">
                        <label>
                          Prezzo Vendita (€):
                          <input 
                            type="number" 
                            placeholder={costoCalcolato.toFixed(2)} 
                            value={currentPrezzo}
                            className={isUnderCost ? "input-vendita error" : "input-vendita"}
                            onChange={(e) => setVenditaGonfiabili(prev => ({ ...prev, [nome]: { ...prev[nome], prezzo: e.target.value } }))}
                          />
                        </label>
                        <label>
                          Sconto (%):
                          <input 
                            type="number" 
                            min="0" max="100" 
                            value={currentSconto}
                            className="input-vendita"
                            onChange={(e) => setVenditaGonfiabili(prev => ({ ...prev, [nome]: { ...prev[nome], sconto: e.target.value } }))}
                          />
                        </label>
                        <div className="vendita-prezzo-finale">
                          <p>Prezzo Finale:</p>
                          <h3>€{prezzoScontato.toFixed(2)}</h3>
                          {isUnderCost && <span className="warning-testo">Sotto costo!</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {extras.filter(ex => extraSelezionati.includes(ex.id)).map(ex => {
                  const costoCalcolato = parseFloat(ex.prezzo);
                  const currentPrezzo = venditaExtras[ex.id]?.prezzo ?? "";
                  const currentSconto = venditaExtras[ex.id]?.sconto ?? "0";
                  
                  const prezzoEffettivo = currentPrezzo !== "" ? parseFloat(currentPrezzo) : costoCalcolato;
                  const prezzoScontato = prezzoEffettivo * (1 - (parseFloat(currentSconto) || 0) / 100);
                  const isUnderCost = currentPrezzo !== "" && parseFloat(currentPrezzo) < costoCalcolato;

                  return (
                    <div key={ex.id} className="scheda-vendita-prodotto extra-box-vendita">
                      <div className="vendita-info-prodotto">
                        <h4>⚙️ {ex.nome} (Servizio Extra)</h4>
                        <p>Costo Vivo di Base: <strong className="testo-costo-base">€{costoCalcolato.toFixed(2)}</strong></p>
                      </div>
                      <div className="vendita-inputs-prodotto">
                        <label>
                          Prezzo Vendita (€):
                          <input 
                            type="number" 
                            placeholder={costoCalcolato.toFixed(2)} 
                            value={currentPrezzo}
                            className={isUnderCost ? "input-vendita error" : "input-vendita"}
                            onChange={(evt) => setVenditaExtras(prev => ({ ...prev, [ex.id]: { ...prev[ex.id], prezzo: evt.target.value } }))}
                          />
                        </label>
                        <label>
                          Sconto (%):
                          <input 
                            type="number" 
                            min="0" max="100" 
                            value={currentSconto}
                            className="input-vendita"
                            onChange={(evt) => setVenditaExtras(prev => ({ ...prev, [ex.id]: { ...prev[ex.id], sconto: evt.target.value } }))}
                          />
                        </label>
                        <div className="vendita-prezzo-finale">
                          <p>Prezzo Finale:</p>
                          <h3>€{prezzoScontato.toFixed(2)}</h3>
                          {isUnderCost && <span className="warning-testo">Sotto costo!</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="totale-box-vendita-finale">
                <h3>TOTALE COMMERCIALE DI VENDITA: <span>€{totaleVenditaComplessivo.toFixed(2)}</span></h3>
              </div>

              <div style={{ textAlign: 'right', margin: '5px 0', padding: '10px 20px', background: '#e3f2fd', borderRadius: '6px', borderRight: '5px solid #1976d2' }}>
                <p style={{ margin: 0, fontSize: '1.05rem', color: '#1565c0' }}>
                  Prezzo di Vendita Target : <strong>€{prezzoVenditaTarget.toFixed(2)}</strong>
                </p>
              </div>

              <div className="margine-box-riepilogo" style={{ textAlign: 'right', margin: '15px 0', padding: '10px 20px', background: '#f9f9f9', borderRadius: '6px', borderRight: '5px solid #2e7d32' }}>
                <p style={{ margin: 0, fontSize: '1.05rem', color: '#555' }}>
                  Differenza / Margine ({totaleComplessivoCostoFlotta.toFixed(2)} €): <strong style={{ color: differenzaCostoVivo >= 0 ? '#2e7d32' : '#c62828', fontSize: '1.2rem' }}>
                    {differenzaCostoVivo >= 0 ? '+' : ''}{differenzaCostoVivo.toFixed(2)} € ({percentualeMargine.toFixed(1)}%)
                  </strong>
                </p>
              </div>

              <button className="btn-preventivo" onClick={() => setMostraPreventivo(true)}>📋 Elabora Documento di Offerta</button>
            </>
          )}
        </div>
      )}

      {/* VIEW: STORICO PREVENTIVI */}
      {currentView === "storico" && user.ruolo === "admin" && (
        <div className="schermata-storico no-print">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2>🗂️ Database Storico Preventivi</h2>
            <button onClick={esportaExcel} style={{ padding: '8px 16px', backgroundColor: '#10b981', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
              📊 Esporta Excel
            </button>
          </div>
          <p className="descrizione-pagina">Consulta, filtra e gestisci lo stato dei preventivi emessi.</p>
          
          <div className="filtri-storico" style={{ display: 'flex', flexWrap: 'wrap', gap: '15px' }}>
            <div className="filtro-group" style={{ flex: '1 1 180px' }}>
              <label>Cerca per ID:</label>
              <input type="text" placeholder="Es. PRV-2026-1001" value={filtroId} onChange={(e) => setFiltroId(e.target.value)} />
            </div>
            <div className="filtro-group" style={{ flex: '1 1 180px' }}>
              <label>Filtra per Referente:</label>
              <input type="text" placeholder="Nome referente" value={filtroReferente} onChange={(e) => setFiltroReferente(e.target.value)} />
            </div>
            <div className="filtro-group" style={{ flex: '1 1 180px' }}>
              <label>Filtra per Email:</label>
              <input type="text" placeholder="Indirizzo e-mail" value={filtroEmail} onChange={(e) => setFiltroEmail(e.target.value)} />
            </div>
            <div className="filtro-group" style={{ flex: '1 1 180px' }}>
              <label>Filtra per Destinazione:</label>
              <input type="text" placeholder="Es. Milano" value={filtroDestinazione} onChange={(e) => setFiltroDestinazione(e.target.value)} />
            </div>
            <div className="filtro-group" style={{ flex: '1 1 180px' }}>
              <label>Stato Documento:</label>
              <select value={filtroStato} onChange={(e) => setFiltroStato(e.target.value)}>
                <option value="">Tutti gli stati</option>
                <option value="Registrato">Registrato</option>
                <option value="Confermato">Confermato</option>
              </select>
            </div>
          </div>

          <div className="admin-table-box-full" style={{ marginTop: '20px' }}>
            <table className="storico-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem', background: '#fff' }}>
              <thead>
                <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                  <th style={{ padding: '12px', width: '15%' }}>ID / Data</th>
                  <th style={{ padding: '12px', width: '20%' }}>Destinazione e Contatti</th>
                  <th style={{ padding: '12px', width: '35%' }}>Dettaglio Articoli</th>
                  <th style={{ padding: '12px', width: '15%' }}>Importo / Stato</th>
                  <th style={{ padding: '12px', width: '15%', textAlign: 'center' }}>Azioni</th>
                </tr>
              </thead>
              <tbody>
                {preventiviFiltrati.length === 0 ? (
                  <tr><td colSpan="5" style={{ textAlign: 'center', padding: '20px', color: '#666' }}>Nessun preventivo trovato con i filtri attuali.</td></tr>
                ) : (
                  preventiviFiltrati.map((p, index) => (
                    <tr key={`${typeof p.id === 'object' ? p.id.codice : p.id}-${index}`} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '12px' }}>
                        <strong>{typeof p.id === 'object' ? p.id.codice : p.id}</strong><br/>
                        <span style={{ color: '#777', fontSize: '0.8rem' }}>{formattaDataIT(p.dataEmissione)}</span>
                      </td>
                      <td style={{ padding: '12px', color: '#444' }}>
                        📍 {p.destinazione} <br/>
                        <span style={{ fontSize: '0.75rem', color: '#888' }}>({p.periodo})</span><br/>
                        {p.nomeReferente && <span style={{ fontSize: '0.8rem', color: '#111' }}>👤 {p.nomeReferente}</span>}<br/>
                        {p.emailReferente && <span style={{ fontSize: '0.8rem', color: '#111' }}>📧 {p.emailReferente}</span>}
                      </td>
                      <td style={{ padding: '12px', fontSize: '0.8rem' }}>
                        <ul style={{ margin: 0, paddingLeft: '15px', color: '#555' }}>
                          {p.gonfiabili && p.gonfiabili.map((g, i) => (
                            <li key={i}><strong>{g.nome}</strong> (Vendita: €{g.prezzoVendita.toFixed(2)})</li>
                          ))}
                          {p.extras && p.extras.map((e, i) => (
                            <li key={`ex-${i}`}>⚙️ {e.nome} (Vendita: €{e.prezzoVendita.toFixed(2)})</li>
                          ))}
                        </ul>
                      </td>
                      <td style={{ padding: '12px' }}>
                        <strong style={{ fontSize: '1.05rem', color: '#111' }}>€{p.totaleVendita.toFixed(2)}</strong><br/>
                        <span className={`badge-stato ${(p.stato || "").toLowerCase()}`}>{p.stato}</span>
                      </td>
                      <td style={{ padding: '12px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', alignItems: 'center' }}>
                          {p.stato === "Registrato" && (
                            <button className="btn-conferma" onClick={() => cambiaStatoPreventivo(typeof p.id === 'object' ? p.id.codice : p.id, "Confermato")}>✔️ Conferma</button>
                          )}
                          {p.stato === "Confermato" && (
                            <button className="btn-ripristina" onClick={() => cambiaStatoPreventivo(typeof p.id === 'object' ? p.id.codice : p.id, "Registrato")}>↩️ Riporta Registrato</button>
                          )}
                          <button className="btn-elimina-prev" onClick={() => eliminaPreventivo(typeof p.id === 'object' ? p.id.codice : p.id)}>🗑️ Elimina</button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

     {/* MODALE DOCUMENTO PREVENTIVO SEMPLIFICATO (PDF) */}
      {mostraPreventivo && (
        <div className="modal-preventivo-backdrop">
          <div className="documento-preventivo">
            
            {/* ZONA CONTROLLI */}
            <div className="no-print azioni-preventivo" style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button className="btn-chiudi" onClick={() => setMostraPreventivo(false)}>← Modifica Prezzi</button>
                <button className="btn-stampa" onClick={handleStampaESalva}>🖨️ Salva in DB e Stampa PDF</button>
              </div>

              <div style={{ background: '#f0f4f8', padding: '12px', borderRadius: '6px', border: '1px solid #d9e2ec', textAlign: 'left', display: 'flex', gap: '15px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold', fontSize: '0.9rem', color: '#334e68' }}>Nome Referente:</label>
                  <input type="text" value={nomeRiferimento} onChange={(e) => setNomeRiferimento(e.target.value)} style={{ width: '100%', padding: '10px', boxSizing: 'border-box', borderRadius: '4px', border: '1px solid #bcccdc' }} placeholder="Mario Rossi" />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold', fontSize: '0.9rem', color: '#334e68' }}>Indirizzo E-mail:</label>
                  <input type="email" value={indirizzoEmail} onChange={(e) => setIndirizzoEmail(e.target.value)} style={{ width: '100%', padding: '10px', boxSizing: 'border-box', borderRadius: '4px', border: '1px solid #bcccdc' }} placeholder="email@esempio.com" />
                </div>
              </div>
              
              <div style={{ background: '#f0f4f8', padding: '12px', borderRadius: '6px', border: '1px solid #d9e2ec', textAlign: 'left' }}>
                <label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold', fontSize: '0.9rem', color: '#334e68' }}>Note Aggiuntive al Preventivo:</label>
                <textarea value={notePreventivo} onChange={(e) => setNotePreventivo(e.target.value)} rows="3" style={{ width: '100%', padding: '10px', boxSizing: 'border-box', borderRadius: '4px', border: '1px solid #bcccdc', resize: 'vertical', fontFamily: 'inherit', fontSize: '0.9rem' }} placeholder="Inserisci qui eventuali dettagli, sconti particolari o messaggi per il cliente..." />
              </div>
            </div>

            {/* ZONA DOCUMENTO PDF */}
            <div className="area-foglio" style={{ textAlign: 'left' }} id="sezione-da-stampare">
              
              <div className="header-preventivo" style={{ marginBottom: '25px', width: '100%', display: 'block' }}>
                <div style={{ float: 'left', width: '30%', textAlign: 'left' }}>
                  <img src="/logo.png" alt="Logo" style={{ maxWidth: '125px', height: 'auto' }} />
                </div>
                <div style={{ float: 'right', width: '70%', textAlign: 'right' }}>
                  <h1 style={{ margin: '0 0 20px 0', textAlign: 'right' }}>PREVENTIVO DI NOLEGGIO</h1>
                  <p style={{ margin: '2px 0', color: '#333' }}>Documento N°: <strong>{idPreventivo.codice}</strong></p>
                  
                  {nomeRiferimento && <p style={{ margin: '2px 0', color: '#333', fontSize: '0.95rem' }}>Alla cortese attenzione di: <strong>{nomeRiferimento}</strong></p>}
                  {indirizzoEmail && <p style={{ margin: '2px 0', color: '#333', fontSize: '0.95rem' }}>E-mail referente: <strong>{indirizzoEmail}</strong></p>}

                  <p style={{ margin: '2px 0', color: '#c62828', fontSize: '0.95rem' }}>
                    Validità offerta: <strong>10 giorni (scadenza: {new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toLocaleDateString('it-IT')})</strong>
                  </p>
                  <p style={{ margin: '2px 0', fontSize: '0.9rem', color: '#777' }}>Data Emissione: {new Date().toLocaleDateString('it-IT')}</p>
                </div>
                <div style={{ clear: 'both' }}></div>
              </div>

              <div className="dati-noleggio-preventivo" style={{ marginBottom: '15px', padding: '10px 0', borderBottom: '1px solid #eee', textAlign: 'left' }}>
                <p style={{ margin: '4px 0' }}><strong>Periodo di Riferimento:</strong> dal {formattaDataIT(dataInizio)} al {formattaDataIT(dataFine)} ({giorniNoleggio} gg)</p>
                <p style={{ margin: '4px 0' }}><strong>Luogo di Consegna:</strong> {destinazione?.nome}</p>
              </div>

              {notePreventivo && notePreventivo.trim() !== "" && (
                <div className="note-documento" style={{ marginBottom: '20px', padding: '12px 15px', background: '#fffde7', borderLeft: '4px solid #fbc02d', textAlign: 'left' }}>
                  <h4 style={{ margin: '0 0 6px 0', color: '#555', fontSize: '0.9rem', textTransform: 'uppercase' }}>Note del Fornitore</h4>
                  <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.9rem', color: '#333', lineHeight: '1.4' }}>{notePreventivo}</div>
                </div>
              )}

              <h3 style={{ textAlign: 'left' }}>Prospetto Economico delle Strutture</h3>
              <table className="tabella-preventivo" style={{ width: '100%', textAlign: 'left' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Articolo / Descrizione Servizio</th>
                    <th style={{ width: '180px', textAlign: 'right' }}>Imponibile</th>
                  </tr>
                </thead>
                <tbody>
                  {serviziSelezionati.map(nome => {
                    const sol = soluzioniMigliori[nome];
                    if (!sol) return null;
                    const costTotal = sol.totaleOpzione;
                    const vPrezzo = venditaGonfiabili[nome]?.prezzo !== undefined && venditaGonfiabili[nome]?.prezzo !== "" ? parseFloat(venditaGonfiabili[nome].prezzo) : costTotal;
                    const vSconto = parseFloat(venditaGonfiabili[nome]?.sconto) || 0;
                    const prezzoVenditaFinale = vPrezzo * (1 - vSconto / 100);

                    const gonfiabileCorrente = gonfiabili.find(g => g.nome === nome) || {};
                    const haParametri = gonfiabileCorrente.giocatori || gonfiabileCorrente.etaConsigliata || gonfiabileCorrente.dimensioni || gonfiabileCorrente.superficie || gonfiabileCorrente.alimentazione || gonfiabileCorrente.tempoMontaggio;

                    return (
                      <tr key={nome}>
                        <td style={{ textAlign: 'left' }}>
                          <div style={{ marginBottom: haParametri ? '4px' : '0' }}><strong>{nome}</strong> (Comprensivo di trasporto, installazione e assistenza)</div>
                          
                          {haParametri && (
                            <div style={{ fontSize: '0.8rem', color: '#666', lineHeight: '1.5', marginBottom: '4px' }}>
                              {gonfiabileCorrente.giocatori && <span style={{ marginRight: '12px', display: 'inline-block' }}><strong>Giocatori:</strong> {gonfiabileCorrente.giocatori}</span>}
                              {gonfiabileCorrente.etaConsigliata && <span style={{ marginRight: '12px', display: 'inline-block' }}><strong>Età Consigliata:</strong> {gonfiabileCorrente.etaConsigliata}</span>}
                              {gonfiabileCorrente.dimensioni && <span style={{ marginRight: '12px', display: 'inline-block' }}><strong>Dimensioni:</strong> {gonfiabileCorrente.dimensioni}</span>}
                              {gonfiabileCorrente.superficie && <span style={{ marginRight: '12px', display: 'inline-block' }}><strong>Superficie:</strong> {gonfiabileCorrente.superficie}</span>}
                              {gonfiabileCorrente.alimentazione && <span style={{ marginRight: '12px', display: 'inline-block' }}><strong>Alimentazione:</strong> {gonfiabileCorrente.alimentazione}</span>}
                              {gonfiabileCorrente.tempoMontaggio && <span style={{ display: 'inline-block' }}><strong>Tempo Montaggio:</strong> {gonfiabileCorrente.tempoMontaggio}</span>}
                            </div>
                          )}

                          {vSconto > 0 && (
                            <div style={{ fontSize: '0.85rem', color: '#c62828', fontStyle: 'italic', marginTop: '3px' }}>
                              Prezzo di listino: €{vPrezzo.toFixed(2)} - Sconto commerciale applicato: {vSconto}%
                            </div>
                          )}
                        </td>
                        <td style={{ textAlign: 'right', verticalAlign: 'middle' }}><strong>€{prezzoVenditaFinale.toFixed(2)}</strong></td>
                      </tr>
                    );
                  })}
                  {extras.filter(e => extraSelezionati.includes(e.id)).map(e => {
                    const costTotal = e.prezzo;
                    const vPrezzo = venditaExtras[e.id]?.prezzo !== undefined && venditaExtras[e.id]?.prezzo !== "" ? parseFloat(venditaExtras[e.id].prezzo) : costTotal;
                    const vSconto = parseFloat(venditaExtras[e.id]?.sconto) || 0;
                    const prezzoVenditaFinaleExtra = vPrezzo * (1 - vSconto / 100);

                    return (
                      <tr key={e.id}>
                        <td style={{ textAlign: 'left' }}>
                          <div><strong>{e.nome}</strong> (Servizio Accessorio Opzionale)</div>
                          {vSconto > 0 && (
                            <div style={{ fontSize: '0.85rem', color: '#c62828', fontStyle: 'italic', marginTop: '3px' }}>
                              Prezzo base: €{parseFloat(vPrezzo).toFixed(2)} - Sconto applicato: {vSconto}%
                            </div>
                          )}
                        </td>
                        <td style={{ textAlign: 'right', verticalAlign: 'middle' }}><strong>€{prezzoVenditaFinaleExtra.toFixed(2)}</strong></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="totale-documento" style={{ marginTop: '20px', padding: '15px', background: '#f5f5f5', textAlign: 'right' }}>
                <h2 style={{ margin: 0 }}>TOTALE FINALE CONTRATTUALE: €{totaleVenditaComplessivo.toFixed(2)} <span style={{ fontSize: '1.2rem', fontWeight: 'normal', color: '#555' }}>+ IVA</span></h2>
              </div>

              <div style={{ display: 'flex', gap: '15px', marginTop: '12px', justifyContent: 'flex-end', textAlign: 'left' }}>
                <div style={{ background: '#fafafa', borderLeft: '4px solid #0288d1', padding: '10px 14px', fontSize: '0.85rem', width: '260px', boxSizing: 'border-box' }}>
                  <span style={{ fontWeight: 'bold', color: '#0288d1', display: 'block', marginBottom: '2px', fontSize: '0.9rem' }}>PAGAMENTO ALLA CONFERMA</span>
                  Versamento caparra confirmatoria pari al 50% del preventivo.
                </div>
                <div style={{ background: '#fafafa', borderLeft: '4px solid #2e7d32', padding: '10px 14px', fontSize: '0.85rem', width: '260px', boxSizing: 'border-box' }}>
                  <span style={{ fontWeight: 'bold', color: '#2e7d32', display: 'block', marginBottom: '2px', fontSize: '0.9rem' }}>SALDO DELL'EVENTO</span>
                  Saldo tramite rimessa diretta a fine evento.
                </div>
              </div>
				
              <div className="nuova-pagina">
                <div className="condizioni-preventivo" style={{ marginTop: '35px', fontSize: '0.85rem', lineHeight: '1.4', color: '#444', textAlign: 'left' }}>
                  <div style={{ marginBottom: '20px', textAlign: 'left' }}>
                    <h4 style={{ margin: '0 0 8px 0', color: '#111', borderBottom: '1px solid #ddd', paddingBottom: '3px', fontSize: '0.9rem' }}>EVENTUALI ADDIZIONALI</h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <div style={{ textAlign: 'left' }}>⚡ <strong>Generatore di corrente:</strong> Posizionabile su richiesta qualora non ci sia elettricità o potenza sufficiente sul posto.</div>
                      <div style={{ textAlign: 'left' }}>🏆 <strong>Arbitraggio:</strong> Disponibile su richiesta servizio di assistenza e direzione per le varie partite.</div>
                      <div style={{ textAlign: 'left' }}>🎨 <strong>Personalizzazione:</strong> Tutti i giochi in struttura sono interamente personalizzabili.</div>
                    </div>
                  </div>

                  <div style={{ textAlign: 'left' }}>
                    <h4 style={{ margin: '0 0 8px 0', color: '#111', borderBottom: '1px solid #ddd', paddingBottom: '3px', fontSize: '0.9rem' }}>CONDIZIONI GENERALI</h4>
                    <ul style={{ margin: 0, paddingLeft: '18px', listStyleType: 'square', textAlign: 'left' }}>
                      <li style={{ marginBottom: '6px', textAlign: 'left' }}>I giochi e i prezzi proposti sopra sono soggetti a verifica disponibilità al momento delle conferma.</li>
                      <li style={{ marginBottom: '6px', textAlign: 'left' }}>La location di allestimento dei giochi deve essere accessibile con nostro automezzo, automobile o furgone tipologia Ducato, e prevedere nelle vicinanze il parcheggio gratuito dello stesso mezzo. I prezzi includono la consegna al piano terra.</li>
                      <li style={{ marginBottom: '6px', textAlign: 'left' }}>Avremo necessità di avere accessibilità a tutte le informazioni inerenti le condizioni dell'area di gioco, pertanto ci riserviamo di chiedere, al momento dell'accettazione di questo preventivo, qualche fotografia del luogo per aiutare a valutare la fattibilità della manifestazione. Inoltre potrebbe rendersi necessario un sopralluogo preliminare (a nostro carico).</li>
                      <li style={{ marginBottom: '6px', textAlign: 'left' }}>Al fine di un corretto calcolo delle tempistiche per la manifestazione è opportuno aggiungere il tempo di montaggio del gioco sia prima dell'inizio dell'evento che alla fine. Se per esempio avessimo indicato un'ora di montaggio, avremo necessità di presentarci con un'ora di anticipo dall'orario di inizio dell'evento, e avremo necessità dell'ora successiva a conclusione dello stesso.</li>
                      <li style={{ marginBottom: '2px', textAlign: 'left' }}>Tutti i costi relativi a pratiche con il fine di permettere lo svolgimento del gioco su suolo pubblico sono a carico del committente, come autorizzazioni, permessi, marche da bollo, ecc.</li>
                    </ul>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App