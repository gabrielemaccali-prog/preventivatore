import { useState, useEffect } from 'react'
import html2pdf from 'html2pdf.js';
import { supabase } from '../../lib/supabaseClient';
import { formattaDataIT, formattaIndirizzoPulito } from '../../lib/utils';

const FORM_VUOTO = {
  nominativo: "", dedica: "", pacchettoId: "", pacchettoNome: "",
  importo: "", testoOfferta: "",
  fattNome: "", fattCognome: "", fattIndirizzo: "", fattCap: "", fattCitta: "", fattProvincia: "", fattCF: "",
  stato: "incompleto", dataEmissione: ""
};

// Validazione Codice Fiscale italiano (persona fisica) con verifica del carattere di controllo.
const CF_VALORI_DISPARI = {
  '0': 1, '1': 0, '2': 5, '3': 7, '4': 9, '5': 13, '6': 15, '7': 17, '8': 19, '9': 21,
  'A': 1, 'B': 0, 'C': 5, 'D': 7, 'E': 9, 'F': 13, 'G': 15, 'H': 17, 'I': 19, 'J': 21,
  'K': 2, 'L': 4, 'M': 18, 'N': 20, 'O': 11, 'P': 3, 'Q': 6, 'R': 8, 'S': 12, 'T': 14,
  'U': 16, 'V': 10, 'W': 22, 'X': 25, 'Y': 24, 'Z': 23
};
const CF_VALORI_PARI = {
  '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  'A': 0, 'B': 1, 'C': 2, 'D': 3, 'E': 4, 'F': 5, 'G': 6, 'H': 7, 'I': 8, 'J': 9,
  'K': 10, 'L': 11, 'M': 12, 'N': 13, 'O': 14, 'P': 15, 'Q': 16, 'R': 17, 'S': 18, 'T': 19,
  'U': 20, 'V': 21, 'W': 22, 'X': 23, 'Y': 24, 'Z': 25
};

const validaCF = (cfRaw) => {
  const cf = (cfRaw || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{15}[A-Z]$/.test(cf)) return false;
  let somma = 0;
  for (let i = 0; i < 15; i++) {
    // posizioni 1-based: dispari (indice pari) -> tabella dispari, pari (indice dispari) -> tabella pari
    somma += (i % 2 === 0) ? CF_VALORI_DISPARI[cf[i]] : CF_VALORI_PARI[cf[i]];
  }
  const carattereControllo = String.fromCharCode('A'.charCodeAt(0) + (somma % 26));
  return carattereControllo === cf[15];
};

// Ritorna un messaggio d'errore specifico (o null se valido / vuoto)
const erroreCF = (cfRaw) => {
  const cf = (cfRaw || "").trim().toUpperCase();
  if (!cf) return null;
  if (!/^[A-Z0-9]{15}[A-Z]$/.test(cf)) return "Formato non valido: il CF deve essere di 16 caratteri (es. RSSMRA85M01H501Z).";
  if (!validaCF(cf)) return "Carattere di controllo errato: il Codice Fiscale non è valido.";
  return null;
};

// Verifica presenza dei dati di fatturazione (con CF valido)
const fatturazioneCompletaDi = (f) =>
  !!(f.fattNome && f.fattCognome && f.fattIndirizzo && f.fattCitta && validaCF(f.fattCF));

// Lo stato dipende dalla presenza dei dati di fatturazione (a meno che sia già "usato")
const calcolaStato = (f, statoPrecedente) => {
  if (statoPrecedente === "usato") return "usato";
  return fatturazioneCompletaDi(f) ? "emesso" : "incompleto";
};

// Validità: 1 anno solare dalla data di emissione
const dataValidita = (dataEmissione) => {
  const base = dataEmissione ? new Date(dataEmissione) : new Date();
  base.setFullYear(base.getFullYear() + 1);
  return base.toISOString();
};

function Voucher({ user }) {
  const [currentView, setCurrentView] = useState("nuovo"); // config | nuovo | storico

  // --- DATI ---
  const [pacchetti, setPacchetti] = useState([]);
  const [voucherSalvati, setVoucherSalvati] = useState([]);

  // --- CONFIGURATORE PACCHETTI ---
  const [nuovoPacchetto, setNuovoPacchetto] = useState({ nome: "", importo: "", descrizione: "" });
  const [idPacchettoInModifica, setIdPacchettoInModifica] = useState(null);
  const [datiPacchettoInModifica, setDatiPacchettoInModifica] = useState({ nome: "", importo: "", descrizione: "" });

  // --- FORM NUOVO / MODIFICA VOUCHER ---
  const [form, setForm] = useState(FORM_VUOTO);
  const [codiceInModifica, setCodiceInModifica] = useState(null); // null = creazione, valorizzato = modifica
  const [codiceGenerato, setCodiceGenerato] = useState("");        // codice definitivo dopo il salvataggio

  // --- RICERCA INDIRIZZO FATTURAZIONE ---
  const [queryIndirizzo, setQueryIndirizzo] = useState("");
  const [risultatiRicerca, setRisultatiRicerca] = useState([]);

  // --- STAMPA PDF ---
  const [datiPDF, setDatiPDF] = useState(null);

  // --- FILTRI STORICO ---
  const [filtroCodice, setFiltroCodice] = useState("");
  const [filtroNominativo, setFiltroNominativo] = useState("");
  const [filtroStato, setFiltroStato] = useState("");

  useEffect(() => {
    fetchPacchetti();
    fetchVoucher();
  }, []);

  const fetchPacchetti = async () => {
    const { data } = await supabase.from('pacchetti').select('*').order('nome');
    if (data) setPacchetti(data);
  };

  const fetchVoucher = async () => {
    const { data } = await supabase.from('voucher').select('*').order('codice', { ascending: false });
    if (data) setVoucherSalvati(data);
  };

  // ====================== CONFIGURATORE PACCHETTI ======================
  const addPacchetto = async (e) => {
    e.preventDefault();
    if (!nuovoPacchetto.nome || nuovoPacchetto.importo === "") return alert("Compila nome e importo");
    const nuovo = {
      id: "pkg_" + Date.now(),
      nome: nuovoPacchetto.nome,
      importo: parseFloat(nuovoPacchetto.importo) || 0,
      descrizione: nuovoPacchetto.descrizione
    };
    const { error } = await supabase.from('pacchetti').insert([nuovo]);
    if (!error) { setNuovoPacchetto({ nome: "", importo: "", descrizione: "" }); fetchPacchetti(); }
    else { console.error(error); alert("Errore salvataggio pacchetto"); }
  };

  const salvaModificaPacchetto = async () => {
    await supabase.from('pacchetti').update({
      nome: datiPacchettoInModifica.nome,
      importo: parseFloat(datiPacchettoInModifica.importo) || 0,
      descrizione: datiPacchettoInModifica.descrizione
    }).eq('id', idPacchettoInModifica);
    setIdPacchettoInModifica(null); fetchPacchetti();
  };

  const rimuoviPacchetto = async (id) => {
    if (!window.confirm("Eliminare questo pacchetto? I voucher già emessi non verranno modificati.")) return;
    await supabase.from('pacchetti').delete().eq('id', id);
    fetchPacchetti();
  };

  // ====================== NUOVO / MODIFICA VOUCHER ======================
  const selezionaPacchetto = (id) => {
    const p = pacchetti.find(x => x.id === id);
    setForm(prev => ({
      ...prev,
      pacchettoId: id,
      pacchettoNome: p?.nome || "",
      importo: p ? p.importo : "",
      testoOfferta: p?.descrizione || ""
    }));
  };

  const resetForm = () => {
    setForm(FORM_VUOTO);
    setCodiceInModifica(null);
    setCodiceGenerato("");
    setQueryIndirizzo("");
    setRisultatiRicerca([]);
  };

  // --- RICERCA INDIRIZZO (Nominatim, come nel preventivatore) ---
  const cercaIndirizzoFatt = async () => {
    if (!queryIndirizzo) return;
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(queryIndirizzo)}&addressdetails=1&countrycodes=it&limit=5`);
      const data = await response.json();
      setRisultatiRicerca(data);
    } catch (error) {
      console.error(error);
    }
  };

  const selezionaIndirizzoFatt = (luogo) => {
    const a = luogo.address || {};
    const via = a.road || a.pedestrian || a.suburb || "";
    const civico = a.house_number ? ` ${a.house_number}` : "";
    let prov = a.county || "";
    prov = prov.replace("Provincia di ", "").replace("Città Metropolitana di ", "");
    setForm(prev => ({
      ...prev,
      fattIndirizzo: `${via}${civico}`.trim(),
      fattCap: a.postcode || "",
      fattCitta: a.city || a.town || a.village || "",
      fattProvincia: prov
    }));
    setRisultatiRicerca([]);
    setQueryIndirizzo("");
  };

  // Legge l'ultimo codice dell'anno corrente dal DB e ritorna il successivo (reset annuale da 1001)
  const generaCodiceVoucher = async () => {
    const anno = new Date().getFullYear();
    const prefix = `VCH-${anno}-`;
    const { data } = await supabase
      .from('voucher')
      .select('codice')
      .like('codice', `${prefix}%`)
      .order('codice', { ascending: false })
      .limit(1);
    let prossimo = 1001;
    if (data && data.length > 0) {
      const ultimo = parseInt(data[0].codice.replace(prefix, ''));
      if (!isNaN(ultimo)) prossimo = ultimo + 1;
    }
    return `${prefix}${prossimo}`;
  };

  const salvaVoucher = async () => {
    if (!form.nominativo.trim()) return alert("Il nominativo di intestazione è obbligatorio.");
    if (!form.pacchettoId && form.importo === "") return alert("Seleziona un pacchetto gioco.");
    const erroreCodiceFiscale = erroreCF(form.fattCF);
    if (erroreCodiceFiscale) return alert(erroreCodiceFiscale);

    const stato = calcolaStato(form, codiceInModifica ? form.stato : "incompleto");

    const payload = {
      nominativo: form.nominativo,
      dedica: form.dedica,
      pacchettoNome: form.pacchettoNome,
      importo: parseFloat(form.importo) || 0,
      testoOfferta: form.testoOfferta,
      fattNome: form.fattNome,
      fattCognome: form.fattCognome,
      fattIndirizzo: form.fattIndirizzo,
      fattCap: form.fattCap,
      fattCitta: form.fattCitta,
      fattProvincia: form.fattProvincia,
      fattCF: (form.fattCF || "").toUpperCase(),
      stato
    };

    let codiceFinale = codiceInModifica;

    if (!codiceInModifica) {
      // CREAZIONE: genera codice leggendo l'ultimo da DB
      codiceFinale = await generaCodiceVoucher();
      const { error } = await supabase.from('voucher').insert([{ codice: codiceFinale, ...payload }]);
      if (error) {
        // Possibile collisione di codice: ritenta una volta rileggendo il massimo
        console.error(error);
        codiceFinale = await generaCodiceVoucher();
        const retry = await supabase.from('voucher').insert([{ codice: codiceFinale, ...payload }]);
        if (retry.error) { alert("Errore durante il salvataggio del voucher."); return; }
      }
    } else {
      // MODIFICA
      const { error } = await supabase.from('voucher').update(payload).eq('codice', codiceInModifica);
      if (error) { console.error(error); alert("Errore durante l'aggiornamento del voucher."); return; }
    }

    setForm(prev => ({ ...prev, stato, dataEmissione: prev.dataEmissione || new Date().toISOString() }));
    setCodiceInModifica(codiceFinale);
    setCodiceGenerato(codiceFinale);
    fetchVoucher();
    alert(`Voucher ${codiceFinale} salvato (stato: ${stato}).`);
  };

  const caricaVoucherInForm = (v) => {
    setForm({
      nominativo: v.nominativo || "",
      dedica: v.dedica || "",
      pacchettoId: "",
      pacchettoNome: v.pacchettoNome || "",
      importo: v.importo ?? "",
      testoOfferta: v.testoOfferta || "",
      fattNome: v.fattNome || "",
      fattCognome: v.fattCognome || "",
      fattIndirizzo: v.fattIndirizzo || "",
      fattCap: v.fattCap || "",
      fattCitta: v.fattCitta || "",
      fattProvincia: v.fattProvincia || "",
      fattCF: v.fattCF || "",
      stato: v.stato || "incompleto",
      dataEmissione: v.dataEmissione || ""
    });
    setCodiceInModifica(v.codice);
    setCodiceGenerato(v.codice);
    setCurrentView("nuovo");
  };

  // ====================== STAMPA PDF ======================
  const scaricaPDF = async (codice) => {
    try {
      const element = document.getElementById('voucher-da-stampare');
      if (!element) return;

      // Attende il caricamento delle immagini, ma senza mai bloccarsi (max 2s)
      const imgs = Array.from(element.querySelectorAll('img'));
      await Promise.race([
        Promise.all(imgs.map(img => img.complete
          ? Promise.resolve()
          : new Promise(res => { img.onload = res; img.onerror = res; }))),
        new Promise(res => setTimeout(res, 2000))
      ]);

      const opt = {
        margin: 0,
        filename: `${codice || 'voucher'}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, imageTimeout: 0 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
        pagebreak: { mode: ['avoid-all'] }
      };
      await html2pdf().set(opt).from(element).save();
    } catch (err) {
      console.error('Errore generazione PDF voucher:', err);
      alert('Errore durante la generazione del PDF. Riprova.');
    }
  };

  // Stampa il voucher attualmente nel form (deve essere già salvato per avere un codice)
  const stampaFormCorrente = async () => {
    if (!codiceGenerato) return alert("Salva prima il voucher, poi potrai stamparlo.");
    if (!fatturazioneCompletaDi(form)) return alert("Inserisci tutti i dati di fatturazione prima di scaricare il PDF.");
    setDatiPDF({ ...form, codice: codiceGenerato });
    await new Promise(r => setTimeout(r, 150));
    scaricaPDF(codiceGenerato);
  };

  const eliminaVoucher = async (codice) => {
    if (!window.confirm(`Eliminare definitivamente il voucher ${codice}?`)) return;
    await supabase.from('voucher').delete().eq('codice', codice);
    fetchVoucher();
  };

  const cambiaStatoVoucher = async (v, nuovoStato) => {
    // Se si esce da "usato", ricalcola lo stato in base ai dati di fatturazione
    const stato = nuovoStato === "auto" ? calcolaStato(v, "incompleto") : nuovoStato;
    await supabase.from('voucher').update({ stato }).eq('codice', v.codice);
    fetchVoucher();
  };

  // ====================== FILTRI STORICO ======================
  const voucherFiltrati = voucherSalvati.filter(v => {
    const mC = (v.codice || "").toLowerCase().includes(filtroCodice.toLowerCase());
    const mN = (v.nominativo || "").toLowerCase().includes(filtroNominativo.toLowerCase());
    const mS = filtroStato === "" || v.stato === filtroStato;
    return mC && mN && mS;
  });

  const importoPDF = datiPDF ? (parseFloat(datiPDF.importo) || 0) : 0;
  const fatturazioneCompleta = fatturazioneCompletaDi(form);

  return (
    <>
      <nav className="modulo-subnav no-print">
        {user.ruolo === "admin" && (
          <button className={`nav-btn ${currentView === 'config' ? 'active' : ''}`} onClick={() => setCurrentView("config")}>⚙️ Configuratore Pacchetti</button>
        )}
        <button className={`nav-btn ${currentView === 'nuovo' ? 'active' : ''}`} onClick={() => setCurrentView("nuovo")}>🎟️ Nuovo Voucher</button>
        <button className={`nav-btn ${currentView === 'storico' ? 'active' : ''}`} onClick={() => setCurrentView("storico")}>🗂️ Storico Voucher</button>
      </nav>

      {/* ===================== CONFIGURATORE PACCHETTI ===================== */}
      {currentView === "config" && user.ruolo === "admin" && (
        <div className="schermata-admin no-print" style={{ padding: '20px' }}>
          <h2>Configuratore Pacchetti Gioco</h2>
          <p className="descrizione-pagina">Definisci i pacchetti: importo e descrizione (testo che apparirà sul voucher).</p>

          <div className="admin-grid-sezione">
            <div className="admin-form-box" style={{ background: '#f9f9f9', padding: '18px', borderRadius: '8px', border: '1px solid #e0e0e0' }}>
              <h3 style={{ margin: '0 0 15px 0', fontSize: '1.1rem', color: '#0288d1' }}>Aggiungi Pacchetto</h3>
              <form onSubmit={addPacchetto} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <input type="text" placeholder="Nome pacchetto" value={nuovoPacchetto.nome} onChange={(e) => setNuovoPacchetto({ ...nuovoPacchetto, nome: e.target.value })} style={{ width: '100%', boxSizing: 'border-box', height: '36px', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px' }} />
                <input type="number" step="any" placeholder="Importo (€)" value={nuovoPacchetto.importo} onChange={(e) => setNuovoPacchetto({ ...nuovoPacchetto, importo: e.target.value })} style={{ width: '100%', boxSizing: 'border-box', height: '36px', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px' }} />
                <textarea placeholder="Descrizione / testo offerta da stampare" value={nuovoPacchetto.descrizione} onChange={(e) => setNuovoPacchetto({ ...nuovoPacchetto, descrizione: e.target.value })} rows="3" style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px', resize: 'vertical', fontFamily: 'inherit' }} />
                <button type="submit" style={{ padding: '9px 18px', background: '#0288d1', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' }}>Salva Pacchetto</button>
              </form>
            </div>

            <div className="admin-table-box" style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                    <th style={{ padding: '10px 12px' }}>Pacchetto</th>
                    <th style={{ padding: '10px 12px' }}>Importo</th>
                    <th style={{ padding: '10px 12px' }}>Descrizione</th>
                    <th style={{ padding: '10px 12px', textAlign: 'center', width: '130px' }}>Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {pacchetti.map(p => (
                    <tr key={p.id} style={{ borderBottom: '1px solid #eee' }}>
                      {idPacchettoInModifica === p.id ? (
                        <>
                          <td style={{ padding: '10px 12px' }}><input type="text" className="table-input" value={datiPacchettoInModifica.nome} onChange={(e) => setDatiPacchettoInModifica({ ...datiPacchettoInModifica, nome: e.target.value })} style={{ width: '100%', height: '30px' }} /></td>
                          <td style={{ padding: '10px 12px' }}><input type="number" step="any" className="table-input" value={datiPacchettoInModifica.importo} onChange={(e) => setDatiPacchettoInModifica({ ...datiPacchettoInModifica, importo: e.target.value })} style={{ width: '100%', height: '30px' }} /></td>
                          <td style={{ padding: '10px 12px' }}><input type="text" className="table-input" value={datiPacchettoInModifica.descrizione} onChange={(e) => setDatiPacchettoInModifica({ ...datiPacchettoInModifica, descrizione: e.target.value })} style={{ width: '100%', height: '30px' }} /></td>
                          <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                            <div style={{ display: 'flex', gap: '5px', justifyContent: 'center' }}>
                              <button className="btn-salva-inline" onClick={salvaModificaPacchetto} style={{ fontSize: '0.8rem', padding: '4px 8px' }}>Salva</button>
                              <button className="btn-annulla-inline" onClick={() => setIdPacchettoInModifica(null)} style={{ fontSize: '0.8rem', padding: '4px 8px' }}>Annulla</button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}><strong>{p.nome}</strong></td>
                          <td style={{ padding: '10px 12px', verticalAlign: 'middle', color: '#2e7d32' }}>€{parseFloat(p.importo).toFixed(2)}</td>
                          <td style={{ padding: '10px 12px', verticalAlign: 'middle', color: '#555' }}>{p.descrizione}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'center', verticalAlign: 'middle' }}>
                            <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                              <button className="btn-modifica-inline" style={{ fontSize: '0.8rem', padding: '4px 8px' }} onClick={() => { setIdPacchettoInModifica(p.id); setDatiPacchettoInModifica({ nome: p.nome, importo: p.importo, descrizione: p.descrizione || "" }); }}>Modifica</button>
                              <button className="btn-rimuovi" style={{ fontSize: '0.8rem', padding: '4px 8px' }} onClick={() => rimuoviPacchetto(p.id)}>Elimina</button>
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                  {pacchetti.length === 0 && <tr><td colSpan="4" style={{ padding: '20px', textAlign: 'center', color: '#666' }}>Nessun pacchetto configurato.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ===================== NUOVO / MODIFICA VOUCHER ===================== */}
      {currentView === "nuovo" && (
        <div className="schermata-inserimento no-print">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <h2 style={{ margin: 0 }}>{codiceInModifica ? `Modifica Voucher ${codiceInModifica}` : "Nuovo Voucher"}</h2>
            {codiceInModifica && <button className="btn-chiudi" style={{ float: 'none' }} onClick={resetForm}>🆕 Nuovo</button>}
          </div>
          <p className="descrizione-pagina">Il codice viene assegnato automaticamente al salvataggio. Anteprima: <strong>{codiceGenerato || `VCH-${new Date().getFullYear()}-XXXX`}</strong></p>

          <div className="sezione">
            <h2>1. Dati del Voucher</h2>
            <label style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', marginBottom: '12px' }}>
              Nominativo di intestazione (festeggiato) *
              <input type="text" value={form.nominativo} onChange={(e) => setForm({ ...form, nominativo: e.target.value })} placeholder="Es. Mario Rossi" />
            </label>
            <label style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', marginBottom: '12px' }}>
              Dedica personalizzata (facoltativa)
              <textarea value={form.dedica} onChange={(e) => setForm({ ...form, dedica: e.target.value })} rows="2" placeholder="Es. Buon compleanno!" style={{ width: '100%', padding: '12px', border: '1px solid #cbd5e1', borderRadius: '6px', marginTop: '5px', fontFamily: 'inherit', fontSize: '1rem', resize: 'vertical', boxSizing: 'border-box' }} />
            </label>
            <label style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', marginBottom: '12px' }}>
              Pacchetto gioco *
              <select className="dropdown-gonfiabili" value={form.pacchettoId} onChange={(e) => selezionaPacchetto(e.target.value)}>
                <option value="">-- Seleziona pacchetto --</option>
                {pacchetti.map(p => <option key={p.id} value={p.id}>{p.nome} (€{parseFloat(p.importo).toFixed(2)})</option>)}
              </select>
            </label>
            {(form.importo !== "" || form.testoOfferta) && (
              <div className="info-percorso-riepilogo">
                <p>💶 Importo: <strong>€{(parseFloat(form.importo) || 0).toFixed(2)}</strong></p>
                {form.testoOfferta && <p>🎁 Offerta: <strong>{form.testoOfferta}</strong></p>}
              </div>
            )}
          </div>

          <div className="sezione">
            <h2>2. Dati di Fatturazione (acquirente)</h2>
            <p className="descrizione-pagina" style={{ marginTop: 0 }}>Facoltativi in fase di creazione: senza questi dati il voucher resta <strong>incompleto</strong>.</p>
            <div className="date-grid" style={{ flexWrap: 'wrap' }}>
              <label style={{ flex: '1 1 200px', display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.9rem' }}>
                Nome
                <input type="text" value={form.fattNome} onChange={(e) => setForm({ ...form, fattNome: e.target.value })} />
              </label>
              <label style={{ flex: '1 1 200px', display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.9rem' }}>
                Cognome
                <input type="text" value={form.fattCognome} onChange={(e) => setForm({ ...form, fattCognome: e.target.value })} />
              </label>
            </div>
            <div style={{ margin: '12px 0' }}>
              <label style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', marginBottom: '5px' }}>Cerca indirizzo di residenza</label>
              <div className="ricerca-box">
                <input type="text" placeholder="Scrivi via, civico, città..." value={queryIndirizzo} onChange={(e) => setQueryIndirizzo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), cercaIndirizzoFatt())} />
                <button type="button" onClick={cercaIndirizzoFatt}>Cerca</button>
              </div>
              {risultatiRicerca.length > 0 && (
                <ul className="risultati-ricerca">
                  {risultatiRicerca.map(luogo => (
                    <li key={luogo.place_id} onClick={() => selezionaIndirizzoFatt(luogo)}>{formattaIndirizzoPulito(luogo)}</li>
                  ))}
                </ul>
              )}
            </div>

            <div className="date-grid" style={{ flexWrap: 'wrap' }}>
              <label style={{ flex: '2 1 240px', display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.9rem' }}>
                Indirizzo (via e civico)
                <input type="text" value={form.fattIndirizzo} onChange={(e) => setForm({ ...form, fattIndirizzo: e.target.value })} />
              </label>
              <label style={{ flex: '1 1 100px', display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.9rem' }}>
                CAP
                <input type="text" value={form.fattCap} onChange={(e) => setForm({ ...form, fattCap: e.target.value })} />
              </label>
            </div>
            <div className="date-grid" style={{ flexWrap: 'wrap', marginTop: '12px' }}>
              <label style={{ flex: '2 1 200px', display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.9rem' }}>
                Città
                <input type="text" value={form.fattCitta} onChange={(e) => setForm({ ...form, fattCitta: e.target.value })} />
              </label>
              <label style={{ flex: '1 1 100px', display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.9rem' }}>
                Provincia
                <input type="text" value={form.fattProvincia} onChange={(e) => setForm({ ...form, fattProvincia: e.target.value })} />
              </label>
            </div>

            <label style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', marginTop: '12px' }}>
              Codice Fiscale
              <input
                type="text"
                value={form.fattCF}
                maxLength={16}
                onChange={(e) => setForm({ ...form, fattCF: e.target.value.toUpperCase() })}
                style={erroreCF(form.fattCF) ? { borderColor: '#ef4444', backgroundColor: '#fef2f2' } : undefined}
              />
            </label>
            {erroreCF(form.fattCF) && (
              <p style={{ margin: '6px 0 0 0', fontSize: '0.82rem', color: '#c62828' }}>
                ⚠️ {erroreCF(form.fattCF)}
              </p>
            )}
          </div>

          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '10px' }}>
            <button className="btn-preventivo" style={{ flex: '1 1 220px', marginTop: 0 }} onClick={salvaVoucher}>💾 Salva Voucher</button>
            <button className="btn-stampa" style={{ flex: '1 1 220px' }} onClick={stampaFormCorrente} disabled={!codiceGenerato || !fatturazioneCompleta}>🖨️ Scarica PDF</button>
          </div>
          {codiceGenerato && !fatturazioneCompleta && (
            <p style={{ margin: '8px 0 0 0', fontSize: '0.85rem', color: '#c62828' }}>
              ⚠️ Per scaricare il PDF è necessario completare tutti i dati di fatturazione.
            </p>
          )}
        </div>
      )}

      {/* ===================== STORICO VOUCHER ===================== */}
      {currentView === "storico" && (
        <div className="schermata-storico no-print">
          <h2 style={{ margin: 0 }}>🗂️ Storico Voucher</h2>
          <p className="descrizione-pagina">Consulta, completa, modifica, ristampa o elimina i voucher emessi.</p>

          <div className="filtri-storico" style={{ flexWrap: 'wrap' }}>
            <div className="filtro-group" style={{ flex: '1 1 180px' }}>
              <label>Codice:</label>
              <input type="text" placeholder="VCH-2026-..." value={filtroCodice} onChange={(e) => setFiltroCodice(e.target.value)} />
            </div>
            <div className="filtro-group" style={{ flex: '1 1 180px' }}>
              <label>Nominativo:</label>
              <input type="text" placeholder="Festeggiato" value={filtroNominativo} onChange={(e) => setFiltroNominativo(e.target.value)} />
            </div>
            <div className="filtro-group" style={{ flex: '1 1 180px' }}>
              <label>Stato:</label>
              <select value={filtroStato} onChange={(e) => setFiltroStato(e.target.value)}>
                <option value="">Tutti</option>
                <option value="incompleto">Incompleto</option>
                <option value="emesso">Emesso</option>
                <option value="usato">Usato</option>
              </select>
            </div>
          </div>

          <div className="admin-table-box-full" style={{ marginTop: '20px', overflowX: 'auto' }}>
            <table className="storico-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem', background: '#fff' }}>
              <thead>
                <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                  <th style={{ padding: '12px' }}>Codice / Data</th>
                  <th style={{ padding: '12px' }}>Intestatario / Pacchetto</th>
                  <th style={{ padding: '12px' }}>Fatturazione</th>
                  <th style={{ padding: '12px' }}>Stato</th>
                  <th style={{ padding: '12px', textAlign: 'center' }}>Azioni</th>
                </tr>
              </thead>
              <tbody>
                {voucherFiltrati.length === 0 ? (
                  <tr><td colSpan="5" style={{ textAlign: 'center', padding: '20px', color: '#666' }}>Nessun voucher trovato.</td></tr>
                ) : voucherFiltrati.map(v => (
                  <tr key={v.codice} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '12px' }}>
                      <strong>{v.codice}</strong><br />
                      <span style={{ color: '#777', fontSize: '0.8rem' }}>{formattaDataIT(v.dataEmissione)}</span>
                    </td>
                    <td style={{ padding: '12px' }}>
                      👤 {v.nominativo}<br />
                      <span style={{ fontSize: '0.8rem', color: '#555' }}>{v.pacchettoNome} — €{parseFloat(v.importo).toFixed(2)}</span>
                    </td>
                    <td style={{ padding: '12px', fontSize: '0.8rem', color: '#555' }}>
                      {v.fattNome || v.fattCognome ? (
                        <>{v.fattNome} {v.fattCognome}<br />{v.fattIndirizzo}<br />{v.fattCF}</>
                      ) : <em style={{ color: '#999' }}>Da completare</em>}
                    </td>
                    <td style={{ padding: '12px' }}>
                      <span className={`badge-stato ${v.stato}`}>{v.stato}</span>
                    </td>
                    <td style={{ padding: '12px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', alignItems: 'center' }}>
                        <button className="btn-modifica-inline" style={{ width: '100%' }} onClick={() => caricaVoucherInForm(v)}>✏️ Modifica</button>
                        {v.stato !== "usato" ? (
                          <button className="btn-conferma" onClick={() => cambiaStatoVoucher(v, "usato")}>✔️ Segna usato</button>
                        ) : (
                          <button className="btn-ripristina" onClick={() => cambiaStatoVoucher(v, "auto")}>↩️ Riattiva</button>
                        )}
                        <button className="btn-elimina-prev" onClick={() => eliminaVoucher(v.codice)}>🗑️ Elimina</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===================== TEMPLATE PDF (fuori schermo) ===================== */}
      <div style={{ position: 'fixed', left: '-10000px', top: 0 }}>
        <div id="voucher-da-stampare" className="voucher-foglio" style={{ backgroundImage: "url('/voucher-bg.jpg')" }}>
          {datiPDF && (
            <>
              {/* img nascosta: serve solo a precaricare/attendere la foto prima della cattura */}
              <img src="/voucher-bg.jpg" alt="" style={{ display: 'none' }} />

              <div className="voucher-info-col">
                <div className="voucher-header">
                  <img src="/logo.png" alt="Logo" className="voucher-logo" />
                  <h1 className="voucher-title">BUBBLE FOOTBALL</h1>
                </div>

                <div className="voucher-label">BUONO REGALO INTESTATO A</div>
                <div className="voucher-nominativo">{datiPDF.nominativo}</div>
                {datiPDF.dedica && <div className="voucher-dedica">“{datiPDF.dedica}”</div>}

                <div className="voucher-offerta-box">
                  {datiPDF.testoOfferta && <div className="voucher-testo-offerta">{datiPDF.testoOfferta}</div>}
                  {importoPDF > 0 && <div className="voucher-importo">Valore: € {importoPDF.toFixed(2)}</div>}
                </div>

                <div className="voucher-non-cumulabile">NON CUMULABILE CON ALTRE INIZIATIVE</div>

                <div className="voucher-codice">CODICE BUONO: {datiPDF.codice}</div>

                <div className="voucher-validita">Valido fino al {formattaDataIT(dataValidita(datiPDF.dataEmissione))}</div>

                <ol className="voucher-istruzioni">
                  <li>. Verifica su <strong>www.bubblefootballmi.it</strong> i centri sportivi presso cui giocare.</li>
                  <li>. Contattaci per verificare la disponibilità della struttura nella data e nell'orario da te preferito e confermare la prenotazione.</li>
                </ol>

                <div className="voucher-contatti">
                  <strong>Per maggiori informazioni:</strong><br />
                  ✉️ bubblefootballmi@gmail.com &nbsp;&nbsp; 📞 351 6759881
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

export default Voucher
