// Le schede di Albatros. Nel mondo Albatros sono le voci del menu laterale (App.jsx); chi vede quale
// lo dicono i permessi del modulo 'albatros' (SCHEDE_REGISTRY in lib/permessi.js).
export const SCHEDE_ALBATROS = [
  { id: 'missioni', label: 'Missioni', icona: 'missioni' },
  // La Giornata tiene l'id 'chiusure': è la chiave con cui i permessi dei ruoli sono già salvati.
  { id: 'chiusure', label: 'Giornata', icona: 'chiusure' },
  { id: 'storico', label: 'Chiusure', icona: 'storico' },
  // Cassa (i ragazzi) tiene l'id 'spese', il permesso che avevano già; Conti (il responsabile) è nuovo.
  { id: 'spese', label: 'Cassa', icona: 'spese' },
  { id: 'conti', label: 'Conti', icona: 'banca' },
  { id: 'incassi', label: 'Incassi', icona: 'indicatori' },
  { id: 'listino', label: 'Listino', icona: 'listino' },
];
