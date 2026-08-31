import { useState, useEffect, Fragment } from 'react'
import html2pdf from 'html2pdf.js';
import * as XLSX from 'xlsx';
import { supabase } from '../../lib/supabaseClient';
import { COSTO_AL_KM, GIORNI_VALIDITA_PREVENTIVO } from '../../lib/costanti';
import { puoVedere } from '../../lib/permessi';
import Icona from '../../components/Icona';
import { useOrdinamentoTabella } from '../../lib/ordinamentoTabella';
import {
  formattaDataIT,
  calcolaGiorni,
  oreDaOrari,
  arrotondaAllaDecina,
  moltiplicatoreTargetPer,
  isPartenzaBFM,
  costoVivoDi,
  formattaIndirizzoPulito
} from '../../lib/utils';

// Stato effettivo di un preventivo. A database esistono solo "Registrato" e "Confermato":
// "Scaduto" è derivato dalla data di emissione secondo la validità dichiarata sul documento.
// Un preventivo già confermato non scade mai.
const statoPreventivo = (p) => {
  if (p?.stato === "Confermato") return "Confermato";
  if (!p?.dataEmissione) return p?.stato || "Registrato";
  const scadenza = new Date(p.dataEmissione).getTime() + GIORNI_VALIDITA_PREVENTIVO * 24 * 60 * 60 * 1000;
  return Date.now() > scadenza ? "Scaduto" : "Registrato";
};

// Le schede "Preventivatore" e "Vendita" sono superate dal form overlay di Gestione, che fa
// entrambe le cose in un unico passaggio. Restano nel codice ma nascoste, in attesa di essere
// eliminate del tutto: rimettere a true per farle ricomparire.
const SCHEDE_LEGACY_VISIBILI = false;

// Colonne della tabella preventivi (Gestione e Storico): etichetta mostrata e valore su cui ordinare.
// "Destinazione" ordina sulla località come la si legge in tabella (l'ultima parte dell'indirizzo).
// "Flag" non ha valore: sono icone, non un dato per cui abbia senso ordinare.
const COLONNE_PREVENTIVI = [
  { chiave: 'id', label: 'ID', stile: { width: '18%' }, valore: (p) => (typeof p.id === 'object' ? p.id.codice : p.id) || '' },
  { chiave: 'data', label: 'Data', stile: { width: '10%' }, valore: (p) => p.dataEmissione || '' },
  { chiave: 'destinazione', label: 'Destinazione', valore: (p) => (p.destinazione || '').split(',').pop().trim() },
  { chiave: 'referente', label: 'Referente', valore: (p) => p.nomeReferente || '' },
  { chiave: 'vendita', label: 'Vendita', valore: (p) => parseFloat(p.totaleVendita) || 0 },
  { chiave: 'flag', label: 'Flag', stile: { width: '50px' } },
];
const VALORI_ORDINAMENTO_PREVENTIVI = Object.fromEntries(
  COLONNE_PREVENTIVI.filter(c => c.valore).map(c => [c.chiave, c.valore])
);

function Preventivatore({ user }) {
  // --- NAVIGAZIONE INTERNA AL MODULO ---
  const primaSchedaVisibile = ['admin', 'gestione', 'storico'].find(s => puoVedere(user, 'preventivatore', s)) || 'gestione';
  const [currentView, setCurrentView] = useState(primaSchedaVisibile);
  const [gestioneTab, setGestioneTab] = useState("registrati"); // registrati | confermati | scaduti
  const [showFormPreventivo, setShowFormPreventivo] = useState(false); // form Nuovo/Modifica preventivo come overlay

  // --- STATI DEI DATI ---
  const [sedi, setSedi] = useState([]);
  const [gonfiabili, setGonfiabili] = useState([]);
  const [extras, setExtras] = useState([]);
  const [preventiviSalvati, setPreventiviSalvati] = useState([]);
  
  const [nomeRiferimento, setNomeRiferimento] = useState("");
  const [indirizzoEmail, setIndirizzoEmail] = useState("");
  const [telefonoRiferimento, setTelefonoRiferimento] = useState("");

  // --- STATI DEL FORM DI INSERIMENTO ---
  const [nuovaSede, setNuovaSede] = useState({ nome: "", citta: "", referente: "", lat: "", lon: "", costoKm: "", bfm: false });
  const [nuovoGonfiabile, setNuovoGonfiabile] = useState({ 
    nome: "", prezzo: "", locationId: "", giocatori: "", etaConsigliata: "", 
    dimensioni: "", superficie: "", alimentazione: "", tempoMontaggio: ""
  });
  const [nuovoExtra, setNuovoExtra] = useState({ nome: "", prezzo: "", costoLibero: false });

  // --- STATI LAYOUT CONFIGURATORE (sotto-schede, elenchi collassabili, form) ---
  const primaSottoschedaAdmin = ['sedi', 'gonfiabili', 'extra'].find(s => puoVedere(user, 'preventivatore', 'admin', s)) || 'sedi';
  const [configTabAdmin, setConfigTabAdmin] = useState(primaSottoschedaAdmin); // sedi | gonfiabili | extra
  const [showFormSede, setShowFormSede] = useState(false);
  const [showFormGonfiabile, setShowFormGonfiabile] = useState(false);
  const [showFormExtra, setShowFormExtra] = useState(false);

  // --- STATI DI MODIFICA IN LINEA ---
  const [idSedeInModifica, setIdSedeInModifica] = useState(null);
  const [datiSedeInModifica, setDatiSedeInModifica] = useState({ nome: "", citta: "", referente: "", lat: "", lon: "", costoKm: "", bfm: false });
  const [idGonfiabileEspanso, setIdGonfiabileEspanso] = useState(null); // riga dell'elenco gonfiabili con le specifiche a vista
  const [idGonfiabileInModifica, setIdGonfiabileInModifica] = useState(null);
  const [datiGonfiabileInModifica, setDatiGonfiabileInModifica] = useState({ 
    nome: "", prezzo: "", locationId: "", giocatori: "", etaConsigliata: "", 
    dimensioni: "", superficie: "", alimentazione: "", tempoMontaggio: ""
  });
  const [idExtraInModifica, setIdExtraInModifica] = useState(null);
  const [datiExtraInModifica, setDatiExtraInModifica] = useState({ nome: "", prezzo: "", costoLibero: false });

  // --- STATI DEL PREVENTIVATORE ---
  const [serviziSelezionati, setServiziSelezionati] = useState([]);
  const [quantitaGonfiabili, setQuantitaGonfiabili] = useState({}); // quantità di pezzi per ciascun gonfiabile (chiave = nome)
  const [dataInizio, setDataInizio] = useState("");
  const [dataFine, setDataFine] = useState("");
  // Orario di servizio giornaliero: è un dato del documento, non entra nel calcolo dei costi
  // (che restano legati ai giorni di noleggio e ai trasporti).
  const [oraInizio, setOraInizio] = useState("");
  const [oraFine, setOraFine] = useState("");
  const [unSoloTrasporto, setUnSoloTrasporto] = useState(false);
  const [extraSelezionati, setExtraSelezionati] = useState([]);
  const [costiExtraLiberi, setCostiExtraLiberi] = useState({}); // costo inserito manualmente per gli extra "a costo libero" (chiave = id extra)
  const [queryIndirizzo, setQueryIndirizzo] = useState("");
  const [risultatiRicerca, setRisultatiRicerca] = useState([]);
  const [destinazione, setDestinazione] = useState(null);
  const [loadingCalcolo, setLoadingCalcolo] = useState(false);
  const [soluzioniMigliori, setSoluzioniMigliori] = useState({});
  const [modalitaModifica, setModalitaModifica] = useState(false); // true quando si sta modificando/ristampando un preventivo salvato
  const [notePreventivo, setNotePreventivo] = useState("");
  const [idPreventivo, setIdPreventivo] = useState({ codice: "", dettagliLogistici: null });
  // Data di emissione del preventivo aperto: il PDF ristampato deve riportare la data originale, non quella odierna
  const [dataEmissionePreventivo, setDataEmissionePreventivo] = useState(null);
  // Stato a database del preventivo aperto: correggere un preventivo già confermato non lo
  // riporta a "Registrato", la conferma si toglie solo dal pulsante apposito in Gestione.
  const [statoDocumento, setStatoDocumento] = useState("Registrato");
  const [salvataggioPreventivo, setSalvataggioPreventivo] = useState(false);
  // Stato di lavoro al momento del caricamento/salvataggio: serve per "Annulla modifiche"
  const [statoOriginale, setStatoOriginale] = useState(null);

  // --- STATI PER LA PAGINA VENDITA ---
  const [venditaGonfiabili, setVenditaGonfiabili] = useState({});
  const [venditaExtras, setVenditaExtras] = useState({});
  const [mostraComeOpzioni, setMostraComeOpzioni] = useState(false);
  const [mostraGiocoOfferta, setMostraGiocoOfferta] = useState(false);
  const [giocoOffertaSelezionato, setGiocoOffertaSelezionato] = useState("");
  const [soluzioneGiocoOfferta, setSoluzioneGiocoOfferta] = useState(null);
  const [venditaGiocoOfferta, setVenditaGiocoOfferta] = useState({ prezzo: "", sconto: "0" });

  // --- PREZZO CONCORDATO ---
  // Sblocca sede e costo su ogni riga di vendita, per riscrivere a mano quanto calcolato dal
  // sistema quando con un fornitore è stato pattuito un importo diverso. Le righe che non si
  // toccano restano quelle calcolate: l'importo digitato è il costo pieno (trasporto compreso).
  const [prezzoConcordato, setPrezzoConcordato] = useState(false);
  const [sediConcordate, setSediConcordate] = useState({}); // sede scelta a mano (chiave = nome gonfiabile, valore = id sede)
  const [costiConcordati, setCostiConcordati] = useState({}); // costo pattuito (chiave = nome gonfiabile)

  // --- STATI PER I FILTRI DELLO STORICO ---
  const [filtroId, setFiltroId] = useState("");
  const [filtroDestinazione, setFiltroDestinazione] = useState("");
  const [filtroStato, setFiltroStato] = useState("");
  const [filtroReferente, setFiltroReferente] = useState("");
  const [filtroEmail, setFiltroEmail] = useState("");
  const [rigaEspansaId, setRigaEspansaId] = useState(null); // id preventivo con riga dettaglio espansa (Storico)

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
      const prevFormattati = preventiviData.map(p => ({
        id: { codice: p.codice, dettagliLogistici: p.dettagliLogistici },
        dataEmissione: p.dataEmissione,
        destinazione: p.destinazione,
        periodo: p.periodo,
        giorni: p.giorni,
        oraInizio: p.oraInizio,
        oraFine: p.oraFine,
        oreNoleggio: p.oreNoleggio,
        gonfiabili: p.gonfiabili,
        extras: p.extras,
        totaleVendita: parseFloat(p.totaleVendita),
        note: p.note,
        stato: p.stato,
        nomeReferente: p.nomeReferente,
        emailReferente: p.emailReferente,
        telefonoReferente: p.telefonoReferente,
        costoVivoTotale: parseFloat(p.costoVivoTotale),
        kmAndata: parseFloat(p.kmAndata),
        unSoloTrasporto: p.unSoloTrasporto,
        mostraComeOpzioni: p.mostraComeOpzioni,
        prezzoConcordato: p.prezzoConcordato,
        mostraGiocoOfferta: p.mostraGiocoOfferta,
        giocoOfferta: p.giocoOfferta
      }));
      setPreventiviSalvati(prevFormattati);
    }
  };

  // Il numero documento resta agganciato al preventivo aperto anche mentre lo si modifica:
  // per crearne uno nuovo si usa esplicitamente "Nuovo preventivo" (come in voucher e prenotazioni).

  // Azzera tutti i dati di lavoro, senza toccare la navigazione
  const azzeraPreventivo = () => {
    setServiziSelezionati([]);
    setQuantitaGonfiabili({});
    setDataInizio("");
    setDataFine("");
    setOraInizio("");
    setOraFine("");
    setUnSoloTrasporto(false);
    setExtraSelezionati([]);
    setCostiExtraLiberi({});
    setQueryIndirizzo("");
    setRisultatiRicerca([]);
    setDestinazione(null);
    setSoluzioniMigliori({});
    setNotePreventivo("");
    setIdPreventivo({ codice: "", dettagliLogistici: null });
    setDataEmissionePreventivo(null);
    setStatoDocumento("Registrato");
    setStatoOriginale(null);
    setVenditaGonfiabili({});
    setVenditaExtras({});
    setMostraComeOpzioni(false);
    setMostraGiocoOfferta(false);
    setGiocoOffertaSelezionato("");
    setSoluzioneGiocoOfferta(null);
    setVenditaGiocoOfferta({ prezzo: "", sconto: "0" });
    setPrezzoConcordato(false);
    setSediConcordate({});
    setCostiConcordati({});
    setNomeRiferimento("");
    setIndirizzoEmail("");
    setTelefonoRiferimento("");
    setModalitaModifica(false);
  };

  // --- SNAPSHOT DELLO STATO DI LAVORO (per "Annulla modifiche") ---
  // Fotografa tutto ciò che l'utente può cambiare nel form, così da poterlo confrontare e ripristinare.
  const snapshotPreventivo = () => ({
    serviziSelezionati, quantitaGonfiabili, dataInizio, dataFine, oraInizio, oraFine, unSoloTrasporto,
    extraSelezionati, costiExtraLiberi, destinazione, soluzioniMigliori,
    venditaGonfiabili, venditaExtras, mostraComeOpzioni, mostraGiocoOfferta,
    giocoOffertaSelezionato, soluzioneGiocoOfferta, venditaGiocoOfferta,
    prezzoConcordato, sediConcordate, costiConcordati,
    nomeRiferimento, indirizzoEmail, telefonoRiferimento, notePreventivo
  });

  // Costi e chilometraggi sono ricalcolati da OSRM: variano da soli e non sono modifiche dell'utente,
  // quindi restano fuori dal confronto (ma dentro allo snapshot, per il ripristino).
  const CAMPI_DERIVATI = ['soluzioniMigliori', 'soluzioneGiocoOfferta'];
  const impronta = (snap) => {
    if (!snap) return null;
    const datiUtente = Object.fromEntries(Object.entries(snap).filter(([k]) => !CAMPI_DERIVATI.includes(k)));
    // Della destinazione conta solo l'indirizzo scelto: le coordinate arrivano dalla geocodifica
    // fatta all'apertura di un preventivo salvato e non sono una modifica dell'utente.
    datiUtente.destinazione = snap.destinazione?.nome ?? null;
    return JSON.stringify(datiUtente);
  };

  const ripristinaSnapshot = (snap) => {
    if (!snap) return;
    setServiziSelezionati(snap.serviziSelezionati);
    setQuantitaGonfiabili(snap.quantitaGonfiabili);
    setDataInizio(snap.dataInizio);
    setDataFine(snap.dataFine);
    setOraInizio(snap.oraInizio);
    setOraFine(snap.oraFine);
    setUnSoloTrasporto(snap.unSoloTrasporto);
    setExtraSelezionati(snap.extraSelezionati);
    setCostiExtraLiberi(snap.costiExtraLiberi);
    setDestinazione(snap.destinazione);
    setSoluzioniMigliori(snap.soluzioniMigliori);
    setVenditaGonfiabili(snap.venditaGonfiabili);
    setVenditaExtras(snap.venditaExtras);
    setMostraComeOpzioni(snap.mostraComeOpzioni);
    setMostraGiocoOfferta(snap.mostraGiocoOfferta);
    setGiocoOffertaSelezionato(snap.giocoOffertaSelezionato);
    setSoluzioneGiocoOfferta(snap.soluzioneGiocoOfferta);
    setVenditaGiocoOfferta(snap.venditaGiocoOfferta);
    setPrezzoConcordato(snap.prezzoConcordato);
    setSediConcordate(snap.sediConcordate);
    setCostiConcordati(snap.costiConcordati);
    setNomeRiferimento(snap.nomeRiferimento);
    setIndirizzoEmail(snap.indirizzoEmail);
    setTelefonoRiferimento(snap.telefonoRiferimento);
    setNotePreventivo(snap.notePreventivo);
  };

  const preventivoModificato = statoOriginale != null && impronta(snapshotPreventivo()) !== impronta(statoOriginale);

  // Avvia un nuovo preventivo: azzera tutti i dati, chiude l'overlay e torna al preventivatore
  const nuovoPreventivo = () => {
    azzeraPreventivo();
    setShowFormPreventivo(false);
    setCurrentView("calculator");
  };

  // Apre il form di nuovo preventivo come overlay compatto (richiamato da Gestione)
  const nuovoPreventivoOverlay = () => { azzeraPreventivo(); setShowFormPreventivo(true); };

  // Chiude l'overlay, chiedendo conferma se c'è del lavoro non ancora salvato
  const chiudiFormPreventivo = () => {
    const nuovoNonSalvato = !idPreventivo.codice && (serviziSelezionati.length > 0 || !!destinazione);
    if ((nuovoNonSalvato || preventivoModificato) && !window.confirm("Ci sono modifiche non salvate. Chiudere comunque?")) return;
    setShowFormPreventivo(false);
  };

  // Converte il testo "Dal gg/mm/aaaa al gg/mm/aaaa" nelle due date ISO (yyyy-mm-dd)
  const estraiDateDaPeriodo = (periodo) => {
    const m = (periodo || "").match(/(\d{2})\/(\d{2})\/(\d{4}).*?(\d{2})\/(\d{2})\/(\d{4})/);
    if (!m) return { inizio: "", fine: "" };
    return { inizio: `${m[3]}-${m[2]}-${m[1]}`, fine: `${m[6]}-${m[5]}-${m[4]}` };
  };

  // Ricostruisce lo stato di lavoro a partire da un preventivo salvato (per modifica o ristampa)
  const caricaPreventivo = (p) => {
    const codice = typeof p.id === 'object' ? p.id.codice : p.id;
    const gonf = p.gonfiabili || [];
    const ex = p.extras || [];

    // Soluzioni logistiche ricostruite dai costi salvati (niente ricalcolo OSRM)
    const soluzioni = {};
    const quantita = {};
    const vendita = {};
    // Righe a prezzo concordato: si ricostruiscono sede e importo digitati, così restano modificabili
    const sediConc = {};
    const costiConc = {};
    gonf.forEach(g => {
      const costoBase = parseFloat(g.costoNoleggio) || 0;
      const costoKm = parseFloat(g.costoLogistica) || 0;
      const sedeSalvata = sedi.find(s => s.nome === g.sedePartenza);
      soluzioni[g.nome] = {
        // L'istanza va ripresa dalla sede salvata: è quella di cui il PDF riporta la scheda tecnica
        prodotto: gonfiabili.find(x => x.nome === g.nome && x.locationId === sedeSalvata?.id)
          || gonfiabili.find(x => x.nome === g.nome)
          || { prezzo: 0 },
        // Il flag "di proprietà" va riletto dall'anagrafica sedi: nel preventivo si salva solo il nome
        partenza: { nome: g.sedePartenza || "—", bfm: !!sedeSalvata?.bfm },
        kmAndata: parseFloat(g.kmCalcolati) || 0,
        costoKmTotale: costoKm,
        costoBaseMoltiplicato: costoBase,
        quantita: g.quantita || 1,
        totaleOpzione: costoBase + costoKm
      };
      if (g.concordato) {
        sediConc[g.nome] = sedeSalvata?.id || "";
        costiConc[g.nome] = String(costoBase);
      }
      quantita[g.nome] = g.quantita || 1;
      vendita[g.nome] = { prezzo: String(g.prezzoVendita ?? ""), sconto: "0" };
    });

    // Extra: rimappa per nome verso gli id correnti
    const idsExtra = [];
    const venditaEx = {};
    const costiLiberiEx = {};
    ex.forEach(e => {
      const trovato = extras.find(x => x.nome === e.nome);
      if (trovato) {
        idsExtra.push(trovato.id);
        venditaEx[trovato.id] = { prezzo: String(e.prezzoVendita ?? ""), sconto: "0" };
        if (trovato.costoLibero) costiLiberiEx[trovato.id] = String(e.costo ?? "");
      }
    });

    const { inizio, fine } = estraiDateDaPeriodo(p.periodo);

    // Ripristino del gioco in offerta dallo snapshot salvato
    let soluzioneGO = null;
    let venditaGO = { prezzo: "", sconto: "0" };
    if (p.mostraGiocoOfferta && p.giocoOfferta) {
      const go = p.giocoOfferta;
      // I preventivi salvati prima dell'introduzione del flag non hanno la sede nello snapshot:
      // in quel caso si risale alla sede dall'anagrafica del gonfiabile.
      const sedeGO = sedi.find(s => s.nome === go.sedePartenza)
        || sedi.find(s => s.id === gonfiabili.find(g => g.nome === go.nome)?.locationId);
      soluzioneGO = {
        prodotto: gonfiabili.find(g => g.nome === go.nome) || { prezzo: 0 },
        partenza: { nome: sedeGO?.nome || go.sedePartenza || "—", bfm: !!sedeGO?.bfm },
        kmAndata: go.kmAndata || 0,
        costoKmTotale: go.costoLogistica || 0,
        costoBaseMoltiplicato: go.costoBase || 0,
        totaleOpzione: (go.costoBase || 0) + (go.costoLogistica || 0)
      };
      venditaGO = { prezzo: String(go.prezzo ?? ""), sconto: String(go.sconto ?? "0") };
    }

    const snap = {
      serviziSelezionati: gonf.map(g => g.nome),
      quantitaGonfiabili: quantita,
      dataInizio: inizio,
      dataFine: fine,
      oraInizio: p.oraInizio || "",
      oraFine: p.oraFine || "",
      unSoloTrasporto: !!p.unSoloTrasporto,
      extraSelezionati: idsExtra,
      costiExtraLiberi: costiLiberiEx,
      destinazione: { nome: p.destinazione },
      soluzioniMigliori: soluzioni,
      venditaGonfiabili: vendita,
      venditaExtras: venditaEx,
      mostraComeOpzioni: !!p.mostraComeOpzioni,
      prezzoConcordato: !!p.prezzoConcordato,
      sediConcordate: sediConc,
      costiConcordati: costiConc,
      mostraGiocoOfferta: !!(p.mostraGiocoOfferta && p.giocoOfferta),
      giocoOffertaSelezionato: p.giocoOfferta?.nome || "",
      soluzioneGiocoOfferta: soluzioneGO,
      venditaGiocoOfferta: venditaGO,
      nomeRiferimento: p.nomeReferente || "",
      indirizzoEmail: p.emailReferente || "",
      telefonoRiferimento: p.telefonoReferente || "",
      notePreventivo: p.note || ""
    };

    setModalitaModifica(true);
    ripristinaSnapshot(snap);
    setStatoOriginale(snap);
    setDataEmissionePreventivo(p.dataEmissione || null);
    // A database esistono solo "Registrato" e "Confermato": "Scaduto" è derivato e non va risalvato.
    setStatoDocumento(p.stato === "Confermato" ? "Confermato" : "Registrato");
    setIdPreventivo({ codice, dettagliLogistici: (typeof p.id === 'object' ? p.id.dettagliLogistici : null) });
    return codice;
  };

  const modificaPreventivo = (p) => {
    caricaPreventivo(p);
    setCurrentView("sales");
  };

  // Apre un preventivo esistente nel form overlay (dalle righe di Gestione)
  const apriPreventivoOverlay = (p) => {
    caricaPreventivo(p);
    setShowFormPreventivo(true);
  };

  const giorniNoleggio = calcolaGiorni(dataInizio, dataFine);

  // Conteggio ore: è la durata della fascia oraria giornaliera e resta tale anche su più giorni
  // (2 giorni dalle 15 alle 18 sono "2 giorni · 3 ore", non 6). Null finché mancano gli orari.
  const oreNoleggio = oreDaOrari(oraInizio, oraFine);
  const formattaOre = (n) => String(n).replace('.', ',');

  // --- CALCOLO PERCORSI STRADALI ---
  // Con `mantieniEsistenti` i risultati si sommano a quelli già presenti invece di sostituirli:
  // serve sui preventivi salvati, dove i costi degli articoli originali non vanno ricalcolati.
  const ricalcolaTuttiIPercorsi = async (nomiScelti, dest, mantieniEsistenti = false) => {
    if (!dest?.lat || !dest?.lon || nomiScelti.length === 0) {
      if (!mantieniEsistenti) setSoluzioniMigliori({});
      return;
    }
    setLoadingCalcolo(true);
    const nuoveSoluzioni = {};

    try {
      for (const nomeGonfiabile of nomiScelti) {
        // Un gonfiabile a prezzo 0 non è quotabile: vincerebbe sempre il confronto fra le sedi
        // falsando i costi. Resta selezionabile solo a prezzo concordato, digitando l'importo.
        const istanzeProdotto = gonfiabili.filter(g => g.nome === nomeGonfiabile && (parseFloat(g.prezzo) || 0) > 0);
        const calcoliIstanze = istanzeProdotto.map(async (istanza) => {
          const sedePartenza = sedi.find(s => s.id === istanza.locationId);
          if (!sedePartenza) return null;

          const url = `https://router.project-osrm.org/route/v1/driving/${sedePartenza.lon},${sedePartenza.lat};${dest.lon},${dest.lat}?overview=false`;
          const response = await fetch(url);
          const data = await response.json();

          if (data.code === "Ok") {
            const kmAndata = data.routes[0].distance / 1000;
            const moltiplicatoreTrasporto = unSoloTrasporto ? 1 : giorniNoleggio;
            const costoKmSede = parseFloat(sedePartenza.costoKm) || COSTO_AL_KM;
            const costoKmTotale = (kmAndata * 2) * costoKmSede * moltiplicatoreTrasporto;
            // La quantità moltiplica SOLO il prezzo base (i trasporti restano invariati)
            const quantita = quantitaGonfiabili[nomeGonfiabile] || 1;
            const costoBaseMoltiplicato = istanza.prezzo * giorniNoleggio * quantita;

            return {
              prodotto: istanza,
              partenza: sedePartenza,
              kmAndata: kmAndata,
              costoKmTotale: costoKmTotale,
              costoBaseMoltiplicato: costoBaseMoltiplicato,
              quantita: quantita,
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
      setSoluzioniMigliori(prev => mantieniEsistenti ? { ...prev, ...nuoveSoluzioni } : nuoveSoluzioni);
    } catch (error) {
      console.error(error);
    }
    setLoadingCalcolo(false);
  };

  useEffect(() => {
    if (!destinazione) return;
    if (modalitaModifica) {
      // Preventivo salvato: i costi approvati non si toccano finché l'utente non cambia i dati
      // che li determinano. Date e trasporto valgono per tutti gli articoli; la quantità e
      // l'aggiunta di un gioco riguardano solo la riga interessata.
      const logisticaCambiata = statoOriginale && (
        dataInizio !== statoOriginale.dataInizio ||
        dataFine !== statoOriginale.dataFine ||
        unSoloTrasporto !== statoOriginale.unSoloTrasporto
      );
      const daCalcolare = logisticaCambiata
        ? serviziSelezionati
        : serviziSelezionati.filter(nome => {
            const sol = soluzioniMigliori[nome];
            return !sol || (sol.quantita || 1) !== (quantitaGonfiabili[nome] || 1);
          });
      if (daCalcolare.length > 0) ricalcolaTuttiIPercorsi(daCalcolare, destinazione, true);
      return;
    }
    ricalcolaTuttiIPercorsi(serviziSelezionati, destinazione);
  }, [serviziSelezionati, quantitaGonfiabili, giorniNoleggio, unSoloTrasporto, gonfiabili, sedi, destinazione]);

  // Un preventivo riaperto conserva solo il testo dell'indirizzo: le coordinate si recuperano
  // via Nominatim, così da poter quotare eventuali gonfiabili aggiunti in un secondo momento.
  useEffect(() => {
    if (!modalitaModifica || !destinazione?.nome || destinazione.lat) return;
    let annullato = false;
    (async () => {
      try {
        // L'indirizzo salvato è in forma leggibile ("CAP 26866, Marudo (Lodi)"): così com'è
        // Nominatim non lo trova, va tolto il prefisso CAP e sciolta la provincia tra parentesi.
        const query = destinazione.nome.replace(/\bCAP\s+/gi, '').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
        const risposta = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=it&limit=1`);
        const dati = await risposta.json();
        if (!annullato && dati?.[0]) {
          setDestinazione(prev => ({ ...prev, lat: dati[0].lat, lon: dati[0].lon }));
        }
      } catch (error) {
        console.error("Geocodifica indirizzo preventivo non riuscita:", error);
      }
    })();
    return () => { annullato = true; };
  }, [modalitaModifica, destinazione?.nome, destinazione?.lat]);

  // --- GONFIABILI PRESSO LE SEDI DI PROPRIETÀ (flag BFM) UTILIZZABILI COME GIOCO IN OFFERTA ---
  const gonfiabiliBFM = gonfiabili.filter(g => {
    const sede = sedi.find(s => s.id === g.locationId);
    return !!sede?.bfm;
  });

  // --- CALCOLO COSTO/LOGISTICA DEL GIOCO IN OFFERTA ---
  useEffect(() => {
    // Su un preventivo salvato lo snapshot del gioco già in offerta non si tocca, ma se se ne
    // sceglie un altro va quotato come gli altri articoli aggiunti in modifica.
    if (modalitaModifica && soluzioneGiocoOfferta?.prodotto?.nome === giocoOffertaSelezionato) return;
    const calcolaGiocoOfferta = async () => {
      if (!mostraGiocoOfferta || !giocoOffertaSelezionato || !destinazione?.lat) {
        setSoluzioneGiocoOfferta(null);
        return;
      }
      const istanza = gonfiabiliBFM.find(g => g.nome === giocoOffertaSelezionato);
      const sedePartenza = sedi.find(s => s.id === istanza?.locationId);
      if (!istanza || !sedePartenza) {
        setSoluzioneGiocoOfferta(null);
        return;
      }
      try {
        const url = `https://router.project-osrm.org/route/v1/driving/${sedePartenza.lon},${sedePartenza.lat};${destinazione.lon},${destinazione.lat}?overview=false`;
        const response = await fetch(url);
        const data = await response.json();
        if (data.code === "Ok") {
          const kmAndata = data.routes[0].distance / 1000;
          const moltiplicatoreTrasporto = unSoloTrasporto ? 1 : giorniNoleggio;
          const costoKmSede = parseFloat(sedePartenza.costoKm) || COSTO_AL_KM;
          const costoKmTotale = (kmAndata * 2) * costoKmSede * moltiplicatoreTrasporto;
          const costoBaseMoltiplicato = istanza.prezzo * giorniNoleggio;
          setSoluzioneGiocoOfferta({
            prodotto: istanza,
            partenza: sedePartenza,
            kmAndata,
            costoKmTotale,
            costoBaseMoltiplicato,
            totaleOpzione: costoBaseMoltiplicato + costoKmTotale
          });
        } else {
          setSoluzioneGiocoOfferta(null);
        }
      } catch (error) {
        console.error(error);
        setSoluzioneGiocoOfferta(null);
      }
    };
    calcolaGiocoOfferta();
  }, [mostraGiocoOfferta, giocoOffertaSelezionato, destinazione, giorniNoleggio, unSoloTrasporto, gonfiabili, sedi, modalitaModifica]);

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

  // Il ricalcolo lo innesca l'effetto che osserva la destinazione: qui basta impostarla.
  // Cambiare indirizzo invalida tutte le logistiche già calcolate, anche su un preventivo salvato.
  const selezionaIndirizzo = (luogo) => {
    setSoluzioniMigliori({});
    setDestinazione({ lat: luogo.lat, lon: luogo.lon, nome: formattaIndirizzoPulito(luogo) });
    setRisultatiRicerca([]);
    setQueryIndirizzo("");
  };

  const aggiungiNomeGonfiabile = (nome) => {
    if (!nome) return;
    if (!serviziSelezionati.includes(nome)) {
      setServiziSelezionati(prev => [...prev, nome]);
      setQuantitaGonfiabili(prev => ({ ...prev, [nome]: prev[nome] || 1 }));
    }
  };

  const cambiaQuantitaGonfiabile = (nome, valore) => {
    const q = Math.max(1, parseInt(valore) || 1);
    setQuantitaGonfiabili(prev => ({ ...prev, [nome]: q }));
  };

  // Passo +/- del selettore in tabella: aggiorna sul valore corrente, così clic ravvicinati
  // non si sovrascrivono a vicenda.
  const variaQuantitaGonfiabile = (nome, delta) => {
    setQuantitaGonfiabili(prev => ({ ...prev, [nome]: Math.max(1, (prev[nome] || 1) + delta) }));
  };

  const aggiungiExtraSelezionato = (id) => {
    if (!id) return;
    setExtraSelezionati(prev => prev.includes(id) ? prev : [...prev, id]);
  };

  const rimuoviExtraSelezionato = (id) => {
    setExtraSelezionati(prev => prev.filter(x => x !== id));
    setVenditaExtras(prev => {
      const clone = { ...prev };
      delete clone[id];
      return clone;
    });
    setCostiExtraLiberi(prev => {
      const clone = { ...prev };
      delete clone[id];
      return clone;
    });
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
    setQuantitaGonfiabili(prev => {
      const clone = { ...prev };
      delete clone[nome];
      return clone;
    });
    setSediConcordate(prev => {
      const clone = { ...prev };
      delete clone[nome];
      return clone;
    });
    setCostiConcordati(prev => {
      const clone = { ...prev };
      delete clone[nome];
      return clone;
    });
  };

  // --- SOLUZIONE EFFETTIVA DI UNA RIGA ---
  // A prezzo concordato la riga vale quanto pattuito a mano: sede scelta dall'utente e costo pieno
  // digitato, senza km né trasporto. Finché non si tocca nulla resta valida la soluzione calcolata,
  // così le righe già quotate non vanno ridigitate. Ovunque servano i costi di un gonfiabile si
  // passa da qui, non da soluzioniMigliori.
  const soluzioneDi = (nome) => {
    const automatica = soluzioniMigliori[nome];
    if (!prezzoConcordato) return automatica;

    const idSede = sediConcordate[nome];
    const costoDigitato = costiConcordati[nome];
    const sedeScelta = sedi.find(s => s.id === idSede);
    // Nessuna scelta manuale su questa riga: vale quanto calcolato dal sistema
    if (!sedeScelta && (costoDigitato === undefined || costoDigitato === "")) return automatica;

    const partenza = sedeScelta || automatica?.partenza || { nome: "—", bfm: false };
    const prodotto = gonfiabili.find(g => g.nome === nome && g.locationId === idSede)
      || automatica?.prodotto
      || gonfiabili.find(g => g.nome === nome)
      || { prezzo: 0 };
    const costo = parseFloat(costoDigitato) || 0;
    return {
      prodotto,
      partenza,
      kmAndata: 0,
      costoKmTotale: 0,
      costoBaseMoltiplicato: costo,
      quantita: quantitaGonfiabili[nome] || 1,
      totaleOpzione: costo,
      concordata: true
    };
  };

  // L'arrotondamento alla decina serve a smussare i costi stimati dal sistema. Un costo concordato
  // è invece un importo pattuito con il fornitore e vale esattamente quello: non si arrotonda.
  const costoVivoArrotondato = (sol) => sol?.concordata ? costoVivoDi(sol) : arrotondaAllaDecina(costoVivoDi(sol));
  // Base su cui si propone il prezzo di vendita (il prezzo proposto resta arrotondato alla decina).
  const baseCalcoloPrezzo = (sol) => !sol ? 0 : (sol.concordata ? sol.totaleOpzione : arrotondaAllaDecina(sol.totaleOpzione));

  // --- CALCOLI TOTALI E ARROTONDAMENTI ---
  // Per i gonfiabili in partenza da una sede di proprietà (flag BFM) il prezzo del gonfiabile concorre
  // solo al calcolo del prezzo di vendita (vedi moltiplicatoreTargetPer): come costo resta a zero e
  // conta unicamente la logistica (vedi costoVivoDi).
  let totaleComplessivoCostiBase = 0;
  serviziSelezionati.forEach(nome => {
    const sol = soluzioneDi(nome);
    if (sol) totaleComplessivoCostiBase += costoVivoArrotondato(sol);
  });
  
  // Per gli extra "a costo libero" il costo non è quello configurato in anagrafica,
  // ma quello inserito manualmente ogni volta in fase di preventivo (vedi costiExtraLiberi).
  const getCostoExtra = (ex) => {
    if (!ex) return 0;
    if (ex.costoLibero) return parseFloat(costiExtraLiberi[ex.id]) || 0;
    return parseFloat(ex.prezzo) || 0;
  };

  const costoExtraBase = extras.filter(e => extraSelezionati.includes(e.id)).reduce((acc, curr) => acc + arrotondaAllaDecina(getCostoExtra(curr)), 0);
  const totaleComplessivoCostoFlotta = totaleComplessivoCostiBase + costoExtraBase;

  let totaleVenditaComplessivo = 0;
  serviziSelezionati.forEach(nome => {
    const sol = soluzioneDi(nome);
    const cost = baseCalcoloPrezzo(sol);
    const defaultPrezzo = arrotondaAllaDecina(cost * moltiplicatoreTargetPer(sol?.partenza, sol?.concordata));
    
    const vPrezzo = (venditaGonfiabili[nome]?.prezzo !== undefined && venditaGonfiabili[nome]?.prezzo !== "") 
      ? parseFloat(venditaGonfiabili[nome].prezzo) 
      : defaultPrezzo;
      
    const vSconto = parseFloat(venditaGonfiabili[nome]?.sconto) || 0;
    totaleVenditaComplessivo += vPrezzo * (1 - vSconto / 100);
  });

  extras.filter(e => extraSelezionati.includes(e.id)).forEach(ex => {
    const cost = arrotondaAllaDecina(getCostoExtra(ex));
    const defaultPrezzo = cost; // Per gli extra, si propone direttamente il costo arrotondato
    
    const vPrezzo = (venditaExtras[ex.id]?.prezzo !== undefined && venditaExtras[ex.id]?.prezzo !== "") 
      ? parseFloat(venditaExtras[ex.id].prezzo) 
      : defaultPrezzo;
      
    const vSconto = parseFloat(venditaExtras[ex.id]?.sconto) || 0;
    totaleVenditaComplessivo += vPrezzo * (1 - vSconto / 100);
  });

  const scaricaPreventivoPDF = (codiceFile) => {
    const element = document.getElementById('sezione-da-stampare');
    const opt = {
      margin: 10,
      filename: `${codiceFile || idPreventivo.codice}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      // Evita che righe/tabelle/blocchi vengano spezzati tra una pagina e l'altra
      pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', '.pdf-evita-taglio'] }
    };
    html2pdf().set(opt).from(element).save();
  };

  // Scarica il PDF del preventivo attualmente nel form (deve essere già salvato per avere un codice).
  // Il documento è sempre montato fuori schermo, quindi non serve nessuna anteprima a video.
  const scaricaPDFPreventivo = () => {
    if (!idPreventivo.codice) return alert("Salva prima il preventivo, poi potrai scaricare il PDF.");
    scaricaPreventivoPDF(idPreventivo.codice);
  };

  // --- LOGICA DI SALVATAGGIO PREVENTIVO ---
  const salvaPreventivo = async () => {
    if (serviziSelezionati.length === 0 || !destinazione) {
      return alert("Per salvare servono almeno un gonfiabile e il luogo di consegna.");
    }

    const dettagliGonfiabili = serviziSelezionati.map(nome => {
      const sol = soluzioneDi(nome);
      const costTotal = baseCalcoloPrezzo(sol);
      const defaultPrezzo = arrotondaAllaDecina(costTotal * moltiplicatoreTargetPer(sol?.partenza, sol?.concordata));

      const vPrezzo = (venditaGonfiabili[nome]?.prezzo !== undefined && venditaGonfiabili[nome]?.prezzo !== "")
        ? parseFloat(venditaGonfiabili[nome].prezzo)
        : defaultPrezzo;
      const vSconto = parseFloat(venditaGonfiabili[nome]?.sconto) || 0;

      return {
        nome,
        quantita: quantitaGonfiabili[nome] || 1,
        sedePartenza: sol?.partenza?.nome || "",
        // Il costo concordato è pattuito col fornitore: si salva com'è, anche da sede di proprietà.
        // Sedi di proprietà quotate dal sistema: il noleggio non è un costo, resta a zero.
        costoNoleggio: sol?.concordata ? (sol.costoBaseMoltiplicato || 0) : (isPartenzaBFM(sol?.partenza) ? 0 : (sol?.costoBaseMoltiplicato || 0)),
        costoLogistica: sol?.costoKmTotale || 0,
        kmCalcolati: sol?.kmAndata || 0,
        concordato: !!sol?.concordata,
        prezzoVendita: vPrezzo * (1 - vSconto / 100)
      };
    });

    const dettagliExtra = extras.filter(e => extraSelezionati.includes(e.id)).map(e => {
      const costTotal = arrotondaAllaDecina(getCostoExtra(e));
      const defaultPrezzo = costTotal;

      const vPrezzo = (venditaExtras[e.id]?.prezzo !== undefined && venditaExtras[e.id]?.prezzo !== "")
        ? parseFloat(venditaExtras[e.id].prezzo)
        : defaultPrezzo;
      const vSconto = parseFloat(venditaExtras[e.id]?.sconto) || 0;

      return {
        nome: e.nome,
        costo: costTotal,
        costoLibero: !!e.costoLibero,
        prezzoVendita: vPrezzo * (1 - vSconto / 100)
      };
    });

    // Calcolo del kilometraggio totale andata per il database
    const totaleKmAndata = serviziSelezionati.reduce((acc, nome) => acc + (soluzioneDi(nome)?.kmAndata || 0), 0);

    // Snapshot del gioco in offerta (se attivo)
    let giocoOffertaSnap = null;
    if (mostraGiocoOfferta && giocoOffertaSelezionato && soluzioneGiocoOfferta) {
      const prezzoPropostoGO = arrotondaAllaDecina(soluzioneGiocoOfferta.totaleOpzione);
      const costoCalcolatoGO = arrotondaAllaDecina(costoVivoDi(soluzioneGiocoOfferta));
      const vPrezzoGO = (venditaGiocoOfferta.prezzo !== undefined && venditaGiocoOfferta.prezzo !== "") ? parseFloat(venditaGiocoOfferta.prezzo) : prezzoPropostoGO;
      const vScontoGO = parseFloat(venditaGiocoOfferta.sconto) || 0;
      giocoOffertaSnap = {
        nome: giocoOffertaSelezionato,
        sedePartenza: soluzioneGiocoOfferta.partenza?.nome || "",
        // Sedi di proprietà: il noleggio non è un costo, resta a zero
        costoBase: isPartenzaBFM(soluzioneGiocoOfferta.partenza) ? 0 : (soluzioneGiocoOfferta.costoBaseMoltiplicato || 0),
        costoLogistica: soluzioneGiocoOfferta.costoKmTotale || 0,
        kmAndata: soluzioneGiocoOfferta.kmAndata || 0,
        costoVivo: costoCalcolatoGO,
        prezzo: vPrezzoGO,
        sconto: vScontoGO,
        prezzoVendita: vPrezzoGO * (1 - vScontoGO / 100)
      };
    }

    // Dettaglio logistico per riga, ricalcolato a ogni salvataggio dai costi correnti
    const dettagliLogistici = serviziSelezionati.map(nome => ({
      nome,
      quantita: quantitaGonfiabili[nome] || 1,
      kmAndata: soluzioneDi(nome)?.kmAndata,
      costoVivoTotale: costoVivoDi(soluzioneDi(nome))
    }));

    // La data di emissione è quella del primo salvataggio: un preventivo riaperto e corretto
    // mantiene la data (e quindi la scadenza) del documento già inviato al cliente.
    const emissione = dataEmissionePreventivo || new Date().toISOString();

    // Il codice NON viene inviato: lo genera il database (anno corrente + progressivo).
    const nuovoPreventivoDB = {
      dataEmissione: emissione,
      destinazione: destinazione?.nome || "N/D",
      periodo: `Dal ${formattaDataIT(dataInizio)} al ${formattaDataIT(dataFine)}`,
      giorni: giorniNoleggio,
      oraInizio: oraInizio || null,
      oraFine: oraFine || null,
      oreNoleggio,
      gonfiabili: dettagliGonfiabili,
      extras: dettagliExtra,
      totaleVendita: totaleVenditaComplessivo,
      note: notePreventivo,
      stato: statoDocumento,
      nomeReferente: nomeRiferimento,
      emailReferente: indirizzoEmail,
      telefonoReferente: telefonoRiferimento,
      costoVivoTotale: totaleComplessivoCostoFlotta,
      kmAndata: totaleKmAndata, // Salvataggio kilometraggio
      dettagliLogistici,
      unSoloTrasporto: unSoloTrasporto,
      mostraComeOpzioni: mostraComeOpzioni,
      prezzoConcordato: prezzoConcordato,
      mostraGiocoOfferta: mostraGiocoOfferta,
      giocoOfferta: giocoOffertaSnap
    };

    let codiceFinale = idPreventivo.codice;
    setSalvataggioPreventivo(true);

    if (!codiceFinale) {
      // Primo salvataggio: inserimento (il DB assegna il codice tramite trigger)
      const { error } = await supabase
        .from('preventivi')
        .insert([nuovoPreventivoDB]);

      if (error) {
        console.error("Errore salvataggio DB:", error);
        setSalvataggioPreventivo(false);
        alert("Errore durante il salvataggio nel Database!");
        return;
      }

      // Rileggo il codice appena generato (il più recente in ordine decrescente)
      const { data: ultimo, error: errLettura } = await supabase
        .from('preventivi')
        .select('codice')
        .order('codice', { ascending: false })
        .limit(1)
        .single();

      if (errLettura || !ultimo) {
        console.error("Errore lettura codice generato:", errLettura);
        setSalvataggioPreventivo(false);
        alert("Preventivo salvato, ma impossibile recuperare il numero documento.");
        fetchData();
        return;
      }

      codiceFinale = ultimo.codice;
    } else {
      // Risalvataggio dello stesso preventivo: aggiorno il record esistente
      const { error } = await supabase
        .from('preventivi')
        .update(nuovoPreventivoDB)
        .eq('codice', codiceFinale);

      if (error) {
        console.error("Errore salvataggio DB:", error);
        setSalvataggioPreventivo(false);
        alert("Errore durante il salvataggio nel Database!");
        return;
      }
    }

    // Da qui in poi si lavora su un documento esistente: "Annulla modifiche" riparte da quanto salvato
    setIdPreventivo({ codice: codiceFinale, dettagliLogistici });
    setDataEmissionePreventivo(emissione);
    setStatoOriginale(snapshotPreventivo());
    setSalvataggioPreventivo(false);
    fetchData();
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
    const matchStato = filtroStato === "" || statoPreventivo(p) === filtroStato;
    const matchReferente = (p.nomeReferente?.toLowerCase() || "").includes(filtroReferente.toLowerCase());
    const matchEmail = (p.emailReferente?.toLowerCase() || "").includes(filtroEmail.toLowerCase());
    return matchId && matchDest && matchStato && matchReferente && matchEmail;
  });

  // --- ESPORTAZIONE EXCEL ---
  const esportaExcel = () => {
    const datiPerExcel = preventiviFiltrati.map(item => {
      // Compongo un dettaglio testuale dei costi vivi per il file Excel per maggiore completezza
      const dettaglioCostiVivi = [
        ...(item.gonfiabili || []).map(g => `${g.nome} (Costo: €${(g.costoNoleggio || 0).toFixed(2)}, Km: ${(g.kmCalcolati || 0).toFixed(1)})`),
        ...(item.extras || []).map(e => `${e.nome} (Costo: €${(e.costo || 0).toFixed(2)})`)
      ].join(' | ');

      return {
        Codice: typeof item.id === 'object' ? item.id.codice : item.id,
        DataEmissione: formattaDataIT(item.dataEmissione),
        Referente: item.nomeReferente || "",
        Email: item.emailReferente || "",
        Telefono: item.telefonoReferente || "",
        Destinazione: item.destinazione,
        Periodo: item.periodo,
        Orario: item.oraInizio && item.oraFine ? `${item.oraInizio} - ${item.oraFine}` : "",
        Ore: item.oreNoleggio != null ? parseFloat(item.oreNoleggio) : "",
        TotaleVendita: item.totaleVendita.toFixed(2),
        DettaglioCostiVivi: dettaglioCostiVivi,
        CostoVivoTotale: (item.costoVivoTotale || 0).toFixed(2),
        KmAndata: (item.kmAndata || 0).toFixed(1),
        Stato: statoPreventivo(item)
      };
    });
    
    const worksheet = XLSX.utils.json_to_sheet(datiPerExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Storico Preventivi");
    XLSX.writeFile(workbook, "Storico_Preventivi.xlsx");
  };

  // --- FUNZIONI PANEL ADMIN ---
  const addSede = async (e) => {
    e.preventDefault();
    if (!nuovaSede.nome || !nuovaSede.lat || !nuovaSede.lon) return alert("Compila tutti i campi");
    const newSede = { id: "loc_" + Date.now(), nome: nuovaSede.nome, citta: nuovaSede.citta, referente: nuovaSede.referente, lat: parseFloat(nuovaSede.lat), lon: parseFloat(nuovaSede.lon), costoKm: parseFloat(nuovaSede.costoKm) || COSTO_AL_KM, bfm: nuovaSede.bfm };
    const { error } = await supabase.from('sedi').insert([newSede]);
    if (!error) { setNuovaSede({ nome: "", citta: "", referente: "", lat: "", lon: "", costoKm: "", bfm: false }); setShowFormSede(false); fetchData(); }
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
      setShowFormGonfiabile(false);
      fetchData();
    }
  };

  const addExtra = async (e) => {
    e.preventDefault();
    if (!nuovoExtra.nome || (!nuovoExtra.costoLibero && !nuovoExtra.prezzo)) return alert("Compila tutti i campi");
    const newE = {
      id: "e_" + Date.now(),
      nome: nuovoExtra.nome,
      prezzo: nuovoExtra.costoLibero ? 0 : parseFloat(nuovoExtra.prezzo),
      costoLibero: nuovoExtra.costoLibero
    };
    const { error } = await supabase.from('extras').insert([newE]);
    if (!error) { setNuovoExtra({ nome: "", prezzo: "", costoLibero: false }); setShowFormExtra(false); fetchData(); }
  };

  const salvaModificaSede = async () => {
    await supabase.from('sedi').update({ nome: datiSedeInModifica.nome, citta: datiSedeInModifica.citta, referente: datiSedeInModifica.referente, lat: parseFloat(datiSedeInModifica.lat), lon: parseFloat(datiSedeInModifica.lon), costoKm: parseFloat(datiSedeInModifica.costoKm) || COSTO_AL_KM, bfm: datiSedeInModifica.bfm }).eq('id', idSedeInModifica);
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
    await supabase.from('extras').update({
      nome: datiExtraInModifica.nome,
      prezzo: datiExtraInModifica.costoLibero ? 0 : parseFloat(datiExtraInModifica.prezzo) || 0,
      costoLibero: datiExtraInModifica.costoLibero
    }).eq('id', idExtraInModifica);
    setIdExtraInModifica(null); fetchData();
  };

  const rimuoviSede = async (id) => { await supabase.from('sedi').delete().eq('id', id); fetchData(); };
  const rimuoviGonfiabile = async (id) => { await supabase.from('gonfiabili').delete().eq('id', id); fetchData(); };
  const rimuoviExtra = async (id) => { await supabase.from('extras').delete().eq('id', id); fetchData(); };

  const nomiUniciGonfiabili = Array.from(new Set(gonfiabili.map(g => g.nome)));
  // Un gonfiabile presente solo a prezzo 0 non è quotabile dal sistema: compare fra i selezionabili
  // soltanto a prezzo concordato, dove il costo lo si digita a mano.
  const quotabileAutomaticamente = (nome) => gonfiabili.some(g => g.nome === nome && (parseFloat(g.prezzo) || 0) > 0);
  const gonfiabiliDisponibiliInDropdown = nomiUniciGonfiabili
    .filter(nome => !serviziSelezionati.includes(nome))
    .filter(nome => prezzoConcordato || quotabileAutomaticamente(nome));

  // Sedi presso cui esiste un dato gonfiabile: sono i fornitori con cui si può pattuire il prezzo
  const sediDiGonfiabile = (nome) => gonfiabili
    .filter(g => g.nome === nome)
    .map(g => sedi.find(s => s.id === g.locationId))
    .filter(Boolean);

  // ====================== BLOCCHI RIUSABILI DEL PREVENTIVO ======================
  // Gli stessi blocchi compongono sia le schede a sé stanti (Preventivatore / Vendita)
  // sia il form overlay compatto richiamato da Gestione: nessuna logica duplicata.

  const renderDateLogistica = () => (
    <>
      {/* Le due date appaiate sulla prima riga, gli orari corrispondenti su quella sotto */}
      <div className="date-grid coppia">
        <label style={{ display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.85rem' }}>Inizio
          <input type="date" value={dataInizio} onChange={(e) => setDataInizio(e.target.value)} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.85rem' }}>Fine
          <input type="date" value={dataFine} onChange={(e) => setDataFine(e.target.value)} />
        </label>
      </div>
      <div className="date-grid coppia">
        <label style={{ display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.85rem' }}>Ora inizio
          <input type="time" value={oraInizio} onChange={(e) => setOraInizio(e.target.value)} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.85rem' }}>Ora fine
          <input type="time" value={oraFine} onChange={(e) => setOraFine(e.target.value)} />
        </label>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.85rem', color: '#555', marginTop: '12px' }}>Durata
        <div className="valore">
          {giorniNoleggio} {giorniNoleggio === 1 ? 'giorno' : 'giorni'}
          {oreNoleggio != null && (
            <span style={{ color: '#64748b', fontWeight: 500 }}>
              {` · ${formattaOre(oreNoleggio)} ${oreNoleggio === 1 ? 'ora' : 'ore'}`}
            </span>
          )}
        </div>
      </div>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', fontWeight: 600, marginTop: '12px', cursor: 'pointer' }}>
        <input type="checkbox" checked={unSoloTrasporto} onChange={(e) => setUnSoloTrasporto(e.target.checked)} />
        Un solo trasporto A/R
      </label>
    </>
  );

  const renderSelezioneGonfiabili = () => (
    <>
      <select value="" onChange={(e) => aggiungiNomeGonfiabile(e.target.value)} className="dropdown-gonfiabili">
        <option value="">-- Seleziona modello --</option>
        {gonfiabiliDisponibiliInDropdown.map(nome => <option key={nome} value={nome}>{nome}</option>)}
      </select>
      {serviziSelezionati.length > 0 && (
        <div className="lista-scelti-container">
          <ul className="lista-scelti">
            {serviziSelezionati.map(nome => (
              <li key={nome} className="item-scelto">
                <span><Icona nome="gonfiabili" size={15} />{nome}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', color: '#475569', fontWeight: 600 }}>
                    Qtà
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={quantitaGonfiabili[nome] || 1}
                      onChange={(e) => cambiaQuantitaGonfiabile(nome, e.target.value)}
                      style={{ width: '64px' }}
                    />
                  </label>
                  <button type="button" className="btn-icon-action danger" aria-label="Rimuovi" title="Rimuovi" onClick={() => rimuoviNomeGonfiabile(nome)}><Icona nome="elimina" size={16} style={{ marginRight: 0 }} /></button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );

  // Il luogo di consegna determina tutta la logistica del preventivo: una volta scelto resta
  // fissato, perché cambiarlo invaliderebbe km, costi e prezzi già definiti sugli articoli.
  // Per un'altra destinazione si parte da un preventivo nuovo.
  const renderLuogoConsegna = () => (
    <>
      {destinazione ? (
        <div className="luogo-confermato">
          <Icona nome="sedi" size={15} />
          <span>{destinazione.nome}</span>
        </div>
      ) : (
        <>
          <div className="ricerca-box">
            <input type="text" placeholder="Scrivi indirizzo..." value={queryIndirizzo} onChange={(e) => setQueryIndirizzo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), cercaIndirizzo())} />
            <button type="button" onClick={cercaIndirizzo}>Cerca</button>
          </div>
          {risultatiRicerca.length > 0 && (
            <ul className="risultati-ricerca">
              {risultatiRicerca.map(luogo => (
                <li key={luogo.place_id} onClick={() => selezionaIndirizzo(luogo)}>{formattaIndirizzoPulito(luogo)}</li>
              ))}
            </ul>
          )}
          <p className="descrizione-pagina" style={{ margin: '6px 0 0 0' }}>
            Va indicato prima di aggiungere giochi e servizi, e non è più modificabile una volta scelto.
          </p>
        </>
      )}
      {loadingCalcolo && <p className="loading">Calcolo in corso...</p>}
    </>
  );

  const renderServiziExtra = () => (
    <div className="extra-grid">
      {extras.map(srv => {
        const selezionato = extraSelezionati.includes(srv.id);
        return (
          <div key={srv.id} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <label className="extra-label">
              <input type="checkbox" checked={selezionato} onChange={() => setExtraSelezionati(prev => prev.includes(srv.id) ? prev.filter(x => x !== srv.id) : [...prev, srv.id])} />
              {srv.nome} {!srv.costoLibero && `(+€${parseFloat(srv.prezzo).toFixed(2)})`}
            </label>
            {srv.costoLibero && selezionato && (
              <input
                type="number"
                step="any"
                placeholder="Costo (€)"
                value={costiExtraLiberi[srv.id] ?? ""}
                onChange={(e) => setCostiExtraLiberi(prev => ({ ...prev, [srv.id]: e.target.value }))}
                style={{ width: '110px' }}
              />
            )}
          </div>
        );
      })}
    </div>
  );

  const renderDettaglioCosti = () => (
    <>
      <div className="blocco-dettaglio-calcolo">
        {serviziSelezionati.map(nome => {
          const sol = soluzioneDi(nome);
          return (
            <div key={nome} className="scheda-riepilogo-prodotto">
              <h4>{nome}</h4>
              {sol ? (
                <div className="voci-prezzo">
                  <p>Magazzino: <em>{sol.partenza.nome}</em></p>
                  <p>Quantità: <span>{sol.quantita || 1} pz</span></p>
                  {/* Su una riga concordata non c'è nessuna scomposizione: vale l'importo pattuito */}
                  {sol.concordata ? (
                    <p>• Costo concordato: <span>€{(sol.costoBaseMoltiplicato || 0).toFixed(2)}</span></p>
                  ) : (
                    <>
                      <p>• Noleggio ({sol.quantita || 1} × €{parseFloat(sol.prodotto.prezzo).toFixed(2)} × {giorniNoleggio}g): <span>€{(isPartenzaBFM(sol.partenza) ? 0 : sol.costoBaseMoltiplicato).toFixed(2)}</span></p>
                      <p>• Logistica ({sol.kmAndata.toFixed(1)} km):<span>€{sol.costoKmTotale.toFixed(2)}</span></p>
                    </>
                  )}
                  <p className="subtotale-prodotto">Subtotale: <strong>€{costoVivoDi(sol).toFixed(2)}</strong></p>
                </div>
              ) : <p className="avviso-calcolo">Inserisci la destinazione per calcolare i costi.</p>}
            </div>
          );
        })}
        {extraSelezionati.length > 0 && (
          <div className="scheda-riepilogo-prodotto extra-box-dettaglio">
            <h4>Accessori</h4>
            {extras.filter(e => extraSelezionati.includes(e.id)).map(e => (
              <p key={e.id}>• {e.nome}: <span>€{getCostoExtra(e).toFixed(2)}</span></p>
            ))}
            <p className="subtotale-prodotto">Subtotale Extra: <strong>€{costoExtraBase.toFixed(2)}</strong></p>
          </div>
        )}
      </div>
      <div className="totale-box-finale">
        <h3>TOTALE COSTI STIMATO: <span>€{totaleComplessivoCostoFlotta.toFixed(2)}</span></h3>
      </div>
    </>
  );

  // Prezzo/sconto proposti per un gonfiabile: base = costo arrotondato × moltiplicatore target.
  // Per le sedi di proprietà il prezzo di anagrafica è già di vendita, quindi la proposta parte
  // dal totale (noleggio + logistica) anche se come costo il noleggio resta a zero.
  const rigaVenditaGonfiabile = (nome) => {
    const sol = soluzioneDi(nome);
    const costo = costoVivoArrotondato(sol);
    const proposto = arrotondaAllaDecina(baseCalcoloPrezzo(sol) * moltiplicatoreTargetPer(sol?.partenza, sol?.concordata));
    const prezzo = venditaGonfiabili[nome]?.prezzo ?? proposto.toFixed(2);
    const sconto = venditaGonfiabili[nome]?.sconto ?? "0";
    const effettivo = prezzo !== "" ? parseFloat(prezzo) : proposto;
    return { sol, costo, proposto, prezzo, sconto, totale: effettivo * (1 - (parseFloat(sconto) || 0) / 100), sottoCosto: prezzo !== "" && parseFloat(prezzo) < costo };
  };

  const rigaVenditaExtra = (ex) => {
    const costo = arrotondaAllaDecina(getCostoExtra(ex));
    const prezzo = venditaExtras[ex.id]?.prezzo ?? costo.toFixed(2);
    const sconto = venditaExtras[ex.id]?.sconto ?? "0";
    const effettivo = prezzo !== "" ? parseFloat(prezzo) : costo;
    return { costo, prezzo, sconto, totale: effettivo * (1 - (parseFloat(sconto) || 0) / 100), sottoCosto: prezzo !== "" && parseFloat(prezzo) < costo };
  };

  // Cella della seconda riga: l'intestazione della tabella descrive la prima, quindi qui
  // ogni valore si porta dietro la propria etichetta.
  const cellaEtichettata = (etichetta, contenuto) => (
    <td className="num cella-etichettata">
      <span className="mini-etichetta">{etichetta}</span>
      {contenuto}
    </td>
  );

  // Costi e prezzi nella stessa tabella, divisa in Giochi, Offerta e Servizi accessori.
  // Ogni gioco occupa due righe: sopra la logistica (quantità, km, trasporto, noleggio),
  // sotto la parte commerciale (costo vivo, prezzo, sconto, totale).
  // In coda a ogni gruppo resta una riga con la tendina di aggiunta.
  const renderTabellaVendita = () => {
    const extraScelti = extras.filter(e => extraSelezionati.includes(e.id));
    const extraDisponibili = extras.filter(e => !extraSelezionati.includes(e.id));
    const colonne = 6;
    const senzaDestinazione = !destinazione;

    // Coppia di righe di un gioco: `chiave` distingue i gonfiabili del preventivo (per nome)
    // dal gioco in offerta, che ha stato e regole proprie ma si presenta allo stesso modo.
    const righeGioco = ({ chiave, nome, sol, costo, proposto, prezzo, sconto, totale, sottoCosto, qta, onQta, onPrezzo, onSconto, onRimuovi, titoloRimuovi, concordabile }) => {
      const noleggio = sol ? (sol.concordata ? (sol.costoBaseMoltiplicato || 0) : (isPartenzaBFM(sol.partenza) ? 0 : (sol.costoBaseMoltiplicato || 0))) : null;
      return (
        <Fragment key={chiave}>
          <tr className="riga-articolo">
            <td>
              <strong>{nome}</strong>
              {/* A prezzo concordato la sede si sceglie: è il fornitore con cui si è pattuito l'importo */}
              {concordabile ? (
                <select className="select-sede-concordata" value={sediConcordate[nome] ?? ""}
                  onChange={(e) => setSediConcordate(prev => ({ ...prev, [nome]: e.target.value }))}>
                  <option value="">{sol?.partenza?.nome ? `da ${sol.partenza.nome} (calcolata)` : "Scegli il fornitore…"}</option>
                  {sediDiGonfiabile(nome).map(s => <option key={s.id} value={s.id}>da {s.nome}</option>)}
                </select>
              ) : (
                <div className="secondaria">{sol?.partenza?.nome ? `da ${sol.partenza.nome}` : 'sede non definita'}</div>
              )}
            </td>
            <td className="num">
              {onQta ? (
                <div className="stepper-qta">
                  <button type="button" aria-label="Diminuisci quantità" onClick={() => onQta(-1)}>−</button>
                  <input type="number" min="1" step="1" className="input-qta" value={qta}
                    onChange={(e) => onQta(null, e.target.value)} />
                  <button type="button" aria-label="Aumenta quantità" onClick={() => onQta(1)}>+</button>
                </div>
              ) : <span className="secondaria">{qta}</span>}
            </td>
            {/* Su una riga concordata km e trasporto non si calcolano: l'importo pattuito è già pieno */}
            <td className="num secondaria">{!sol || sol.concordata ? '—' : sol.kmAndata.toFixed(1)}</td>
            <td className="num secondaria">{!sol || sol.concordata ? '—' : `€${(sol.costoKmTotale || 0).toFixed(2)}`}</td>
            <td className="num secondaria">{sol ? `€${noleggio.toFixed(2)}` : '—'}</td>
            <td className="num">
              <button type="button" className="btn-icon-action danger" aria-label={titoloRimuovi} title={titoloRimuovi} onClick={onRimuovi}>
                <Icona nome="elimina" size={15} style={{ marginRight: 0 }} />
              </button>
            </td>
          </tr>
          <tr className="riga-prezzi">
            <td>{sottoCosto && <span className="warning-testo">Prezzo sotto costo</span>}</td>
            {cellaEtichettata("Costo vivo",
              concordabile
                ? <input type="number" step="any" className="input-vendita" placeholder={sol && !sol.concordata ? costo.toFixed(2) : "0.00"}
                    value={costiConcordati[nome] ?? ""}
                    onChange={(e) => setCostiConcordati(prev => ({ ...prev, [nome]: e.target.value }))} />
                : (sol ? <strong>€{costo.toFixed(2)}</strong> : <em className="secondaria">da calcolare</em>))}
            {cellaEtichettata("Prezzo €",
              <input type="number" step="any" placeholder={proposto.toFixed(2)} value={prezzo}
                className={sottoCosto ? "input-vendita error" : "input-vendita"}
                onChange={(e) => onPrezzo(e.target.value)} />)}
            {cellaEtichettata("Sconto %",
              <input type="number" min="0" max="100" value={sconto} className="input-vendita"
                onChange={(e) => onSconto(e.target.value)} />)}
            {cellaEtichettata("Totale", <span className="totale">€{totale.toFixed(2)}</span>)}
            <td></td>
          </tr>
        </Fragment>
      );
    };

    return (
      <div className="tabella-vendita-box">
        <table className="tabella-vendita">
          <thead>
            <tr>
              <th>Articolo</th>
              <th className="num">Qtà</th>
              <th className="num">Km</th>
              <th className="num">Trasporto</th>
              <th className="num">Noleggio</th>
              <th></th>
            </tr>
          </thead>

          <tbody>
            <tr className="riga-gruppo"><td colSpan={colonne}>Giochi</td></tr>

            {serviziSelezionati.map(nome => {
              const r = rigaVenditaGonfiabile(nome);
              return righeGioco({
                chiave: nome,
                nome,
                sol: r.sol,
                costo: r.costo,
                proposto: r.proposto,
                prezzo: r.prezzo,
                sconto: r.sconto,
                totale: r.totale,
                sottoCosto: r.sottoCosto,
                qta: quantitaGonfiabili[nome] || 1,
                onQta: (delta, valore) => delta === null ? cambiaQuantitaGonfiabile(nome, valore) : variaQuantitaGonfiabile(nome, delta),
                onPrezzo: (v) => setVenditaGonfiabili(prev => ({ ...prev, [nome]: { ...prev[nome], prezzo: v } })),
                onSconto: (v) => setVenditaGonfiabili(prev => ({ ...prev, [nome]: { ...prev[nome], sconto: v } })),
                onRimuovi: () => rimuoviNomeGonfiabile(nome),
                titoloRimuovi: "Rimuovi",
                // Solo i giochi del preventivo si concordano: il gioco in offerta resta come calcolato
                concordabile: prezzoConcordato
              });
            })}

            <tr className="riga-aggiunta">
              <td colSpan={colonne}>
                {/* Senza luogo di consegna non si può quotare nulla: la scelta resta bloccata */}
                <select value="" onChange={(e) => aggiungiNomeGonfiabile(e.target.value)} disabled={senzaDestinazione || gonfiabiliDisponibiliInDropdown.length === 0}>
                  <option value="">
                    {senzaDestinazione
                      ? "Indica prima il luogo di consegna"
                      : (gonfiabiliDisponibiliInDropdown.length === 0 ? "Tutti i giochi sono già in elenco" : "+ Aggiungi gioco…")}
                  </option>
                  {!senzaDestinazione && gonfiabiliDisponibiliInDropdown.map(nome => <option key={nome} value={nome}>{nome}</option>)}
                </select>
              </td>
            </tr>

            {/* L'offerta sta fra i giochi e i servizi, ma resta fuori dai totali: è una proposta a sé */}
            {mostraGiocoOfferta && (
              <>
                <tr className="riga-gruppo"><td colSpan={colonne}>Offerta</td></tr>

                {giocoOffertaSelezionato && (() => {
                  const costo = arrotondaAllaDecina(costoVivoDi(soluzioneGiocoOfferta));
                  const proposto = soluzioneGiocoOfferta ? arrotondaAllaDecina(soluzioneGiocoOfferta.totaleOpzione) : 0;
                  const prezzo = venditaGiocoOfferta.prezzo ?? proposto.toFixed(2);
                  const sconto = venditaGiocoOfferta.sconto ?? "0";
                  const effettivo = prezzo !== "" ? parseFloat(prezzo) : proposto;
                  return righeGioco({
                    chiave: `offerta-${giocoOffertaSelezionato}`,
                    nome: giocoOffertaSelezionato,
                    sol: soluzioneGiocoOfferta,
                    costo,
                    proposto,
                    prezzo,
                    sconto,
                    totale: effettivo * (1 - (parseFloat(sconto) || 0) / 100),
                    sottoCosto: prezzo !== "" && parseFloat(prezzo) < costo,
                    qta: 1,
                    onQta: null, // il gioco in offerta è sempre un pezzo solo
                    onPrezzo: (v) => setVenditaGiocoOfferta(prev => ({ ...prev, prezzo: v })),
                    onSconto: (v) => setVenditaGiocoOfferta(prev => ({ ...prev, sconto: v })),
                    onRimuovi: () => setGiocoOffertaSelezionato(""),
                    titoloRimuovi: "Togli il gioco in offerta"
                  });
                })()}

                {!giocoOffertaSelezionato && (
                  <tr className="riga-aggiunta">
                    <td colSpan={colonne}>
                      {/* Solo i giochi presso sedi di proprietà possono essere messi in offerta */}
                      <select value="" onChange={(e) => setGiocoOffertaSelezionato(e.target.value)} disabled={senzaDestinazione}>
                        <option value="">{senzaDestinazione ? "Indica prima il luogo di consegna" : "+ Scegli il gioco in offerta…"}</option>
                        {!senzaDestinazione && gonfiabiliBFM.map(g => <option key={g.id} value={g.nome}>{g.nome}</option>)}
                      </select>
                    </td>
                  </tr>
                )}
              </>
            )}

            <tr className="riga-gruppo"><td colSpan={colonne}>Servizi accessori</td></tr>

            {extraScelti.map(ex => {
              const r = rigaVenditaExtra(ex);
              return (
                <tr key={ex.id} className="riga-prezzi riga-servizio">
                  <td>
                    <strong>{ex.nome}</strong>
                    {r.sottoCosto && <div className="warning-testo">Prezzo sotto costo</div>}
                  </td>
                  {cellaEtichettata("Costo vivo",
                    /* Gli extra "a costo libero" hanno un importo diverso ogni volta: si digita qui */
                    ex.costoLibero
                      ? <input type="number" step="any" className="input-vendita" placeholder="0.00"
                          value={costiExtraLiberi[ex.id] ?? ""}
                          onChange={(e) => setCostiExtraLiberi(prev => ({ ...prev, [ex.id]: e.target.value }))} />
                      : <strong>€{r.costo.toFixed(2)}</strong>)}
                  {cellaEtichettata("Prezzo €",
                    <input type="number" step="any" placeholder={r.costo.toFixed(2)} value={r.prezzo}
                      className={r.sottoCosto ? "input-vendita error" : "input-vendita"}
                      onChange={(e) => setVenditaExtras(prev => ({ ...prev, [ex.id]: { ...prev[ex.id], prezzo: e.target.value } }))} />)}
                  {cellaEtichettata("Sconto %",
                    <input type="number" min="0" max="100" value={r.sconto} className="input-vendita"
                      onChange={(e) => setVenditaExtras(prev => ({ ...prev, [ex.id]: { ...prev[ex.id], sconto: e.target.value } }))} />)}
                  {cellaEtichettata("Totale", <span className="totale">€{r.totale.toFixed(2)}</span>)}
                  <td className="num">
                    <button type="button" className="btn-icon-action danger" aria-label="Rimuovi" title="Rimuovi" onClick={() => rimuoviExtraSelezionato(ex.id)}>
                      <Icona nome="elimina" size={15} style={{ marginRight: 0 }} />
                    </button>
                  </td>
                </tr>
              );
            })}

            <tr className="riga-aggiunta">
              <td colSpan={colonne}>
                <select value="" onChange={(e) => aggiungiExtraSelezionato(e.target.value)} disabled={senzaDestinazione || extraDisponibili.length === 0}>
                  <option value="">
                    {senzaDestinazione
                      ? "Indica prima il luogo di consegna"
                      : (extraDisponibili.length === 0 ? "Tutti i servizi sono già in elenco" : "+ Aggiungi servizio accessorio…")}
                  </option>
                  {!senzaDestinazione && extraDisponibili.map(e => <option key={e.id} value={e.id}>{e.nome}{e.costoLibero ? " (costo libero)" : ` (+€${parseFloat(e.prezzo).toFixed(2)})`}</option>)}
                </select>
              </td>
            </tr>
          </tbody>

          <tfoot>
            <tr>
              <td colSpan={3}>Totali</td>
              {cellaEtichettata("Costi", <strong>€{totaleComplessivoCostoFlotta.toFixed(2)}</strong>)}
              {cellaEtichettata("Vendita", <span className="totale">{mostraComeOpzioni ? '—' : `€${totaleVenditaComplessivo.toFixed(2)}`}</span>)}
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  };

  // Sezione Vendita completa: prima le scelte di presentazione, poi la tabella costi/prezzi
  const renderSezioneVendita = () => (
    <>
      <div className="opzioni-vendita">
        {/* Prima opzione della sezione: sblocca sede e costo su ogni riga della tabella sotto */}
        <label className="opzione-riga">
          <input type="checkbox" checked={prezzoConcordato} onChange={(e) => setPrezzoConcordato(e.target.checked)} />
          Prezzo concordato
        </label>
        {prezzoConcordato && (
          <p className="descrizione-pagina">
            Su ogni riga puoi scegliere il fornitore e digitare il costo pattuito, che sostituisce quello calcolato
            (è il costo pieno: km e trasporto non vengono conteggiati). Le righe che non tocchi restano quelle calcolate
            dal sistema. Sono selezionabili anche i giochi a prezzo 0, per i quali il costo va indicato a mano.
          </p>
        )}

        <label className="opzione-riga">
          <input type="checkbox" checked={mostraComeOpzioni} onChange={(e) => setMostraComeOpzioni(e.target.checked)} />
          Presenta i gonfiabili come opzioni alternative
        </label>
        {mostraComeOpzioni && (
          <p className="descrizione-pagina">Ogni gonfiabile viene proposto come opzione a sé, senza totale commerciale complessivo.</p>
        )}

        {/* La spunta fa comparire il gruppo "Offerta" in tabella, dove si sceglie il gioco */}
        <label className="opzione-riga">
          <input type="checkbox" checked={mostraGiocoOfferta} onChange={(e) => { setMostraGiocoOfferta(e.target.checked); if (!e.target.checked) setGiocoOffertaSelezionato(""); }} />
          Aggiungi un gioco in offerta
        </label>
      </div>

      {renderTabellaVendita()}
    </>
  );

  // Dati che finiscono in testa al documento PDF: prima si inserivano nell'anteprima, ora nel form
  const renderDatiDocumento = () => (
    <>
      <div className="date-grid">
        <label style={{ display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.85rem' }}>Nome referente
          <input type="text" value={nomeRiferimento} onChange={(e) => setNomeRiferimento(e.target.value)} placeholder="Mario Rossi" />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.85rem' }}>Indirizzo e-mail
          <input type="email" value={indirizzoEmail} onChange={(e) => setIndirizzoEmail(e.target.value)} placeholder="email@esempio.com" />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.85rem' }}>Telefono referente
          <input type="tel" value={telefonoRiferimento} onChange={(e) => setTelefonoRiferimento(e.target.value)} placeholder="333 1234567" />
        </label>
      </div>
      <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginTop: '12px' }}>Note al preventivo
        <textarea value={notePreventivo} onChange={(e) => setNotePreventivo(e.target.value)} rows="3" style={{ marginTop: '5px', fontFamily: 'inherit' }} placeholder="Dettagli, sconti particolari o messaggi per il cliente..." />
      </label>
    </>
  );

  // Salva / Annulla modifiche / Scarica PDF: stesso schema di voucher e prenotazioni.
  // Il PDF si scarica solo a preventivo salvato, perché il documento riporta il numero assegnato dal database.
  // Nell'overlay non serve "Nuovo preventivo": si chiude con la X e si riparte dal pulsante Nuovo di Gestione.
  const renderAzioniPreventivo = (inOverlay = false) => (
    <>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn-preventivo btn-accent" style={{ width: 'auto', flex: '1 1 auto', marginTop: 0 }} onClick={salvaPreventivo} disabled={salvataggioPreventivo}>
          {salvataggioPreventivo ? 'Salvataggio…' : (idPreventivo.codice ? 'Salva modifiche' : 'Salva Preventivo')}
        </button>
        {idPreventivo.codice && preventivoModificato && (
          <button type="button" className="btn-annulla-inline" disabled={salvataggioPreventivo} onClick={() => { if (window.confirm("Annullare le modifiche non salvate?")) ripristinaSnapshot(statoOriginale); }}>Annulla modifiche</button>
        )}
        <button type="button" className="btn-stampa" style={{ marginTop: 0 }} onClick={scaricaPDFPreventivo} disabled={!idPreventivo.codice || preventivoModificato}>
          <Icona nome="stampa" size={16} />Scarica PDF
        </button>
        {!inOverlay && (
          <button type="button" className="btn-chiudi" style={{ float: 'none', marginTop: 0 }} onClick={nuovoPreventivo}>
            <Icona nome="nuovo" size={16} />Nuovo preventivo
          </button>
        )}
      </div>
      {idPreventivo.codice && preventivoModificato && (
        <p style={{ margin: '8px 0 0 0', fontSize: '0.85rem', color: '#c62828' }}>
          Ci sono modifiche non salvate: salvale prima di scaricare il PDF.
        </p>
      )}
    </>
  );

  // ====================== SCHEDA PREVENTIVATORE ======================
  const renderCalcolatore = () => (
    <div className="schermata-inserimento no-print">
      <h2>Modulo Calcolo Preventivi</h2>
      <div className="sezione">
        <h2>1. Date del Noleggio &amp; Logistica</h2>
        {renderDateLogistica()}
      </div>

      <div className="sezione">
        <h2>2. Seleziona Strutture Gonfiabili</h2>
        {renderSelezioneGonfiabili()}
      </div>

      <div className="sezione">
        <h2>3. Luogo di Consegna</h2>
        {renderLuogoConsegna()}
      </div>

      <div className="sezione">
        <h2>4. Servizi Accessori Opzionali</h2>
        {renderServiziExtra()}
      </div>

      <div className="riepilogo">
        <h2>Dettaglio Analitico dei Costi</h2>
        {renderDettaglioCosti()}
        {puoVedere(user, 'preventivatore', 'sales') && (
          <button className="btn-preventivo" onClick={() => setCurrentView("sales")}><Icona nome="vendita" size={16} />Procedi alla Vendita</button>
        )}
      </div>
    </div>
  );

  // ====================== SCHEDA VENDITA ======================
  const renderVendita = () => {
    if (serviziSelezionati.length === 0 || !destinazione) {
      return (
        <div className="schermata-vendita no-print">
          <div style={{ padding: '35px', textAlign: 'center', backgroundColor: '#fff3cd', color: '#856404', borderRadius: '8px', border: '1px solid #ffeeba', margin: '20px 0' }}>
            <h3>Azione non consentita</h3>
            <p>Per poter configurare i prezzi finali di vendita, è necessario prima completare l'elaborazione del calcolo logistico. Torna alla schermata precedente ed inserisci almeno un gonfiabile ed il luogo di consegna.</p>
            <button className="btn-chiudi" style={{ marginTop: '15px', float: 'none', display: 'inline-block' }} onClick={() => setCurrentView("calculator")}>Ritorna al Preventivatore</button>
          </div>
        </div>
      );
    }

    return (
      <div className="schermata-vendita no-print form-pren">
        <h2>Pannello Definizione Prezzi di Vendita</h2>
        <p className="descrizione-pagina">Assegna i valori commerciali definitivi. I prezzi inseriti devono essere superiori rispetto ai costi vivi stimati.</p>

        <div className="sezione">
          <h2>Vendita</h2>
          {renderSezioneVendita()}
        </div>

        <div className="sezione">
          <h2>Dati del documento</h2>
          {renderDatiDocumento()}
        </div>

        {renderAzioniPreventivo()}
      </div>
    );
  };

  // ====================== FORM OVERLAY (Gestione) ======================
  // Unico form compatto per creare o modificare un preventivo: stessa struttura del form
  // prenotazioni (griglia a due colonne in alto, sezioni a tutta larghezza sotto).
  const renderFormPreventivo = () => (
    <div className="schermata-inserimento no-print form-pren form-pren-compatto">
      <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
        {idPreventivo.codice ? `Modifica Preventivo ${idPreventivo.codice}` : "Nuovo Preventivo"}
        {/* Lo stato resta a vista: così è chiaro che salvando un confermato la conferma non si perde */}
        {idPreventivo.codice && <span className={`badge-stato ${statoDocumento.toLowerCase()}`}>{statoDocumento}</span>}
      </h2>

      <div className="form-top-grid">
        {/* Noleggio: quando e dove */}
        <div className="sezione">
          <h2>Noleggio</h2>
          {renderDateLogistica()}

          <div className="sotto-sezione">
            <h3>Luogo di consegna</h3>
            {renderLuogoConsegna()}
          </div>
        </div>

        {/* Documento: intestazione e note del PDF */}
        <div className="sezione">
          <h2>Documento</h2>
          {renderDatiDocumento()}
        </div>
      </div>

      {/* Vendita: articoli, costi e prezzi in un'unica tabella, da cui si aggiunge e si rimuove.
          Nessun permesso a parte: è il cuore del form, chi può aprire un preventivo la vede.
          Prima dipendeva dal permesso della vecchia scheda "Vendita", che non esiste più in
          navigazione: i ruoli senza quella spunta si ritrovavano un form monco. */}
      <div className="sezione">
        <h2>Vendita</h2>
        {renderSezioneVendita()}
      </div>

      {renderAzioniPreventivo(true)}
    </div>
  );


  // Ordinamento condiviso da Gestione e Storico: la tabella è la stessa, quindi lo è anche il criterio scelto.
  const { ordina, propsTestata, frecciaOrdinamento } = useOrdinamentoTabella(VALORI_ORDINAMENTO_PREVENTIVI);

  // ====================== TABELLA CONDIVISA (Gestione / Storico) ======================
  // Stesso layout in entrambe le schede: il clic sulla riga espande dettagli e azioni.
  const rigaTabellaPreventivo = (p, index, onApri) => {
    const codice = typeof p.id === 'object' ? p.id.codice : p.id;
    const espansa = rigaEspansaId === codice;
    const stato = statoPreventivo(p);
    const coloreStatoRiga = stato === 'Confermato' ? '#16a34a' : (stato === 'Scaduto' ? '#94a3b8' : '#f59e0b');
    return (
      <Fragment key={`${codice}-${index}`}>
        <tr onClick={() => setRigaEspansaId(prev => prev === codice ? null : codice)} style={{ cursor: 'pointer', background: espansa ? '#f8fafc' : undefined, borderBottom: espansa ? 'none' : '1px solid #eee', borderLeft: `3px solid ${coloreStatoRiga}` }}>
          <td style={{ padding: '8px 10px' }}>
            <span className="riga-espandibile-chevron" style={{ transform: espansa ? 'rotate(90deg)' : 'none' }}>›</span>
            <strong>{codice}</strong>
          </td>
          <td style={{ padding: '8px 10px', color: '#777', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
            {formattaDataIT(p.dataEmissione)}
          </td>
          <td style={{ padding: '8px 10px', color: '#444', fontSize: '0.82rem' }}>
            {(p.destinazione || '').split(',').pop().trim()} <span style={{ color: '#94a3b8' }}>
              - {p.giorni ? `${p.giorni} g` : '—'}
              {/* Le ore compaiono solo sui preventivi in cui è stata indicata la fascia oraria */}
              {p.oreNoleggio != null && ` · ${formattaOre(parseFloat(p.oreNoleggio))} h`}
            </span>
          </td>
          <td style={{ padding: '8px 10px', fontSize: '0.8rem', color: '#111' }}>
            {p.nomeReferente || <span style={{ color: '#999' }}>—</span>}
          </td>
          <td style={{ padding: '8px 10px', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
            <strong style={{ color: '#2e7d32' }}>€{p.totaleVendita.toFixed(2)}</strong>
          </td>
          <td style={{ padding: '8px 10px' }}>
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center', color: '#64748b' }}>
              {p.mostraGiocoOfferta && <Icona nome="offerta" size={16} style={{ marginRight: 0 }} title="Gioco in offerta" />}
              {p.mostraComeOpzioni && <Icona nome="opzioni" size={16} style={{ marginRight: 0 }} title="Proposto a opzioni" />}
              {!p.mostraGiocoOfferta && !p.mostraComeOpzioni && <span style={{ color: '#ccc' }}>—</span>}
            </div>
          </td>
        </tr>
        {espansa && (
          <tr className="riga-espandibile-dettaglio">
            <td colSpan={6} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '20px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '0.82rem', color: '#334155', minWidth: 0, flex: 1 }}>
                  <div><span style={{ color: '#94a3b8' }}>Stato </span><span className={`badge-stato ${stato.toLowerCase()}`}>{stato}</span></div>
                  <div><span style={{ color: '#94a3b8' }}>Indirizzo </span>{p.destinazione || '—'}</div>
                  <div><span style={{ color: '#94a3b8' }}>Periodo </span>{p.periodo || '—'}</div>
                  {p.oraInizio && p.oraFine && (
                    <div>
                      <span style={{ color: '#94a3b8' }}>Orario </span>{p.oraInizio} – {p.oraFine}
                      {p.oreNoleggio != null && <span style={{ color: '#94a3b8' }}> ({formattaOre(parseFloat(p.oreNoleggio))} h)</span>}
                    </div>
                  )}
                  {p.emailReferente && <div><span style={{ color: '#94a3b8' }}>Email </span>{p.emailReferente}</div>}
                  {p.telefonoReferente && <div><span style={{ color: '#94a3b8' }}>Telefono </span>{p.telefonoReferente}</div>}

                  {(p.gonfiabili && p.gonfiabili.length > 0) ? (
                    <table className="tabella-dettaglio-gonfiabili" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', marginTop: '4px', background: '#fff' }}>
                      <thead>
                        <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #e2e8f0' }}>
                          <th style={{ padding: '5px 8px', textAlign: 'left', color: '#64748b', fontWeight: 600 }}>Gonfiabile</th>
                          <th style={{ padding: '5px 8px', textAlign: 'left', color: '#64748b', fontWeight: 600 }}>Sede</th>
                          <th style={{ padding: '5px 8px', textAlign: 'right', color: '#64748b', fontWeight: 600 }}>Km</th>
                          <th style={{ padding: '5px 8px', textAlign: 'right', color: '#64748b', fontWeight: 600 }}>Costo</th>
                          <th style={{ padding: '5px 8px', textAlign: 'right', color: '#64748b', fontWeight: 600 }}>Ricavo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.gonfiabili.map((g, i) => {
                          const costo = (parseFloat(g.costoNoleggio) || 0) + (parseFloat(g.costoLogistica) || 0);
                          return (
                            <tr key={`${g.nome}-${i}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                              <td style={{ padding: '5px 8px' }}>{g.nome}{g.quantita > 1 ? ` ×${g.quantita}` : ''}</td>
                              <td style={{ padding: '5px 8px', color: '#555' }}>{g.sedePartenza || '—'}</td>
                              <td style={{ padding: '5px 8px', textAlign: 'right', color: '#555' }}>{(parseFloat(g.kmCalcolati) || 0).toFixed(1)}</td>
                              <td style={{ padding: '5px 8px', textAlign: 'right', color: '#555' }}>€{costo.toFixed(2)}</td>
                              <td style={{ padding: '5px 8px', textAlign: 'right', color: '#2e7d32', fontWeight: 'bold' }}>€{(parseFloat(g.prezzoVendita) || 0).toFixed(2)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <div><span style={{ color: '#94a3b8' }}>Gonfiabili </span>—</div>
                  )}

                  <div><span style={{ color: '#94a3b8' }}>Note </span>{p.note ? <em>{p.note}</em> : '—'}</div>
                </div>
                <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                  {p.stato === "Registrato" && (
                    <button type="button" className="btn-icon-action success" title="Conferma" onClick={() => cambiaStatoPreventivo(codice, "Confermato")}><Icona nome="salva" size={16} style={{ marginRight: 0 }} /></button>
                  )}
                  {p.stato === "Confermato" && (
                    <button type="button" className="btn-icon-action" title="Riporta a Registrato" onClick={() => cambiaStatoPreventivo(codice, "Registrato")}><Icona nome="riporta" size={16} style={{ marginRight: 0 }} /></button>
                  )}
                  <button type="button" className="btn-icon-action" title="Apri" onClick={() => onApri(p)}><Icona nome="apri" size={16} style={{ marginRight: 0 }} /></button>
                  {user.ruolo === "admin" && (
                    <button type="button" className="btn-icon-action danger" title="Elimina" onClick={() => eliminaPreventivo(codice)}><Icona nome="elimina" size={16} style={{ marginRight: 0 }} /></button>
                  )}
                </div>
              </div>
            </td>
          </tr>
        )}
      </Fragment>
    );
  };

  const tabellaPreventivi = (righe, messaggioVuoto, onApri) => (
    <div className="admin-table-box-full" style={{ marginTop: '20px' }}>
      <table className="storico-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem', background: '#fff' }}>
        <thead>
          <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
            {COLONNE_PREVENTIVI.map(c => {
              const { style: stileOrdinabile, ...propsOrdinabile } = c.valore ? propsTestata(c.chiave) : { style: undefined };
              return (
                <th key={c.chiave} {...propsOrdinabile} style={{ padding: '8px 10px', ...c.stile, ...stileOrdinabile }}>
                  {c.label}{c.valore ? frecciaOrdinamento(c.chiave) : ''}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {righe.length === 0
            ? <tr><td colSpan="6" style={{ textAlign: 'center', padding: '20px', color: '#666' }}>{messaggioVuoto}</td></tr>
            : ordina(righe).map((p, index) => rigaTabellaPreventivo(p, index, onApri))}
        </tbody>
      </table>
    </div>
  );

  // Data stampata sul documento: quella del preventivo aperto, altrimenti oggi (bozza non ancora salvata)
  const dataEmissioneDocumento = dataEmissionePreventivo ? new Date(dataEmissionePreventivo) : new Date();

  // --- STILI RESPONSIVE INIETTATI VIA JAVASCRIPT ---
  const mobileStyles = `
    @media (max-width: 768px) {
      .main-header { flex-direction: column; align-items: flex-start; gap: 10px; }
      .header-menu { flex-wrap: wrap; width: 100%; margin-top: 10px; }
      .nav-btn, .btn-logout { flex: 1 1 auto; text-align: center; }
      .admin-grid-sezione { display: flex !important; flex-direction: column; gap: 15px; }
      .scheda-vendita-prodotto { display: flex !important; flex-direction: column; align-items: stretch; }
      .vendita-inputs-prodotto { flex-direction: column; align-items: stretch; gap: 15px; }
      .date-grid { flex-direction: column; gap: 10px; }
      .ricerca-box { flex-direction: column; gap: 8px; }
      .azioni-preventivo { flex-direction: column; gap: 10px; }
      .azioni-preventivo > div { flex-direction: column; gap: 10px; }
      .modal-preventivo-backdrop { padding: 10px; }
      .filtri-storico { flex-direction: column; }
      .filtri-storico .filtro-group { flex: 1 1 100% !important; }
      .header-preventivo { flex-direction: column; align-items: center; }
      .header-preventivo > div { width: 100% !important; text-align: center !important; float: none !important; }

      table { display: block; width: 100%; border: none !important; }
      thead { display: none; }
      tbody { display: block; width: 100%; }
      tr { 
        display: block; width: 100%; margin-bottom: 20px; border: 1px solid #cbd5e1 !important; 
        border-radius: 8px; background: #fff; box-shadow: 0 4px 8px rgba(0,0,0,0.05);
      }
      td { 
        display: block; width: 100%; text-align: left !important; border: none !important; 
        border-bottom: 1px dashed #e2e8f0 !important; padding: 12px 15px !important; box-sizing: border-box;
      }
      td:last-child { border-bottom: none !important; background: #f8fafc; border-radius: 0 0 8px 8px; }
      td:last-child > div { width: 100%; display: flex; flex-direction: column; gap: 8px; }
      td:last-child button { width: 100%; }
      .coord-input { width: 100% !important; margin: 0 0 8px 0 !important; }
      td > div[style*="grid-template-columns"] { grid-template-columns: 1fr 1fr !important; }
      .admin-table-box, .admin-table-box-full { border: none !important; background: transparent !important; overflow: visible !important; max-height: none !important; }
    }
  `;

  return (
    <>
      <style>{mobileStyles}</style>

      <nav className="modulo-subnav no-print subnav-segmented">
        {puoVedere(user, 'preventivatore', 'admin') && (
          <button className={`nav-btn ${currentView === 'admin' ? 'active' : ''}`} onClick={() => setCurrentView("admin")}><Icona nome="configuratore" />Configuratore</button>
        )}
        {SCHEDE_LEGACY_VISIBILI && puoVedere(user, 'preventivatore', 'calculator') && (
          <button className={`nav-btn ${currentView === 'calculator' ? 'active' : ''}`} onClick={() => setCurrentView("calculator")}><Icona nome="preventivatore" />Preventivatore</button>
        )}
        {SCHEDE_LEGACY_VISIBILI && puoVedere(user, 'preventivatore', 'sales') && (
          <button className={`nav-btn ${currentView === 'sales' ? 'active' : ''}`} onClick={() => setCurrentView("sales")}><Icona nome="vendita" />Vendita</button>
        )}
        {puoVedere(user, 'preventivatore', 'gestione') && (
          <button className={`nav-btn ${currentView === 'gestione' ? 'active' : ''}`} onClick={() => setCurrentView("gestione")}><Icona nome="gestione" />Gestione</button>
        )}
        {puoVedere(user, 'preventivatore', 'storico') && (
          <button className={`nav-btn ${currentView === 'storico' ? 'active' : ''}`} onClick={() => setCurrentView("storico")}><Icona nome="storico" />Storico Preventivi</button>
        )}
      </nav>

      {/* VIEW: ADMIN */}
      {currentView === "admin" && puoVedere(user, 'preventivatore', 'admin') && (
        <div className="schermata-admin no-print" style={{ padding: '20px', fontFamily: 'inherit' }}>
          <h2>Pannello di Controllo Risorse ed Infrastruttura</h2>

          <div className="modulo-subnav subnav-segmented" style={{ marginTop: '15px' }}>
            {puoVedere(user, 'preventivatore', 'admin', 'sedi') && (
              <button className={`nav-btn ${configTabAdmin === 'sedi' ? 'active' : ''}`} onClick={() => setConfigTabAdmin('sedi')}><Icona nome="sedi" />Sedi</button>
            )}
            {puoVedere(user, 'preventivatore', 'admin', 'gonfiabili') && (
              <button className={`nav-btn ${configTabAdmin === 'gonfiabili' ? 'active' : ''}`} onClick={() => setConfigTabAdmin('gonfiabili')}><Icona nome="gonfiabili" />Gonfiabili</button>
            )}
            {puoVedere(user, 'preventivatore', 'admin', 'extra') && (
              <button className={`nav-btn ${configTabAdmin === 'extra' ? 'active' : ''}`} onClick={() => setConfigTabAdmin('extra')}><Icona nome="extra" />Extra</button>
            )}
          </div>

          {/* 1. SEZIONE SEDE / MAGAZZINO */}
          {configTabAdmin === 'sedi' && puoVedere(user, 'preventivatore', 'admin', 'sedi') && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '15px 0', gap: '10px', flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0 }}>Sedi / Magazzini ({sedi.length})</h3>
              <button className="btn-preventivo btn-accent" style={{ width: 'auto', marginTop: 0, padding: '8px 16px' }} onClick={() => setShowFormSede(true)}><Icona nome="nuovo" size={16} style={{ marginRight: '6px' }} />Nuovo</button>
            </div>

            {showFormSede && (
              <div className="modal-form-backdrop" onClick={() => setShowFormSede(false)}>
                <div className="modal-form-box" onClick={(e) => e.stopPropagation()}>
                  <button type="button" className="modal-form-close" onClick={() => setShowFormSede(false)} aria-label="Chiudi">✕</button>
                  <h3 style={{ margin: '0 0 15px 0', fontSize: '1.1rem', color: '#0288d1' }}>Aggiungi Sede / Magazzino</h3>
                  <form onSubmit={addSede} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <input type="text" placeholder="Nome Sede" value={nuovaSede.nome} onChange={(e) => setNuovaSede({...nuovaSede, nome: e.target.value})} style={{ width: '100%', boxSizing: 'border-box', height: '36px', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px' }} />
                    <input type="text" placeholder="Città" value={nuovaSede.citta} onChange={(e) => setNuovaSede({...nuovaSede, citta: e.target.value})} style={{ width: '100%', boxSizing: 'border-box', height: '36px', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px' }} />
                    <input type="text" placeholder="Referente" value={nuovaSede.referente} onChange={(e) => setNuovaSede({...nuovaSede, referente: e.target.value})} style={{ width: '100%', boxSizing: 'border-box', height: '36px', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px' }} />
                    <input type="number" step="any" placeholder="Latitudine" value={nuovaSede.lat} onChange={(e) => setNuovaSede({...nuovaSede, lat: e.target.value})} style={{ width: '100%', boxSizing: 'border-box', height: '36px', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px' }} />
                    <input type="number" step="any" placeholder="Longitudine" value={nuovaSede.lon} onChange={(e) => setNuovaSede({...nuovaSede, lon: e.target.value})} style={{ width: '100%', boxSizing: 'border-box', height: '36px', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px' }} />
                    <input type="number" step="any" placeholder="Costo €/km (es. 1.20)" value={nuovaSede.costoKm} onChange={(e) => setNuovaSede({...nuovaSede, costoKm: e.target.value})} style={{ width: '100%', boxSizing: 'border-box', height: '36px', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px' }} />
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', color: '#444' }}>
                      <input type="checkbox" checked={nuovaSede.bfm} onChange={(e) => setNuovaSede({...nuovaSede, bfm: e.target.checked})} />
                      BFM — sede di proprietà (giochi in offerta, costo a zero)
                    </label>
                    <button type="submit" style={{ display: 'inline-flex', alignItems: 'center', padding: '9px 18px', background: '#0288d1', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem', marginTop: '5px' }}><Icona nome="salva" size={16} style={{ marginRight: '6px' }} />Salva Sede</button>
                  </form>
                </div>
              </div>
            )}

            <div className="admin-table-box" style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', maxHeight: 'none', overflowY: 'visible' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                    <th style={{ padding: '10px 12px', color: '#444' }}>Nome Sede</th>
                    <th style={{ padding: '10px 12px', color: '#444' }}>Città</th>
                    <th style={{ padding: '10px 12px', color: '#444' }}>Referente</th>
                    <th style={{ padding: '10px 12px', color: '#444' }}>Coordinate</th>
                    <th style={{ padding: '10px 12px', color: '#444' }}>€/km</th>
                    <th style={{ padding: '10px 12px', textAlign: 'center', color: '#444', width: '70px' }}>BFM</th>
                    <th style={{ padding: '10px 12px', textAlign: 'center', color: '#444', width: '130px' }}>Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {sedi.map(s => (
                    <tr key={s.id} style={{ borderBottom: '1px solid #eee' }}>
                      {idSedeInModifica === s.id ? (
                        <>
                          <td style={{ padding: '10px 12px' }}><input type="text" className="table-input" value={datiSedeInModifica.nome} onChange={(e)=>setDatiSedeInModifica({...datiSedeInModifica, nome: e.target.value})} style={{ width: '100%', fontSize: '0.85rem', height: '30px' }} /></td>
                          <td style={{ padding: '10px 12px' }}><input type="text" className="table-input" value={datiSedeInModifica.citta} onChange={(e)=>setDatiSedeInModifica({...datiSedeInModifica, citta: e.target.value})} style={{ width: '100%', fontSize: '0.85rem', height: '30px' }} /></td>
                          <td style={{ padding: '10px 12px' }}><input type="text" className="table-input" value={datiSedeInModifica.referente} onChange={(e)=>setDatiSedeInModifica({...datiSedeInModifica, referente: e.target.value})} style={{ width: '100%', fontSize: '0.85rem', height: '30px' }} /></td>
                          <td style={{ padding: '10px 12px' }}>
                            <input type="number" step="any" className="table-input coord-input" value={datiSedeInModifica.lat} onChange={(e)=>setDatiSedeInModifica({...datiSedeInModifica, lat: e.target.value})} style={{ width: '48%', marginRight: '4%', fontSize: '0.85rem', height: '30px' }} />
                            <input type="number" step="any" className="table-input coord-input" value={datiSedeInModifica.lon} onChange={(e)=>setDatiSedeInModifica({...datiSedeInModifica, lon: e.target.value})} style={{ width: '48%', fontSize: '0.85rem', height: '30px' }} />
                          </td>
                          <td style={{ padding: '10px 12px' }}>
                            <input type="number" step="any" className="table-input" value={datiSedeInModifica.costoKm} onChange={(e)=>setDatiSedeInModifica({...datiSedeInModifica, costoKm: e.target.value})} style={{ width: '100%', fontSize: '0.85rem', height: '30px' }} />
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                            <input type="checkbox" checked={datiSedeInModifica.bfm} onChange={(e)=>setDatiSedeInModifica({...datiSedeInModifica, bfm: e.target.checked})} />
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                            <div style={{ display: 'flex', gap: '5px', justifyContent: 'center' }}>
                              <button className="btn-accent-inline" onClick={salvaModificaSede} style={{ display: 'inline-flex', alignItems: 'center', fontSize: '0.8rem', padding: '4px 8px' }}><Icona nome="salva" size={14} style={{ marginRight: '4px' }} />Salva</button>
                              <button className="btn-outline-annulla" onClick={() => setIdSedeInModifica(null)} style={{ display: 'inline-flex', alignItems: 'center', fontSize: '0.8rem', padding: '4px 8px', borderRadius: '4px' }}><Icona nome="annulla" size={14} style={{ marginRight: '4px' }} />Annulla</button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>{s.nome}</td>
                          <td style={{ padding: '10px 12px', verticalAlign: 'middle', color: '#555' }}>{s.citta || <em style={{ color: '#999' }}>—</em>}</td>
                          <td style={{ padding: '10px 12px', verticalAlign: 'middle', color: '#555' }}>{s.referente || <em style={{ color: '#999' }}>—</em>}</td>
                          <td style={{ padding: '10px 12px', verticalAlign: 'middle', color: '#555' }}>{parseFloat(s.lat).toFixed(4)}, {parseFloat(s.lon).toFixed(4)}</td>
                          <td style={{ padding: '10px 12px', verticalAlign: 'middle', color: '#555' }}>€{(parseFloat(s.costoKm) || COSTO_AL_KM).toFixed(2)}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'center', verticalAlign: 'middle' }}>
                            {s.bfm ? <span title="Sede di proprietà" style={{ color: '#2e7d32', fontWeight: 'bold' }}>✓</span> : <span style={{ color: '#ccc' }}>—</span>}
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'center', verticalAlign: 'middle' }}>
                            <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                              <button className="btn-icon-action" aria-label="Modifica" title="Modifica" onClick={() => { setIdSedeInModifica(s.id); setDatiSedeInModifica({ nome: s.nome, citta: s.citta || "", referente: s.referente || "", lat: s.lat, lon: s.lon, costoKm: s.costoKm ?? "", bfm: !!s.bfm }); }}><Icona nome="modifica" size={16} style={{ marginRight: 0 }} /></button>
                              <button className="btn-icon-action danger" aria-label="Elimina" title="Elimina" onClick={() => rimuoviSede(s.id)}><Icona nome="elimina" size={16} style={{ marginRight: 0 }} /></button>
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
          )}

          {/* 2. SEZIONE GONFIABILI */}
          {configTabAdmin === 'gonfiabili' && puoVedere(user, 'preventivatore', 'admin', 'gonfiabili') && (
          <div className="admin-sezione-fullwidth" style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <div style={{ order: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0 }}>Gonfiabili ({gonfiabili.length})</h3>
              <button className="btn-preventivo btn-accent" style={{ width: 'auto', marginTop: 0, padding: '8px 16px' }} onClick={() => setShowFormGonfiabile(true)}><Icona nome="nuovo" size={16} style={{ marginRight: '6px' }} />Nuovo</button>
            </div>

            {showFormGonfiabile && (
              <div className="modal-form-backdrop" onClick={() => setShowFormGonfiabile(false)}>
                <div className="modal-form-box" onClick={(e) => e.stopPropagation()}>
                  <button type="button" className="modal-form-close" onClick={() => setShowFormGonfiabile(false)} aria-label="Chiudi">✕</button>
                  <h3 style={{ margin: '0 0 15px 0', fontSize: '1.1rem' , color: '#0288d1' }}>Aggiungi Nuovo Gonfiabile</h3>
                  <form onSubmit={addGonfiabile}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '15px' }}>
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

                    <button type="submit" style={{ display: 'inline-flex', alignItems: 'center', padding: '9px 18px', background: '#0288d1', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' }}><Icona nome="salva" size={16} style={{ marginRight: '6px' }} />Salva Gonfiabile</button>
                  </form>
                </div>
              </div>
            )}

            <div className="admin-table-box-full" style={{ order: 1, width: '100%', overflowX: 'auto', background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                    <th style={{ padding: '10px 12px', width: '40px', color: '#444' }}></th>
                    <th style={{ padding: '10px 12px', width: '32%', color: '#444' }}>Modello</th>
                    <th style={{ padding: '10px 12px', width: '15%', color: '#444' }}>Prezzo</th>
                    <th style={{ padding: '10px 12px', width: '28%', color: '#444' }}>Ubicazione</th>
                    <th style={{ padding: '10px 12px', width: '25%', textAlign: 'center', color: '#444' }}>Azioni</th>
                  </tr>
                </thead>
                <tbody>
                  {gonfiabili.map(g => {
                    const sd = sedi.find(s => s.id === g.locationId);
                    const inModifica = idGonfiabileInModifica === g.id;
                    // La riga si espande sia col click diretto sia entrando in modifica
                    const espanso = inModifica || idGonfiabileEspanso === g.id;
                    return (
                      <Fragment key={g.id}>
                        <tr
                          style={{ borderBottom: espanso ? 'none' : '1px solid #eee', cursor: inModifica ? 'default' : 'pointer', background: espanso ? '#fafafa' : 'transparent' }}
                          onClick={() => { if (!inModifica) setIdGonfiabileEspanso(prev => prev === g.id ? null : g.id); }}
                        >
                          <td style={{ padding: '10px 12px', verticalAlign: 'middle', color: '#888', textAlign: 'center' }}>{espanso ? '▼' : '▶'}</td>
                          {inModifica ? (
                            <>
                              <td style={{ padding: '10px 12px' }}>
                                <input type="text" className="table-input" value={datiGonfiabileInModifica.nome} onChange={(e)=>setDatiGonfiabileInModifica({...datiGonfiabileInModifica, nome: e.target.value})} style={{ width: '100%', fontSize: '0.85rem', height: '30px' }} />
                              </td>
                              <td style={{ padding: '10px 12px' }}>
                                <input type="number" step="any" className="table-input" value={datiGonfiabileInModifica.prezzo} onChange={(e)=>setDatiGonfiabileInModifica({...datiGonfiabileInModifica, prezzo: e.target.value})} style={{ width: '100%', fontSize: '0.85rem', height: '30px' }} />
                              </td>
                              <td style={{ padding: '10px 12px' }}>
                                <select className="table-input" value={datiGonfiabileInModifica.locationId} onChange={(e)=>setDatiGonfiabileInModifica({...datiGonfiabileInModifica, locationId: e.target.value})} style={{ width: '100%', height: '32px', fontSize: '0.85rem' }}>
                                  {sedi.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
                                </select>
                              </td>
                              <td style={{ padding: '10px 12px', textAlign: 'center', verticalAlign: 'middle' }}>
                                <div style={{ display: 'flex', gap: '5px', justifyContent: 'center' }}>
                                  <button className="btn-accent-inline" onClick={salvaModificaGonfiabile} style={{ display: 'inline-flex', alignItems: 'center', fontSize: '0.8rem', padding: '4px 8px' }}><Icona nome="salva" size={14} style={{ marginRight: '4px' }} />Salva</button>
                                  <button className="btn-outline-annulla" onClick={() => setIdGonfiabileInModifica(null)} style={{ display: 'inline-flex', alignItems: 'center', fontSize: '0.8rem', padding: '4px 8px', borderRadius: '4px' }}><Icona nome="annulla" size={14} style={{ marginRight: '4px' }} />Annulla</button>
                                </div>
                              </td>
                            </>
                          ) : (
                            <>
                              <td style={{ padding: '10px 12px', verticalAlign: 'middle', fontSize: '0.9rem', fontWeight: 'bold', color: '#111' }}>{g.nome}</td>
                              <td style={{ padding: '10px 12px', verticalAlign: 'middle', color: '#2e7d32', fontSize: '0.85rem' }}>€{parseFloat(g.prezzo).toFixed(2)}</td>
                              <td style={{ padding: '10px 12px', verticalAlign: 'middle', color: '#555', fontSize: '0.85rem' }}>
                                {sd ? sd.nome : <em style={{ color: '#999' }}>Non assegnata</em>}
                              </td>
                              <td style={{ padding: '10px 12px', textAlign: 'center', verticalAlign: 'middle' }} onClick={(e) => e.stopPropagation()}>
                                <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                                  <button className="btn-icon-action" aria-label="Modifica" title="Modifica" onClick={() => {
                                    setIdGonfiabileEspanso(g.id);
                                    setIdGonfiabileInModifica(g.id);
                                    setDatiGonfiabileInModifica({
                                      nome: g.nome, prezzo: g.prezzo, locationId: g.locationId, giocatori: g.giocatori || "",
                                      etaConsigliata: g.etaConsigliata || "", dimensioni: g.dimensioni || "", superficie: g.superficie || "",
                                      alimentazione: g.alimentazione || "", tempoMontaggio: g.tempoMontaggio || ""
                                    });
                                  }}><Icona nome="modifica" size={16} style={{ marginRight: 0 }} /></button>
                                  <button className="btn-icon-action danger" aria-label="Elimina" title="Elimina" onClick={() => rimuoviGonfiabile(g.id)}><Icona nome="elimina" size={16} style={{ marginRight: 0 }} /></button>
                                </div>
                              </td>
                            </>
                          )}
                        </tr>

                        {espanso && (
                          <tr style={{ borderBottom: '1px solid #eee', background: '#fafafa' }}>
                            <td colSpan={5} style={{ padding: '0 12px 12px 44px' }}>
                              <p style={{ margin: '0 0 8px 0', fontSize: '0.75rem', fontWeight: 'bold', color: '#0288d1' }}>Specifiche e Parametri Tecnici</p>
                              {inModifica ? (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '6px' }}>
                                  <input type="text" placeholder="👥 Giocatori" className="table-input" value={datiGonfiabileInModifica.giocatori} onChange={(e)=>setDatiGonfiabileInModifica({...datiGonfiabileInModifica, giocatori: e.target.value})} style={{ fontSize: '0.8rem', height: '28px' }} />
                                  <input type="text" placeholder="🎂 Età" className="table-input" value={datiGonfiabileInModifica.etaConsigliata} onChange={(e)=>setDatiGonfiabileInModifica({...datiGonfiabileInModifica, etaConsigliata: e.target.value})} style={{ fontSize: '0.8rem', height: '28px' }} />
                                  <input type="text" placeholder="📐 Dimensioni" className="table-input" value={datiGonfiabileInModifica.dimensioni} onChange={(e)=>setDatiGonfiabileInModifica({...datiGonfiabileInModifica, dimensioni: e.target.value})} style={{ fontSize: '0.8rem', height: '28px' }} />
                                  <input type="text" placeholder="🧱 Superficie" className="table-input" value={datiGonfiabileInModifica.superficie} onChange={(e)=>setDatiGonfiabileInModifica({...datiGonfiabileInModifica, superficie: e.target.value})} style={{ fontSize: '0.8rem', height: '28px' }} />
                                  <input type="text" placeholder="🔌 Alimentazione" className="table-input" value={datiGonfiabileInModifica.alimentazione} onChange={(e)=>setDatiGonfiabileInModifica({...datiGonfiabileInModifica, alimentazione: e.target.value})} style={{ fontSize: '0.8rem', height: '28px' }} />
                                  <input type="text" placeholder="⏱️ Montaggio" className="table-input" value={datiGonfiabileInModifica.tempoMontaggio} onChange={(e)=>setDatiGonfiabileInModifica({...datiGonfiabileInModifica, tempoMontaggio: e.target.value})} style={{ fontSize: '0.8rem', height: '28px' }} />
                                </div>
                              ) : (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 10px', fontSize: '0.75rem', color: '#555' }}>
                                  <div style={{ background: '#f0f0f0', padding: '3px 6px', borderRadius: '4px', whiteSpace: 'nowrap' }}>👥 Giocatori: {g.giocatori || '-'}</div>
                                  <div style={{ background: '#f0f0f0', padding: '3px 6px', borderRadius: '4px', whiteSpace: 'nowrap' }}>🎂 Età: {g.etaConsigliata || '-'}</div>
                                  <div style={{ background: '#f0f0f0', padding: '3px 6px', borderRadius: '4px', whiteSpace: 'nowrap' }}>📐 Dim: {g.dimensioni || '-'}</div>
                                  <div style={{ background: '#f0f0f0', padding: '3px 6px', borderRadius: '4px', whiteSpace: 'nowrap' }}>🧱 Sup: {g.superficie || '-'}</div>
                                  <div style={{ background: '#f0f0f0', padding: '3px 6px', borderRadius: '4px', whiteSpace: 'nowrap' }}>🔌 Alim: {g.alimentazione || '-'}</div>
                                  <div style={{ background: '#f0f0f0', padding: '3px 6px', borderRadius: '4px', whiteSpace: 'nowrap' }}>⏱️ Montaggio: {g.tempoMontaggio || '-'}</div>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          )}

          {/* 3. SEZIONE SERVIZI EXTRA */}
          {configTabAdmin === 'extra' && puoVedere(user, 'preventivatore', 'admin', 'extra') && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '15px 0', gap: '10px', flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0 }}>Servizi Extra ({extras.length})</h3>
              <button className="btn-preventivo btn-accent" style={{ width: 'auto', marginTop: 0, padding: '8px 16px' }} onClick={() => setShowFormExtra(true)}><Icona nome="nuovo" size={16} style={{ marginRight: '6px' }} />Nuovo</button>
            </div>

            {showFormExtra && (
              <div className="modal-form-backdrop" onClick={() => setShowFormExtra(false)}>
                <div className="modal-form-box" onClick={(e) => e.stopPropagation()}>
                  <button type="button" className="modal-form-close" onClick={() => setShowFormExtra(false)} aria-label="Chiudi">✕</button>
                  <h3 style={{ margin: '0 0 15px 0', fontSize: '1.1rem', color: '#0288d1' }}>Configura Servizio Extra</h3>
                  <form onSubmit={addExtra} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <input type="text" placeholder="Nome Servizio" value={nuovoExtra.nome} onChange={(e) => setNuovoExtra({...nuovoExtra, nome: e.target.value})} style={{ width: '100%', boxSizing: 'border-box', height: '36px', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px' }} />
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', color: '#444' }}>
                      <input type="checkbox" checked={nuovoExtra.costoLibero} onChange={(e) => setNuovoExtra({...nuovoExtra, costoLibero: e.target.checked, prezzo: e.target.checked ? "" : nuovoExtra.prezzo})} />
                      Costo libero (l'importo cambia ogni volta e verrà specificato nel preventivo)
                    </label>
                    {!nuovoExtra.costoLibero && (
                      <input type="number" step="any" placeholder="Prezzo (€)" value={nuovoExtra.prezzo} onChange={(e) => setNuovoExtra({...nuovoExtra, prezzo: e.target.value})} style={{ width: '100%', boxSizing: 'border-box', height: '36px', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px' }} />
                    )}
                    <button type="submit" style={{ display: 'inline-flex', alignItems: 'center', padding: '9px 18px', background: '#0288d1', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem', marginTop: '5px' }}><Icona nome="salva" size={16} style={{ marginRight: '6px' }} />Salva Extra</button>
                  </form>
                </div>
              </div>
            )}

            <div className="admin-table-box" style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', maxHeight: 'none', overflowY: 'visible' }}>
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
                          <td style={{ padding: '10px 12px' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: '#555', marginBottom: '4px', whiteSpace: 'nowrap' }}>
                              <input type="checkbox" checked={datiExtraInModifica.costoLibero} onChange={(e)=>setDatiExtraInModifica({...datiExtraInModifica, costoLibero: e.target.checked})} />
                              Costo libero
                            </label>
                            {!datiExtraInModifica.costoLibero && (
                              <input type="number" step="any" className="table-input" value={datiExtraInModifica.prezzo} onChange={(e)=>setDatiExtraInModifica({...datiExtraInModifica, prezzo: e.target.value})} style={{ width: '100%', fontSize: '0.85rem', height: '30px' }} />
                            )}
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                            <div style={{ display: 'flex', gap: '5px', justifyContent: 'center' }}>
                              <button className="btn-accent-inline" onClick={salvaModificaExtra} style={{ display: 'inline-flex', alignItems: 'center', fontSize: '0.8rem', padding: '4px 8px' }}><Icona nome="salva" size={14} style={{ marginRight: '4px' }} />Salva</button>
                              <button className="btn-outline-annulla" onClick={() => setIdExtraInModifica(null)} style={{ display: 'inline-flex', alignItems: 'center', fontSize: '0.8rem', padding: '4px 8px', borderRadius: '4px' }}><Icona nome="annulla" size={14} style={{ marginRight: '4px' }} />Annulla</button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>{e.nome}</td>
                          <td style={{ padding: '10px 12px', verticalAlign: 'middle', color: e.costoLibero ? '#b45309' : '#2e7d32' }}>
                            {e.costoLibero ? <em>Libero (da specificare)</em> : `€${parseFloat(e.prezzo).toFixed(2)}`}
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'center', verticalAlign: 'middle' }}>
                            <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                              <button className="btn-icon-action" aria-label="Modifica" title="Modifica" onClick={() => { setIdExtraInModifica(e.id); setDatiExtraInModifica({ nome: e.nome, prezzo: e.prezzo, costoLibero: !!e.costoLibero }); }}><Icona nome="modifica" size={16} style={{ marginRight: 0 }} /></button>
                              <button className="btn-icon-action danger" aria-label="Elimina" title="Elimina" onClick={() => rimuoviExtra(e.id)}><Icona nome="elimina" size={16} style={{ marginRight: 0 }} /></button>
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
          )}
        </div>
      )}

      {/* VIEW: PREVENTIVATORE (scheda legacy, nascosta) */}
      {SCHEDE_LEGACY_VISIBILI && currentView === "calculator" && renderCalcolatore()}

      {/* VIEW: PAGINA VENDITA (scheda legacy, nascosta) */}
      {SCHEDE_LEGACY_VISIBILI && currentView === "sales" && puoVedere(user, 'preventivatore', 'sales') && renderVendita()}


      {/* VIEW: GESTIONE (sotto-schede per stato) */}
      {currentView === "gestione" && puoVedere(user, 'preventivatore', 'gestione') && (() => {
        const registrati = preventiviSalvati.filter(p => statoPreventivo(p) === 'Registrato');
        const confermati = preventiviSalvati.filter(p => statoPreventivo(p) === 'Confermato');
        const scaduti = preventiviSalvati.filter(p => statoPreventivo(p) === 'Scaduto');
        const liste = { registrati, confermati, scaduti };
        const messaggiVuoto = {
          registrati: "Nessun preventivo in attesa di conferma.",
          confermati: "Nessun preventivo confermato.",
          scaduti: "Nessun preventivo scaduto.",
        };
        return (
          <div className="schermata-storico no-print">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <h2 style={{ margin: 0 }}>Gestione</h2>
              <button className="btn-preventivo btn-accent" style={{ width: 'auto', marginTop: 0, padding: '8px 16px' }} onClick={nuovoPreventivoOverlay}><Icona nome="nuovo" size={16} />Nuovo</button>
            </div>
            <p className="descrizione-pagina">
              Preventivi raggruppati per stato. Un preventivo non confermato entro {GIORNI_VALIDITA_PREVENTIVO} giorni dall'emissione risulta scaduto,
              in linea con la validità dichiarata sul documento di offerta.
            </p>
            <nav className="modulo-subnav subnav-segmented" style={{ margin: '10px 0' }}>
              <button className={`nav-btn ${gestioneTab === 'registrati' ? 'active' : ''}`} onClick={() => setGestioneTab('registrati')}><Icona nome="daConfermare" />Registrati ({registrati.length})</button>
              <button className={`nav-btn ${gestioneTab === 'confermati' ? 'active' : ''}`} onClick={() => setGestioneTab('confermati')}><Icona nome="completate" />Confermati ({confermati.length})</button>
              <button className={`nav-btn ${gestioneTab === 'scaduti' ? 'active' : ''}`} onClick={() => setGestioneTab('scaduti')}><Icona nome="attesaPagamento" />Scaduti ({scaduti.length})</button>
            </nav>
            {tabellaPreventivi(liste[gestioneTab], messaggiVuoto[gestioneTab], apriPreventivoOverlay)}
          </div>
        );
      })()}

      {/* VIEW: STORICO PREVENTIVI */}
      {currentView === "storico" && puoVedere(user, 'preventivatore', 'storico') && (
        <div className="schermata-storico no-print">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <h2 style={{ margin: 0 }}>Database Storico Preventivi</h2>
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
                <option value="Scaduto">Scaduto</option>
              </select>
            </div>
          </div>

          {tabellaPreventivi(preventiviFiltrati, "Nessun preventivo trovato con i filtri attuali.", modificaPreventivo)}
        </div>
      )}

      {/* ===================== DOCUMENTO PDF (montato fuori schermo) ===================== */}
      {/* Non serve nessuna anteprima: il foglio resta sempre montato fuori dallo schermo e
          html2pdf lo cattura al volo quando si preme "Scarica PDF". */}
      <div style={{ position: 'fixed', left: '-10000px', top: 0 }} aria-hidden="true">
        <div className="documento-preventivo">
            <div className="area-foglio" style={{ textAlign: 'left' }} id="sezione-da-stampare">
              
              <div className="header-preventivo" style={{ marginBottom: '25px', width: '100%', display: 'block' }}>
                <div style={{ float: 'left', width: '30%', textAlign: 'left' }}>
                  <img src="/logo.png" alt="Logo" style={{ maxWidth: '125px', height: 'auto' }} />
                </div>
                <div style={{ float: 'right', width: '70%', textAlign: 'right' }}>
                  <h1 style={{ margin: '0 0 20px 0', textAlign: 'right' }}>PREVENTIVO DI NOLEGGIO</h1>
                  <p style={{ margin: '2px 0', color: '#333' }}>Documento N°: <strong>{idPreventivo.codice || `PRV-${new Date().getFullYear()}-XXXX`}</strong></p>
                  
                  {nomeRiferimento && <p style={{ margin: '2px 0', color: '#333', fontSize: '0.95rem' }}>Alla cortese attenzione di: <strong>{nomeRiferimento}</strong></p>}
                  {indirizzoEmail && <p style={{ margin: '2px 0', color: '#333', fontSize: '0.95rem' }}>E-mail referente: <strong>{indirizzoEmail}</strong></p>}
                  {telefonoRiferimento && <p style={{ margin: '2px 0', color: '#333', fontSize: '0.95rem' }}>Telefono referente: <strong>{telefonoRiferimento}</strong></p>}

                  <p style={{ margin: '2px 0', color: '#c62828', fontSize: '0.95rem' }}>
                    Validità offerta: <strong>{GIORNI_VALIDITA_PREVENTIVO} giorni (scadenza: {new Date(dataEmissioneDocumento.getTime() + GIORNI_VALIDITA_PREVENTIVO * 24 * 60 * 60 * 1000).toLocaleDateString('it-IT')})</strong>
                  </p>
                  <p style={{ margin: '2px 0', fontSize: '0.9rem', color: '#777' }}>Data Emissione: {dataEmissioneDocumento.toLocaleDateString('it-IT')}</p>
                </div>
                <div style={{ clear: 'both' }}></div>
              </div>

              <div className="dati-noleggio-preventivo" style={{ marginBottom: '15px', padding: '10px 0', borderBottom: '1px solid #eee', textAlign: 'left' }}>
                <p style={{ margin: '4px 0' }}><strong>Periodo di Riferimento:</strong> dal {formattaDataIT(dataInizio)} al {formattaDataIT(dataFine)} ({giorniNoleggio} g)</p>
                {oraInizio && oraFine && (
                  <p style={{ margin: '4px 0' }}><strong>Orario:</strong> dalle {oraInizio} alle {oraFine} ({formattaOre(oreNoleggio)} {oreNoleggio === 1 ? 'ora' : 'ore'})</p>
                )}
                <p style={{ margin: '4px 0' }}><strong>Luogo di Consegna:</strong> {destinazione?.nome}</p>
              </div>

              {notePreventivo && notePreventivo.trim() !== "" && (
                <div className="note-documento" style={{ marginBottom: '20px', padding: '12px 15px', background: '#fffde7', borderLeft: '4px solid #fbc02d', textAlign: 'left' }}>               
					<h4 style={{ margin: '0 0 6px 0', color: '#555', fontSize: '0.9rem', textTransform: 'uppercase' }}>Note del Fornitore</h4>
                  <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.9rem', color: '#333', lineHeight: '1.4' }}>{notePreventivo}</div>
                </div>
              )}

              <h3 style={{ textAlign: 'left' }}>Prospetto Economico</h3>

              {mostraComeOpzioni ? (
                <>
                  <p style={{ margin: '0 0 15px 0', fontSize: '0.9rem', color: '#555', fontStyle: 'italic' }}>
                    Di seguito le proposte tra cui è possibile scegliere:
                  </p>
                  {serviziSelezionati.map(nome => {
                    const sol = soluzioneDi(nome);
                    if (!sol) return null;
                    const costTotal = baseCalcoloPrezzo(sol);
                    const defaultPrezzo = arrotondaAllaDecina(costTotal * moltiplicatoreTargetPer(sol?.partenza, sol?.concordata));
                    const vPrezzo = venditaGonfiabili[nome]?.prezzo !== undefined && venditaGonfiabili[nome]?.prezzo !== "" ? parseFloat(venditaGonfiabili[nome].prezzo) : defaultPrezzo;
                    const vSconto = parseFloat(venditaGonfiabili[nome]?.sconto) || 0;
                    const prezzoVenditaFinale = vPrezzo * (1 - vSconto / 100);

                    // Le schede tecniche sono per sede: vale l'istanza da cui il gioco parte davvero
                    // (scelta dal calcolo o indicata a mano col prezzo concordato), non la prima per nome.
                    const gonfiabileCorrente = sol.prodotto || gonfiabili.find(g => g.nome === nome) || {};
                    const haParametri = gonfiabileCorrente.giocatori || gonfiabileCorrente.etaConsigliata || gonfiabileCorrente.dimensioni || gonfiabileCorrente.superficie || gonfiabileCorrente.alimentazione || gonfiabileCorrente.tempoMontaggio;

                    return (
                      <div key={nome} className="pdf-evita-taglio" style={{ border: '1px solid #ddd', borderRadius: '6px', marginBottom: '15px', overflow: 'hidden' }}>
                        <div style={{ background: '#f5f5f5', padding: '8px 15px', borderBottom: '1px solid #ddd' }}>
                          <strong>Opzione: {nome}</strong>
                        </div>
                        <table className="tabella-preventivo" style={{ width: '100%', textAlign: 'left', margin: 0 }}>
                          <tbody>
                            <tr>
                              <td style={{ textAlign: 'left' }}>
                                <div style={{ marginBottom: haParametri ? '4px' : '0' }}><strong>{nome}</strong> {(quantitaGonfiabili[nome] || 1) > 1 && <span style={{ fontWeight: 'normal' }}>— Quantità: {quantitaGonfiabili[nome]} pz</span>}</div>

                                {haParametri && (
                                  <div style={{ fontSize: '0.6rem', color: '#666', lineHeight: '1.5', marginBottom: '4px' }}>
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
                              <td style={{ width: '180px', textAlign: 'right', verticalAlign: 'middle' }}><strong>€{prezzoVenditaFinale.toFixed(2)}</strong> <span style={{ fontSize: '0.8rem', fontWeight: 'normal', color: '#555' }}>+ IVA</span></td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    );
                  })}

                  {extraSelezionati.length > 0 && (
                    <>
                      <h4 style={{ textAlign: 'left', marginTop: '20px' }}>Servizi Accessori (inclusi in tutte le opzioni)</h4>
                      <table className="tabella-preventivo" style={{ width: '100%', textAlign: 'left' }}>
                        <tbody>
                          {extras.filter(e => extraSelezionati.includes(e.id)).map(e => {
                            const costTotal = arrotondaAllaDecina(getCostoExtra(e));
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
                                <td style={{ width: '180px', textAlign: 'right', verticalAlign: 'middle' }}><strong>€{prezzoVenditaFinaleExtra.toFixed(2)}</strong></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </>
                  )}
                </>
              ) : (
              <table className="tabella-preventivo" style={{ width: '100%', textAlign: 'left' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Articolo / Descrizione Servizio</th>
                    <th style={{ width: '180px', textAlign: 'right' }}>Imponibile</th>
                  </tr>
                </thead>
                <tbody>
                  {serviziSelezionati.map(nome => {
                    const sol = soluzioneDi(nome);
                    if (!sol) return null;
                    const costTotal = baseCalcoloPrezzo(sol);
                    const defaultPrezzo = arrotondaAllaDecina(costTotal * moltiplicatoreTargetPer(sol?.partenza, sol?.concordata));
                    const vPrezzo = venditaGonfiabili[nome]?.prezzo !== undefined && venditaGonfiabili[nome]?.prezzo !== "" ? parseFloat(venditaGonfiabili[nome].prezzo) : defaultPrezzo;
                    const vSconto = parseFloat(venditaGonfiabili[nome]?.sconto) || 0;
                    const prezzoVenditaFinale = vPrezzo * (1 - vSconto / 100);

                    // Le schede tecniche sono per sede: vale l'istanza da cui il gioco parte davvero
                    // (scelta dal calcolo o indicata a mano col prezzo concordato), non la prima per nome.
                    const gonfiabileCorrente = sol.prodotto || gonfiabili.find(g => g.nome === nome) || {};
                    const haParametri = gonfiabileCorrente.giocatori || gonfiabileCorrente.etaConsigliata || gonfiabileCorrente.dimensioni || gonfiabileCorrente.superficie || gonfiabileCorrente.alimentazione || gonfiabileCorrente.tempoMontaggio;

                    return (
                      <tr key={nome}>
                        <td style={{ textAlign: 'left' }}>
                          <div style={{ marginBottom: haParametri ? '4px' : '0' }}><strong>{nome}</strong> {(quantitaGonfiabili[nome] || 1) > 1 && <span style={{ fontWeight: 'normal' }}>— Quantità: {quantitaGonfiabili[nome]} pz</span>}</div>

                          {haParametri && (
                            <div style={{ fontSize: '0.6rem',  color: '#666', lineHeight: '1.5', marginBottom: '4px' }}>
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
                    const costTotal = arrotondaAllaDecina(getCostoExtra(e));
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
              )}

              {!mostraComeOpzioni && (
                <div className="totale-documento" style={{ marginTop: '20px', padding: '15px', background: '#f5f5f5', textAlign: 'right' }}>
                  <h2 style={{ margin: 0 }}>TOTALE FINALE : €{totaleVenditaComplessivo.toFixed(2)} <span style={{ fontSize: '1.2rem', fontWeight: 'normal', color: '#555' }}>+ IVA</span></h2>
                </div>
              )}

              {mostraGiocoOfferta && giocoOffertaSelezionato && soluzioneGiocoOfferta && (() => {
                const costoCalcolatoGO = arrotondaAllaDecina(soluzioneGiocoOfferta.totaleOpzione);
                const defaultPrezzoGO = costoCalcolatoGO;
                const vPrezzoGO = venditaGiocoOfferta.prezzo !== undefined && venditaGiocoOfferta.prezzo !== "" ? parseFloat(venditaGiocoOfferta.prezzo) : defaultPrezzoGO;
                const vScontoGO = parseFloat(venditaGiocoOfferta.sconto) || 0;
                const prezzoVenditaFinaleGO = vPrezzoGO * (1 - vScontoGO / 100);

                const gonfiabileGO = gonfiabili.find(g => g.nome === giocoOffertaSelezionato) || {};
                const haParametriGO = gonfiabileGO.giocatori || gonfiabileGO.etaConsigliata || gonfiabileGO.dimensioni || gonfiabileGO.superficie || gonfiabileGO.alimentazione || gonfiabileGO.tempoMontaggio;

                return (
                  <div className="pdf-evita-taglio" style={{ marginTop: '20px' }}>
                    <h3 style={{ textAlign: 'left' }}>Offerta</h3>
                    <table className="tabella-preventivo" style={{ width: '100%', textAlign: 'left' }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'left' }}>Articolo / Descrizione Servizio</th>
                          <th style={{ width: '180px', textAlign: 'right' }}>Imponibile</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td style={{ textAlign: 'left' }}>
                            <div style={{ marginBottom: haParametriGO ? '4px' : '0' }}><strong>{giocoOffertaSelezionato}</strong> </div>

                            {haParametriGO && (
                              <div style={{ fontSize: '0.6rem', color: '#666', lineHeight: '1.5', marginBottom: '4px' }}>
                                {gonfiabileGO.giocatori && <span style={{ marginRight: '12px', display: 'inline-block' }}><strong>Giocatori:</strong> {gonfiabileGO.giocatori}</span>}
                                {gonfiabileGO.etaConsigliata && <span style={{ marginRight: '12px', display: 'inline-block' }}><strong>Età Consigliata:</strong> {gonfiabileGO.etaConsigliata}</span>}
                                {gonfiabileGO.dimensioni && <span style={{ marginRight: '12px', display: 'inline-block' }}><strong>Dimensioni:</strong> {gonfiabileGO.dimensioni}</span>}
                                {gonfiabileGO.superficie && <span style={{ marginRight: '12px', display: 'inline-block' }}><strong>Superficie:</strong> {gonfiabileGO.superficie}</span>}
                                {gonfiabileGO.alimentazione && <span style={{ marginRight: '12px', display: 'inline-block' }}><strong>Alimentazione:</strong> {gonfiabileGO.alimentazione}</span>}
                                {gonfiabileGO.tempoMontaggio && <span style={{ display: 'inline-block' }}><strong>Tempo Montaggio:</strong> {gonfiabileGO.tempoMontaggio}</span>}
                              </div>
                            )}

                            {vScontoGO > 0 && (
                              <div style={{ fontSize: '0.85rem', color: '#c62828', fontStyle: 'italic', marginTop: '3px' }}>
                                Prezzo di listino: €{vPrezzoGO.toFixed(2)} - Sconto commerciale applicato: {vScontoGO}%
                              </div>
                            )}
                          </td>
                          <td style={{ textAlign: 'right', verticalAlign: 'middle' }}><strong>€{prezzoVenditaFinaleGO.toFixed(2)}</strong></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                );
              })()}

              <div className="nuova-pagina">
                <div className="condizioni-preventivo" style={{ marginTop: '35px', fontSize: '0.85rem', lineHeight: '1.4', color: '#444', textAlign: 'left' }}>
                  <h4 style={{ margin: '0 0 2px 0', color: '#111', borderBottom: '1px solid #ddd', paddingBottom: '3px', fontSize: '0.9rem' }}>MODALITA DI PAGAMENTO</h4>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '15px', marginTop: '12px', justifyContent: 'flex-end', textAlign: 'left' }}>
                    <div style={{ background: '#fafafa', borderLeft: '4px solid #0288d1', padding: '10px 14px', fontSize: '0.85rem', flex: '1 1 200px', boxSizing: 'border-box' }}>
                      <span style={{ fontWeight: 'bold', color: '#0288d1', display: 'block', marginBottom: '2px', fontSize: '0.9rem' }}>PAGAMENTO ALLA CONFERMA</span>
                      Versamento caparra confirmatoria pari al 50% del preventivo.
                    </div>
                    <div style={{ background: '#fafafa', borderLeft: '4px solid #2e7d32', padding: '10px 14px', fontSize: '0.85rem', flex: '1 1 200px', boxSizing: 'border-box' }}>
                      <span style={{ fontWeight: 'bold', color: '#2e7d32', display: 'block', marginBottom: '2px', fontSize: '0.9rem' }}>SALDO DELL'EVENTO</span>
                      Saldo tramite rimessa diretta a fine evento.
                    </div>
                  </div>
                  
                  <div style={{ marginBottom: '20px', textAlign: 'left' }}>
                    <h4 style={{ margin: '20px 0 8px 0', color: '#111', borderBottom: '1px solid #ddd', paddingBottom: '3px', fontSize: '0.9rem' }}>EVENTUALI ADDIZIONALI</h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <div style={{ textAlign: 'left' , margin: '10px 0 0 0'}}>⚡ <strong>Generatore di corrente:</strong> Posizionabile su richiesta qualora non ci sia elettricità o non fosse disponibile la potenza sufficiente sul posto.</div>
                      <div style={{ textAlign: 'left' , margin: '10px 0 0 0' }}>🏆 <strong>Arbitraggio:</strong> Disponibile su richiesta servizio di assistenza e direzione per le varie partite.</div>
                      <div style={{ textAlign: 'left' , margin: '10px 0 0 0' }}>🎨 <strong>Personalizzazione:</strong> Tutti i giochi in struttura sono interamente personalizzabili.</div>
                    </div>
                  </div>

                  <div style={{ textAlign: 'left' }}>
                    <h4 style={{ margin: '0 0 8px 0', color: '#111', borderBottom: '1px solid #ddd', paddingBottom: '3px', fontSize: '0.9rem' }}>CONDIZIONI GENERALI</h4>
                    <ul style={{ margintop: 0, paddingLeft: '18px', listStyleType: 'square', textAlign: 'left' }}>
                      <li style={{ marginBottom: '6px', textAlign: 'left' }}>
  I giochi e i prezzi proposti sopra sono soggetti a <strong>verifica della disponibilità al momento della conferma</strong>.
</li>
<li style={{ marginBottom: '6px', textAlign: 'left' }}>
  I prezzi presenti in questa offerta fanno riferimento ad un noleggio di una <strong> durata pari a 6 ore</strong>.
</li>
<li style={{ marginBottom: '6px', textAlign: 'left' }}>
  La <strong>location di allestimento dei giochi deve essere facilmente accessibile</strong> con i nostri automezzi (automobile o furgone tipo Ducato) e prevedere un parcheggio gratuito nelle immediate vicinanze. I prezzi includono esclusivamente la consegna al piano terra.
</li>

<li style={{ marginBottom: '6px', textAlign: 'left' }}>
  Al fine di valutare la fattibilità della manifestazione, ci riserviamo il diritto di richiedere, al momento dell'accettazione del preventivo, <strong>documentazione fotografica dell'area di gioco</strong>. Qualora necessario, potrebbe essere richiesto un sopralluogo preliminare.
</li>

<li style={{ marginBottom: '6px', textAlign: 'left' }}>
  Per una corretta gestione delle tempistiche, al calcolo della durata dell'evento va <strong>aggiunto il tempo di montaggio e smontaggio</strong>. Ad esempio, se è indicata un'ora di montaggio, il nostro personale arriverà con un'ora di anticipo rispetto all'inizio dell'evento e rimarrà per l'ora successiva alla conclusione dello stesso.
</li>

<li style={{ marginBottom: '2px', textAlign: 'left' }}>
  Tutti i costi e gli adempimenti relativi a <strong>pratiche per lo svolgimento del gioco su suolo pubblico</strong> (autorizzazioni, permessi, marche da bollo, ecc.) sono a totale carico del committente.
</li>

<li style={{ marginBottom: '2px', textAlign: 'left' }}>
  L'eventuale richiesta di <strong>documentazione accessoria</strong> deve essere inoltrata con un <strong>preavviso di almeno 15 giorni</strong> rispetto alla data dell'evento. Tale documentazione potrebbe essere soggetta a costi aggiuntivi.
</li>
                    </ul>
                  </div>
                </div>
              </div>

            </div>
        </div>
      </div>

      {/* ===================== FORM NUOVO/MODIFICA PREVENTIVO (overlay compatto) ===================== */}
      {showFormPreventivo && (
        <div className="modal-preventivo-backdrop" onClick={chiudiFormPreventivo}>
          <div className="modal-form-pren-box" onClick={(e) => e.stopPropagation()}>
            <button className="btn-chiudi" title="Chiudi" onClick={chiudiFormPreventivo}>✕</button>
            {renderFormPreventivo()}
          </div>
        </div>
      )}
    </>
  )
}

export default Preventivatore
