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
