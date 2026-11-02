// Le scelte e le regole delle missioni di Albatros: funzioni pure, provate da calcolo.prova.mjs.

export const STATI_MISSIONE = [
  { id: 'aperta', label: 'Aperta' },
  { id: 'in_corso', label: 'In corso' },
  { id: 'in_attesa', label: 'In attesa' },
  { id: 'chiusa', label: 'Chiusa' },
];
export const PRIORITA_MISSIONE = [
  { id: 'alta', label: 'Alta' },
  { id: 'normale', label: 'Normale' },
  { id: 'bassa', label: 'Bassa' },
];
export const etichettaStato = (id) => STATI_MISSIONE.find(s => s.id === id)?.label || id;
export const etichettaPriorita = (id) => PRIORITA_MISSIONE.find(p => p.id === id)?.label || id;

// Non chiusa: è quello che conta il numero accanto a "Missioni" nel menu.
export const missioneAperta = (m) => m?.stato !== 'chiusa';

// Scaduta: non chiusa e con la scadenza prima di oggi (oggi stesso non è ancora scaduta).
export const missioneScaduta = (m, oggi) => missioneAperta(m) && !!m?.scadenza && m.scadenza < oggi;

// L'ordine dell'elenco: prima le non chiuse; tra queste la priorità più alta, poi la scadenza più
// vicina (chi non ne ha va dopo), poi la più vecchia. Le chiuse in fondo, le ultime chiuse in cima.
const pesoPriorita = (p) => { const i = PRIORITA_MISSIONE.findIndex(x => x.id === p); return i < 0 ? 1 : i; };
export function confrontaMissioni(a, b) {
  const apertaA = missioneAperta(a), apertaB = missioneAperta(b);
  if (apertaA !== apertaB) return apertaA ? -1 : 1;
  if (!apertaA) return String(b.chiusa_il || '').localeCompare(String(a.chiusa_il || ''));
  const p = pesoPriorita(a.priorita) - pesoPriorita(b.priorita);
  if (p) return p;
  if (a.scadenza !== b.scadenza) {
    if (!a.scadenza) return 1;
    if (!b.scadenza) return -1;
    return a.scadenza < b.scadenza ? -1 : 1;
  }
  return String(a.creato_il || '').localeCompare(String(b.creato_il || ''));
}

// I campi che cambiano passando a un nuovo stato: chiusa_il si segna chiudendo e si toglie riaprendo.
export const campiCambioStato = (missione, nuovoStato, adesso = new Date()) => ({
  stato: nuovoStato,
  chiusa_il: nuovoStato === 'chiusa' ? (missione?.stato === 'chiusa' ? missione.chiusa_il : adesso.toISOString()) : null,
});

// --- Sotto-attività ---
export const attivitaFatta = (a) => !!a?.fatta_il;
export const attivitaScaduta = (a, oggi) => !attivitaFatta(a) && !!a?.scadenza && a.scadenza < oggi;
export const avanzamento = (attivita) => ({ fatte: (attivita || []).filter(attivitaFatta).length, totale: (attivita || []).length });

// Lo stato in cui deve passare la missione dopo che le sue attività sono cambiate, o null se resta
// com'è: fatte tutte si chiude; se una torna da fare (o se ne aggiunge una) una missione chiusa si
// riapre "in corso". Una missione senza attività non si tocca: la si chiude a mano.
export function statoDopoAttivita(missione, attivita) {
  const { fatte, totale } = avanzamento(attivita);
  if (totale === 0) return null;
  if (fatte === totale) return missione.stato === 'chiusa' ? null : 'chiusa';
  return missione.stato === 'chiusa' ? 'in_corso' : null;
}
