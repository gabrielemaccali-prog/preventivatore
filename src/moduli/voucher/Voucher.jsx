import { useState, useEffect, Fragment } from 'react'
import html2pdf from 'html2pdf.js';
import { supabase } from '../../lib/supabaseClient';
import { puoVedere } from '../../lib/permessi';
import { formattaDataIT, formattaIndirizzoPulito } from '../../lib/utils';
import Icona from '../../components/Icona';
import { useOrdinamentoTabella } from '../../lib/ordinamentoTabella';

const FORM_VUOTO = {
  nominativo: "", dedica: "", pacchettoId: "", pacchettoNome: "",
  importo: "", testoOfferta: "",
  fattNome: "", fattCognome: "", fattIndirizzo: "", fattCap: "", fattCitta: "", fattProvincia: "", fattCF: "",
  pagamenti: [],
  stato: "incompleto", dataEmissione: ""
};

// Stato pagamento derivato dai versamenti rispetto all'importo del voucher (stessa logica delle prenotazioni)
const statoPagamentoDi = (pagamenti, importo) => {
  const tot = (pagamenti || []).reduce((s, p) => s + (parseFloat(p.importo) || 0), 0);
  if (tot <= 0) return 'in attesa';
  if (tot + 0.001 >= (parseFloat(importo) || 0)) return 'saldato';
  return 'acconto';
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

// Colonne della tabella voucher (Gestione e Storico): etichetta mostrata e valore su cui ordinare.
// "Pagato / Totale" ordina sul totale, cioè sul valore del voucher.
const COLONNE_VOUCHER = [
  { chiave: 'codice', label: 'Codice', valore: (v) => v.codice || '' },
  { chiave: 'data', label: 'Data', valore: (v) => v.dataEmissione || '' },
  { chiave: 'intestatario', label: 'Intestatario', valore: (v) => v.nominativo || '' },
  { chiave: 'pacchetto', label: 'Pacchetto', valore: (v) => v.pacchettoNome || '' },
  { chiave: 'importo', label: 'Pagato / Totale', valore: (v) => parseFloat(v.importo) || 0 },
];
const VALORI_ORDINAMENTO_VOUCHER = Object.fromEntries(COLONNE_VOUCHER.map(c => [c.chiave, c.valore]));

function Voucher({ user }) {
  const primaSchedaVoucher = ['gestione', 'config', 'storico'].find(s => puoVedere(user, 'voucher', s)) || 'gestione';
  const [currentView, setCurrentView] = useState(primaSchedaVoucher); // config | gestione | storico
  const [gestioneTab, setGestioneTab] = useState("incompleti"); // incompleti | emessi | usati
  const [showFormVoucher, setShowFormVoucher] = useState(false); // form Nuovo/Modifica voucher come overlay
  const [mostraErroriValidazione, setMostraErroriValidazione] = useState(false); // evidenzia di rosso i campi obbligatori mancanti, solo dopo un tentativo di salvataggio

  // --- DATI ---
  const [pacchetti, setPacchetti] = useState([]);
  const [voucherSalvati, setVoucherSalvati] = useState([]);
  const [prenotazioni, setPrenotazioni] = useState([]); // serve solo per sapere dove è stato usato un voucher
  const [nuovoPagamento, setNuovoPagamento] = useState({ importo: "", data: "", nominativo: "" });

  // --- CONFIGURATORE PACCHETTI ---
  const [nuovoPacchetto, setNuovoPacchetto] = useState({ nome: "", importo: "", descrizione: "" });
  const [showFormPacchettoCfg, setShowFormPacchettoCfg] = useState(false);
  const [idPacchettoInModifica, setIdPacchettoInModifica] = useState(null);
  const [datiPacchettoInModifica, setDatiPacchettoInModifica] = useState({ nome: "", importo: "", descrizione: "" });

  // --- FORM NUOVO / MODIFICA VOUCHER ---
  const [form, setForm] = useState(FORM_VUOTO);
  const [formOriginale, setFormOriginale] = useState(null); // snapshot al caricamento, per evidenziare i campi modificati
  const [codiceInModifica, setCodiceInModifica] = useState(null); // null = creazione, valorizzato = modifica
  const [codiceGenerato, setCodiceGenerato] = useState("");        // codice definitivo dopo il salvataggio
  const [salvataggioVoucher, setSalvataggioVoucher] = useState(false);

  // --- RICERCA INDIRIZZO FATTURAZIONE ---
  const [queryIndirizzo, setQueryIndirizzo] = useState("");
  const [risultatiRicerca, setRisultatiRicerca] = useState([]);

  // --- STAMPA PDF ---
  const [datiPDF, setDatiPDF] = useState(null);

  // --- FILTRI STORICO ---
  const [filtroCodice, setFiltroCodice] = useState("");
  const [filtroNominativo, setFiltroNominativo] = useState("");
  const [filtroStato, setFiltroStato] = useState("");
  const [rigaEspansaId, setRigaEspansaId] = useState(null); // codice voucher con riga dettaglio espansa (Gestione/Storico)

  useEffect(() => {
    fetchPacchetti();
    fetchVoucher();
  }, []);

  const fetchPacchetti = async () => {
    const { data } = await supabase.from('pacchetti').select('*').order('nome');
    if (data) setPacchetti(data);
  };

  // Voucher + relativi pagamenti (dalla tabella unica "pagamenti", condivisa con le prenotazioni)
  // + le prenotazioni, per mostrare su quale prenotazione un voucher è stato usato.
  const fetchVoucher = async () => {
    const [vc, pag, pr] = await Promise.all([
      supabase.from('voucher').select('*').order('codice', { ascending: false }),
      supabase.from('pagamenti').select('*').eq('tipo', 'voucher').order('data'),
      supabase.from('prenotazioni').select('id, data, nominativo, voucherCodice'),
    ]);
    if (vc.data) {
      const righePag = pag.data || [];
      setVoucherSalvati(vc.data.map(v => ({
        ...v,
        pagamenti: righePag.filter(x => x.riferimento === v.codice).map(x => ({ id: x.id, data: x.data, importo: x.importo, nominativo: x.nominativo || "" }))
      })));
    }
    if (pr.data) setPrenotazioni(pr.data);
  };

  // Allinea le righe della tabella pagamenti a quelle del form (cancella e reinserisce: sono poche per voucher)
  const sincronizzaPagamenti = async (codice, righe) => {
    await supabase.from('pagamenti').delete().eq('tipo', 'voucher').eq('riferimento', codice);
    const daInserire = (righe || [])
      .filter(pg => pg.data)
      .map(pg => ({ tipo: 'voucher', riferimento: codice, data: pg.data, importo: parseFloat(pg.importo) || 0, nominativo: pg.nominativo || null }));
    if (daInserire.length > 0) await supabase.from('pagamenti').insert(daInserire);
  };

  const aggiungiPagamento = () => {
    if (nuovoPagamento.importo === "" || !nuovoPagamento.data) return alert("Inserisci importo e data del pagamento.");
    setForm(prev => ({ ...prev, pagamenti: [...(prev.pagamenti || []), { importo: parseFloat(nuovoPagamento.importo) || 0, data: nuovoPagamento.data, nominativo: nuovoPagamento.nominativo }] }));
    setNuovoPagamento({ importo: "", data: "", nominativo: "" });
  };
  const rimuoviPagamento = (idx) => setForm(prev => ({ ...prev, pagamenti: prev.pagamenti.filter((_, i) => i !== idx) }));

  // Prenotazione su cui il voucher è stato usato (è l'unico modo per passare a "usato")
  const prenotazioneDelVoucher = (codice) => prenotazioni.find(p => String(p.voucherCodice) === String(codice));

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
    if (!error) { setNuovoPacchetto({ nome: "", importo: "", descrizione: "" }); setShowFormPacchettoCfg(false); fetchPacchetti(); }
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
    setFormOriginale(null);
    setCodiceInModifica(null);
    setCodiceGenerato("");
    setQueryIndirizzo("");
    setRisultatiRicerca([]);
    setNuovoPagamento({ importo: "", data: "", nominativo: "" });
    setMostraErroriValidazione(false);
  };

  // Apre il form di nuovo voucher come overlay compatto (richiamato da Gestione)
  const nuovoVoucherOverlay = () => { resetForm(); setShowFormVoucher(true); };

  // Chiude l'overlay, chiedendo conferma se ci sono modifiche non salvate.
  const chiudiFormVoucher = () => {
    const modificato = JSON.stringify(form) !== JSON.stringify(formOriginale ?? FORM_VUOTO);
    if (modificato && !window.confirm("Ci sono modifiche non salvate. Chiudere comunque?")) return;
    setShowFormVoucher(false);
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
    // Tutti i campi obbligatori vengono controllati insieme (non uno alla volta) così l'utente
    // li vede evidenziati di rosso tutti insieme invece di scoprirli uno a uno a ogni tentativo.
    if (!form.nominativo.trim() || !form.pacchettoNome) {
      setMostraErroriValidazione(true);
      return alert("Compila i campi obbligatori evidenziati in rosso.");
    }
    const erroreCodiceFiscale = erroreCF(form.fattCF);
    if (erroreCodiceFiscale) return alert(erroreCodiceFiscale);
    setMostraErroriValidazione(false);

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
      statoPagamento: statoPagamentoDi(form.pagamenti, form.importo),
      stato
    };

    setSalvataggioVoucher(true);
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
        if (retry.error) { setSalvataggioVoucher(false); alert("Errore durante il salvataggio del voucher."); return; }
      }
    } else {
      // MODIFICA
      const { error } = await supabase.from('voucher').update(payload).eq('codice', codiceInModifica);
      if (error) { console.error(error); setSalvataggioVoucher(false); alert("Errore durante l'aggiornamento del voucher."); return; }
    }

    await sincronizzaPagamenti(codiceFinale, form.pagamenti);

    const salvato = { ...form, stato, dataEmissione: form.dataEmissione || new Date().toISOString() };
    setForm(salvato);
    setFormOriginale(salvato);
    setSalvataggioVoucher(false);
    setCodiceInModifica(codiceFinale);
    setCodiceGenerato(codiceFinale);
    fetchVoucher();
    alert(`Voucher ${codiceFinale} salvato (stato: ${stato}).`);
  };

  // Apre un voucher esistente nel form overlay (dalle righe di Gestione e Storico)
  const caricaVoucherInForm = (v) => {
    const caricato = {
      nominativo: v.nominativo || "",
      dedica: v.dedica || "",
      // il pacchetto è salvato per nome sul voucher: si risale all'id per riselezionarlo nella tendina
      pacchettoId: pacchetti.find(p => p.nome === v.pacchettoNome)?.id || "",
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
      pagamenti: v.pagamenti || [],
      stato: v.stato || "incompleto",
      dataEmissione: v.dataEmissione || ""
    };
    setForm(caricato);
    setFormOriginale(caricato);
    setCodiceInModifica(v.codice);
    setCodiceGenerato(v.codice);
    setQueryIndirizzo("");
    setRisultatiRicerca([]);
    setNuovoPagamento({ importo: "", data: "", nominativo: "" });
    setMostraErroriValidazione(false);
    setShowFormVoucher(true);
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
    await supabase.from('pagamenti').delete().eq('tipo', 'voucher').eq('riferimento', codice);
    fetchVoucher();
  };

  // Ordinamento condiviso da Gestione e Storico: la tabella è la stessa, quindi lo è anche il criterio scelto.
  const { ordina, propsTestata, frecciaOrdinamento } = useOrdinamentoTabella(VALORI_ORDINAMENTO_VOUCHER);

  // ====================== TABELLA CONDIVISA (Gestione / Storico) ======================
  // Il clic sulla riga espande il pannello con i dettagli di fatturazione e le azioni.
  // Il pulsante "Apri" richiama sempre il form come overlay.
  const rigaTabellaVoucher = (v) => {
    const espansa = rigaEspansaId === v.codice;
    const prenUso = prenotazioneDelVoucher(v.codice);
    const totPagato = (v.pagamenti || []).reduce((s, x) => s + (parseFloat(x.importo) || 0), 0);
    const statoPag = statoPagamentoDi(v.pagamenti, v.importo);
    const pagColore = statoPag === 'saldato' ? '#16a34a' : statoPag === 'acconto' ? '#ca8a04' : '#dc2626';
    // Banda laterale con lo stato del voucher, come nelle righe delle prenotazioni
    const coloreStatoRiga = v.stato === 'emesso' ? '#16a34a' : v.stato === 'usato' ? '#94a3b8' : '#f59e0b';
    return (
      <Fragment key={v.codice}>
        <tr onClick={() => setRigaEspansaId(prev => prev === v.codice ? null : v.codice)} style={{ cursor: 'pointer', background: espansa ? '#f8fafc' : undefined, borderBottom: espansa ? 'none' : '1px solid #eee', borderLeft: `3px solid ${coloreStatoRiga}` }}>
          <td style={{ padding: '12px' }}>
            <span className="riga-espandibile-chevron" style={{ transform: espansa ? 'rotate(90deg)' : 'none' }}>›</span>
            <strong>{v.codice}</strong>
          </td>
          <td style={{ padding: '12px', color: '#777', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{formattaDataIT(v.dataEmissione)}</td>
          <td style={{ padding: '12px' }}>👤 {v.nominativo}</td>
          <td style={{ padding: '12px', fontSize: '0.85rem', color: '#555' }}>{v.pacchettoNome} — €{parseFloat(v.importo).toFixed(2)}</td>
          <td style={{ padding: '12px', whiteSpace: 'nowrap' }}>
            <span title={`pagamento ${statoPag}`} style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: pagColore, marginRight: '6px' }}></span>
            €{totPagato.toFixed(2)} <span style={{ color: '#94a3b8' }}>/ €{(parseFloat(v.importo) || 0).toFixed(2)}</span>
          </td>
        </tr>
        {espansa && (
          <tr className="riga-espandibile-dettaglio" style={{ borderLeft: `3px solid ${coloreStatoRiga}` }}>
            <td colSpan={5} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '20px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '0.82rem', color: '#334155' }}>
                  <div style={{ marginBottom: '2px' }}><span className={`badge-stato ${v.stato}`}>{v.stato}</span></div>
                  <div><span style={{ color: '#94a3b8' }}>Fatturazione </span>{v.fattNome || v.fattCognome ? `${v.fattNome || ''} ${v.fattCognome || ''}`.trim() : <em style={{ color: '#999' }}>Da completare</em>}</div>
                  {(v.fattNome || v.fattCognome) && v.fattIndirizzo && <div><span style={{ color: '#94a3b8' }}>Indirizzo </span>{v.fattIndirizzo}</div>}
                  {(v.fattNome || v.fattCognome) && v.fattCF && <div><span style={{ color: '#94a3b8' }}>Codice fiscale </span>{v.fattCF}</div>}
                  <div><span style={{ color: '#94a3b8' }}>Pagamenti </span>{(v.pagamenti && v.pagamenti.length > 0) ? v.pagamenti.map(pg => `€${(parseFloat(pg.importo) || 0).toFixed(2)} il ${pg.data}`).join(', ') : 'nessuno'} <em style={{ color: '#94a3b8' }}>({statoPag})</em></div>
                  {v.stato === 'usato' && (
                    <div><span style={{ color: '#94a3b8' }}>Usato su </span>{prenUso ? `${prenUso.id} — ${prenUso.nominativo || ''} (${prenUso.data || ''})` : <em style={{ color: '#999' }}>prenotazione non trovata</em>}</div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                  <button type="button" className="btn-icon-action" title="Apri" onClick={() => caricaVoucherInForm(v)}><Icona nome="apri" size={16} style={{ marginRight: 0 }} /></button>
                  {user.ruolo === "admin" && (
                    <button type="button" className="btn-icon-action danger" title="Elimina" onClick={() => eliminaVoucher(v.codice)}><Icona nome="elimina" size={16} style={{ marginRight: 0 }} /></button>
                  )}
                </div>
              </div>
            </td>
          </tr>
        )}
      </Fragment>
    );
  };

  const tabellaVoucher = (righe, messaggioVuoto) => (
    <div className="admin-table-box-full" style={{ marginTop: '20px', overflowX: 'auto' }}>
      <table className="storico-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem', background: '#fff' }}>
        <thead>
          <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
            {COLONNE_VOUCHER.map(c => {
              const { style: stileOrdinabile, ...propsOrdinabile } = propsTestata(c.chiave);
              return (
                <th key={c.chiave} {...propsOrdinabile} style={{ padding: '12px', ...stileOrdinabile }}>
                  {c.label}{frecciaOrdinamento(c.chiave)}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {righe.length === 0
            ? <tr><td colSpan="5" style={{ textAlign: 'center', padding: '20px', color: '#666' }}>{messaggioVuoto}</td></tr>
            : ordina(righe).map(rigaTabellaVoucher)}
        </tbody>
      </table>
    </div>
  );

  // ====================== FILTRI STORICO ======================
  const voucherFiltrati = voucherSalvati.filter(v => {
    const mC = (v.codice || "").toLowerCase().includes(filtroCodice.toLowerCase());
    const mN = (v.nominativo || "").toLowerCase().includes(filtroNominativo.toLowerCase());
    const mS = filtroStato === "" || v.stato === filtroStato;
    return mC && mN && mS;
  });

  const importoPDF = datiPDF ? (parseFloat(datiPDF.importo) || 0) : 0;

  // Form Nuovo/Modifica Voucher, mostrato come overlay compatto (stesso stile del form prenotazione).
  const renderFormVoucher = (compatto = false) => {
    const fatturazioneCompleta = fatturazioneCompletaDi(form);
    const pagamentiForm = form.pagamenti || [];
    const importoVoucher = parseFloat(form.importo) || 0;
    const totalePagato = pagamentiForm.reduce((s, p) => s + (parseFloat(p.importo) || 0), 0);
    const statoPag = statoPagamentoDi(pagamentiForm, importoVoucher);

    const formModificato = formOriginale != null && JSON.stringify(form) !== JSON.stringify(formOriginale);

    // Stato visivo di un campo: rosso se obbligatorio e mancante (solo dopo un tentativo di salvataggio),
    // altrimenti giallo se modificato rispetto ai valori caricati (solo in modifica).
    // Sono classi e non style inline perché la regola globale "input { border ... !important }"
    // (per la visibilità su mobile) vincerebbe sempre sull'inline style degli <input>.
    const evidenzia = (chiave, mancante = false) => {
      if (mostraErroriValidazione && mancante) return 'campo-errore';
      const modificato = formOriginale != null && JSON.stringify(form[chiave]) !== JSON.stringify(formOriginale[chiave]);
      return modificato ? 'campo-modificato' : '';
    };
    const nominativoMancante = !form.nominativo.trim();
    const pacchettoMancante = !form.pacchettoNome;
    const setF = (patch) => setForm(prev => ({ ...prev, ...patch }));

    return (
      <div className={`schermata-inserimento no-print form-pren ${compatto ? 'form-pren-compatto' : ''}`}>
        <h2 style={{ margin: 0 }}>{codiceInModifica ? `Modifica Voucher ${codiceInModifica}` : "Nuovo Voucher"}</h2>
        <p className="descrizione-pagina">Il codice viene assegnato automaticamente al salvataggio. Anteprima: <strong>{codiceGenerato || `VCH-${new Date().getFullYear()}-XXXX`}</strong></p>

        {pacchetti.length === 0 && <p className="descrizione-pagina" style={{ color: '#c62828' }}>⚠️ Nessun pacchetto configurato. Vai nel Configuratore.</p>}

        <div className="form-top-grid">
          {/* Dati del voucher: intestatario, dedica, pacchetto */}
          <div className="sezione">
            <h2>Dati del Voucher</h2>
            <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: '12px' }}>Nominativo di intestazione (festeggiato) *
              <input type="text" value={form.nominativo} onChange={(e) => setF({ nominativo: e.target.value })} placeholder="Es. Mario Rossi" className={evidenzia('nominativo', nominativoMancante)} />
            </label>
            <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: '12px' }}>Dedica personalizzata (facoltativa)
              <textarea value={form.dedica} onChange={(e) => setF({ dedica: e.target.value })} rows="2" placeholder="Es. Buon compleanno!" className={evidenzia('dedica')} style={{ marginTop: '5px', fontFamily: 'inherit' }} />
            </label>
            <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem' }}>Pacchetto gioco *
              <select className={`dropdown-gonfiabili ${evidenzia('pacchettoId', pacchettoMancante)}`} value={form.pacchettoId} onChange={(e) => selezionaPacchetto(e.target.value)}>
                <option value="">-- Seleziona pacchetto --</option>
                {pacchetti.map(p => <option key={p.id} value={p.id}>{p.nome} (€{parseFloat(p.importo).toFixed(2)})</option>)}
              </select>
            </label>
          </div>

          {/* Dati di fatturazione dell'acquirente: senza questi il voucher resta incompleto */}
          <div className="sezione">
            <h2>Dati di Fatturazione (acquirente)</h2>
            <p className="descrizione-pagina" style={{ marginTop: 0 }}>Facoltativi in fase di creazione: senza questi dati il voucher resta <strong>incompleto</strong>.</p>
            <div className="date-grid">
              <label style={{ display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.85rem' }}>Nome
                <input type="text" value={form.fattNome} onChange={(e) => setF({ fattNome: e.target.value })} className={evidenzia('fattNome')} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.85rem' }}>Cognome
                <input type="text" value={form.fattCognome} onChange={(e) => setF({ fattCognome: e.target.value })} className={evidenzia('fattCognome')} />
              </label>
            </div>

            <div style={{ margin: '12px 0' }}>
              <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: '5px' }}>Cerca indirizzo di residenza</label>
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

            <div className="date-grid">
              <label style={{ gridColumn: 'span 2', display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.85rem' }}>Indirizzo (via e civico)
                <input type="text" value={form.fattIndirizzo} onChange={(e) => setF({ fattIndirizzo: e.target.value })} className={evidenzia('fattIndirizzo')} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.85rem' }}>CAP
                <input type="text" value={form.fattCap} onChange={(e) => setF({ fattCap: e.target.value })} className={evidenzia('fattCap')} />
              </label>
            </div>
            <div className="date-grid" style={{ marginTop: '12px' }}>
              <label style={{ display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.85rem' }}>Città
                <input type="text" value={form.fattCitta} onChange={(e) => setF({ fattCitta: e.target.value })} className={evidenzia('fattCitta')} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.85rem' }}>Provincia
                <input type="text" value={form.fattProvincia} onChange={(e) => setF({ fattProvincia: e.target.value })} className={evidenzia('fattProvincia')} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.85rem' }}>Codice Fiscale
                <input
                  type="text"
                  value={form.fattCF}
                  maxLength={16}
                  onChange={(e) => setF({ fattCF: e.target.value.toUpperCase() })}
                  className={erroreCF(form.fattCF) ? 'campo-errore' : evidenzia('fattCF')}
                />
              </label>
            </div>
            {erroreCF(form.fattCF) && (
              <p style={{ margin: '6px 0 0 0', fontSize: '0.82rem', color: '#c62828' }}>
                ⚠️ {erroreCF(form.fattCF)}
              </p>
            )}
          </div>
        </div>

        {/* Pagamenti del voucher: righe della tabella unica "pagamenti" (nessun voucher usabile come pagamento, ovviamente) */}
        <div className="sezione">
          <h2>Pagamenti</h2>
          <div className="sotto-sezione" style={{ marginTop: 0, paddingTop: 0, borderTop: 'none' }}>
            <h3>Stato pagamento: <span style={{ fontSize: '0.8rem', fontWeight: 'bold', padding: '3px 10px', borderRadius: '10px', textTransform: 'none', letterSpacing: 0, background: statoPag === 'saldato' ? '#dcfce7' : statoPag === 'acconto' ? '#fef9c3' : '#fee2e2', color: statoPag === 'saldato' ? '#166534' : statoPag === 'acconto' ? '#854d0e' : '#991b1b' }}>{statoPag}</span></h3>
            {pagamentiForm.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', marginBottom: '10px' }}>
                <thead><tr style={{ color: '#666', textAlign: 'left' }}><th style={{ padding: '4px' }}>Data</th><th style={{ padding: '4px' }}>Importo</th><th style={{ padding: '4px' }}>Da</th><th></th></tr></thead>
                <tbody>
                  {pagamentiForm.map((pg, i) => (
                    <tr key={i}>
                      <td style={{ padding: '4px' }}>{pg.data}</td>
                      <td style={{ padding: '4px' }}>€{(parseFloat(pg.importo) || 0).toFixed(2)}</td>
                      <td style={{ padding: '4px' }}>{pg.nominativo || '—'}</td>
                      <td style={{ padding: '4px', textAlign: 'right' }}><button className="btn-rimuovi" style={{ fontSize: '0.72rem', padding: '3px 8px' }} onClick={() => rimuoviPagamento(i)}>🗑</button></td>
                    </tr>
                  ))}
                  <tr><td colSpan="2" style={{ padding: '4px', fontWeight: 'bold' }}>Totale versato: €{totalePagato.toFixed(2)}</td><td colSpan="2" style={{ padding: '4px', color: '#777' }}>su €{importoVoucher.toFixed(2)}</td></tr>
                </tbody>
              </table>
            )}
            {statoPag !== 'saldato' && (
              <div className="pren-row">
                <label style={{ display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.82rem' }}>Data pagamento
                  <input type="date" value={nuovoPagamento.data} onChange={(e) => setNuovoPagamento({ ...nuovoPagamento, data: e.target.value })} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.82rem' }}>Importo €
                  <input type="number" step="any" value={nuovoPagamento.importo} onChange={(e) => setNuovoPagamento({ ...nuovoPagamento, importo: e.target.value })} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.82rem' }}>Nominativo
                  <input type="text" value={nuovoPagamento.nominativo} onChange={(e) => setNuovoPagamento({ ...nuovoPagamento, nominativo: e.target.value })} />
                </label>
                <div style={{ display: 'flex', alignItems: 'end' }}>
                  <button type="button" className="btn-accent-inline" style={{ padding: '8px 14px', fontSize: '0.85rem' }} onClick={aggiungiPagamento}>+ Pagamento</button>
                </div>
              </div>
            )}
            {form.stato === 'usato' && (
              <p className="descrizione-pagina" style={{ margin: '10px 0 0 0' }}>
                🎟️ Voucher già usato{prenotazioneDelVoucher(codiceInModifica) ? ` sulla prenotazione ${prenotazioneDelVoucher(codiceInModifica).id}` : ''}.
              </p>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn-preventivo btn-accent" style={{ width: 'auto', flex: '1 1 auto', marginTop: 0 }} onClick={salvaVoucher} disabled={salvataggioVoucher}>{salvataggioVoucher ? 'Salvataggio…' : (codiceInModifica ? '💾 Salva modifiche' : '💾 Salva Voucher')}</button>
          {codiceInModifica && formModificato && (
            <button type="button" className="btn-annulla-inline" disabled={salvataggioVoucher} onClick={() => { if (window.confirm("Annullare le modifiche non salvate?")) setForm(formOriginale); }}>Annulla modifiche</button>
          )}
          <button className="btn-stampa" style={{ marginTop: 0 }} onClick={stampaFormCorrente} disabled={!codiceGenerato || !fatturazioneCompleta}>🖨️ Scarica PDF</button>
        </div>
        {codiceGenerato && !fatturazioneCompleta && (
          <p style={{ margin: '8px 0 0 0', fontSize: '0.85rem', color: '#c62828' }}>
            ⚠️ Per scaricare il PDF è necessario completare tutti i dati di fatturazione.
          </p>
        )}
      </div>
    );
  };

  return (
    <>
      <nav className="modulo-subnav no-print subnav-segmented">
        {puoVedere(user, 'voucher', 'config') && (
          <button className={`nav-btn ${currentView === 'config' ? 'active' : ''}`} onClick={() => setCurrentView("config")}><Icona nome="configuratore" />Configuratore</button>
        )}
        {puoVedere(user, 'voucher', 'gestione') && (
          <button className={`nav-btn ${currentView === 'gestione' ? 'active' : ''}`} onClick={() => setCurrentView("gestione")}><Icona nome="gestione" />Gestione</button>
        )}
        {puoVedere(user, 'voucher', 'storico') && (
          <button className={`nav-btn ${currentView === 'storico' ? 'active' : ''}`} onClick={() => setCurrentView("storico")}><Icona nome="storico" />Storico Voucher</button>
        )}
      </nav>

      {/* ===================== CONFIGURATORE PACCHETTI ===================== */}
      {currentView === "config" && puoVedere(user, 'voucher', 'config') && (
        <div className="schermata-admin no-print" style={{ padding: '20px' }}>
          <h2>Configuratore Pacchetti Gioco</h2>
          <p className="descrizione-pagina">Definisci i pacchetti: importo e descrizione (testo che apparirà sul voucher).</p>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '15px 0', gap: '10px', flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0 }}>Pacchetti ({pacchetti.length})</h3>
              <button className="btn-preventivo btn-accent" style={{ width: 'auto', marginTop: 0, padding: '8px 16px' }} onClick={() => setShowFormPacchettoCfg(true)}><Icona nome="nuovo" size={16} style={{ marginRight: '6px' }} />Nuovo</button>
            </div>

            {showFormPacchettoCfg && (
              <div className="modal-form-backdrop" onClick={() => setShowFormPacchettoCfg(false)}>
                <div className="modal-form-box" onClick={(e) => e.stopPropagation()}>
                  <button type="button" className="modal-form-close" onClick={() => setShowFormPacchettoCfg(false)} aria-label="Chiudi">✕</button>
                  <h3 style={{ margin: '0 0 15px 0', fontSize: '1.1rem', color: '#0288d1' }}>Aggiungi Pacchetto</h3>
                  <form onSubmit={addPacchetto} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <input type="text" placeholder="Nome pacchetto" value={nuovoPacchetto.nome} onChange={(e) => setNuovoPacchetto({ ...nuovoPacchetto, nome: e.target.value })} style={{ width: '100%', boxSizing: 'border-box', height: '36px', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px' }} />
                    <input type="number" step="any" placeholder="Importo (€)" value={nuovoPacchetto.importo} onChange={(e) => setNuovoPacchetto({ ...nuovoPacchetto, importo: e.target.value })} style={{ width: '100%', boxSizing: 'border-box', height: '36px', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px' }} />
                    <textarea placeholder="Descrizione / testo offerta da stampare" value={nuovoPacchetto.descrizione} onChange={(e) => setNuovoPacchetto({ ...nuovoPacchetto, descrizione: e.target.value })} rows="3" style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px', resize: 'vertical', fontFamily: 'inherit' }} />
                    <button type="submit" style={{ display: 'inline-flex', alignItems: 'center', padding: '9px 18px', background: '#0288d1', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' }}><Icona nome="salva" size={16} style={{ marginRight: '6px' }} />Salva Pacchetto</button>
                  </form>
                </div>
              </div>
            )}

            <div className="admin-table-box" style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', maxHeight: 'none', overflowY: 'visible' }}>
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
                              <button className="btn-accent-inline" onClick={salvaModificaPacchetto} style={{ display: 'inline-flex', alignItems: 'center', fontSize: '0.8rem', padding: '4px 8px' }}><Icona nome="salva" size={14} style={{ marginRight: '4px' }} />Salva</button>
                              <button className="btn-outline-annulla" onClick={() => setIdPacchettoInModifica(null)} style={{ display: 'inline-flex', alignItems: 'center', fontSize: '0.8rem', padding: '4px 8px', borderRadius: '4px' }}><Icona nome="annulla" size={14} style={{ marginRight: '4px' }} />Annulla</button>
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
                              <button className="btn-icon-action" aria-label="Modifica" title="Modifica" onClick={() => { setIdPacchettoInModifica(p.id); setDatiPacchettoInModifica({ nome: p.nome, importo: p.importo, descrizione: p.descrizione || "" }); }}><Icona nome="modifica" size={16} style={{ marginRight: 0 }} /></button>
                              <button className="btn-icon-action danger" aria-label="Elimina" title="Elimina" onClick={() => rimuoviPacchetto(p.id)}><Icona nome="elimina" size={16} style={{ marginRight: 0 }} /></button>
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

      {/* ===================== GESTIONE (sotto-schede per stato) ===================== */}
      {currentView === "gestione" && puoVedere(user, 'voucher', 'gestione') && (() => {
        const incompleti = voucherSalvati.filter(v => v.stato === 'incompleto');
        const emessi = voucherSalvati.filter(v => v.stato === 'emesso');
        const usati = voucherSalvati.filter(v => v.stato === 'usato');
        const liste = { incompleti, emessi, usati };
        const messaggiVuoto = {
          incompleti: "Nessun voucher da completare.",
          emessi: "Nessun voucher emesso in attesa di essere usato.",
          usati: "Nessun voucher usato.",
        };
        return (
          <div className="schermata-storico no-print">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <h2 style={{ margin: 0 }}>Gestione</h2>
              <button className="btn-preventivo btn-accent" style={{ width: 'auto', marginTop: 0, padding: '8px 16px' }} onClick={nuovoVoucherOverlay}>➕ Nuovo</button>
            </div>
            <p className="descrizione-pagina">Voucher raggruppati per stato: completa i dati di fatturazione e registra i pagamenti. Un voucher passa a <strong>usato</strong> solo quando viene selezionato su una prenotazione.</p>
            <nav className="modulo-subnav subnav-segmented" style={{ margin: '10px 0' }}>
              <button className={`nav-btn ${gestioneTab === 'incompleti' ? 'active' : ''}`} onClick={() => setGestioneTab('incompleti')}><Icona nome="daCompletare" />Incompleti ({incompleti.length})</button>
              <button className={`nav-btn ${gestioneTab === 'emessi' ? 'active' : ''}`} onClick={() => setGestioneTab('emessi')}><Icona nome="nuovoVoucher" />Emessi ({emessi.length})</button>
              <button className={`nav-btn ${gestioneTab === 'usati' ? 'active' : ''}`} onClick={() => setGestioneTab('usati')}><Icona nome="completate" />Usati ({usati.length})</button>
            </nav>
            {tabellaVoucher(liste[gestioneTab], messaggiVuoto[gestioneTab])}
          </div>
        );
      })()}

      {/* ===================== STORICO VOUCHER ===================== */}
      {currentView === "storico" && puoVedere(user, 'voucher', 'storico') && (
        <div className="schermata-storico no-print">
          <h2 style={{ margin: 0 }}>Storico Voucher</h2>
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

          {tabellaVoucher(voucherFiltrati, "Nessun voucher trovato.")}
        </div>
      )}

      {/* ===================== FORM NUOVO/MODIFICA VOUCHER (overlay compatto) ===================== */}
      {showFormVoucher && (
        <div className="modal-preventivo-backdrop" onClick={chiudiFormVoucher}>
          <div className="modal-form-pren-box" onClick={(e) => e.stopPropagation()}>
            <button className="btn-chiudi" title="Chiudi" onClick={chiudiFormVoucher}>✕</button>
            {renderFormVoucher(true)}
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
