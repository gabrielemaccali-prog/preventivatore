import { useState, useEffect, Fragment } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabaseClient'
import { validaCF } from '../../lib/utils'
import { puoVedere } from '../../lib/permessi'
import RicercaIndirizzo from '../../components/RicercaIndirizzo'

const GIORNI = [
  { n: 1, l: 'Lun' }, { n: 2, l: 'Mar' }, { n: 3, l: 'Mer' }, { n: 4, l: 'Gio' },
  { n: 5, l: 'Ven' }, { n: 6, l: 'Sab' }, { n: 7, l: 'Dom' }
];

const PACCHETTO_VUOTO = { nome: "", durataOre: "", locationTipo: "libera", prezzo: "", centroRicavo: "", prevedeRinfresco: false, numeroPartecipanti: "" };
const OPERATORE_VUOTO = { nome: "", email: "", telefono: "" };
const CAMPO_VUOTO = { nome: "", nomeCompleto: "", indirizzo: "", cap: "", citta: "", provincia: "", centroCosto: "", costoFlat: "", ivaInclusaCampo: false, ivaInclusaRinfresco: false, costoMerenda: "", costoAperitivo: "", ivaCampo: "22", ivaRinfresco: "22", noRinfresco: false };

// Frazione IVA da applicare (percentuale campo, es. 22 -> 0.22); 22% di default se non specificata sul campo.
const fracIva = (v) => (v != null && v !== '' ? parseFloat(v) : 22) / 100;

const PREN_VUOTA = {
  data: "", pacchettoId: "", oraInizio: "", oraFine: "",
  nominativo: "", email: "", telefono: "",
  campoId: "", campoPrenotato: false, locationIndirizzo: "", locationCap: "", locationCitta: "", locationProvincia: "",
  operatoriIds: [], sconto: "0", prezzoManuale: "",
  tipoRinfresco: "", numeroPartecipanti: "", etaMedia: "", note: "", pagamenti: [],
  preventivoCollegato: "", ereditaCosti: false, costoEreditato: "",
  fattTipo: "privato",
  fattNome: "", fattCognome: "", fattIndirizzo: "", fattCap: "", fattCitta: "", fattProvincia: "", fattCF: "",
  ragioneSociale: "", aziIndirizzo: "", aziCap: "", aziCitta: "", aziProvincia: "", pIva: "", cfAzienda: "", sdi: "",
  stato: "FORSE"
};

const ivaLabel = (incl) => incl ? 'IVA inclusa' : 'IVA esclusa';

// "HH:MM" -> minuti dalla mezzanotte (null se vuoto/non valido)
const toMinutes = (hhmm) => {
  const m = (hhmm || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
};

// Giorno settimana 1=Lun..7=Dom da una data ISO
const giornoSettimana = (dataStr) => {
  if (!dataStr) return null;
  const d = new Date(dataStr).getDay(); // 0=Dom..6=Sab
  return d === 0 ? 7 : d;
};

const MESI = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
const toISODate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addGiorni = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const inizioSettimana = (d) => { const x = new Date(d); const g = x.getDay(); x.setDate(x.getDate() - (g === 0 ? 6 : g - 1)); x.setHours(0, 0, 0, 0); return x; };
const coloreStato = (s) => s === 'CONF' ? { bg: '#dcfce7', bd: '#16a34a', tx: '#166534' } : { bg: '#fed7aa', bd: '#f59e0b', tx: '#9a3412' };

// Data breve in italiano, es. "24 luglio" (senza anno)
const formattaDataBreveIT = (dataStr) => {
  if (!dataStr) return '';
  return new Date(dataStr).toLocaleDateString('it-IT', { day: '2-digit', month: 'long' });
};

// Ripulisce un numero di telefono per un link wa.me (aggiunge il prefisso 39 ai numeri italiani senza prefisso)
const numeroWhatsApp = (telefono) => {
  const cifre = (telefono || '').replace(/\D/g, '');
  if (!cifre) return null;
  return cifre.length === 10 ? `39${cifre}` : cifre;
};

// Calendario Google condiviso su cui precompilare i link "Aggiungi a Google Calendar" (vedi Impostazioni/CLAUDE per come cambiarlo)
const GOOGLE_CALENDAR_ID = 'bubblefootballmi@gmail.com';

// Costruisce data/ora come oggetto Date locale, senza ambiguità di fuso (evita l'interpretazione UTC di "YYYY-MM-DD")
const dataOraLocale = (dataStr, oraStr) => {
  const [y, mese, g] = (dataStr || '').split('-').map(Number);
  const [h, m] = (oraStr || '00:00').split(':').map(Number);
  return new Date(y, (mese || 1) - 1, g || 1, h || 0, m || 0, 0);
};

// Formatta un Date nel formato richiesto da Google Calendar (YYYYMMDDTHHMMSS, orario locale + parametro ctz)
const dataOraGoogle = (d) => {
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}T${p2(d.getHours())}${p2(d.getMinutes())}00`;
};

// Costruisce la descrizione estesa dell'evento Google Calendar: contatti, dettagli vendita, pagamento, fatturazione
const dettagliGoogleCalendar = (p) => {
  const righe = [];
  righe.push(`Contatti: ${p.nominativo || ''}${p.telefono ? ` · Tel ${p.telefono}` : ''}${p.email ? ` · ${p.email}` : ''}`);
  if (p.etaMedia) righe.push(`Età media partecipanti: ${p.etaMedia}`);
  if (p.note) righe.push(`Note: ${p.note}`);

  righe.push('');
  righe.push(`Pacchetto: ${p.pacchettoNome || '—'}${p.numeroPartecipanti ? ` · ${p.numeroPartecipanti} partecipanti` : ''}`);
  if (p.tipoRinfresco) righe.push(`Rinfresco: ${p.tipoRinfresco}`);
  righe.push(`Prezzo vendita: €${(parseFloat(p.prezzoVendita) || 0).toFixed(2)}${p.sconto ? ` (sconto ${p.sconto}%)` : ''}`);

  righe.push('');
  const pagatoTot = (p.pagamenti || []).reduce((s, x) => s + (parseFloat(x.importo) || 0), 0);
  righe.push(`Pagamento: ${p.statoPagamento || 'in attesa'} — pagato €${pagatoTot.toFixed(2)} / €${(parseFloat(p.prezzoVendita) || 0).toFixed(2)}`);
  (p.pagamenti || []).forEach(pg => righe.push(`  • ${pg.data}: €${(parseFloat(pg.importo) || 0).toFixed(2)}${pg.nominativo ? ` (${pg.nominativo})` : ''}`));

  if (p.fattTipo === 'azienda') {
    righe.push('');
    righe.push(`Fatturazione (azienda): ${p.ragioneSociale || ''}`);
    if (p.aziIndirizzo || p.aziCitta) righe.push(`  ${[p.aziIndirizzo, p.aziCap, p.aziCitta, p.aziProvincia].filter(Boolean).join(', ')}`);
    if (p.pIva) righe.push(`  P.IVA ${p.pIva}`);
    if (p.cfAzienda) righe.push(`  CF ${p.cfAzienda}`);
    if (p.sdi) righe.push(`  SDI ${p.sdi}`);
  } else if (p.fattTipo === 'privato' && (p.fattNome || p.fattCognome || p.fattCF)) {
    righe.push('');
    righe.push(`Fatturazione (privato): ${[p.fattNome, p.fattCognome].filter(Boolean).join(' ')}`);
    if (p.fattIndirizzo || p.fattCitta) righe.push(`  ${[p.fattIndirizzo, p.fattCap, p.fattCitta, p.fattProvincia].filter(Boolean).join(', ')}`);
    if (p.fattCF) righe.push(`  CF ${p.fattCF}`);
  }
  return righe.join('\n');
};

// Link "Aggiungi a Google Calendar" precompilato con i dati della prenotazione, sul calendario condiviso GOOGLE_CALENDAR_ID.
// operatoriAnagrafica serve a risolvere l'email corrente degli operatori assegnati (nello snapshot della prenotazione c'è solo id/nome).
const linkGoogleCalendar = (p, operatoriAnagrafica) => {
  const inizio = dataOraLocale(p.data, p.oraInizio);
  const durataOre = p.oraFine ? durataDaOrari(p.oraInizio, p.oraFine) : (parseFloat(p.durataOre) || 1);
  const fine = new Date(inizio.getTime() + Math.max(durataOre, 0.25) * 3600000);
  const luogo = p.campoNome || [p.locationIndirizzo, p.locationCitta].filter(Boolean).join(', ') || '';
  const titolo = [p.nominativo, p.campoNome, p.pacchettoNome].filter(Boolean).join(' - ');
  const emailOperatori = (p.operatori || [])
    .map(op => (operatoriAnagrafica || []).find(o => o.id === op.id)?.email)
    .filter(Boolean);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: titolo,
    dates: `${dataOraGoogle(inizio)}/${dataOraGoogle(fine)}`,
    details: dettagliGoogleCalendar(p),
    location: luogo,
    src: GOOGLE_CALENDAR_ID,
    authuser: GOOGLE_CALENDAR_ID,
    ctz: 'Europe/Rome',
  });
  if (emailOperatori.length > 0) params.set('add', emailOperatori.join(','));
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
};

// Numero settimana ISO 8601
const numeroSettimana = (d) => {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil((((t - yearStart) / 86400000) + 1) / 7);
};

// Inserisce automaticamente i due punti mentre si digita l'orario: "1900" -> "19:00"
const formattaOraInput = (raw) => {
  const d = (raw || "").replace(/\D/g, "").slice(0, 4);
  if (d.length <= 2) return d;
  return d.slice(0, 2) + ':' + d.slice(2);
};

// Validazione formato email
const validaEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((e || "").trim());

// Stato pagamento derivato dai versamenti rispetto al prezzo di vendita
const statoPagamentoDi = (pagamenti, prezzoVendita) => {
  const tot = (pagamenti || []).reduce((s, p) => s + (parseFloat(p.importo) || 0), 0);
  if (tot <= 0) return 'in attesa';
  if (tot + 0.001 >= (prezzoVendita || 0)) return 'saldato';
  return 'acconto';
};

// Verifica se i dati di fatturazione sono completi (privato con CF valido, oppure azienda con P.IVA)
const fatturazioneCompletaDi = (p) => p.fattTipo === 'azienda'
  ? !!(p.ragioneSociale && p.aziIndirizzo && p.aziCitta && p.pIva)
  : !!(p.fattNome && p.fattCognome && p.fattIndirizzo && p.fattCitta && validaCF(p.fattCF));

// Durata in ore dalla differenza inizio/fine (gestisce l'attraversamento della mezzanotte)
const durataDaOrari = (ini, fin) => {
  const a = toMinutes(ini), b = toMinutes(fin);
  if (a == null || b == null) return null;
  let diff = b - a;
  if (diff <= 0) diff += 24 * 60;
  return Math.round((diff / 60) * 100) / 100;
};
const numOrNull = (v) => v === "" || v == null ? null : parseFloat(v);

// Normalizza un orario in formato 24h "HH:MM". Accetta "1900" o "19:00". Ritorna null se non valido.
const normalizzaOra24 = (raw) => {
  const s = (raw || "").trim();
  if (s === "") return "";
  const soloCifre = s.replace(/[^\d]/g, "");
  if (soloCifre.length !== 4) return null;
  const hh = parseInt(soloCifre.slice(0, 2), 10);
  const mm = parseInt(soloCifre.slice(2, 4), 10);
  if (hh > 23 || mm > 59) return null;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};

const lblStyle = { display: 'block', fontSize: '0.78rem', fontWeight: 'bold', color: '#555', marginBottom: '3px' };
// Componente a livello di modulo (non ricreato ad ogni render): un input dentro,
// altrimenti React lo tratta come un tipo nuovo ad ogni render e l'input perde il focus a ogni carattere digitato.
const Campo = ({ label, children }) => (
  <div><label style={lblStyle}>{label}</label>{children}</div>
);

function Prenotazioni({ user }) {
  const primaSchedaPren = ['nuova', 'config', 'gestione', 'calendario'].find(s => puoVedere(user, 'prenotazioni', s)) || 'nuova';
  const [currentView, setCurrentView] = useState(primaSchedaPren); // config | nuova | gestione | calendario
  const primaSottoschedaConfigPren = ['pacchetti', 'operatori', 'campi'].find(s => puoVedere(user, 'prenotazioni', 'config', s)) || 'pacchetti';
  const [configTab, setConfigTab] = useState(primaSottoschedaConfigPren);  // pacchetti | operatori | campi
  const [gestioneTab, setGestioneTab] = useState("inAttesaPagamento"); // inAttesaPagamento | daConfermare | partiteAttive | daCompletare

  const [pacchetti, setPacchetti] = useState([]);
  const [operatori, setOperatori] = useState([]);
  const [campi, setCampi] = useState([]);
  const [tariffe, setTariffe] = useState([]);

  // visibilità dei form (aperti da "Nuovo" o "Modifica")
  const [showFormPacchetto, setShowFormPacchetto] = useState(false);
  const [showFormOperatore, setShowFormOperatore] = useState(false);
  const [showFormCampo, setShowFormCampo] = useState(false);

  // visibilità elenchi (collassabili, aperti di default)
  const [showListaPacchetti, setShowListaPacchetti] = useState(true);
  const [showListaOperatori, setShowListaOperatori] = useState(true);
  const [showListaCampi, setShowListaCampi] = useState(true);
  // singole schede campo (collassate di default: mostrano solo nome/indirizzo, il dettaglio si apre al click)
  const [campiEspansi, setCampiEspansi] = useState({});
  const toggleCampoEspanso = (id) => setCampiEspansi(prev => ({ ...prev, [id]: !prev[id] }));

  // Raggruppa i campi per provincia (ordine alfabetico, "Senza provincia" sempre in coda)
  const gruppiCampiPerProvincia = (() => {
    const gruppi = {};
    campi.forEach(c => {
      const prov = c.provincia || 'Senza provincia';
      if (!gruppi[prov]) gruppi[prov] = [];
      gruppi[prov].push(c);
    });
    return Object.entries(gruppi).sort(([a], [b]) => {
      if (a === 'Senza provincia') return 1;
      if (b === 'Senza provincia') return -1;
      return a.localeCompare(b);
    });
  })();

  // form (usati sia per creare sia per modificare)
  const [formPacchetto, setFormPacchetto] = useState(PACCHETTO_VUOTO);
  const [editPacchetto, setEditPacchetto] = useState(null);
  const [formOperatore, setFormOperatore] = useState(OPERATORE_VUOTO);
  const [editOperatore, setEditOperatore] = useState(null);
  // editing inline in tabella
  const [idPacchettoInline, setIdPacchettoInline] = useState(null);
  const [datiPacchettoInline, setDatiPacchettoInline] = useState(PACCHETTO_VUOTO);
  const [idOperatoreInline, setIdOperatoreInline] = useState(null);
  const [datiOperatoreInline, setDatiOperatoreInline] = useState(OPERATORE_VUOTO);
  const [formCampo, setFormCampo] = useState(CAMPO_VUOTO);
  const [editCampo, setEditCampo] = useState(null);
  const [nuovaTariffa, setNuovaTariffa] = useState({ campoId: "", giorni: [], oraInizio: "", oraFine: "", costo: "" });

  // --- NUOVA PRENOTAZIONE ---
  const [prenotazioni, setPrenotazioni] = useState([]);
  const [preventivi, setPreventivi] = useState([]);
  const [voucher, setVoucher] = useState([]);
  const [formPren, setFormPren] = useState(PREN_VUOTA);
  const [formPrenOriginale, setFormPrenOriginale] = useState(null); // snapshot al caricamento, per evidenziare i campi modificati
  const [codicePrenInModifica, setCodicePrenInModifica] = useState(null);
  const [salvataggioPren, setSalvataggioPren] = useState(false);
  const [nuovoPagamento, setNuovoPagamento] = useState({ importo: "", data: "", nominativo: "" });
  const [filtroPrenData, setFiltroPrenData] = useState("");
  const [filtroPrenStato, setFiltroPrenStato] = useState("");
  const [filtroPrenNome, setFiltroPrenNome] = useState("");
  const [calView, setCalView] = useState("mese");
  const [calDate, setCalDate] = useState(() => new Date());
  const [prenSelezionata, setPrenSelezionata] = useState(null);
  const [testoConferma, setTestoConferma] = useState(null); // testo mail di conferma pronto da copiare
  const [confermaCopiata, setConfermaCopiata] = useState(false);
  const [riepilogoData, setRiepilogoData] = useState(() => new Date());
  const [riepilogoTab, setRiepilogoTab] = useState("operatori"); // operatori | campi
  const [riepilogoTesto, setRiepilogoTesto] = useState(null); // messaggio whatsapp pronto da copiare
  const [riepilogoCopiato, setRiepilogoCopiato] = useState(false);

  useEffect(() => { fetchTutto(); }, []);

  const fetchTutto = async () => {
    const [p, o, c, t, pr, pv, vc] = await Promise.all([
      supabase.from('pren_pacchetti').select('*').order('nome'),
      supabase.from('pren_operatori').select('*').order('nome'),
      supabase.from('pren_campi').select('*').order('nome'),
      supabase.from('pren_campi_tariffe').select('*'),
      supabase.from('prenotazioni').select('*').order('data', { ascending: false }),
      supabase.from('preventivi').select('*').order('codice', { ascending: false }),
      supabase.from('voucher').select('*').order('codice', { ascending: false })
    ]);
    if (p.data) setPacchetti(p.data);
    if (o.data) setOperatori(o.data);
    if (c.data) setCampi(c.data);
    if (t.data) setTariffe(t.data);
    if (pr.data) setPrenotazioni(pr.data);
    if (pv.data) setPreventivi(pv.data);
    if (vc.data) setVoucher(vc.data);
  };

  // Costo campo: cerca la tariffa variabile la cui fascia contiene l'ora di inizio nel giorno scelto; altrimenti flat
  const calcolaCostoCampo = (campo, dataStr, oraInizio) => {
    if (!campo) return 0;
    const flat = parseFloat(campo.costoFlat) || 0;
    const g = giornoSettimana(dataStr);
    const oraMin = toMinutes(oraInizio);
    if (g == null || oraMin == null) return flat;
    for (const tr of tariffe.filter(x => x.campoId === campo.id)) {
      const giorni = (tr.giorni || "").split(',').filter(Boolean).map(Number);
      if (!giorni.includes(g)) continue;
      const ini = toMinutes(tr.oraInizio);
      let fin = toMinutes(tr.oraFine);
      if (ini == null) continue;
      if (fin == null || fin <= ini) fin = 24 * 60; // es. 19:00-00:00 -> mezzanotte
      if (oraMin >= ini && oraMin < fin) return parseFloat(tr.costo) || 0;
    }
    return flat;
  };

  // ID prenotazione PRN-AAAA-NNNN (reset annuale, legge l'ultimo dal DB)
  const generaCodicePren = async () => {
    const anno = new Date().getFullYear();
    const prefix = `PRN-${anno}-`;
    const { data } = await supabase.from('prenotazioni').select('id').like('id', `${prefix}%`).order('id', { ascending: false }).limit(1);
    let prossimo = 1001;
    if (data && data.length > 0) {
      const ultimo = parseInt(data[0].id.replace(prefix, ''));
      if (!isNaN(ultimo)) prossimo = ultimo + 1;
    }
    return `${prefix}${prossimo}`;
  };

  const nuovaPrenotazione = () => { setFormPren(PREN_VUOTA); setFormPrenOriginale(null); setCodicePrenInModifica(null); };

  const caricaPrenotazione = (p) => {
    const pac = pacchetti.find(x => x.id === p.pacchettoId);
    const hasPrezzo = pac && pac.prezzo != null && pac.prezzo !== "";
    const scontoN = parseFloat(p.sconto) || 0;
    const nettoVend = p.prezzoVenditaNetto != null ? parseFloat(p.prezzoVenditaNetto) : ((parseFloat(p.prezzoVendita) || 0) / 1.22);
    const prezzoManuale = hasPrezzo ? "" : (scontoN < 100 ? String(Math.round((nettoVend / (1 - scontoN / 100)) * 100) / 100) : String(nettoVend));
    setCodicePrenInModifica(p.id);
    const caricato = {
      data: p.data || "", pacchettoId: p.pacchettoId || "",
      oraInizio: p.oraInizio || "", oraFine: p.oraFine || "",
      nominativo: p.nominativo || "", email: p.email || "", telefono: p.telefono || "",
      campoId: p.campoId || "", campoPrenotato: !!p.campoPrenotato,
      locationIndirizzo: p.locationIndirizzo || "", locationCap: p.locationCap || "", locationCitta: p.locationCitta || "", locationProvincia: p.locationProvincia || "",
      operatoriIds: (p.operatori || []).map(o => o.id),
      sconto: String(p.sconto ?? "0"), prezzoManuale,
      tipoRinfresco: p.tipoRinfresco || "", numeroPartecipanti: p.numeroPartecipanti ?? "", etaMedia: p.etaMedia || "", note: p.note || "",
      pagamenti: p.pagamenti || [],
      preventivoCollegato: p.preventivoCollegato || "", ereditaCosti: !!p.ereditaCosti, costoEreditato: p.costoEreditato ?? "",
      fattTipo: p.fattTipo || "privato",
      fattNome: p.fattNome || "", fattCognome: p.fattCognome || "", fattIndirizzo: p.fattIndirizzo || "", fattCap: p.fattCap || "", fattCitta: p.fattCitta || "", fattProvincia: p.fattProvincia || "", fattCF: p.fattCF || "",
      ragioneSociale: p.ragioneSociale || "", aziIndirizzo: p.aziIndirizzo || "", aziCap: p.aziCap || "", aziCitta: p.aziCitta || "", aziProvincia: p.aziProvincia || "", pIva: p.pIva || "", cfAzienda: p.cfAzienda || "", sdi: p.sdi || "",
      stato: p.stato || "FORSE"
    };
    setFormPren(caricato);
    setFormPrenOriginale(caricato);
    setCurrentView("nuova");
  };

  // Data in formato esteso italiano, es. "Mercoledì 09 settembre 2026"
  const formattaDataEstesaIT = (dataStr) => {
    if (!dataStr) return '';
    const txt = new Date(dataStr).toLocaleDateString('it-IT', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
    return txt.charAt(0).toUpperCase() + txt.slice(1);
  };

  const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Costruisce la mail di conferma (testo semplice + HTML con tabella, come nel formato usato oggi via Gmail)
  const costruisciConferma = (p) => {
    const campoInfo = p.campoId ? campi.find(c => c.id === p.campoId) : null;
    const locationTxt = campoInfo
      ? [campoInfo.nomeCompleto || campoInfo.nome, [campoInfo.indirizzo, campoInfo.citta].filter(Boolean).join(', ')].filter(Boolean).join(' ')
      : (p.campoNome || [p.locationIndirizzo, p.locationCitta].filter(Boolean).join(', ') || '—');
    const oraTxt = p.oraInizio ? `${p.oraInizio}${p.oraFine ? ` - ${p.oraFine}` : ''}${p.durataOre ? `   (${p.durataOre} ${p.durataOre === 1 ? 'ora' : 'ore'})` : ''}` : '—';
    const prezzoVendita = parseFloat(p.prezzoVendita) || 0;
    const totalePagatoP = (p.pagamenti || []).reduce((s, x) => s + (parseFloat(x.importo) || 0), 0);
    const residuo = Math.max(prezzoVendita - totalePagatoP, 0);
    const statoPag = p.statoPagamento || statoPagamentoDi(p.pagamenti, prezzoVendita);
    const rigaPagamentoLabel = statoPag === 'saldato' ? 'Pagamento:' : 'Modalità di pagamento:';
    const rigaPagamentoValore = statoPag === 'saldato'
      ? 'SALDATO ✅'
      : `Con Bonifico — Importo da versare: €${residuo.toFixed(2)}${totalePagatoP > 0 ? ` (già versato €${totalePagatoP.toFixed(2)} su €${prezzoVendita.toFixed(2)})` : ''}`;

    const testo = [
      `Ciao ${p.nominativo || ''},`,
      '',
      `di seguito puoi trovare l'avvenuta conferma della tua prenotazione:`,
      '',
      'PRENOTAZIONE',
      p.pacchettoNome || '',
      'Data:',
      formattaDataEstesaIT(p.data),
      'Orario:',
      oraTxt,
      'Centro Sportivo:',
      locationTxt,
      'Tariffa di gioco:',
      `${prezzoVendita.toFixed(2)}€`,
      '',
      rigaPagamentoLabel,
      rigaPagamentoValore,
      '',
      "Ricordiamo inoltre che E' VIETATO introdurre all'interno del Centro Sportivo cibi e bevande acquistati altrove.",
      '',
      "In caso di disdetta ti chiedo gentilmente di comunicarlo entro 30 ore dalla data dell'evento.",
      '',
      'Cosa fare adesso?',
      "- Compilare il modulo di registrazione all'evento che trovi al link https://forms.gle/mmVKZW81XEvkVU4A6",
      "  Tutti i giocatori dovranno compilare il modulo online, stampare o conservare sul telefono la mail di conferma e mostrarla al nostro staff PRIMA DI GIOCARE. Eventuali giocatori sprovvisti di tale conferma non potranno prendere parte all'attività.",
      '',
      '- Presentatevi al campo 20 minuti in anticipo per la verifica della documentazione.',
      '',
      '- Consigliamo di consultare la pagina FAQ https://www.bubblefootballmi.it/faq/ dove troverete ulteriori informazioni utili.',
      '',
      "Si informa che, in caso di comportamenti scorretti o non conformi al regolamento, l'attività potrà essere sospesa definitivamente, con la conseguente perdita di qualsiasi diritto al rimborso.",
      '',
      'Resto in attesa di conferma presa visione e in caso di eventuali errori ti prego di segnalarli rispondendo a questa email.',
      '',
      'Saluti',
      'Karin',
      '',
      '',
      'Bubble Football Milano | Calcio al Buio | Ideeinfesta',
      'Tel. (0039) 351 67 59 881',
      'E-mail: bubblefootballmi@gmail.com',
      'Sito web: www.bubblefootballitalia.it | www.calcioalbuio.it | www.ideeinfesta.it/',
      'BFM S.R.L. (C.F./P.IVA 14418440963)'
    ].join('\n');

    const cellaLabel = 'background:#1f79cb;color:#fff;font-weight:bold;border:1px solid #1f79cb;padding:6px 10px;';
    const cellaValore = 'border:1px solid #1f79cb;padding:6px 10px;color:#000;';
    const rigaTabella = (label, valore, big) => `<tr><td style="${cellaLabel}">${escapeHtml(label)}</td><td style="${cellaValore}${big ? 'font-weight:bold;font-size:15px;' : ''}">${escapeHtml(valore)}</td></tr>`;

    const html = `
      <div style="font-family:Calibri,Arial,sans-serif;font-size:14px;color:#000;line-height:1.5;">
        <p>Ciao ${escapeHtml(p.nominativo || '')},</p>
        <p>di seguito puoi trovare l'avvenuta conferma della tua prenotazione:</p>
        <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:12px 0;">
          <tbody>
            ${rigaTabella('PRENOTAZIONE', p.pacchettoNome || '', true)}
            ${rigaTabella('Data:', formattaDataEstesaIT(p.data))}
            ${rigaTabella('Orario:', oraTxt)}
            ${rigaTabella('Centro Sportivo:', locationTxt)}
            ${rigaTabella('Tariffa di gioco:', `${prezzoVendita.toFixed(2)}€`)}
            ${rigaTabella(rigaPagamentoLabel, rigaPagamentoValore)}
          </tbody>
        </table>
        <p><b>Ricordiamo inoltre che E' VIETATO introdurre all'interno del Centro Sportivo cibi e bevande acquistati altrove.</b></p>
        <p><b><u>In caso di disdetta ti chiedo gentilmente di comunicarlo entro 30 ore dalla data dell'evento.</u></b></p>
        <p>Cosa fare adesso?</p>
        <ul style="margin:0 0 12px;padding-left:20px;">
          <li style="margin-bottom:10px;"><b>Compilare il modulo di registrazione all'evento che trovi al link</b> <a href="https://forms.gle/mmVKZW81XEvkVU4A6">https://forms.gle/mmVKZW81XEvkVU4A6</a><br>
            <u>Tutti i giocatori dovranno compilare il modulo online, stampare o conservare sul telefono la mail di conferma e mostrarla al nostro staff PRIMA DI GIOCARE. Eventuali giocatori sprovvisti di tale conferma non potranno prendere parte all'attività.</u>
          </li>
          <li style="margin-bottom:10px;"><b>Presentatevi al campo 20 minuti in anticipo</b> per la verifica della documentazione.</li>
          <li>Consigliamo di consultare la pagina FAQ <a href="https://www.bubblefootballmi.it/faq/">https://www.bubblefootballmi.it/faq/</a> dove troverete ulteriori informazioni utili.</li>
        </ul>
        <p style="background:#ff9900;padding:6px;display:inline-block;"><u><b><i>Si informa che, in caso di comportamenti scorretti o non conformi al regolamento, l'attività potrà essere sospesa definitivamente, con la conseguente perdita di qualsiasi diritto al rimborso</i></b></u>.</p>
        <p>Resto in attesa di conferma presa visione e in caso di eventuali errori ti prego di segnalarli rispondendo a questa email.</p>
        <p>Saluti<br>Karin</p>
        <p style="color:#444;font-size:13px;">
          Bubble Football Milano | Calcio al Buio | Ideeinfesta<br>
          Tel. (0039) 351 67 59 881<br>
          E-mail: <a href="mailto:bubblefootballmi@gmail.com">bubblefootballmi@gmail.com</a><br>
          Sito web: <a href="https://www.bubblefootballitalia.it">www.bubblefootballitalia.it</a> | <a href="http://www.calcioalbuio.it">www.calcioalbuio.it</a> | <a href="http://www.ideeinfesta.it/">www.ideeinfesta.it/</a><br>
          BFM S.R.L. (C.F./P.IVA 14418440963)
        </p>
      </div>
    `;

    return { testo, html };
  };

  const cambiaStatoPren = async (p, nuovoStato) => {
    await supabase.from('prenotazioni').update({ stato: nuovoStato }).eq('id', p.id);
    fetchTutto();
    if (nuovoStato === 'CONF') setTestoConferma(costruisciConferma(p));
  };
  const toggleCampoPrenotato = async (p) => {
    const nuovo = !p.campoPrenotato;
    await supabase.from('prenotazioni').update({ campoPrenotato: nuovo }).eq('id', p.id);
    setPrenSelezionata(prev => (prev && prev.id === p.id) ? { ...prev, campoPrenotato: nuovo } : prev);
    fetchTutto();
  };
  // Apre il link precompilato Google Calendar e segna la prenotazione come sincronizzata (ripristinato a "non sincronizzato" ad ogni modifica salvata)
  const apriGoogleCalendar = async (p) => {
    window.open(linkGoogleCalendar(p, operatori), '_blank', 'noopener,noreferrer');
    await supabase.from('prenotazioni').update({ googleCalendarSync: true }).eq('id', p.id);
    setPrenSelezionata(prev => (prev && prev.id === p.id) ? { ...prev, googleCalendarSync: true } : prev);
    fetchTutto();
  };
  // Permette di correggere manualmente lo stato di sincronizzazione (es. click per errore, evento poi cancellato su Google Calendar)
  const toggleGoogleCalendarSync = async (p) => {
    const nuovo = !p.googleCalendarSync;
    await supabase.from('prenotazioni').update({ googleCalendarSync: nuovo }).eq('id', p.id);
    setPrenSelezionata(prev => (prev && prev.id === p.id) ? { ...prev, googleCalendarSync: nuovo } : prev);
    fetchTutto();
  };
  const eliminaPrenotazione = async (id) => {
    if (!window.confirm(`Eliminare la prenotazione ${id}?`)) return;
    await supabase.from('prenotazioni').delete().eq('id', id);
    fetchTutto();
  };

  // Riga di tabella condivisa da Storico e dalle sotto-schede di Gestione (stesse azioni: apri, conferma, calendario, elimina)
  const rigaTabellaPren = (p) => {
    const totPagato = (p.pagamenti || []).reduce((s, x) => s + (parseFloat(x.importo) || 0), 0);
    const totale = parseFloat(p.prezzoVendita) || 0;
    return (
      <tr key={p.id} style={{ borderBottom: '1px solid #eee' }}>
        <td style={{ padding: '12px' }}>
          <strong>{p.id}</strong><br />
          <span style={{ color: '#777', fontSize: '0.8rem' }}>{p.data} {p.oraInizio ? `· ${p.oraInizio}` : ''}</span><br />
          <span className={`badge-stato ${(p.stato || '').toLowerCase()}`} style={{ marginTop: '6px' }}>{p.stato}</span>
        </td>
        <td style={{ padding: '12px' }}>
          👤 {p.nominativo}<br />
          {p.telefono && <span style={{ fontSize: '0.8rem', color: '#555' }}>📞 {p.telefono}</span>}
        </td>
        <td style={{ padding: '12px', fontSize: '0.82rem', color: '#555' }}>
          {p.pacchettoNome || '—'}<br />
          <span style={{ color: '#777' }}>{p.campoNome || [p.locationIndirizzo, p.locationCitta].filter(Boolean).join(', ') || '—'}</span>
          {p.operatori && p.operatori.length > 0 && <><br /><span style={{ color: '#0288d1' }}>🧑‍🔧 {p.operatori.map(o => o.nome).join(', ')}</span></>}
        </td>
        <td style={{ padding: '12px' }}>
          <strong style={{ color: '#0f172a' }}>€{totPagato.toFixed(2)}</strong> <span style={{ color: '#777' }}>/ €{totale.toFixed(2)}</span><br />
          <span className="badge-stato" style={{ marginTop: '6px', background: p.statoPagamento === 'saldato' ? '#dcfce7' : p.statoPagamento === 'acconto' ? '#fef9c3' : '#fee2e2', color: p.statoPagamento === 'saldato' ? '#166534' : p.statoPagamento === 'acconto' ? '#854d0e' : '#991b1b' }}>{p.statoPagamento || 'in attesa'}</span>
        </td>
        <td style={{ padding: '12px', textAlign: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'row', gap: '6px', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn-modifica-inline" title="Apri" style={{ padding: '6px 9px' }} onClick={() => caricaPrenotazione(p)}>📂</button>
            {p.stato === "FORSE" && (
              <button className="btn-conferma" title="Conferma (prepara mail al cliente)" style={{ width: 'auto', padding: '6px 9px' }} onClick={() => cambiaStatoPren(p, "CONF")}>✔️</button>
            )}
            {p.stato === "CONF" && (
              <button className="btn-ripristina" title="Riporta a FORSE" style={{ width: 'auto', padding: '6px 9px' }} onClick={() => cambiaStatoPren(p, "FORSE")}>↩️</button>
            )}
            <button className="btn-modifica-inline" title={p.googleCalendarSync ? "Già aggiunto a Google Calendar (clic per riaprire)" : "Aggiungi a Google Calendar"} style={{ padding: '6px 9px' }} onClick={() => apriGoogleCalendar(p)}>📅</button>
            <button type="button" onClick={() => toggleGoogleCalendarSync(p)} title={p.googleCalendarSync ? "Sincronizzato con Google Calendar (clic per correggere a mano)" : "Non ancora sincronizzato con Google Calendar (clic per correggere a mano)"} style={{ border: 'none', cursor: 'pointer', fontSize: '0.68rem', fontWeight: 'bold', padding: '2px 6px', borderRadius: '8px', background: p.googleCalendarSync ? '#dcfce7' : '#fee2e2', color: p.googleCalendarSync ? '#166534' : '#991b1b' }}>{p.googleCalendarSync ? '✅ Sync' : '⚠️ No sync'}</button>
            {user.ruolo === "admin" && (
              <button className="btn-elimina-prev" title="Elimina" style={{ width: 'auto', padding: '6px 9px' }} onClick={() => eliminaPrenotazione(p.id)}>🗑️</button>
            )}
          </div>
        </td>
      </tr>
    );
  };

  // Tabella completa (intestazione + righe) condivisa da Storico e Gestione
  const tabellaPren = (righe, messaggioVuoto) => (
    <div className="admin-table-box-full" style={{ marginTop: '20px', overflowX: 'auto' }}>
      <table className="storico-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem', background: '#fff' }}>
        <thead>
          <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
            <th style={{ padding: '12px' }}>Codice / Data / Stato</th>
            <th style={{ padding: '12px' }}>Nominativo</th>
            <th style={{ padding: '12px' }}>Pacchetto / Location / Operatori</th>
            <th style={{ padding: '12px' }}>Pagato / Totale</th>
            <th style={{ padding: '12px', textAlign: 'center' }}>Azioni</th>
          </tr>
        </thead>
        <tbody>
          {righe.length === 0
            ? <tr><td colSpan="5" style={{ textAlign: 'center', padding: '20px', color: '#666' }}>{messaggioVuoto}</td></tr>
            : righe.map(rigaTabellaPren)}
        </tbody>
      </table>
    </div>
  );

  const esportaExcelPren = () => {
    if (prenotazioniFiltrate.length === 0) return alert("Nessuna prenotazione da esportare.");
    const righe = prenotazioniFiltrate.map(p => {
      const r = {};
      Object.keys(p).forEach(k => {
        const v = p[k];
        if (k === 'operatori') r['operatori'] = (v || []).map(o => o.nome).join(', ');
        else if (k === 'pagamenti') r['pagamenti'] = (v || []).map(pg => `${pg.data}: €${(parseFloat(pg.importo) || 0).toFixed(2)}${pg.nominativo ? ` (${pg.nominativo})` : ''}`).join(' | ');
        else if (v !== null && typeof v === 'object') r[k] = JSON.stringify(v);
        else r[k] = v;
      });
      return r;
    });
    const ws = XLSX.utils.json_to_sheet(righe);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Prenotazioni");
    XLSX.writeFile(wb, "Storico_Prenotazioni.xlsx");
  };

  const prenotazioniFiltrate = prenotazioni.filter(p => {
    const mData = !filtroPrenData || p.data === filtroPrenData;
    const mStato = !filtroPrenStato || p.stato === filtroPrenStato;
    const mNome = (p.nominativo || "").toLowerCase().includes(filtroPrenNome.toLowerCase());
    return mData && mStato && mNome;
  });

  const selezionaPacchettoPren = (id) => {
    const p = pacchetti.find(x => x.id === id);
    setFormPren(prev => ({
      ...prev,
      pacchettoId: id,
      numeroPartecipanti: (p && p.numeroPartecipanti != null) ? p.numeroPartecipanti : prev.numeroPartecipanti,
      campoId: "",
      oraFine: (p && p.durataOre != null && p.durataOre !== "") ? "" : prev.oraFine,
      tipoRinfresco: p?.prevedeRinfresco ? prev.tipoRinfresco : ""
    }));
  };

  const toggleOperatorePren = (id) => {
    setFormPren(prev => ({ ...prev, operatoriIds: prev.operatoriIds.includes(id) ? prev.operatoriIds.filter(x => x !== id) : [...prev.operatoriIds, id] }));
  };

  const aggiungiPagamento = () => {
    if (nuovoPagamento.importo === "" || !nuovoPagamento.data) return alert("Inserisci importo e data del pagamento.");
    setFormPren(prev => ({ ...prev, pagamenti: [...prev.pagamenti, { importo: parseFloat(nuovoPagamento.importo) || 0, data: nuovoPagamento.data, nominativo: nuovoPagamento.nominativo }] }));
    setNuovoPagamento({ importo: "", data: "", nominativo: "" });
  };
  const rimuoviPagamento = (idx) => setFormPren(prev => ({ ...prev, pagamenti: prev.pagamenti.filter((_, i) => i !== idx) }));

  const salvaPrenotazione = async () => {
    const f = formPren;
    const pac = pacchetti.find(p => p.id === f.pacchettoId);
    const durataFissa = pac && pac.durataOre != null && pac.durataOre !== "";
    if (!f.data) return alert("Inserisci la data.");
    if (!pac) return alert("Seleziona un pacchetto.");
    if (!f.nominativo.trim()) return alert("Inserisci il nominativo della prenotazione.");
    if (!f.oraInizio) return alert("Inserisci l'orario di inizio.");
    if (!durataFissa && !f.oraFine) return alert("Per un pacchetto a durata libera inserisci anche l'orario di fine.");
    if (pac.prevedeRinfresco && !f.tipoRinfresco) return alert("Il pacchetto prevede un rinfresco: seleziona merenda o aperitivo.");
    if (pac.prevedeRinfresco && campi.find(c => c.id === f.campoId)?.noRinfresco) return alert("Questo campo non consente pacchetti con rinfresco: cambia campo o pacchetto.");
    if (f.fattTipo === 'privato' && f.fattCF && !validaCF(f.fattCF)) return alert("Codice Fiscale non valido.");

    const IVA = 0.22;
    const durataOre = durataFissa ? parseFloat(pac.durataOre) : durataDaOrari(f.oraInizio, f.oraFine);
    const campo = pac.locationTipo === 'campi' ? campi.find(c => c.id === f.campoId) : null;
    const campoIvaInclCampo = campo ? !!campo.ivaInclusaCampo : false;
    const campoIvaInclRinfresco = campo ? !!campo.ivaInclusaRinfresco : false;
    const sconto = parseFloat(f.sconto) || 0;
    const scontoFrac = 1 - sconto / 100;
    const pacHaPrezzo = pac.prezzo != null && pac.prezzo !== "";
    const prezzoBaseNetto = pacHaPrezzo ? (parseFloat(pac.prezzo) / (1 + IVA)) : (parseFloat(f.prezzoManuale) || 0);
    const prezzoBaseLordo = pacHaPrezzo ? parseFloat(pac.prezzo) : ((parseFloat(f.prezzoManuale) || 0) * (1 + IVA));
    const prezzoVenditaNetto = prezzoBaseNetto * scontoFrac;
    const prezzoVenditaLordo = prezzoBaseLordo * scontoFrac;
    const ivaCampoFrac = campo ? fracIva(campo.ivaCampo) : IVA;
    const ivaRinfrescoFrac = campo ? fracIva(campo.ivaRinfresco) : IVA;
    const costoCampoRaw = campo ? calcolaCostoCampo(campo, f.data, f.oraInizio) : 0;
    const costoCampoLordo = campoIvaInclCampo ? costoCampoRaw : costoCampoRaw * (1 + ivaCampoFrac);
    const costoCampoNetto = campoIvaInclCampo ? costoCampoRaw / (1 + ivaCampoFrac) : costoCampoRaw;
    const numPart = numOrNull(f.numeroPartecipanti);
    let costoRinfrescoRaw = 0;
    if (pac.prevedeRinfresco && f.tipoRinfresco && campo && numPart) {
      const perPersona = f.tipoRinfresco === 'merenda' ? (parseFloat(campo.costoMerenda) || 0) : (parseFloat(campo.costoAperitivo) || 0);
      costoRinfrescoRaw = perPersona * numPart;
    }
    const costoRinfrescoLordo = campoIvaInclRinfresco ? costoRinfrescoRaw : costoRinfrescoRaw * (1 + ivaRinfrescoFrac);
    const costoRinfrescoNetto = campoIvaInclRinfresco ? costoRinfrescoRaw / (1 + ivaRinfrescoFrac) : costoRinfrescoRaw;
    const operatoriSnap = operatori.filter(o => f.operatoriIds.includes(o.id)).map(o => ({ id: o.id, nome: o.nome }));

    const rec = {
      data: f.data, pacchettoId: f.pacchettoId, pacchettoNome: pac.nome || "",
      durataOre, oraInizio: f.oraInizio, oraFine: durataFissa ? null : f.oraFine,
      nominativo: f.nominativo, email: f.email, telefono: f.telefono,
      campoId: campo ? campo.id : null, campoNome: campo ? campo.nome : null, campoPrenotato: f.campoPrenotato,
      locationIndirizzo: campo ? null : f.locationIndirizzo, locationCap: campo ? null : f.locationCap,
      locationCitta: campo ? null : f.locationCitta, locationProvincia: campo ? null : f.locationProvincia,
      operatori: operatoriSnap, sconto,
      costoCampo: costoCampoLordo, costoCampoNetto, costoCampoLordo,
      prezzoVendita: prezzoVenditaLordo, prezzoVenditaNetto, prezzoVenditaLordo,
      tipoRinfresco: pac.prevedeRinfresco ? f.tipoRinfresco : null, numeroPartecipanti: numPart,
      costoRinfresco: costoRinfrescoLordo, costoRinfrescoNetto, costoRinfrescoLordo,
      etaMedia: f.etaMedia, note: f.note,
      preventivoCollegato: f.preventivoCollegato || null, ereditaCosti: !!f.ereditaCosti, costoEreditato: f.ereditaCosti ? (parseFloat(f.costoEreditato) || 0) : null,
      pagamenti: f.pagamenti || [],
      statoPagamento: statoPagamentoDi(f.pagamenti, prezzoVenditaLordo),
      stato: f.stato || "FORSE",
      fattTipo: f.fattTipo,
      fattNome: f.fattNome, fattCognome: f.fattCognome, fattIndirizzo: f.fattIndirizzo, fattCap: f.fattCap, fattCitta: f.fattCitta, fattProvincia: f.fattProvincia, fattCF: (f.fattCF || "").toUpperCase(),
      ragioneSociale: f.ragioneSociale, aziIndirizzo: f.aziIndirizzo, aziCap: f.aziCap, aziCitta: f.aziCitta, aziProvincia: f.aziProvincia, pIva: f.pIva, cfAzienda: f.cfAzienda, sdi: f.sdi
    };

    setSalvataggioPren(true);
    let codice = codicePrenInModifica;
    if (!codice) {
      codice = await generaCodicePren();
      const { error } = await supabase.from('prenotazioni').insert([{ id: codice, ...rec }]);
      if (error) { console.error(error); setSalvataggioPren(false); return alert("Errore durante il salvataggio della prenotazione."); }
    } else {
      // ogni modifica invalida la sincronizzazione con Google Calendar già fatta in precedenza
      const { error } = await supabase.from('prenotazioni').update({ ...rec, googleCalendarSync: false }).eq('id', codice);
      if (error) { console.error(error); setSalvataggioPren(false); return alert("Errore durante l'aggiornamento della prenotazione."); }
    }
    setSalvataggioPren(false);
    setCodicePrenInModifica(codice);
    setFormPrenOriginale(f);
    fetchTutto();
    alert(`Prenotazione ${codice} salvata (stato: FORSE).`);
  };

  const inputStyle = { width: '100%', boxSizing: 'border-box', height: '36px', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px' };
  const btnSalva = { padding: '9px 18px', background: '#0288d1', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' };
  const btnNuovo = { width: 'auto', marginTop: 0, padding: '8px 16px', background: '#10b981' };
  const boxForm = { background: '#f9f9f9', padding: '18px', borderRadius: '8px', border: '1px solid #e0e0e0', marginBottom: '15px' };
  const boxTabella = { background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', maxHeight: 'none', overflowY: 'visible' };
  const headerElenco = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '15px 0' };
  const btnCollassa = { width: 'auto', marginTop: 0, padding: '6px 12px', fontSize: '0.85rem', background: '#e2e8f0', color: '#334155' };
  const btnBarraNuovo = { display: 'flex', justifyContent: 'flex-end', margin: '18px 0 12px 0' };

  // ---------------- PACCHETTI ----------------
  const salvaPacchetto = async (e) => {
    e.preventDefault();
    if (!formPacchetto.nome) return alert("Inserisci il nome del pacchetto");
    const rec = {
      nome: formPacchetto.nome,
      durataOre: numOrNull(formPacchetto.durataOre),
      locationTipo: formPacchetto.locationTipo,
      prezzo: numOrNull(formPacchetto.prezzo),
      centroRicavo: formPacchetto.centroRicavo,
      prevedeRinfresco: formPacchetto.prevedeRinfresco,
      numeroPartecipanti: numOrNull(formPacchetto.numeroPartecipanti)
    };
    let error;
    if (editPacchetto) ({ error } = await supabase.from('pren_pacchetti').update(rec).eq('id', editPacchetto));
    else ({ error } = await supabase.from('pren_pacchetti').insert([{ id: "ppk_" + Date.now(), ...rec }]));
    if (error) { console.error(error); return alert("Errore salvataggio pacchetto"); }
    setFormPacchetto(PACCHETTO_VUOTO); setEditPacchetto(null); setShowFormPacchetto(false); fetchTutto();
  };
  const nuovoPacchetto = () => { setIdPacchettoInline(null); setEditPacchetto(null); setFormPacchetto(PACCHETTO_VUOTO); setShowFormPacchetto(true); };
  const modificaPacchetto = (p) => {
    setEditPacchetto(p.id);
    setFormPacchetto({
      nome: p.nome || "", durataOre: p.durataOre ?? "", locationTipo: p.locationTipo || "libera",
      prezzo: p.prezzo ?? "", centroRicavo: p.centroRicavo || "", prevedeRinfresco: !!p.prevedeRinfresco, numeroPartecipanti: p.numeroPartecipanti ?? ""
    });
    setShowFormPacchetto(true);
  };
  const rimuoviPacchetto = async (id) => { if (window.confirm("Eliminare il pacchetto?")) { await supabase.from('pren_pacchetti').delete().eq('id', id); fetchTutto(); } };
  const iniziaInlinePacchetto = (p) => {
    setShowFormPacchetto(false);
    setIdPacchettoInline(p.id);
    setDatiPacchettoInline({
      nome: p.nome || "", durataOre: p.durataOre ?? "", locationTipo: p.locationTipo || "libera",
      prezzo: p.prezzo ?? "", centroRicavo: p.centroRicavo || "", prevedeRinfresco: !!p.prevedeRinfresco, numeroPartecipanti: p.numeroPartecipanti ?? ""
    });
  };
  const salvaInlinePacchetto = async () => {
    const d = datiPacchettoInline;
    const { error } = await supabase.from('pren_pacchetti').update({
      nome: d.nome, durataOre: numOrNull(d.durataOre), locationTipo: d.locationTipo,
      prezzo: numOrNull(d.prezzo), centroRicavo: d.centroRicavo, prevedeRinfresco: d.prevedeRinfresco, numeroPartecipanti: numOrNull(d.numeroPartecipanti)
    }).eq('id', idPacchettoInline);
    if (error) { console.error(error); return alert("Errore salvataggio pacchetto"); }
    setIdPacchettoInline(null); fetchTutto();
  };

  // ---------------- OPERATORI ----------------
  const salvaOperatore = async (e) => {
    e.preventDefault();
    if (!formOperatore.nome) return alert("Inserisci il nome dell'operatore");
    let error;
    if (editOperatore) ({ error } = await supabase.from('pren_operatori').update(formOperatore).eq('id', editOperatore));
    else ({ error } = await supabase.from('pren_operatori').insert([{ id: "opr_" + Date.now(), ...formOperatore }]));
    if (error) { console.error(error); return alert("Errore salvataggio operatore"); }
    setFormOperatore(OPERATORE_VUOTO); setEditOperatore(null); setShowFormOperatore(false); fetchTutto();
  };
  const nuovoOperatore = () => { setIdOperatoreInline(null); setEditOperatore(null); setFormOperatore(OPERATORE_VUOTO); setShowFormOperatore(true); };
  const modificaOperatore = (o) => { setEditOperatore(o.id); setFormOperatore({ nome: o.nome || "", email: o.email || "", telefono: o.telefono || "" }); setShowFormOperatore(true); };
  const rimuoviOperatore = async (id) => { if (window.confirm("Eliminare l'operatore?")) { await supabase.from('pren_operatori').delete().eq('id', id); fetchTutto(); } };
  const iniziaInlineOperatore = (o) => { setShowFormOperatore(false); setIdOperatoreInline(o.id); setDatiOperatoreInline({ nome: o.nome || "", email: o.email || "", telefono: o.telefono || "" }); };
  const salvaInlineOperatore = async () => {
    const { error } = await supabase.from('pren_operatori').update(datiOperatoreInline).eq('id', idOperatoreInline);
    if (error) { console.error(error); return alert("Errore salvataggio operatore"); }
    setIdOperatoreInline(null); fetchTutto();
  };

  // ---------------- CAMPI ----------------
  const salvaCampo = async (e) => {
    e.preventDefault();
    if (!formCampo.nome) return alert("Inserisci il nome del campo");
    const rec = {
      nome: formCampo.nome, nomeCompleto: formCampo.nomeCompleto, indirizzo: formCampo.indirizzo, cap: formCampo.cap, citta: formCampo.citta, provincia: formCampo.provincia,
      centroCosto: formCampo.centroCosto, costoFlat: numOrNull(formCampo.costoFlat),
      ivaInclusaCampo: formCampo.ivaInclusaCampo, ivaInclusaRinfresco: formCampo.ivaInclusaRinfresco,
      costoMerenda: numOrNull(formCampo.costoMerenda), costoAperitivo: numOrNull(formCampo.costoAperitivo),
      ivaCampo: numOrNull(formCampo.ivaCampo), ivaRinfresco: numOrNull(formCampo.ivaRinfresco),
      noRinfresco: formCampo.noRinfresco
    };
    let error;
    if (editCampo) ({ error } = await supabase.from('pren_campi').update(rec).eq('id', editCampo));
    else ({ error } = await supabase.from('pren_campi').insert([{ id: "cmp_" + Date.now(), ...rec }]));
    if (error) { console.error(error); return alert("Errore salvataggio campo"); }
    setFormCampo(CAMPO_VUOTO); setEditCampo(null); setShowFormCampo(false); fetchTutto();
  };
  const nuovoCampo = () => { setEditCampo(null); setFormCampo(CAMPO_VUOTO); setShowFormCampo(true); };
  const modificaCampo = (c) => {
    setEditCampo(c.id);
    setFormCampo({
      nome: c.nome || "", nomeCompleto: c.nomeCompleto || "", indirizzo: c.indirizzo || "", cap: c.cap || "", citta: c.citta || "", provincia: c.provincia || "",
      centroCosto: c.centroCosto || "", costoFlat: c.costoFlat ?? "",
      ivaInclusaCampo: !!c.ivaInclusaCampo, ivaInclusaRinfresco: !!c.ivaInclusaRinfresco,
      costoMerenda: c.costoMerenda ?? "", costoAperitivo: c.costoAperitivo ?? "",
      ivaCampo: c.ivaCampo ?? "22", ivaRinfresco: c.ivaRinfresco ?? "22",
      noRinfresco: !!c.noRinfresco
    });
    setShowFormCampo(true);
  };
  const rimuoviCampo = async (id) => {
    if (!window.confirm("Eliminare il campo e le sue tariffe?")) return;
    await supabase.from('pren_campi_tariffe').delete().eq('campoId', id);
    await supabase.from('pren_campi').delete().eq('id', id);
    if (editCampo === id) { setEditCampo(null); setFormCampo(CAMPO_VUOTO); setShowFormCampo(false); }
    fetchTutto();
  };

  const addTariffa = async (campoId) => {
    if (nuovaTariffa.giorni.length === 0 || nuovaTariffa.costo === "") return alert("Seleziona i giorni e inserisci il costo");
    const oraInizio = normalizzaOra24(nuovaTariffa.oraInizio);
    const oraFine = normalizzaOra24(nuovaTariffa.oraFine);
    if (oraInizio === null || oraFine === null) return alert("Orario non valido: usa il formato 24h HH:MM (es. 19:00).");
    const rec = { id: "trf_" + Date.now(), campoId, giorni: nuovaTariffa.giorni.join(','), oraInizio, oraFine, costo: parseFloat(nuovaTariffa.costo) || 0 };
    const { error } = await supabase.from('pren_campi_tariffe').insert([rec]);
    if (error) { console.error(error); return alert("Errore salvataggio tariffa"); }
    setNuovaTariffa({ campoId: "", giorni: [], oraInizio: "", oraFine: "", costo: "" });
    fetchTutto();
  };
  const rimuoviTariffa = async (id) => { await supabase.from('pren_campi_tariffe').delete().eq('id', id); fetchTutto(); };
  const toggleGiornoTariffa = (n) => setNuovaTariffa(prev => ({ ...prev, giorni: prev.giorni.includes(n) ? prev.giorni.filter(x => x !== n) : [...prev.giorni, n] }));
  const etichettaGiorni = (str) => (str || "").split(',').filter(Boolean).map(n => GIORNI.find(g => g.n === parseInt(n))?.l || n).join(' ');

  return (
    <>
      <nav className="modulo-subnav no-print">
        {puoVedere(user, 'prenotazioni', 'config') && (
          <button className={`nav-btn ${currentView === 'config' ? 'active' : ''}`} onClick={() => setCurrentView("config")}>⚙️ Configuratore</button>
        )}
        {puoVedere(user, 'prenotazioni', 'nuova') && (
          <button className={`nav-btn ${currentView === 'nuova' ? 'active' : ''}`} onClick={() => setCurrentView("nuova")}>➕ Nuova Prenotazione</button>
        )}
        {puoVedere(user, 'prenotazioni', 'gestione') && (
          <button className={`nav-btn ${currentView === 'gestione' ? 'active' : ''}`} onClick={() => setCurrentView("gestione")}>🔔 Gestione</button>
        )}
        {puoVedere(user, 'prenotazioni', 'calendario') && (
          <button className={`nav-btn ${currentView === 'calendario' ? 'active' : ''}`} onClick={() => setCurrentView("calendario")}>📅 Calendario</button>
        )}
        {puoVedere(user, 'prenotazioni', 'riepiloghi') && (
          <button className={`nav-btn ${currentView === 'riepiloghi' ? 'active' : ''}`} onClick={() => setCurrentView("riepiloghi")}>📋 Riepiloghi</button>
        )}
      </nav>

      {/* ===================== CONFIGURATORE ===================== */}
      {currentView === "config" && puoVedere(user, 'prenotazioni', 'config') && (
        <div className="schermata-admin no-print" style={{ padding: '20px' }}>
          <h2>Configuratore Prenotazioni</h2>

          <div className="modulo-subnav" style={{ marginTop: '15px' }}>
            {puoVedere(user, 'prenotazioni', 'config', 'pacchetti') && (
              <button className={`nav-btn ${configTab === 'pacchetti' ? 'active' : ''}`} onClick={() => setConfigTab("pacchetti")}>📦 Pacchetti</button>
            )}
            {puoVedere(user, 'prenotazioni', 'config', 'operatori') && (
              <button className={`nav-btn ${configTab === 'operatori' ? 'active' : ''}`} onClick={() => setConfigTab("operatori")}>👤 Operatori</button>
            )}
            {puoVedere(user, 'prenotazioni', 'config', 'campi') && (
              <button className={`nav-btn ${configTab === 'campi' ? 'active' : ''}`} onClick={() => setConfigTab("campi")}>📍 Campi</button>
            )}
          </div>

          {/* --- PACCHETTI --- */}
          {configTab === "pacchetti" && puoVedere(user, 'prenotazioni', 'config', 'pacchetti') && (
            <div>
              <div style={headerElenco}>
                <h3 style={{ margin: 0 }}>Pacchetti ({pacchetti.length})</h3>
                <button className="nav-btn" style={btnCollassa} onClick={() => setShowListaPacchetti(v => !v)}>{showListaPacchetti ? '▼ Nascondi elenco' : '▶ Mostra elenco'}</button>
              </div>

              {showListaPacchetti && (
                <div className="admin-table-box" style={boxTabella}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                    <thead><tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                      <th style={{ padding: '10px 12px' }}>Nome</th><th style={{ padding: '10px 12px' }}>Durata</th><th style={{ padding: '10px 12px' }}>Location</th><th style={{ padding: '10px 12px' }}>Prezzo</th><th style={{ padding: '10px 12px' }}>C. Ricavo</th><th style={{ padding: '10px 12px' }}>N° Part.</th><th style={{ padding: '10px 12px' }}>Rinfresco</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Azioni</th>
                    </tr></thead>
                    <tbody>
                      {pacchetti.map(p => idPacchettoInline === p.id ? (
                        <tr key={p.id} style={{ borderBottom: '1px solid #eee', background: '#f0f9ff' }}>
                          <td style={{ padding: '8px' }}><input className="table-input" value={datiPacchettoInline.nome} onChange={(e) => setDatiPacchettoInline({ ...datiPacchettoInline, nome: e.target.value })} style={{ width: '100%', height: '28px', fontSize: '0.8rem' }} /></td>
                          <td style={{ padding: '8px' }}><input className="table-input" type="number" step="any" placeholder="Libera" value={datiPacchettoInline.durataOre} onChange={(e) => setDatiPacchettoInline({ ...datiPacchettoInline, durataOre: e.target.value })} style={{ width: '70px', height: '28px', fontSize: '0.8rem' }} /></td>
                          <td style={{ padding: '8px' }}><select className="table-input" value={datiPacchettoInline.locationTipo} onChange={(e) => setDatiPacchettoInline({ ...datiPacchettoInline, locationTipo: e.target.value })} style={{ height: '30px', fontSize: '0.8rem' }}><option value="libera">Libera</option><option value="campi">Dai campi</option></select></td>
                          <td style={{ padding: '8px' }}><input className="table-input" type="number" step="any" placeholder="Manuale" value={datiPacchettoInline.prezzo} onChange={(e) => setDatiPacchettoInline({ ...datiPacchettoInline, prezzo: e.target.value })} style={{ width: '80px', height: '28px', fontSize: '0.8rem' }} /></td>
                          <td style={{ padding: '8px' }}><input className="table-input" value={datiPacchettoInline.centroRicavo} onChange={(e) => setDatiPacchettoInline({ ...datiPacchettoInline, centroRicavo: e.target.value })} style={{ width: '100%', height: '28px', fontSize: '0.8rem' }} /></td>
                          <td style={{ padding: '8px' }}><input className="table-input" type="number" step="1" value={datiPacchettoInline.numeroPartecipanti} onChange={(e) => setDatiPacchettoInline({ ...datiPacchettoInline, numeroPartecipanti: e.target.value })} style={{ width: '60px', height: '28px', fontSize: '0.8rem' }} /></td>
                          <td style={{ padding: '8px', textAlign: 'center' }}><input type="checkbox" checked={datiPacchettoInline.prevedeRinfresco} onChange={(e) => setDatiPacchettoInline({ ...datiPacchettoInline, prevedeRinfresco: e.target.checked })} /></td>
                          <td style={{ padding: '8px', textAlign: 'center' }}>
                            <div style={{ display: 'flex', gap: '5px', justifyContent: 'center' }}>
                              <button className="btn-salva-inline" style={{ fontSize: '0.8rem', padding: '4px 8px' }} onClick={salvaInlinePacchetto}>Salva</button>
                              <button className="btn-annulla-inline" style={{ fontSize: '0.8rem', padding: '4px 8px' }} onClick={() => setIdPacchettoInline(null)}>Annulla</button>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        <tr key={p.id} style={{ borderBottom: '1px solid #eee' }}>
                          <td style={{ padding: '10px 12px' }}><strong>{p.nome}</strong></td>
                          <td style={{ padding: '10px 12px' }}>{p.durataOre ? `${p.durataOre}h` : 'Libera'}</td>
                          <td style={{ padding: '10px 12px' }}>{p.locationTipo === 'campi' ? 'Dai campi' : 'Libera'}</td>
                          <td style={{ padding: '10px 12px' }}>{p.prezzo != null ? `€${parseFloat(p.prezzo).toFixed(2)} IVA incl.` : 'Manuale (+IVA)'}</td>
                          <td style={{ padding: '10px 12px' }}>{p.centroRicavo || '—'}</td>
                          <td style={{ padding: '10px 12px' }}>{p.numeroPartecipanti || '—'}</td>
                          <td style={{ padding: '10px 12px' }}>{p.prevedeRinfresco ? 'Sì' : 'No'}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                            <div style={{ display: 'flex', gap: '5px', justifyContent: 'center' }}>
                              <button className="btn-modifica-inline" style={{ fontSize: '0.8rem', padding: '4px 8px' }} onClick={() => iniziaInlinePacchetto(p)}>Modifica</button>
                              <button className="btn-rimuovi" style={{ fontSize: '0.8rem', padding: '4px 8px' }} onClick={() => rimuoviPacchetto(p.id)}>Elimina</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {pacchetti.length === 0 && <tr><td colSpan="8" style={{ padding: '20px', textAlign: 'center', color: '#666' }}>Nessun pacchetto.</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}

              <div style={btnBarraNuovo}>
                <button className="btn-preventivo" style={btnNuovo} onClick={nuovoPacchetto}>➕ Nuovo pacchetto</button>
              </div>

              {showFormPacchetto && (
                <div className="admin-form-box" style={boxForm}>
                  <h3 style={{ margin: '0 0 15px 0', fontSize: '1.1rem', color: '#0288d1' }}>{editPacchetto ? 'Modifica Pacchetto' : 'Nuovo Pacchetto'}</h3>
                  <form onSubmit={salvaPacchetto} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <Campo label="Nome pacchetto"><input type="text" value={formPacchetto.nome} onChange={(e) => setFormPacchetto({ ...formPacchetto, nome: e.target.value })} style={inputStyle} /></Campo>
                    <Campo label="Durata ore (vuoto = libera)"><input type="number" step="any" value={formPacchetto.durataOre} onChange={(e) => setFormPacchetto({ ...formPacchetto, durataOre: e.target.value })} style={inputStyle} /></Campo>
                    <Campo label="Location"><select value={formPacchetto.locationTipo} onChange={(e) => setFormPacchetto({ ...formPacchetto, locationTipo: e.target.value })} style={inputStyle}>
                      <option value="libera">Libera (indirizzo manuale)</option>
                      <option value="campi">Dai campi</option>
                    </select></Campo>
                    <Campo label="Prezzo € (vuoto = manuale in prenotazione. Se fissato è IVA inclusa)"><input type="number" step="any" value={formPacchetto.prezzo} onChange={(e) => setFormPacchetto({ ...formPacchetto, prezzo: e.target.value })} style={inputStyle} /></Campo>
                    <Campo label="Centro di ricavo"><input type="text" value={formPacchetto.centroRicavo} onChange={(e) => setFormPacchetto({ ...formPacchetto, centroRicavo: e.target.value })} style={inputStyle} /></Campo>
                    <Campo label="N° partecipanti (se stabilito in anticipo)"><input type="number" step="1" value={formPacchetto.numeroPartecipanti} onChange={(e) => setFormPacchetto({ ...formPacchetto, numeroPartecipanti: e.target.value })} style={inputStyle} /></Campo>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem' }}>
                      <input type="checkbox" checked={formPacchetto.prevedeRinfresco} onChange={(e) => setFormPacchetto({ ...formPacchetto, prevedeRinfresco: e.target.checked })} /> Prevede rinfresco dopo partita
                    </label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button type="submit" style={btnSalva}>{editPacchetto ? 'Salva modifiche' : 'Salva Pacchetto'}</button>
                      <button type="button" className="btn-annulla-inline" onClick={() => { setEditPacchetto(null); setFormPacchetto(PACCHETTO_VUOTO); setShowFormPacchetto(false); }}>Annulla</button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          )}

          {/* --- OPERATORI --- */}
          {configTab === "operatori" && puoVedere(user, 'prenotazioni', 'config', 'operatori') && (
            <div>
              <div style={headerElenco}>
                <h3 style={{ margin: 0 }}>Operatori ({operatori.length})</h3>
                <button className="nav-btn" style={btnCollassa} onClick={() => setShowListaOperatori(v => !v)}>{showListaOperatori ? '▼ Nascondi elenco' : '▶ Mostra elenco'}</button>
              </div>

              {showListaOperatori && (
                <div className="admin-table-box" style={boxTabella}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                    <thead><tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                      <th style={{ padding: '10px 12px' }}>Nome</th><th style={{ padding: '10px 12px' }}>Email</th><th style={{ padding: '10px 12px' }}>Telefono</th><th style={{ padding: '10px 12px', textAlign: 'center' }}>Azioni</th>
                    </tr></thead>
                    <tbody>
                      {operatori.map(o => idOperatoreInline === o.id ? (
                        <tr key={o.id} style={{ borderBottom: '1px solid #eee', background: '#f0f9ff' }}>
                          <td style={{ padding: '8px' }}><input className="table-input" value={datiOperatoreInline.nome} onChange={(e) => setDatiOperatoreInline({ ...datiOperatoreInline, nome: e.target.value })} style={{ width: '100%', height: '28px', fontSize: '0.8rem' }} /></td>
                          <td style={{ padding: '8px' }}><input className="table-input" value={datiOperatoreInline.email} onChange={(e) => setDatiOperatoreInline({ ...datiOperatoreInline, email: e.target.value })} style={{ width: '100%', height: '28px', fontSize: '0.8rem' }} /></td>
                          <td style={{ padding: '8px' }}><input className="table-input" value={datiOperatoreInline.telefono} onChange={(e) => setDatiOperatoreInline({ ...datiOperatoreInline, telefono: e.target.value })} style={{ width: '100%', height: '28px', fontSize: '0.8rem' }} /></td>
                          <td style={{ padding: '8px', textAlign: 'center' }}>
                            <div style={{ display: 'flex', gap: '5px', justifyContent: 'center' }}>
                              <button className="btn-salva-inline" style={{ fontSize: '0.8rem', padding: '4px 8px' }} onClick={salvaInlineOperatore}>Salva</button>
                              <button className="btn-annulla-inline" style={{ fontSize: '0.8rem', padding: '4px 8px' }} onClick={() => setIdOperatoreInline(null)}>Annulla</button>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        <tr key={o.id} style={{ borderBottom: '1px solid #eee' }}>
                          <td style={{ padding: '10px 12px' }}><strong>{o.nome}</strong></td>
                          <td style={{ padding: '10px 12px' }}>{o.email}</td>
                          <td style={{ padding: '10px 12px' }}>{o.telefono}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                            <div style={{ display: 'flex', gap: '5px', justifyContent: 'center' }}>
                              <button className="btn-modifica-inline" style={{ fontSize: '0.8rem', padding: '4px 8px' }} onClick={() => iniziaInlineOperatore(o)}>Modifica</button>
                              <button className="btn-rimuovi" style={{ fontSize: '0.8rem', padding: '4px 8px' }} onClick={() => rimuoviOperatore(o.id)}>Elimina</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {operatori.length === 0 && <tr><td colSpan="4" style={{ padding: '20px', textAlign: 'center', color: '#666' }}>Nessun operatore.</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}

              <div style={btnBarraNuovo}>
                <button className="btn-preventivo" style={btnNuovo} onClick={nuovoOperatore}>➕ Nuovo operatore</button>
              </div>

              {showFormOperatore && (
                <div className="admin-form-box" style={boxForm}>
                  <h3 style={{ margin: '0 0 15px 0', fontSize: '1.1rem', color: '#0288d1' }}>{editOperatore ? 'Modifica Operatore' : 'Nuovo Operatore'}</h3>
                  <form onSubmit={salvaOperatore} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <Campo label="Nome"><input type="text" value={formOperatore.nome} onChange={(e) => setFormOperatore({ ...formOperatore, nome: e.target.value })} style={inputStyle} /></Campo>
                    <Campo label="Email"><input type="email" value={formOperatore.email} onChange={(e) => setFormOperatore({ ...formOperatore, email: e.target.value })} style={inputStyle} /></Campo>
                    <Campo label="Telefono"><input type="text" value={formOperatore.telefono} onChange={(e) => setFormOperatore({ ...formOperatore, telefono: e.target.value })} style={inputStyle} /></Campo>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button type="submit" style={btnSalva}>{editOperatore ? 'Salva modifiche' : 'Salva Operatore'}</button>
                      <button type="button" className="btn-annulla-inline" onClick={() => { setEditOperatore(null); setFormOperatore(OPERATORE_VUOTO); setShowFormOperatore(false); }}>Annulla</button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          )}

          {/* --- CAMPI --- */}
          {configTab === "campi" && puoVedere(user, 'prenotazioni', 'config', 'campi') && (
            <div>
              <div style={headerElenco}>
                <h3 style={{ margin: 0 }}>Campi ({campi.length})</h3>
                <button className="nav-btn" style={btnCollassa} onClick={() => setShowListaCampi(v => !v)}>{showListaCampi ? '▼ Nascondi elenco' : '▶ Mostra elenco'}</button>
              </div>

              {showListaCampi && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                {gruppiCampiPerProvincia.map(([provincia, campiGruppo]) => (
                <div key={provincia}>
                  <h4 style={{ margin: '0 0 10px 0', fontSize: '0.85rem', fontWeight: 'bold', color: '#0288d1', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '2px solid #e0f2fe', paddingBottom: '6px' }}>
                    📌 {provincia} <span style={{ fontWeight: 'normal', color: '#888', textTransform: 'none' }}>({campiGruppo.length})</span>
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                {campiGruppo.map(c => {
                  const tarCampo = tariffe.filter(t => t.campoId === c.id);
                  const inModifica = editCampo === c.id && showFormCampo;
                  const espanso = !!campiEspansi[c.id] || inModifica;
                  return (
                    <div key={c.id} style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', padding: '15px', ...(inModifica ? { boxShadow: '0 0 0 2px #0288d1' } : {}) }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer' }} onClick={() => toggleCampoEspanso(c.id)}>
                          <span style={{ fontSize: '0.7rem', color: '#888', marginTop: '4px' }}>{espanso ? '▼' : '▶'}</span>
                          <div>
                            <strong style={{ fontSize: '1rem' }}>📍 {c.nome}</strong>
                            {c.noRinfresco && <span title="Non è possibile fare rinfresco in questo campo" style={{ marginLeft: '6px', fontSize: '0.7rem', fontWeight: 'bold', padding: '2px 7px', borderRadius: '10px', background: '#fee2e2', color: '#991b1b' }}>🚫 No rinfresco</span>}
                            {c.nomeCompleto && <div style={{ fontSize: '0.82rem', color: '#0288d1', fontStyle: 'italic' }}>{c.nomeCompleto}</div>}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '5px' }}>
                          <button className="btn-modifica-inline" style={{ fontSize: '0.8rem', padding: '4px 8px' }} onClick={() => modificaCampo(c)}>Modifica</button>
                          <button className="btn-rimuovi" style={{ fontSize: '0.8rem', padding: '4px 8px' }} onClick={() => rimuoviCampo(c.id)}>Elimina</button>
                        </div>
                      </div>

                      {espanso && (
                      <>
                      <div style={{ marginTop: '8px' }}>
                        <div style={{ fontSize: '0.85rem', color: '#555' }}>{[c.indirizzo, c.cap, c.citta, c.provincia].filter(Boolean).join(', ')}</div>
                        <div style={{ fontSize: '0.8rem', color: '#777' }}>
                          Centro di costo: {c.centroCosto || '—'} · Base €{parseFloat(c.costoFlat || 0).toFixed(2)}
                          {c.costoMerenda != null && ` · Merenda €${parseFloat(c.costoMerenda).toFixed(2)}/p`}
                          {c.costoAperitivo != null && ` · Aperitivo €${parseFloat(c.costoAperitivo).toFixed(2)}/p`}
                        </div>
                        <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                          <span style={{ display: 'inline-block', fontSize: '0.72rem', fontWeight: 'bold', padding: '2px 8px', borderRadius: '10px', background: c.ivaInclusaCampo ? '#dcfce7' : '#fee2e2', color: c.ivaInclusaCampo ? '#166534' : '#991b1b' }}>Campo: {ivaLabel(c.ivaInclusaCampo)}</span>
                          <span style={{ display: 'inline-block', fontSize: '0.72rem', fontWeight: 'bold', padding: '2px 8px', borderRadius: '10px', background: c.ivaInclusaRinfresco ? '#dcfce7' : '#fee2e2', color: c.ivaInclusaRinfresco ? '#166534' : '#991b1b' }}>Rinfresco: {ivaLabel(c.ivaInclusaRinfresco)}</span>
                        </div>
                      </div>

                      {tarCampo.length > 0 && (
                        <div style={{ marginTop: '12px', borderTop: '1px dashed #ddd', paddingTop: '12px' }}>
                          <div style={{ fontSize: '0.82rem', fontWeight: 'bold', color: '#555', marginBottom: '6px' }}>Tariffe variabili (sovrascrivono la flat)</div>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                            <thead><tr style={{ color: '#666' }}><th style={{ textAlign: 'left', padding: '4px' }}>Giorni</th><th style={{ textAlign: 'left', padding: '4px' }}>Fascia</th><th style={{ textAlign: 'left', padding: '4px' }}>Costo</th><th style={{ textAlign: 'right', padding: '4px' }}>Azioni</th></tr></thead>
                            <tbody>
                              {tarCampo.map(t => (
                                <tr key={t.id}>
                                  <td style={{ padding: '4px' }}>{etichettaGiorni(t.giorni)}</td>
                                  <td style={{ padding: '4px' }}>{t.oraInizio || '—'} - {t.oraFine || '—'}</td>
                                  <td style={{ padding: '4px' }}>€{parseFloat(t.costo).toFixed(2)}</td>
                                  <td style={{ padding: '4px', textAlign: 'right' }}>{inModifica && <button className="btn-rimuovi" style={{ fontSize: '0.72rem', padding: '3px 8px' }} onClick={() => rimuoviTariffa(t.id)}>🗑 Elimina</button>}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {inModifica && (
                        <div style={{ marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', background: '#f8fafc', padding: '10px', borderRadius: '6px' }}>
                          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                            {GIORNI.map(g => (
                              <label key={g.n} style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '3px', cursor: 'pointer' }}>
                                <input type="checkbox" checked={nuovaTariffa.campoId === c.id && nuovaTariffa.giorni.includes(g.n)} onChange={() => { if (nuovaTariffa.campoId !== c.id) setNuovaTariffa({ campoId: c.id, giorni: [g.n], oraInizio: "", oraFine: "", costo: "" }); else toggleGiornoTariffa(g.n); }} />
                                {g.l}
                              </label>
                            ))}
                          </div>
                          <input type="text" inputMode="numeric" placeholder="HH:MM" maxLength={5} title="Formato 24h, es. 19:00" value={nuovaTariffa.campoId === c.id ? nuovaTariffa.oraInizio : ""} onChange={(e) => setNuovaTariffa(prev => ({ ...prev, campoId: c.id, oraInizio: formattaOraInput(e.target.value) }))} style={{ ...inputStyle, width: '80px', height: '32px' }} />
                          <input type="text" inputMode="numeric" placeholder="HH:MM" maxLength={5} title="Formato 24h, es. 00:00" value={nuovaTariffa.campoId === c.id ? nuovaTariffa.oraFine : ""} onChange={(e) => setNuovaTariffa(prev => ({ ...prev, campoId: c.id, oraFine: formattaOraInput(e.target.value) }))} style={{ ...inputStyle, width: '80px', height: '32px' }} />
                          <input type="number" step="any" placeholder="€" value={nuovaTariffa.campoId === c.id ? nuovaTariffa.costo : ""} onChange={(e) => setNuovaTariffa(prev => ({ ...prev, campoId: c.id, costo: e.target.value }))} style={{ ...inputStyle, width: '80px', height: '32px' }} />
                          <button type="button" className="btn-conferma" style={{ padding: '6px 12px' }} onClick={() => addTariffa(c.id)}>+ Tariffa</button>
                        </div>
                      )}
                      </>
                      )}
                    </div>
                  );
                })}
                  </div>
                </div>
                ))}
                {campi.length === 0 && <p style={{ color: '#666' }}>Nessun campo configurato.</p>}
              </div>
              )}

              <div style={btnBarraNuovo}>
                <button className="btn-preventivo" style={btnNuovo} onClick={nuovoCampo}>➕ Nuovo campo</button>
              </div>

              {showFormCampo && (
                <div className="admin-form-box" style={boxForm}>
                  <h3 style={{ margin: '0 0 15px 0', fontSize: '1.1rem', color: '#0288d1' }}>{editCampo ? 'Modifica Campo' : 'Nuovo Campo'}</h3>
                  <form onSubmit={salvaCampo} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <Campo label="Nome campo"><input type="text" value={formCampo.nome} onChange={(e) => setFormCampo({ ...formCampo, nome: e.target.value })} style={inputStyle} /></Campo>
                    <Campo label="Nome completo campo (usato nelle comunicazioni al cliente)"><input type="text" value={formCampo.nomeCompleto} onChange={(e) => setFormCampo({ ...formCampo, nomeCompleto: e.target.value })} style={inputStyle} placeholder="Es. Padel Arena Quintosole" /></Campo>
                    <Campo label="Cerca indirizzo"><RicercaIndirizzo onSelect={(a) => setFormCampo(prev => ({ ...prev, indirizzo: a.indirizzo, cap: a.cap, citta: a.citta, provincia: a.provincia }))} /></Campo>
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 0.8fr', gap: '8px' }}>
                      <Campo label="Indirizzo"><input type="text" value={formCampo.indirizzo} onChange={(e) => setFormCampo({ ...formCampo, indirizzo: e.target.value })} style={inputStyle} /></Campo>
                      <Campo label="CAP"><input type="text" value={formCampo.cap} onChange={(e) => setFormCampo({ ...formCampo, cap: e.target.value })} style={inputStyle} /></Campo>
                      <Campo label="Città"><input type="text" value={formCampo.citta} onChange={(e) => setFormCampo({ ...formCampo, citta: e.target.value })} style={inputStyle} /></Campo>
                      <Campo label="Prov"><input type="text" value={formCampo.provincia} onChange={(e) => setFormCampo({ ...formCampo, provincia: e.target.value })} style={inputStyle} /></Campo>
                    </div>
                    <Campo label="Centro di costo"><input type="text" value={formCampo.centroCosto} onChange={(e) => setFormCampo({ ...formCampo, centroCosto: e.target.value })} style={inputStyle} /></Campo>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                      <Campo label="Costo base flat €"><input type="number" step="any" value={formCampo.costoFlat} onChange={(e) => setFormCampo({ ...formCampo, costoFlat: e.target.value })} style={inputStyle} /></Campo>
                      <Campo label="Costo merenda €/pers"><input type="number" step="any" value={formCampo.costoMerenda} onChange={(e) => setFormCampo({ ...formCampo, costoMerenda: e.target.value })} style={inputStyle} /></Campo>
                      <Campo label="Costo aperitivo €/pers"><input type="number" step="any" value={formCampo.costoAperitivo} onChange={(e) => setFormCampo({ ...formCampo, costoAperitivo: e.target.value })} style={inputStyle} /></Campo>
                    </div>
                    <div style={{ display: 'flex', gap: '20px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem' }}>
                        <input type="checkbox" checked={formCampo.ivaInclusaCampo} onChange={(e) => setFormCampo({ ...formCampo, ivaInclusaCampo: e.target.checked })} /> Costo campo IVA inclusa
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem' }}>
                        <input type="checkbox" checked={formCampo.ivaInclusaRinfresco} onChange={(e) => setFormCampo({ ...formCampo, ivaInclusaRinfresco: e.target.checked })} /> Costo rinfresco IVA inclusa
                      </label>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                      <Campo label="% IVA affitto campo"><input type="number" step="any" value={formCampo.ivaCampo} onChange={(e) => setFormCampo({ ...formCampo, ivaCampo: e.target.value })} style={inputStyle} /></Campo>
                      <Campo label="% IVA rinfreschi"><input type="number" step="any" value={formCampo.ivaRinfresco} onChange={(e) => setFormCampo({ ...formCampo, ivaRinfresco: e.target.value })} style={inputStyle} /></Campo>
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem' }}>
                      <input type="checkbox" checked={formCampo.noRinfresco} onChange={(e) => setFormCampo({ ...formCampo, noRinfresco: e.target.checked })} /> 🚫 Non è possibile fare rinfresco in questo campo
                    </label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button type="submit" style={btnSalva}>{editCampo ? 'Salva modifiche' : 'Salva Campo'}</button>
                      <button type="button" className="btn-annulla-inline" onClick={() => { setEditCampo(null); setFormCampo(CAMPO_VUOTO); setShowFormCampo(false); }}>Annulla</button>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.8rem', color: '#666' }}>Il costo base (flat) vale sempre; le tariffe variabili (nella scheda del campo) lo sovrascrivono in certi giorni/orari.</p>
                  </form>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ===================== PLACEHOLDER ALTRE SCHEDE ===================== */}
      {currentView === "nuova" && puoVedere(user, 'prenotazioni', 'nuova') && (() => {
        const IVA = 0.22;
        const pac = pacchetti.find(p => p.id === formPren.pacchettoId);
        const durataFissa = pac && pac.durataOre != null && pac.durataOre !== "";
        const locationDaCampi = pac?.locationTipo === 'campi';
        const campoSel = locationDaCampi ? campi.find(c => c.id === formPren.campoId) : null;
        const durataOre = durataFissa ? parseFloat(pac.durataOre) : durataDaOrari(formPren.oraInizio, formPren.oraFine);
        const sconto = parseFloat(formPren.sconto) || 0;
        const scontoFrac = 1 - sconto / 100;
        const pacHaPrezzo = pac && pac.prezzo != null && pac.prezzo !== "";
        // Prezzo di vendita: se dal pacchetto è IVA inclusa (lordo); se manuale è IVA esclusa (netto) -> aggiunge IVA
        const prezzoBaseLordo = pacHaPrezzo ? parseFloat(pac.prezzo) : ((parseFloat(formPren.prezzoManuale) || 0) * (1 + IVA));
        const prezzoLordo = prezzoBaseLordo * scontoFrac;
        const prezzoVendita = prezzoLordo; // il cliente paga il lordo
        // Costo rinfresco (i valori sono lordi o netti a seconda del flag ivaInclusaRinfresco del campo)
        const campoIvaInclRinfresco = campoSel ? !!campoSel.ivaInclusaRinfresco : false;
        // Rinfresco
        const numPart = numOrNull(formPren.numeroPartecipanti);
        const perPersonaRinf = campoSel ? (formPren.tipoRinfresco === 'merenda' ? (parseFloat(campoSel.costoMerenda) || 0) : formPren.tipoRinfresco === 'aperitivo' ? (parseFloat(campoSel.costoAperitivo) || 0) : 0) : 0;
        const costoRinfrescoRaw = (pac?.prevedeRinfresco && formPren.tipoRinfresco && numPart) ? perPersonaRinf * numPart : 0;
        const ivaRinfrescoFrac = campoSel ? fracIva(campoSel.ivaRinfresco) : IVA;
        const costoRinfrescoLordo = campoIvaInclRinfresco ? costoRinfrescoRaw : costoRinfrescoRaw * (1 + ivaRinfrescoFrac);
        const errCF = formPren.fattTipo === 'privato' && formPren.fattCF && !validaCF(formPren.fattCF);
        const emailNonValida = formPren.email && !validaEmail(formPren.email);
        const totalePagato = (formPren.pagamenti || []).reduce((s, p) => s + (parseFloat(p.importo) || 0), 0);
        const statoPag = statoPagamentoDi(formPren.pagamenti, prezzoVendita);
        const setF = (patch) => setFormPren(prev => ({ ...prev, ...patch }));
        const costoEreditatoNum = formPren.ereditaCosti ? (parseFloat(formPren.costoEreditato) || 0) : 0;
        const preventivoSelezionato = preventivi.find(pv => String(pv.codice) === String(formPren.preventivoCollegato));

        // Evidenzia i campi cambiati rispetto ai valori caricati inizialmente (solo in modifica)
        const campoModificato = (chiave) => formPrenOriginale != null && JSON.stringify(formPren[chiave]) !== JSON.stringify(formPrenOriginale[chiave]);
        const evidenzia = (chiave) => campoModificato(chiave) ? { borderColor: '#f59e0b', borderWidth: '2px', backgroundColor: '#fffbeb' } : undefined;
        const formModificato = formPrenOriginale != null && JSON.stringify(formPren) !== JSON.stringify(formPrenOriginale);

        // Copia vendita/costo del preventivo selezionato nei campi del form (restano poi modificabili a mano)
        const applicaEreditaCosti = (pv) => {
          if (!pv) return;
          setF({ prezzoManuale: String(pv.totaleVendita ?? "0"), sconto: "0", costoEreditato: String(pv.costoVivoTotale ?? "0") });
        };
        const onCambiaPreventivoCollegato = (codice) => {
          setF({ preventivoCollegato: codice });
          if (formPren.ereditaCosti) applicaEreditaCosti(preventivi.find(pv => String(pv.codice) === String(codice)));
        };
        const onToggleEredita = (checked) => {
          setF({ ereditaCosti: checked });
          if (checked) applicaEreditaCosti(preventivoSelezionato);
        };

        return (
        <div className="schermata-inserimento no-print form-pren" style={(codicePrenInModifica && formModificato) ? { paddingBottom: '60px' } : undefined}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <h2 style={{ margin: 0 }}>{codicePrenInModifica ? `Modifica Prenotazione ${codicePrenInModifica}` : "Nuova Prenotazione"}</h2>
            <button className="btn-chiudi" style={{ float: 'none' }} onClick={nuovaPrenotazione}>🆕 Nuova</button>
          </div>

          {pacchetti.length === 0 && <p className="descrizione-pagina" style={{ color: '#c62828' }}>⚠️ Nessun pacchetto configurato. Vai nel Configuratore.</p>}

          {/* 1. Data, pacchetto, orari */}
          <div className="sezione">
            <h2>Evento</h2>
            <div className="date-grid" style={{ flexWrap: 'wrap' }}>
              <label style={{ flex: '1 1 160px', display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.85rem' }}>Data
                <input type="date" value={formPren.data} onChange={(e) => setF({ data: e.target.value })} style={evidenzia('data')} />
              </label>
              <label style={{ flex: '2 1 220px', display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.85rem' }}>Pacchetto
                <select className="dropdown-gonfiabili" value={formPren.pacchettoId} onChange={(e) => selezionaPacchettoPren(e.target.value)} style={evidenzia('pacchettoId')}>
                  <option value="">-- Seleziona pacchetto --</option>
                  {pacchetti.map(p => <option key={p.id} value={p.id}>{p.nome}{p.durataOre ? ` (${p.durataOre}h)` : ' (durata libera)'}</option>)}
                </select>
              </label>
            </div>
            <div className="date-grid" style={{ flexWrap: 'wrap', marginTop: '12px' }}>
              <label style={{ display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.82rem' }}>Ora inizio
                <input type="text" inputMode="numeric" placeholder="HH:MM" maxLength={5} value={formPren.oraInizio} onChange={(e) => setF({ oraInizio: formattaOraInput(e.target.value) })} style={evidenzia('oraInizio')} />
              </label>
              {!durataFissa && (
                <label style={{ display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.82rem' }}>Ora fine
                  <input type="text" inputMode="numeric" placeholder="HH:MM" maxLength={5} value={formPren.oraFine} onChange={(e) => setF({ oraFine: formattaOraInput(e.target.value) })} style={evidenzia('oraFine')} />
                </label>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.82rem', color: '#555' }}>Durata
                <div className="valore">{durataOre != null ? `${durataOre} h` : '—'} {durataFissa && <span style={{ fontSize: '0.72rem', color: '#0288d1' }}>(fissa)</span>}</div>
              </div>
            </div>
          </div>

          {/* 2. Contatti */}
          <div className="sezione">
            <h2>Contatti prenotazione</h2>
            <div className="date-grid" style={{ flexWrap: 'wrap' }}>
              <label style={{ flex: '2 1 200px', display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.85rem' }}>Nominativo *
                <input type="text" value={formPren.nominativo} onChange={(e) => setF({ nominativo: e.target.value })} style={evidenzia('nominativo')} />
              </label>
              <label className="span2" style={{ display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.82rem' }}>Email
                <input type="email" value={formPren.email} onChange={(e) => setF({ email: e.target.value })} style={emailNonValida ? { borderColor: '#ef4444', backgroundColor: '#fef2f2' } : evidenzia('email')} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.82rem' }}>Telefono
                <input type="text" value={formPren.telefono} onChange={(e) => setF({ telefono: e.target.value })} style={evidenzia('telefono')} />
              </label>
            </div>
            {emailNonValida && <p style={{ margin: '6px 0 0 0', fontSize: '0.8rem', color: '#c62828' }}>⚠️ Indirizzo email non valido.</p>}
            <div className="date-grid" style={{ flexWrap: 'wrap', marginTop: '12px' }}>
              <label style={{ flex: '1 1 160px', display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.85rem' }}>Età media partecipanti
                <input type="text" value={formPren.etaMedia} onChange={(e) => setF({ etaMedia: e.target.value })} style={evidenzia('etaMedia')} />
              </label>
            </div>
            <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginTop: '12px' }}>Note
              <textarea value={formPren.note} onChange={(e) => setF({ note: e.target.value })} rows="2" style={{ width: '100%', padding: '10px', border: '1px solid #cbd5e1', borderRadius: '6px', marginTop: '5px', fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical', ...evidenzia('note') }} />
            </label>
          </div>

          {/* 3. Location */}
          <div className="sezione">
            <h2>Location</h2>
            {locationDaCampi ? (
              <>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: '10px' }}>Campo
                  <select className="dropdown-gonfiabili" value={formPren.campoId} onChange={(e) => setF({ campoId: e.target.value })} style={evidenzia('campoId')}>
                    <option value="">-- Seleziona campo --</option>
                    {campi.map(c => <option key={c.id} value={c.id}>{c.nome}{c.citta ? ` — ${c.citta}` : ''}{pac?.prevedeRinfresco && c.noRinfresco ? ' 🚫 no rinfresco' : ''}</option>)}
                  </select>
                </label>

                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', fontWeight: 600, marginBottom: '12px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={formPren.campoPrenotato} onChange={(e) => setF({ campoPrenotato: e.target.checked })} /> 🔒 Campo prenotato
                </label>

                {campoSel && pac?.prevedeRinfresco && campoSel.noRinfresco && (
                  <p style={{ color: '#c62828', fontWeight: 'bold' }}>🚫 Questo campo non consente pacchetti con rinfresco: scegli un altro campo o un pacchetto senza rinfresco.</p>
                )}

                {campoSel && pac?.prevedeRinfresco && !campoSel.noRinfresco && (
                  <div className="pren-row" style={{ marginBottom: '12px' }}>
                    <label style={{ display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.82rem' }}>Rinfresco *
                      <select value={formPren.tipoRinfresco} onChange={(e) => setF({ tipoRinfresco: e.target.value })} style={!formPren.tipoRinfresco ? { borderColor: '#ef4444', backgroundColor: '#fef2f2' } : evidenzia('tipoRinfresco')}>
                        <option value="">-- Seleziona --</option>
                        <option value="merenda">Merenda</option>
                        <option value="aperitivo">Aperitivo</option>
                      </select>
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.82rem' }}>N° partecipanti
                      <input type="number" value={formPren.numeroPartecipanti} readOnly style={{ background: '#f1f5f9', color: '#475569' }} title="Impostato dal pacchetto" />
                    </label>
                    {formPren.tipoRinfresco && campoSel && numPart ? <div style={{ alignSelf: 'end', padding: '10px 0', fontSize: '0.82rem', color: '#777' }}>€{perPersonaRinf.toFixed(2)}/pers × {numPart}</div> : null}
                  </div>
                )}

                {campoSel && pac?.prevedeRinfresco && !campoSel.noRinfresco && formPren.tipoRinfresco && costoRinfrescoLordo === 0 && (
                  <p style={{ color: '#c62828' }}>🍽️ Rinfresco {formPren.tipoRinfresco}: costo 0 — {!numPart ? "n° partecipanti mancante nel pacchetto" : `il campo non ha il costo ${formPren.tipoRinfresco} configurato`}.</p>
                )}
              </>
            ) : (
              <>
                <RicercaIndirizzo onSelect={(a) => setF({ locationIndirizzo: a.indirizzo, locationCap: a.cap, locationCitta: a.citta, locationProvincia: a.provincia })} />
                <div className="date-grid" style={{ flexWrap: 'wrap', marginTop: '10px' }}>
                  <label style={{ flex: '2 1 220px', display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.85rem' }}>Indirizzo<input type="text" value={formPren.locationIndirizzo} onChange={(e) => setF({ locationIndirizzo: e.target.value })} style={evidenzia('locationIndirizzo')} /></label>
                  <label style={{ flex: '1 1 90px', display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.85rem' }}>CAP<input type="text" value={formPren.locationCap} onChange={(e) => setF({ locationCap: e.target.value })} style={evidenzia('locationCap')} /></label>
                  <label style={{ flex: '1 1 140px', display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.85rem' }}>Città<input type="text" value={formPren.locationCitta} onChange={(e) => setF({ locationCitta: e.target.value })} style={evidenzia('locationCitta')} /></label>
                  <label style={{ flex: '1 1 80px', display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.85rem' }}>Prov<input type="text" value={formPren.locationProvincia} onChange={(e) => setF({ locationProvincia: e.target.value })} style={evidenzia('locationProvincia')} /></label>
                </div>
              </>
            )}
          </div>

          {/* 4. Operatori */}
          <div className="sezione">
            <h2>Operatori</h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {operatori.map(o => {
                const sel = formPren.operatoriIds.includes(o.id);
                return (
                  <label key={o.id} className={`chip-operatore ${sel ? 'sel' : ''}`}>
                    <input type="checkbox" checked={sel} onChange={() => toggleOperatorePren(o.id)} /> {o.nome}
                  </label>
                );
              })}
              {operatori.length === 0 && <span style={{ color: '#999', fontSize: '0.85rem' }}>Nessun operatore configurato.</span>}
            </div>
          </div>

          {/* 6. Prezzo */}
          <div className="sezione">
            <h2>Prezzo di vendita</h2>
            {!pacHaPrezzo && (
              <>
                <div className="date-grid" style={{ flexWrap: 'wrap', marginBottom: '12px' }}>
                  <label style={{ flex: '2 1 240px', display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.85rem' }}>Preventivo collegato
                    <select className="dropdown-gonfiabili" value={formPren.preventivoCollegato} onChange={(e) => onCambiaPreventivoCollegato(e.target.value)} style={evidenzia('preventivoCollegato')}>
                      <option value="">-- Nessuno --</option>
                      {preventivi.map(pv => <option key={pv.codice} value={pv.codice}>{pv.codice} — {pv.destinazione || pv.nomeReferente || ''} (€{(parseFloat(pv.totaleVendita) || 0).toFixed(2)})</option>)}
                    </select>
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', fontWeight: 600, alignSelf: 'end', padding: '10px 0', cursor: preventivoSelezionato ? 'pointer' : 'not-allowed', opacity: preventivoSelezionato ? 1 : 0.5 }}>
                    <input type="checkbox" checked={formPren.ereditaCosti} disabled={!preventivoSelezionato} onChange={(e) => onToggleEredita(e.target.checked)} /> Eredita costi e vendita dal preventivo
                  </label>
                </div>
                {formPren.ereditaCosti && !locationDaCampi && (
                  <p style={{ fontSize: '0.82rem', color: '#666', marginTop: 0 }}>📄 Costo ereditato dal preventivo (senza IVA): <strong>€{costoEreditatoNum.toFixed(2)}</strong></p>
                )}
              </>
            )}
            <div className="date-grid" style={{ flexWrap: 'wrap' }}>
              {(pac && pac.prezzo != null && pac.prezzo !== "") ? (
                <div style={{ flex: '1 1 160px', fontSize: '0.9rem', alignSelf: 'end', padding: '10px 0' }}>Prezzo pacchetto: <strong>€{parseFloat(pac.prezzo).toFixed(2)}</strong> <span style={{ fontSize: '0.75rem', color: '#666' }}>(IVA incl.)</span></div>
              ) : (
                <label style={{ flex: '1 1 160px', display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.85rem' }}>Prezzo di vendita € (IVA escl.)
                  <input type="number" step="any" value={formPren.prezzoManuale} onChange={(e) => setF({ prezzoManuale: e.target.value })} style={evidenzia('prezzoManuale')} />
                </label>
              )}
              <label style={{ flex: '1 1 120px', display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.85rem' }}>Sconto (%)
                <input type="number" min="0" max="100" value={formPren.sconto} onChange={(e) => setF({ sconto: e.target.value })} style={evidenzia('sconto')} />
              </label>
              <div style={{ flex: '1 1 220px', alignSelf: 'end', padding: '10px 0' }}>
                Prezzo finale: <strong style={{ color: '#10b981', fontSize: '1.2rem' }}>€{prezzoLordo.toFixed(2)}</strong> <span style={{ fontSize: '0.75rem', color: '#666' }}>(IVA incl.)</span>
              </div>
            </div>
          </div>

          {/* 6b. Pagamenti */}
          <div className="sezione">
            <h2>Stato pagamento: <span style={{ fontSize: '0.8rem', fontWeight: 'bold', padding: '3px 10px', borderRadius: '10px', background: statoPag === 'saldato' ? '#dcfce7' : statoPag === 'acconto' ? '#fef9c3' : '#fee2e2', color: statoPag === 'saldato' ? '#166534' : statoPag === 'acconto' ? '#854d0e' : '#991b1b' }}>{statoPag}</span></h2>
            {formPren.pagamenti.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', marginBottom: '10px' }}>
                <thead><tr style={{ color: '#666', textAlign: 'left' }}><th style={{ padding: '4px' }}>Data</th><th style={{ padding: '4px' }}>Importo</th><th style={{ padding: '4px' }}>Da</th><th></th></tr></thead>
                <tbody>
                  {formPren.pagamenti.map((pg, i) => (
                    <tr key={i}>
                      <td style={{ padding: '4px' }}>{pg.data}</td>
                      <td style={{ padding: '4px' }}>€{(parseFloat(pg.importo) || 0).toFixed(2)}</td>
                      <td style={{ padding: '4px' }}>{pg.nominativo || '—'}</td>
                      <td style={{ padding: '4px', textAlign: 'right' }}><button className="btn-rimuovi" style={{ fontSize: '0.72rem', padding: '3px 8px' }} onClick={() => rimuoviPagamento(i)}>🗑</button></td>
                    </tr>
                  ))}
                  <tr><td colSpan="2" style={{ padding: '4px', fontWeight: 'bold' }}>Totale versato: €{totalePagato.toFixed(2)}</td><td colSpan="2" style={{ padding: '4px', color: '#777' }}>su €{prezzoVendita.toFixed(2)}</td></tr>
                </tbody>
              </table>
            )}
            {statoPag !== 'saldato' && (
              <>
                <div className="pren-row" style={{ marginBottom: '8px' }}>
                  <label style={{ display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.82rem', flex: '1 1 100%' }}>Usa un voucher emesso (facoltativo)
                    <select value="" onChange={(e) => {
                      const v = voucher.find(x => String(x.codice) === e.target.value);
                      if (v) setNuovoPagamento(prev => ({ ...prev, importo: String(v.importo ?? ''), nominativo: prev.nominativo || v.nominativo || '' }));
                    }}>
                      <option value="">-- Seleziona voucher --</option>
                      {voucher.filter(v => v.stato !== 'usato').map(v => <option key={v.codice} value={v.codice}>{v.codice} — {v.nominativo} (€{(parseFloat(v.importo) || 0).toFixed(2)})</option>)}
                    </select>
                  </label>
                </div>
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
                    <button type="button" className="btn-conferma" style={{ padding: '8px 14px' }} onClick={aggiungiPagamento}>+ Pagamento</button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* 8. Fatturazione */}
          <div className="sezione">
            <h2>Dati di fatturazione <span style={{ fontSize: '0.75rem', fontWeight: 'normal', color: '#777' }}>(facoltativi, inseribili in un secondo momento)</span></h2>
            <div style={{ display: 'flex', gap: '18px', marginBottom: '12px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '0.9rem' }}><input type="radio" name="fattTipo" checked={formPren.fattTipo === 'privato'} onChange={() => setF({ fattTipo: 'privato' })} /> Privato</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '0.9rem' }}><input type="radio" name="fattTipo" checked={formPren.fattTipo === 'azienda'} onChange={() => setF({ fattTipo: 'azienda' })} /> Azienda</label>
            </div>

            {formPren.fattTipo === 'privato' ? (
              <>
                <div className="date-grid" style={{ flexWrap: 'wrap' }}>
                  <label style={{ flex: '1 1 180px', display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.85rem' }}>Nome<input type="text" value={formPren.fattNome} onChange={(e) => setF({ fattNome: e.target.value })} style={evidenzia('fattNome')} /></label>
                  <label style={{ flex: '1 1 180px', display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.85rem' }}>Cognome<input type="text" value={formPren.fattCognome} onChange={(e) => setF({ fattCognome: e.target.value })} style={evidenzia('fattCognome')} /></label>
                </div>
                <div style={{ margin: '12px 0' }}>
                  <RicercaIndirizzo onSelect={(a) => setF({ fattIndirizzo: a.indirizzo, fattCap: a.cap, fattCitta: a.citta, fattProvincia: a.provincia })} />
                </div>
                <div className="date-grid" style={{ flexWrap: 'wrap' }}>
                  <label style={{ flex: '2 1 220px', display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.85rem' }}>Indirizzo<input type="text" value={formPren.fattIndirizzo} onChange={(e) => setF({ fattIndirizzo: e.target.value })} style={evidenzia('fattIndirizzo')} /></label>
                  <label style={{ flex: '1 1 90px', display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.85rem' }}>CAP<input type="text" value={formPren.fattCap} onChange={(e) => setF({ fattCap: e.target.value })} style={evidenzia('fattCap')} /></label>
                  <label style={{ flex: '1 1 140px', display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.85rem' }}>Città<input type="text" value={formPren.fattCitta} onChange={(e) => setF({ fattCitta: e.target.value })} style={evidenzia('fattCitta')} /></label>
                  <label style={{ flex: '1 1 80px', display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.85rem' }}>Prov<input type="text" value={formPren.fattProvincia} onChange={(e) => setF({ fattProvincia: e.target.value })} style={evidenzia('fattProvincia')} /></label>
                </div>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginTop: '12px' }}>Codice Fiscale
                  <input type="text" maxLength={16} value={formPren.fattCF} onChange={(e) => setF({ fattCF: e.target.value.toUpperCase() })} style={errCF ? { borderColor: '#ef4444', backgroundColor: '#fef2f2' } : evidenzia('fattCF')} />
                </label>
                {errCF && <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: '#c62828' }}>⚠️ Codice Fiscale non valido.</p>}
              </>
            ) : (
              <>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem' }}>Ragione sociale<input type="text" value={formPren.ragioneSociale} onChange={(e) => setF({ ragioneSociale: e.target.value })} style={evidenzia('ragioneSociale')} /></label>
                <div style={{ margin: '12px 0' }}>
                  <RicercaIndirizzo onSelect={(a) => setF({ aziIndirizzo: a.indirizzo, aziCap: a.cap, aziCitta: a.citta, aziProvincia: a.provincia })} />
                </div>
                <div className="date-grid" style={{ flexWrap: 'wrap' }}>
                  <label style={{ flex: '2 1 220px', display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.85rem' }}>Indirizzo<input type="text" value={formPren.aziIndirizzo} onChange={(e) => setF({ aziIndirizzo: e.target.value })} style={evidenzia('aziIndirizzo')} /></label>
                  <label style={{ flex: '1 1 90px', display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.85rem' }}>CAP<input type="text" value={formPren.aziCap} onChange={(e) => setF({ aziCap: e.target.value })} style={evidenzia('aziCap')} /></label>
                  <label style={{ flex: '1 1 140px', display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.85rem' }}>Città<input type="text" value={formPren.aziCitta} onChange={(e) => setF({ aziCitta: e.target.value })} style={evidenzia('aziCitta')} /></label>
                  <label style={{ flex: '1 1 80px', display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.85rem' }}>Prov<input type="text" value={formPren.aziProvincia} onChange={(e) => setF({ aziProvincia: e.target.value })} style={evidenzia('aziProvincia')} /></label>
                </div>
                <div className="date-grid" style={{ marginTop: '12px' }}>
                  <label style={{ display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.82rem' }}>Partita IVA<input type="text" value={formPren.pIva} onChange={(e) => setF({ pIva: e.target.value })} style={evidenzia('pIva')} /></label>
                  <label style={{ display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.82rem' }}>Codice Fiscale<input type="text" value={formPren.cfAzienda} onChange={(e) => setF({ cfAzienda: e.target.value })} style={evidenzia('cfAzienda')} /></label>
                  <label style={{ display: 'flex', flexDirection: 'column', fontWeight: 600, fontSize: '0.82rem' }}>Codice SDI<input type="text" value={formPren.sdi} onChange={(e) => setF({ sdi: e.target.value })} style={evidenzia('sdi')} /></label>
                </div>
              </>
            )}
          </div>

          <button className="btn-preventivo" onClick={salvaPrenotazione} disabled={salvataggioPren}>{salvataggioPren ? 'Salvataggio…' : (codicePrenInModifica ? '💾 Salva modifiche' : '💾 Salva Prenotazione (FORSE)')}</button>

          {codicePrenInModifica && formModificato && (
            <div className="no-print" style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 50, background: '#fff', borderTop: '1px solid #e2e8f0', boxShadow: '0 -2px 10px rgba(0,0,0,0.08)', padding: '10px 20px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '12px' }}>
              <span style={{ marginRight: 'auto', fontSize: '0.85rem', color: '#666' }}>✏️ Modifiche non salvate su {codicePrenInModifica}</span>
              <button type="button" className="btn-annulla-inline" style={{ padding: '9px 16px' }} disabled={salvataggioPren} onClick={() => { if (window.confirm("Annullare le modifiche non salvate?")) setFormPren(formPrenOriginale); }}>Annulla modifiche</button>
              <button className="btn-preventivo" style={{ width: 'auto', marginTop: 0 }} onClick={salvaPrenotazione} disabled={salvataggioPren}>{salvataggioPren ? 'Salvataggio…' : '💾 Salva modifiche'}</button>
            </div>
          )}
        </div>
        );
      })()}
      {currentView === "storico" && puoVedere(user, 'prenotazioni', 'storico') && (
        <div className="schermata-storico no-print">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <h2 style={{ margin: 0 }}>🗂️ Storico Prenotazioni</h2>
            <button onClick={esportaExcelPren} style={{ padding: '8px 16px', backgroundColor: '#10b981', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>📊 Esporta Excel</button>
          </div>
          <p className="descrizione-pagina">Consulta, apri, cambia stato o elimina le prenotazioni.</p>

          <div className="filtri-storico" style={{ flexWrap: 'wrap' }}>
            <div className="filtro-group" style={{ flex: '1 1 160px' }}>
              <label>Data:</label>
              <input type="date" value={filtroPrenData} onChange={(e) => setFiltroPrenData(e.target.value)} />
            </div>
            <div className="filtro-group" style={{ flex: '1 1 160px' }}>
              <label>Stato:</label>
              <select value={filtroPrenStato} onChange={(e) => setFiltroPrenStato(e.target.value)}>
                <option value="">Tutti</option>
                <option value="FORSE">FORSE</option>
                <option value="CONF">CONF</option>
              </select>
            </div>
            <div className="filtro-group" style={{ flex: '1 1 180px' }}>
              <label>Nominativo:</label>
              <input type="text" placeholder="Nome prenotazione" value={filtroPrenNome} onChange={(e) => setFiltroPrenNome(e.target.value)} />
            </div>
          </div>

          {tabellaPren(prenotazioniFiltrate, "Nessuna prenotazione trovata.")}
        </div>
      )}
      {currentView === "gestione" && puoVedere(user, 'prenotazioni', 'gestione') && (() => {
        const oggiIsoGestione = toISODate(new Date());
        const inAttesaPagamento = prenotazioni.filter(p => p.stato === 'FORSE' && (!p.statoPagamento || p.statoPagamento === 'in attesa'));
        const daConfermare = prenotazioni.filter(p => p.stato === 'FORSE' && p.statoPagamento && p.statoPagamento !== 'in attesa');
        const partiteAttive = prenotazioni.filter(p => p.stato === 'CONF' && p.data >= oggiIsoGestione);
        const daCompletare = prenotazioni.filter(p => p.stato === 'CONF' && p.data < oggiIsoGestione && (p.statoPagamento !== 'saldato' || !fatturazioneCompletaDi(p)));
        const liste = { inAttesaPagamento, daConfermare, partiteAttive, daCompletare };
        const messaggiVuoto = {
          inAttesaPagamento: "Nessun cliente in attesa di pagamento.",
          daConfermare: "Nessun cliente pagato in attesa di conferma.",
          partiteAttive: "Nessuna partita confermata in programma.",
          daCompletare: "Nessuna prenotazione da completare.",
        };
        return (
          <div className="schermata-storico no-print">
            <h2 style={{ margin: 0 }}>🔔 Gestione</h2>
            <p className="descrizione-pagina">Prenotazioni che richiedono un'azione: conferma, sollecito pagamento o completamento dati.</p>
            <nav className="modulo-subnav" style={{ margin: '10px 0' }}>
              <button className={`nav-btn ${gestioneTab === 'inAttesaPagamento' ? 'active' : ''}`} onClick={() => setGestioneTab('inAttesaPagamento')}>⏳ In attesa di pagamento ({inAttesaPagamento.length})</button>
              <button className={`nav-btn ${gestioneTab === 'daConfermare' ? 'active' : ''}`} onClick={() => setGestioneTab('daConfermare')}>💰 Da confermare ({daConfermare.length})</button>
              <button className={`nav-btn ${gestioneTab === 'partiteAttive' ? 'active' : ''}`} onClick={() => setGestioneTab('partiteAttive')}>🎮 Partite attive ({partiteAttive.length})</button>
              <button className={`nav-btn ${gestioneTab === 'daCompletare' ? 'active' : ''}`} onClick={() => setGestioneTab('daCompletare')}>🧩 Da completare ({daCompletare.length})</button>
            </nav>
            {tabellaPren(liste[gestioneTab], messaggiVuoto[gestioneTab])}
          </div>
        );
      })()}
      {currentView === "calendario" && puoVedere(user, 'prenotazioni', 'calendario') && (() => {
        const oggiIso = toISODate(new Date());
        const prenDelGiorno = (iso) => prenotazioni.filter(p => p.data === iso).sort((a, b) => (a.oraInizio || '').localeCompare(b.oraInizio || ''));

        // --- Griglia oraria (viste Settimana/Giorno): posiziona ogni prenotazione in base a orario e durata reali ---
        const ORE_GRIGLIA = Array.from({ length: 19 }, (_, i) => (6 + i) % 24); // 06:00 -> 00:00 (19 fasce da un'ora)
        const minutiDaInizioGiornata = (oraStr) => {
          const m = (oraStr || '').match(/^(\d{1,2}):(\d{2})$/);
          if (!m) return null;
          let h = parseInt(m[1], 10);
          if (h < 6) h += 24; // dopo mezzanotte: continua oltre le 24:00 della griglia
          return (h - 6) * 60 + parseInt(m[2], 10);
        };
        const durataOreDi = (p) => (p.durataOre != null && p.durataOre !== '' ? parseFloat(p.durataOre) || 1 : (durataDaOrari(p.oraInizio, p.oraFine) || 1));
        // Calcola posizione/durata (in minuti dall'inizio griglia) e assegna una "corsia" a ciascuna prenotazione,
        // cosi' quelle con orari sovrapposti nello stesso giorno (o location) si affiancano invece di accavallarsi.
        const calcolaLayoutEventi = (lista) => {
          const eventi = lista
            .map(p => {
              const inizioMin = minutiDaInizioGiornata(p.oraInizio);
              if (inizioMin == null) return null;
              const durataMin = Math.max(durataOreDi(p), 0.25) * 60;
              return { p, inizioMin, durataMin, fineMin: inizioMin + durataMin };
            })
            .filter(Boolean)
            .sort((a, b) => a.inizioMin - b.inizioMin);
          const fineCorsie = [];
          eventi.forEach(ev => {
            let corsia = fineCorsie.findIndex(fine => fine <= ev.inizioMin);
            if (corsia === -1) { corsia = fineCorsie.length; fineCorsie.push(ev.fineMin); }
            else fineCorsie[corsia] = ev.fineMin;
            ev.corsia = corsia;
          });
          eventi.forEach(ev => {
            const sovrapposti = eventi.filter(altro => altro.inizioMin < ev.fineMin && altro.fineMin > ev.inizioMin);
            ev.numCorsie = Math.max(...sovrapposti.map(s => s.corsia + 1));
          });
          return eventi;
        };
        const vaiPrec = () => setCalDate(d => calView === 'mese' ? new Date(d.getFullYear(), d.getMonth() - 1, 1) : addGiorni(d, calView === 'settimana' ? -7 : -1));
        const vaiSucc = () => setCalDate(d => calView === 'mese' ? new Date(d.getFullYear(), d.getMonth() + 1, 1) : addGiorni(d, calView === 'settimana' ? 7 : 1));
        const titolo = calView === 'mese'
          ? `${MESI[calDate.getMonth()]} ${calDate.getFullYear()}`
          : calView === 'settimana'
            ? `Settimana dal ${inizioSettimana(calDate).toLocaleDateString('it-IT')}`
            : calDate.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

        const Chip = ({ p, riempi }) => {
          const c = coloreStato(p.stato);
          const campoTxt = p.campoNome || p.locationCitta || '—';
          const pagColore = p.statoPagamento === 'saldato' ? '#16a34a' : p.statoPagamento === 'acconto' ? '#ca8a04' : '#dc2626';
          const hasOp = p.operatori && p.operatori.length > 0;
          return (
            <div onClick={(e) => { e.stopPropagation(); setPrenSelezionata(p); }} title={`${p.oraInizio || ''} ${p.stato} · ${p.nominativo} · ${campoTxt} · ${p.pacchettoNome || ''} · pagamento ${p.statoPagamento || 'in attesa'}`} style={{ cursor: 'pointer', background: c.bg, borderLeft: `3px solid ${c.bd}`, color: c.tx, fontSize: '0.7rem', padding: '3px 5px', borderRadius: '4px', lineHeight: 1.25, ...(riempi ? { height: '100%', boxSizing: 'border-box', overflow: 'hidden' } : { marginBottom: '3px' }) }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '4px' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span title={p.googleCalendarSync ? 'Sincronizzato con Google Calendar' : 'Non sincronizzato con Google Calendar'}>{p.googleCalendarSync ? '✅' : '⚠️'}</span> {p.oraInizio ? <strong>{p.oraInizio}</strong> : ''} - {p.nominativo}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                  {p.campoId && <input type="checkbox" checked={!!p.campoPrenotato} onClick={(e) => e.stopPropagation()} onChange={() => toggleCampoPrenotato(p)} title={p.campoPrenotato ? 'campo prenotato' : 'campo da prenotare'} style={{ margin: 0 }} />}
                  <span title={hasOp ? `${p.operatori.length} operatori assegnati` : 'nessun operatore'}>{hasOp ? `🧑${p.operatori.length}` : '🚫'}</span>
                  <span title={`pagamento ${p.statoPagamento || 'in attesa'}`} style={{ display: 'inline-block', width: '11px', height: '11px', background: pagColore, borderRadius: '2px', flexShrink: 0 }}></span>
                </span>
              </div>
              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.9 }}>{p.pacchettoNome || '—'} - {campoTxt}</div>
            </div>
          );
        };

        // Su schermi stretti: nasconde i chip completi nei giorni del mese (troppo piccoli per essere leggibili)
        // e mostra solo l'orario di ciascuna prenotazione in una mini-etichetta colorata per stato,
        // così l'intero mese entra senza scroll orizzontale ma resta comunque leggibile un minimo di informazione.
        const calendarioMobileStyles = `
          @media (max-width: 480px) {
            .cal-mese-grid { min-width: 0 !important; grid-template-columns: 16px repeat(7, 1fr) !important; gap: 2px !important; }
            .cal-mese-giorno { min-height: 46px !important; padding: 2px !important; }
            .cal-mese-numero { font-size: 0.6rem !important; }
            .cal-mese-giorno-header { font-size: 0.6rem !important; padding: 2px 0 !important; }
            .cal-mese-settimana, .cal-mese-settimana-label { font-size: 0.55rem !important; }
            .cal-mese-chips { display: none !important; }
            .cal-mese-puntini { display: flex !important; flex-wrap: wrap; align-content: flex-start; gap: 1px; justify-content: center; }
          }
        `;

        return (
          <div className="schermata-storico no-print">
            <style>{calendarioMobileStyles}</style>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button className="btn-chiudi" style={{ float: 'none', padding: '6px 12px' }} onClick={vaiPrec}>‹</button>
                <button className="btn-chiudi" style={{ float: 'none', padding: '6px 12px' }} onClick={() => setCalDate(new Date())}>Oggi</button>
                <button className="btn-chiudi" style={{ float: 'none', padding: '6px 12px' }} onClick={vaiSucc}>›</button>
                <h2 style={{ margin: 0, textTransform: 'capitalize' }}>{titolo}</h2>
                {toISODate(calDate) === oggiIso && <span style={{ fontSize: '0.7rem', background: '#2563eb', color: '#fff', padding: '2px 9px', borderRadius: '10px', fontWeight: 'bold', letterSpacing: '0.03em' }}>OGGI</span>}
              </div>
              <div className="modulo-subnav" style={{ margin: 0 }}>
                <button className={`nav-btn ${calView === 'mese' ? 'active' : ''}`} onClick={() => setCalView('mese')}>Mese</button>
                <button className={`nav-btn ${calView === 'settimana' ? 'active' : ''}`} onClick={() => setCalView('settimana')}>Settimana</button>
                <button className={`nav-btn ${calView === 'giorno' ? 'active' : ''}`} onClick={() => setCalView('giorno')}>Giorno</button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '14px', margin: '10px 0', fontSize: '0.8rem' }}>
              <span><span style={{ display: 'inline-block', width: 12, height: 12, background: '#fed7aa', border: '1px solid #f59e0b', borderRadius: 2, verticalAlign: 'middle' }}></span> FORSE</span>
              <span><span style={{ display: 'inline-block', width: 12, height: 12, background: '#dcfce7', border: '1px solid #16a34a', borderRadius: 2, verticalAlign: 'middle' }}></span> CONF</span>
            </div>

            {/* MESE */}
            {calView === 'mese' && (
              <div className="cal-mese-wrap" style={{ overflowX: 'auto' }}>
                <div className="cal-mese-grid" style={{ display: 'grid', gridTemplateColumns: '44px repeat(7, 1fr)', gap: '4px', minWidth: '640px' }}>
                  <div className="cal-mese-settimana-label" style={{ fontSize: '0.7rem', color: '#94a3b8', textAlign: 'center', padding: '6px 0' }}>Sett.</div>
                  {['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'].map(g => <div key={g} className="cal-mese-giorno-header" style={{ fontWeight: 'bold', fontSize: '0.8rem', color: '#64748b', textAlign: 'center', padding: '6px 0' }}>{g}</div>)}
                  {Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addGiorni(inizioSettimana(new Date(calDate.getFullYear(), calDate.getMonth(), 1)), w * 7 + d))).map((settimana, wi) => (
                    <Fragment key={wi}>
                      <div onClick={() => { setCalDate(settimana[0]); setCalView('settimana'); }} title="Apri settimana" className="cal-mese-settimana" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 'bold', color: '#64748b' }}>{numeroSettimana(settimana[3])}</div>
                      {settimana.map((giorno, di) => {
                        const iso = toISODate(giorno);
                        const fuoriMese = giorno.getMonth() !== calDate.getMonth();
                        const lista = prenDelGiorno(iso);
                        return (
                          <div key={di} onClick={() => { setCalDate(giorno); setCalView('giorno'); }} title="Apri giorno" className="cal-mese-giorno" style={{ cursor: 'pointer', minHeight: '150px', border: iso === oggiIso ? '2px solid #2563eb' : '1px solid #e2e8f0', borderRadius: '6px', padding: '4px', background: iso === oggiIso ? '#eff6ff' : (fuoriMese ? '#f8fafc' : '#fff'), opacity: fuoriMese ? 0.55 : 1 }}>
                            <div className="cal-mese-numero" style={{ textAlign: 'right' }}>
                              <span style={iso === oggiIso ? { display: 'inline-block', fontSize: '0.75rem', fontWeight: 'bold', color: '#fff', background: '#2563eb', borderRadius: '50%', width: '20px', height: '20px', lineHeight: '20px', textAlign: 'center' } : { fontSize: '0.75rem', fontWeight: 'normal', color: '#475569' }}>{giorno.getDate()}</span>
                            </div>
                            <div className="cal-mese-chips">
                              {lista.slice(0, 8).map(p => <Chip key={p.id} p={p} />)}
                              {lista.length > 8 && <div style={{ fontSize: '0.7rem', color: '#777' }}>+{lista.length - 8} altre…</div>}
                            </div>
                            <div className="cal-mese-puntini" style={{ display: 'none' }}>
                              {lista.slice(0, 4).map(p => {
                                const c = coloreStato(p.stato);
                                return (
                                  <span key={p.id} title={`${p.oraInizio || ''} ${p.stato} · ${p.nominativo}`} onClick={(e) => { e.stopPropagation(); setPrenSelezionata(p); }} style={{ display: 'inline-block', fontSize: '0.55rem', lineHeight: 1, fontWeight: 'bold', padding: '1px 2px', borderRadius: '3px', background: c.bg, border: `1px solid ${c.bd}`, color: c.tx, margin: '1px' }}>
                                    {(p.oraInizio || '').slice(0, 2) || '•'}
                                  </span>
                                );
                              })}
                              {lista.length > 4 && <span style={{ fontSize: '0.55rem', color: '#777' }}>+{lista.length - 4}</span>}
                            </div>
                          </div>
                        );
                      })}
                    </Fragment>
                  ))}
                </div>
              </div>
            )}

            {/* SETTIMANA (griglia oraria 06:00 -> 00:00, blocchi proporzionali alla durata) */}
            {calView === 'settimana' && (() => {
              const ROW_H = 34;
              const giorni = Array.from({ length: 7 }, (_, i) => addGiorni(inizioSettimana(calDate), i));
              const altezzaGriglia = ORE_GRIGLIA.length * ROW_H;
              return (
                <div style={{ overflowX: 'auto' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '56px repeat(7, 1fr)', gap: '1px', background: '#e2e8f0', border: '1px solid #e2e8f0', borderRadius: '6px', minWidth: '700px' }}>
                    <div style={{ background: '#fff' }}></div>
                    {giorni.map((g, i) => {
                      const isOggi = toISODate(g) === oggiIso;
                      return (
                        <div key={i} style={{ background: isOggi ? '#dbeafe' : '#f8fafc', padding: '6px', fontSize: '0.78rem', fontWeight: 'bold', color: isOggi ? '#2563eb' : '#475569', textAlign: 'center', borderBottom: isOggi ? '3px solid #2563eb' : '3px solid transparent', boxSizing: 'border-box' }}>
                          {['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'][i]} {g.getDate()}
                        </div>
                      );
                    })}
                    <div style={{ position: 'relative', background: '#f8fafc', height: `${altezzaGriglia}px` }}>
                      {ORE_GRIGLIA.map((h, i) => (
                        <div key={h} style={{ position: 'absolute', top: `${i * ROW_H}px`, transform: 'translateY(-50%)', width: '100%', boxSizing: 'border-box', fontSize: '0.72rem', color: '#64748b', textAlign: 'right', padding: '0 6px' }}>{String(h).padStart(2, '0')}:00</div>
                      ))}
                    </div>
                    {giorni.map((g, di) => {
                      const eventi = calcolaLayoutEventi(prenDelGiorno(toISODate(g)));
                      const isOggi = toISODate(g) === oggiIso;
                      return (
                        <div key={di} style={{ position: 'relative', background: isOggi ? '#f5f9ff' : '#fff', height: `${altezzaGriglia}px` }}>
                          {ORE_GRIGLIA.map((h, i) => <div key={h} style={{ position: 'absolute', top: `${i * ROW_H}px`, width: '100%', borderTop: '1px solid #f1f5f9' }}></div>)}
                          {eventi.map(ev => (
                            <div key={ev.p.id} style={{ position: 'absolute', top: `${(ev.inizioMin / 60) * ROW_H}px`, height: `${(ev.durataMin / 60) * ROW_H}px`, left: `${(ev.corsia / ev.numCorsie) * 100}%`, width: `${(1 / ev.numCorsie) * 100}%`, boxSizing: 'border-box', padding: '0 1px 2px 1px' }}>
                              <Chip p={ev.p} riempi />
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* GIORNO (griglia oraria 06:00 -> 00:00, blocchi proporzionali alla durata, una colonna per location) */}
            {calView === 'giorno' && (() => {
              const ROW_H = 56;
              const iso = toISODate(calDate);
              const locLabel = (p) => p.campoNome || [p.locationIndirizzo, p.locationCitta].filter(Boolean).join(', ') || '—';
              const dayPrens = prenDelGiorno(iso);
              if (dayPrens.length === 0) return <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '20px', color: '#777' }}>Nessuna prenotazione in questa giornata.</div>;
              // I campi noti (da anagrafica) vengono prima delle location libere; entro ciascun gruppo, ordine alfabetico.
              const locationCampoNoto = new Set(dayPrens.filter(p => p.campoId).map(locLabel));
              const locations = [...new Set(dayPrens.map(locLabel))].sort((a, b) => {
                const aCampo = locationCampoNoto.has(a), bCampo = locationCampoNoto.has(b);
                if (aCampo !== bCampo) return aCampo ? -1 : 1;
                return a.localeCompare(b);
              });
              const altezzaGriglia = ORE_GRIGLIA.length * ROW_H;
              return (
                <div style={{ overflowX: 'auto' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: `64px repeat(${locations.length}, minmax(180px, 1fr))`, gap: '1px', background: '#e2e8f0', border: '1px solid #e2e8f0', borderRadius: '6px', minWidth: 'min-content' }}>
                    <div style={{ background: '#fff' }}></div>
                    {locations.map(loc => (
                      <div key={loc} title={locationCampoNoto.has(loc) ? 'Campo da anagrafica' : 'Location libera'} style={{ background: '#f8fafc', padding: '6px', fontSize: '0.78rem', fontWeight: 'bold', color: '#475569', textAlign: 'center' }}>
                        {locationCampoNoto.has(loc) && '🏟️ '}{loc}
                      </div>
                    ))}
                    <div style={{ position: 'relative', background: '#f8fafc', height: `${altezzaGriglia}px` }}>
                      {ORE_GRIGLIA.map((h, i) => (
                        <div key={h} style={{ position: 'absolute', top: `${i * ROW_H}px`, transform: 'translateY(-50%)', width: '100%', boxSizing: 'border-box', fontSize: '0.75rem', color: '#64748b', textAlign: 'right', padding: '0 8px' }}>{String(h).padStart(2, '0')}:00</div>
                      ))}
                    </div>
                    {locations.map(loc => {
                      const eventi = calcolaLayoutEventi(dayPrens.filter(p => locLabel(p) === loc));
                      return (
                        <div key={loc} style={{ position: 'relative', background: '#fff', height: `${altezzaGriglia}px` }}>
                          {ORE_GRIGLIA.map((h, i) => <div key={h} style={{ position: 'absolute', top: `${i * ROW_H}px`, width: '100%', borderTop: '1px solid #f1f5f9' }}></div>)}
                          {eventi.map(ev => {
                            const p = ev.p;
                            const c = coloreStato(p.stato);
                            const pagColore = p.statoPagamento === 'saldato' ? '#16a34a' : p.statoPagamento === 'acconto' ? '#ca8a04' : '#dc2626';
                            const hasOp = p.operatori && p.operatori.length > 0;
                            return (
                              <div key={p.id} style={{ position: 'absolute', top: `${(ev.inizioMin / 60) * ROW_H}px`, height: `${(ev.durataMin / 60) * ROW_H}px`, left: `${(ev.corsia / ev.numCorsie) * 100}%`, width: `${(1 / ev.numCorsie) * 100}%`, boxSizing: 'border-box', padding: '0 3px 3px 3px' }}>
                                <div onClick={() => setPrenSelezionata(p)} style={{ cursor: 'pointer', height: '100%', boxSizing: 'border-box', overflow: 'hidden', background: c.bg, borderLeft: `4px solid ${c.bd}`, color: c.tx, padding: '3px 8px', borderRadius: '6px', fontSize: '0.8rem', lineHeight: 1.3 }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      <span title={p.googleCalendarSync ? 'Sincronizzato con Google Calendar' : 'Non sincronizzato con Google Calendar'}>{p.googleCalendarSync ? '✅' : '⚠️'}</span> <strong>{p.oraInizio || ''}{p.oraFine ? `–${p.oraFine}` : ''}</strong> · <strong>{p.nominativo}</strong>
                                    </span>
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                                      {p.campoId && <input type="checkbox" checked={!!p.campoPrenotato} onClick={(e) => e.stopPropagation()} onChange={() => toggleCampoPrenotato(p)} title={p.campoPrenotato ? 'campo prenotato' : 'campo da prenotare'} style={{ margin: 0 }} />}
                                      <span title={hasOp ? `${p.operatori.length} operatori assegnati` : 'nessun operatore'}>{hasOp ? `🧑${p.operatori.length}` : '🚫'}</span>
                                      <span title={`pagamento ${p.statoPagamento || 'in attesa'}`} style={{ display: 'inline-block', width: '11px', height: '11px', background: pagColore, borderRadius: '2px', flexShrink: 0 }}></span>
                                    </span>
                                  </div>
                                  <div style={{ fontSize: '0.76rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.9 }}>{p.pacchettoNome || '—'} - {p.campoNome || p.locationCitta || '—'}</div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* DETTAGLIO PRENOTAZIONE */}
            {prenSelezionata && (
              <div className="modal-preventivo-backdrop" onClick={() => setPrenSelezionata(null)}>
                <div style={{ background: '#fff', maxWidth: '420px', margin: '80px auto', borderRadius: '10px', padding: '22px' }} onClick={e => e.stopPropagation()}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <button className="btn-chiudi" title="Chiudi" style={{ float: 'none', padding: '4px 9px' }} onClick={() => setPrenSelezionata(null)}>✕</button>
                      <h3 style={{ margin: 0 }}>{prenSelezionata.id}</h3>
                    </div>
                    <span className={`badge-stato ${(prenSelezionata.stato || '').toLowerCase()}`}>{prenSelezionata.stato}</span>
                  </div>
                  <div style={{ marginTop: '12px', fontSize: '0.9rem', lineHeight: 1.6 }}>
                    📅 {prenSelezionata.data} · {prenSelezionata.oraInizio}{prenSelezionata.oraFine ? `–${prenSelezionata.oraFine}` : ''}{prenSelezionata.durataOre ? ` (${prenSelezionata.durataOre}h)` : ''}<br />
                    👤 <strong>{prenSelezionata.nominativo}</strong>{prenSelezionata.telefono ? ` · 📞 ${prenSelezionata.telefono}` : ''}{prenSelezionata.email ? ` · ✉️ ${prenSelezionata.email}` : ''}<br />
                    {prenSelezionata.pacchettoNome || '—'}<br />
                    {prenSelezionata.campoNome || [prenSelezionata.locationIndirizzo, prenSelezionata.locationCitta].filter(Boolean).join(', ') || '—'}<br />
                    {prenSelezionata.operatori && prenSelezionata.operatori.length > 0 && <>🧑 {prenSelezionata.operatori.map(o => o.nome).join(', ')}<br /></>}
                    {prenSelezionata.tipoRinfresco && <>🍽️ Rinfresco: {prenSelezionata.tipoRinfresco}{prenSelezionata.numeroPartecipanti ? ` · ${prenSelezionata.numeroPartecipanti} pers` : ''}<br /></>}
                    {prenSelezionata.etaMedia && <>🎂 Età media: {prenSelezionata.etaMedia}<br /></>}
                    {prenSelezionata.note && <>📝 <em>{prenSelezionata.note}</em><br /></>}
                    💶 Pagato €{((prenSelezionata.pagamenti || []).reduce((s, x) => s + (parseFloat(x.importo) || 0), 0)).toFixed(2)} / €{(parseFloat(prenSelezionata.prezzoVendita) || 0).toFixed(2)} · <strong>{prenSelezionata.statoPagamento || 'in attesa'}</strong><br />
                    📅 <button type="button" onClick={(e) => { e.stopPropagation(); toggleGoogleCalendarSync(prenSelezionata); }} title="Clic per correggere a mano lo stato di sincronizzazione" style={{ border: 'none', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 'bold', padding: '2px 8px', borderRadius: '10px', background: prenSelezionata.googleCalendarSync ? '#dcfce7' : '#fee2e2', color: prenSelezionata.googleCalendarSync ? '#166534' : '#991b1b' }}>{prenSelezionata.googleCalendarSync ? '✅ Sincronizzato con Google Calendar' : '⚠️ Non sincronizzato con Google Calendar'}</button>
                    {prenSelezionata.campoId && (
                      <label onClick={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px', cursor: 'pointer', fontWeight: 'bold', color: prenSelezionata.campoPrenotato ? '#166534' : '#9a3412' }}>
                        <input type="checkbox" checked={!!prenSelezionata.campoPrenotato} onChange={() => toggleCampoPrenotato(prenSelezionata)} /> {prenSelezionata.campoPrenotato ? 'Campo prenotato' : 'Campo da prenotare'} <span style={{ fontSize: '0.75rem', color: '#777', fontWeight: 'normal' }}>(clic per cambiare)</span>
                      </label>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '18px', justifyContent: 'center' }}>
                    <button className="btn-modifica-inline" title="Apri" style={{ padding: '8px 12px' }} onClick={() => { caricaPrenotazione(prenSelezionata); setPrenSelezionata(null); }}>📂</button>
                    {prenSelezionata.stato === 'FORSE' && <button className="btn-conferma" title="Conferma (prepara mail al cliente)" style={{ width: 'auto', padding: '8px 12px' }} onClick={() => { cambiaStatoPren(prenSelezionata, 'CONF'); setPrenSelezionata(null); }}>✔️</button>}
                    {prenSelezionata.stato === 'CONF' && <button className="btn-ripristina" title="Riporta a FORSE" style={{ width: 'auto', padding: '8px 12px' }} onClick={() => { cambiaStatoPren(prenSelezionata, 'FORSE'); setPrenSelezionata(null); }}>↩️</button>}
                    <button className="btn-modifica-inline" title={prenSelezionata.googleCalendarSync ? "Già aggiunto a Google Calendar (clic per riaprire)" : "Aggiungi a Google Calendar"} style={{ padding: '8px 12px' }} onClick={() => apriGoogleCalendar(prenSelezionata)}>📅</button>
                    {user.ruolo === 'admin' && <button className="btn-elimina-prev" title="Elimina" style={{ width: 'auto', padding: '8px 12px' }} onClick={() => { eliminaPrenotazione(prenSelezionata.id); setPrenSelezionata(null); }}>🗑️</button>}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ===================== RIEPILOGHI SETTIMANALI (per operatore / per campo) ===================== */}
      {currentView === "riepiloghi" && puoVedere(user, 'prenotazioni', 'riepiloghi') && (() => {
        const inizio = inizioSettimana(riepilogoData);
        const fine = addGiorni(inizio, 6);
        const isoSettimana = new Set(Array.from({ length: 7 }, (_, i) => toISODate(addGiorni(inizio, i))));
        const righeSettimana = prenotazioni.filter(p => isoSettimana.has(p.data)).sort((a, b) => `${a.data}${a.oraInizio || ''}`.localeCompare(`${b.data}${b.oraInizio || ''}`));
        const locLabelRiep = (p) => p.campoNome || [p.locationIndirizzo, p.locationCitta].filter(Boolean).join(', ') || '—';

        const rigaTestoBreve = (p) => {
          const extra = [];
          if (p.tipoRinfresco) extra.push(p.tipoRinfresco);
          if (p.numeroPartecipanti) extra.push(`${p.numeroPartecipanti} pers`);
          return `ore ${p.oraInizio || '—'} ${formattaDataBreveIT(p.data)} - ${p.pacchettoNome || 'Prenotazione'}${extra.length ? ' (' + extra.join(', ') + ')' : ''}`;
        };

        // Raggruppa per operatore
        const perOperatore = {};
        righeSettimana.forEach(p => {
          (p.operatori || []).forEach(o => {
            if (!perOperatore[o.id]) perOperatore[o.id] = [];
            perOperatore[o.id].push(p);
          });
        });
        const listaOperatori = operatori
          .map(o => ({ id: o.id, nome: o.nome, telefono: o.telefono, righe: perOperatore[o.id] || [] }))
          .filter(o => o.righe.length > 0);

        // Raggruppa per campo configurato (le location libere non hanno un gruppo/riepilogo da inviare)
        const perCampo = {};
        righeSettimana.filter(p => p.campoId).forEach(p => {
          const label = locLabelRiep(p);
          if (!perCampo[label]) perCampo[label] = [];
          perCampo[label].push(p);
        });
        const listaCampi = Object.entries(perCampo).map(([label, righe]) => ({ label, righe }));

        const periodoTxt = `dal ${formattaDataBreveIT(toISODate(inizio))} al ${formattaDataBreveIT(toISODate(fine))}`;

        const messaggioOperatore = (op) => [
          `Ciao ${op.nome}! 👋`,
          `Ecco le tue prenotazioni per la settimana ${periodoTxt}:`,
          '',
          ...op.righe.map((p, i) => `${i + 1}) ${rigaTestoBreve(p)}${locLabelRiep(p) !== '—' ? ` presso ${locLabelRiep(p)}` : ''}`),
          '',
          'Grazie! 💪'
        ].join('\n');

        const messaggioCampo = (c) => [
          `📋 Prenotazioni della settimana - ${c.label}`,
          `Periodo ${periodoTxt}`,
          '',
          ...c.righe.map((p, i) => `${i + 1}) ${rigaTestoBreve(p)}`)
        ].join('\n');

        return (
          <div className="schermata-storico no-print">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button className="btn-chiudi" style={{ float: 'none', padding: '6px 12px' }} onClick={() => setRiepilogoData(d => addGiorni(d, -7))}>‹</button>
                <button className="btn-chiudi" style={{ float: 'none', padding: '6px 12px' }} onClick={() => setRiepilogoData(new Date())}>Oggi</button>
                <button className="btn-chiudi" style={{ float: 'none', padding: '6px 12px' }} onClick={() => setRiepilogoData(d => addGiorni(d, 7))}>›</button>
                <h2 style={{ margin: 0 }}>Settimana {periodoTxt}</h2>
              </div>
              <div className="modulo-subnav" style={{ margin: 0 }}>
                <button className={`nav-btn ${riepilogoTab === 'operatori' ? 'active' : ''}`} onClick={() => setRiepilogoTab('operatori')}>👤 Per Operatore</button>
                <button className={`nav-btn ${riepilogoTab === 'campi' ? 'active' : ''}`} onClick={() => setRiepilogoTab('campi')}>📍 Per Campo</button>
              </div>
            </div>

            {riepilogoTab === 'operatori' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '16px' }}>
                {listaOperatori.length === 0 && <p style={{ color: '#666' }}>Nessuna prenotazione con operatori assegnati in questa settimana.</p>}
                {listaOperatori.map(op => {
                  const numero = numeroWhatsApp(op.telefono);
                  return (
                    <div key={op.id} className="admin-table-box" style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', padding: '14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                        <strong>👤 {op.nome} <span style={{ fontWeight: 'normal', color: '#777', fontSize: '0.85rem' }}>({op.righe.length} prenotazion{op.righe.length === 1 ? 'e' : 'i'})</span></strong>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button type="button" className="btn-preventivo" style={{ width: 'auto', marginTop: 0, fontSize: '0.85rem', padding: '6px 12px' }} onClick={() => { setRiepilogoTesto(messaggioOperatore(op)); setRiepilogoCopiato(false); }}>📋 Copia testo</button>
                          {numero && (
                            <a className="btn-conferma" title="Apri app WhatsApp" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '34px', padding: '6px', fontSize: '1rem' }} href={`whatsapp://send?phone=${numero}&text=${encodeURIComponent(messaggioOperatore(op))}`} target="whatsapp-noleggio">📱</a>
                          )}
                        </div>
                      </div>
                      <ul style={{ margin: '10px 0 0 0', paddingLeft: '20px', fontSize: '0.85rem', color: '#555' }}>
                        {op.righe.map(p => <li key={p.id}>{rigaTestoBreve(p)}{locLabelRiep(p) !== '—' && ` · ${locLabelRiep(p)}`}</li>)}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}

            {riepilogoTab === 'campi' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '16px' }}>
                {listaCampi.length === 0 && <p style={{ color: '#666' }}>Nessuna prenotazione in questa settimana.</p>}
                {listaCampi.map(c => (
                  <div key={c.label} className="admin-table-box" style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', padding: '14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                      <strong>📍 {c.label} <span style={{ fontWeight: 'normal', color: '#777', fontSize: '0.85rem' }}>({c.righe.length} prenotazion{c.righe.length === 1 ? 'e' : 'i'})</span></strong>
                      <button type="button" className="btn-preventivo" style={{ width: 'auto', marginTop: 0, fontSize: '0.85rem', padding: '6px 12px' }} onClick={() => { setRiepilogoTesto(messaggioCampo(c)); setRiepilogoCopiato(false); }}>📋 Copia messaggio</button>
                    </div>
                    <ul style={{ margin: '10px 0 0 0', paddingLeft: '20px', fontSize: '0.85rem', color: '#555' }}>
                      {c.righe.map(p => <li key={p.id}>{rigaTestoBreve(p)}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* ANTEPRIMA RIEPILOGO DA COPIARE (invio manuale su WhatsApp, es. gruppo di un campo) */}
      {riepilogoTesto !== null && (
        <div className="modal-preventivo-backdrop no-print" onClick={() => { setRiepilogoTesto(null); setRiepilogoCopiato(false); }}>
          <div style={{ background: '#fff', maxWidth: '480px', margin: '80px auto', borderRadius: '10px', padding: '22px' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>📱 Messaggio riepilogo</h3>
            <p className="descrizione-pagina" style={{ marginTop: 0 }}>Copia il testo e incollalo in WhatsApp (es. nel gruppo del campo).</p>
            <textarea readOnly value={riepilogoTesto} rows={12} style={{ width: '100%', boxSizing: 'border-box', padding: '10px', border: '1px solid #cbd5e1', borderRadius: '6px', fontFamily: 'inherit', fontSize: '0.85rem', resize: 'vertical' }} onFocus={(e) => e.target.select()} />
            <div style={{ display: 'flex', gap: '10px', marginTop: '14px', justifyContent: 'flex-end' }}>
              <button type="button" className="btn-chiudi" style={{ float: 'none' }} onClick={() => { setRiepilogoTesto(null); setRiepilogoCopiato(false); }}>Chiudi</button>
              <button
                type="button"
                className="btn-preventivo"
                style={{ width: 'auto', marginTop: 0 }}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(riepilogoTesto);
                    setRiepilogoCopiato(true);
                  } catch {
                    alert("Copia non riuscita: seleziona il testo manualmente.");
                  }
                }}
              >
                {riepilogoCopiato ? '✅ Copiato!' : '📋 Copia testo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ANTEPRIMA CONFERMA DA COPIARE (invio manuale via Gmail, con formattazione HTML) */}
      {testoConferma !== null && (
        <div className="modal-preventivo-backdrop no-print" onClick={() => { setTestoConferma(null); setConfermaCopiata(false); }}>
          <div style={{ background: '#fff', maxWidth: '600px', margin: '60px auto', borderRadius: '10px', padding: '22px' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>✉️ Conferma prenotazione</h3>
            <p className="descrizione-pagina" style={{ marginTop: 0 }}>Copia il messaggio e incollalo in una nuova mail Gmail: la formattazione (tabella, grassetti) viene mantenuta.</p>
            <div
              style={{ maxHeight: '360px', overflowY: 'auto', padding: '14px', border: '1px solid #cbd5e1', borderRadius: '6px', background: '#f9f9f9' }}
              dangerouslySetInnerHTML={{ __html: testoConferma.html }}
            />
            <div style={{ display: 'flex', gap: '10px', marginTop: '14px', justifyContent: 'flex-end' }}>
              <button type="button" className="btn-chiudi" style={{ float: 'none' }} onClick={() => { setTestoConferma(null); setConfermaCopiata(false); }}>Chiudi</button>
              <button
                type="button"
                className="btn-preventivo"
                style={{ width: 'auto', marginTop: 0 }}
                onClick={async () => {
                  try {
                    if (window.ClipboardItem && navigator.clipboard.write) {
                      await navigator.clipboard.write([
                        new ClipboardItem({
                          'text/html': new Blob([testoConferma.html], { type: 'text/html' }),
                          'text/plain': new Blob([testoConferma.testo], { type: 'text/plain' })
                        })
                      ]);
                    } else {
                      await navigator.clipboard.writeText(testoConferma.testo);
                    }
                    setConfermaCopiata(true);
                  } catch {
                    try {
                      await navigator.clipboard.writeText(testoConferma.testo);
                      setConfermaCopiata(true);
                    } catch {
                      alert("Copia non riuscita: seleziona il testo manualmente.");
                    }
                  }
                }}
              >
                {confermaCopiata ? '✅ Copiato!' : '📋 Copia messaggio'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default Prenotazioni
