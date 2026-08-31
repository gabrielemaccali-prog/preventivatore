import { useState } from 'react';

// Confronto usato dall'ordinamento: numeri per valore, testo con le regole italiane (accenti e
// maiuscole non contano, i numeri dentro le stringhe contano come numeri).
// I valori vuoti finiscono sempre in fondo, sia in salita sia in discesa: sono "dati mancanti",
// non il minimo della colonna, e averli sempre da una parte sola li rende facili da trovare.
const confronta = (a, b) => {
  const aVuoto = a == null || a === '';
  const bVuoto = b == null || b === '';
  if (aVuoto || bVuoto) return aVuoto && bVuoto ? 0 : (aVuoto ? 1 : -1);
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'it', { numeric: true, sensitivity: 'base' });
};

// Ordinamento di una tabella per clic sulla testata.
// `valori` associa a ogni colonna ordinabile la funzione che ne estrae il valore da confrontare
// (una chiave per colonna, non per forza un campo del record: può comporre più campi).
//
// Il ciclo dei clic è: crescente -> decrescente -> nessun ordinamento, così si torna sempre
// all'ordine di partenza della lista senza dover ricaricare la pagina.
export const useOrdinamentoTabella = (valori) => {
  const [ordine, setOrdine] = useState(null); // { chiave, discendente } oppure null

  // Restituisce una copia ordinata: la lista in ingresso non viene toccata.
  const ordina = (righe) => {
    const estrai = ordine && valori[ordine.chiave];
    if (!estrai) return righe;
    const segno = ordine.discendente ? -1 : 1;
    return [...righe].sort((a, b) => segno * confronta(estrai(a), estrai(b)));
  };

  const propsTestata = (chiave) => ({
    onClick: () => setOrdine(prev => {
      if (!prev || prev.chiave !== chiave) return { chiave, discendente: false };
      return prev.discendente ? null : { chiave, discendente: true };
    }),
    title: 'Ordina per questa colonna',
    style: { cursor: 'pointer', userSelect: 'none' },
  });

  // Freccia da accodare all'etichetta della colonna attualmente ordinata.
  const frecciaOrdinamento = (chiave) => (ordine?.chiave === chiave ? (ordine.discendente ? ' \u25be' : ' \u25b4') : '');

  return { ordina, propsTestata, frecciaOrdinamento };
};
