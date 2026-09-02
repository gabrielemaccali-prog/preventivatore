import { MOLTIPLICATORE_TARGET } from './costanti';

// Formatta una data in formato italiano (gg/mm/aaaa)
export const formattaDataIT = (dataStr) => {
  if (!dataStr) return "N/D";
  const opzioni = { year: 'numeric', month: '2-digit', day: '2-digit' };
  return new Date(dataStr).toLocaleDateString('it-IT', opzioni);
};

// Calcola il numero di giorni di noleggio (inclusivo); minimo 1
export const calcolaGiorni = (dataInizio, dataFine) => {
  if (!dataInizio || !dataFine) return 1;
  const inizio = new Date(dataInizio);
  const fine = new Date(dataFine);
  const diffTime = fine - inizio;
  return diffTime < 0 ? 1 : Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
};

// "HH:MM" -> minuti dalla mezzanotte (null se vuoto o non valido).
// Sta qui perché la usano preventivatore, prenotazioni e compensi: un solo modo di leggere un orario,
// altrimenti due moduli possono contare ore diverse sulla stessa partita — e sui compensi sono soldi.
export const toMinutes = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || "");
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
};

// Ore di servizio ricavate dagli orari giornalieri (gestisce l'attraversamento della mezzanotte).
// Restituisce null finché non sono stati indicati entrambi gli orari.
export const oreDaOrari = (oraInizio, oraFine) => {
  const a = toMinutes(oraInizio);
  const b = toMinutes(oraFine);
  if (a == null || b == null) return null;
  let diff = b - a;
  if (diff <= 0) diff += 24 * 60;
  return Math.round((diff / 60) * 100) / 100;
};

// Arrotondamento automatico alla decina superiore
export const arrotondaAllaDecina = (valore) => {
  return Math.ceil(valore / 10) * 10;
};

// Sedi "di proprietà" (flag BFM in anagrafica sedi): il prezzo indicato nell'anagrafica
// gonfiabili è già il prezzo di vendita, quindi non si applica il moltiplicatore target
// e il costo del gonfiabile resta a zero.
export const isPartenzaBFM = (partenza) => !!partenza?.bfm;

// Su una riga a prezzo concordato l'importo è stato pattuito con il fornitore, quindi è un costo
// a tutti gli effetti anche se la sede è di proprietà: si applica il moltiplicatore pieno.
export const moltiplicatoreTargetPer = (partenza, concordata = false) =>
  (!concordata && isPartenzaBFM(partenza)) ? 1 : MOLTIPLICATORE_TARGET;

// Costo vivo di una soluzione logistica: per le sedi di proprietà il prezzo del gonfiabile
// non è un costo (resta a zero), mentre la logistica concorre sempre.
export const costoVivoDi = (sol) => {
  if (!sol) return 0;
  // Il costo concordato a mano vale così com'è: comprende già trasporto e noleggio.
  if (sol.concordata) return sol.totaleOpzione || 0;
  return isPartenzaBFM(sol.partenza) ? (sol.costoKmTotale || 0) : (sol.totaleOpzione || 0);
};

// --- VALIDAZIONE CODICE FISCALE (con carattere di controllo) ---
const CF_DISPARI = { '0': 1, '1': 0, '2': 5, '3': 7, '4': 9, '5': 13, '6': 15, '7': 17, '8': 19, '9': 21, 'A': 1, 'B': 0, 'C': 5, 'D': 7, 'E': 9, 'F': 13, 'G': 15, 'H': 17, 'I': 19, 'J': 21, 'K': 2, 'L': 4, 'M': 18, 'N': 20, 'O': 11, 'P': 3, 'Q': 6, 'R': 8, 'S': 12, 'T': 14, 'U': 16, 'V': 10, 'W': 22, 'X': 25, 'Y': 24, 'Z': 23 };
const CF_PARI = { '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, 'A': 0, 'B': 1, 'C': 2, 'D': 3, 'E': 4, 'F': 5, 'G': 6, 'H': 7, 'I': 8, 'J': 9, 'K': 10, 'L': 11, 'M': 12, 'N': 13, 'O': 14, 'P': 15, 'Q': 16, 'R': 17, 'S': 18, 'T': 19, 'U': 20, 'V': 21, 'W': 22, 'X': 23, 'Y': 24, 'Z': 25 };

export const validaCF = (cfRaw) => {
  const cf = (cfRaw || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{15}[A-Z]$/.test(cf)) return false;
  let somma = 0;
  for (let i = 0; i < 15; i++) somma += (i % 2 === 0) ? CF_DISPARI[cf[i]] : CF_PARI[cf[i]];
  return String.fromCharCode('A'.charCodeAt(0) + (somma % 26)) === cf[15];
};

// Campi di fatturazione ancora da compilare, con l'etichetta che hanno nel form: lista vuota = tutto a posto.
// CAP e provincia sono richiesti come il resto dell'indirizzo: senza non si emette la fattura elettronica.
// È la fonte unica del "cosa manca": `fatturazioneCompletaDi` ne è solo la lettura in sì/no.
export const campiFatturazioneMancanti = (p) => (p.fattTipo === 'azienda'
  ? [[p.ragioneSociale, 'Ragione sociale'], [p.aziIndirizzo, 'Indirizzo'], [p.aziCap, 'CAP'], [p.aziCitta, 'Città'],
     [p.aziProvincia, 'Provincia'], [p.pIva, 'P. IVA']]
  : [[p.fattNome, 'Nome'], [p.fattCognome, 'Cognome'], [p.fattIndirizzo, 'Indirizzo'], [p.fattCap, 'CAP'],
     [p.fattCitta, 'Città'], [p.fattProvincia, 'Provincia'],
     [validaCF(p.fattCF), p.fattCF ? 'Codice Fiscale (non valido)' : 'Codice Fiscale']]
).filter(([valore]) => !valore).map(([, etichetta]) => etichetta);

// Verifica se i dati di fatturazione sono completi (privato con CF valido, oppure azienda con P.IVA): in entrambi i casi
// serve l'indirizzo per intero, CAP e provincia compresi.
export const fatturazioneCompletaDi = (p) => campiFatturazioneMancanti(p).length === 0;

// Prenotazione conclusa: confermata, evento ormai passato, saldata e con i dati di fatturazione a posto.
// Non è uno stato salvato: si ricava ogni volta dai dati della prenotazione e dalla data odierna
// (passata da fuori, così la funzione resta pura e testabile). Vive qui perché la usano sia il modulo
// prenotazioni sia costi/ricavi: una definizione sola, altrimenti le due schede si contraddicono.
export const prenotazioneCompletata = (p, oggiIso) =>
  p.stato === 'CONF' && p.data < oggiIso && p.statoPagamento === 'saldato' && fatturazioneCompletaDi(p);

// Scompone un risultato Nominatim nei singoli campi indirizzo
export const parseIndirizzo = (luogo) => {
  const a = luogo.address || {};
  const via = a.road || a.pedestrian || a.suburb || "";
  const civico = a.house_number ? ` ${a.house_number}` : "";
  let prov = a.county || "";
  prov = prov.replace("Provincia di ", "").replace("Città Metropolitana di ", "");
  return {
    indirizzo: `${via}${civico}`.trim(),
    cap: a.postcode || "",
    citta: a.city || a.town || a.village || "",
    provincia: prov
  };
};

// Compone un indirizzo leggibile dai dati grezzi di Nominatim
export const formattaIndirizzoPulito = (luogo) => {
  const addr = luogo.address || {};
  const via = addr.road || addr.pedestrian || addr.suburb || "";
  const civico = addr.house_number ? ` ${addr.house_number}` : "";
  const cap = addr.postcode ? `, CAP ${addr.postcode}` : "";
  const citta = addr.city || addr.town || addr.village || "";
  let prov = addr.county || "";
  prov = prov.replace("Provincia di ", "").replace("Città Metropolitana di ", "");
  return `${via}${civico}${cap}, ${citta}${prov ? ` (${prov})` : ""}`.trim().replace(/^,/, '').trim();
};
