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

// Arrotondamento automatico alla decina superiore
export const arrotondaAllaDecina = (valore) => {
  return Math.ceil(valore / 10) * 10;
};

// Per i gonfiabili con sede di partenza "BFM - Milano" non si applica il moltiplicatore target
export const isPartenzaBFMMilano = (partenza) => {
  const nomeSede = (partenza?.nome || "").toLowerCase();
  return nomeSede.includes("bfm") && nomeSede.includes("milano");
};

export const moltiplicatoreTargetPer = (partenza) => isPartenzaBFMMilano(partenza) ? 1 : MOLTIPLICATORE_TARGET;

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
