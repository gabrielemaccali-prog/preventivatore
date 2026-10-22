import * as XLSX from 'xlsx'

// ============================================================
// Scarico in Excel di tabelle già pronte: un foglio per elenco di righe, le chiavi della prima riga
// fanno da intestazione. Le schede che esportano preparano le righe con i numeri come numeri, così
// in Excel si sommano senza riconvertirli.
// ============================================================

// Excel rifiuta nei nomi dei fogli i caratteri []:*?/\ e oltre 31 caratteri.
const nomeFoglio = (nome) => String(nome || 'Foglio').replace(/[[\]:*?/\\]/g, ' ').slice(0, 31);
// Il nome del file nasce spesso dal nome di un fornitore o di una persona: niente caratteri che
// Windows non accetta.
const nomeFile = (nome) => String(nome || 'export').replace(/[<>:"/\\|?*]+/g, ' ').replace(/\s+/g, '_');

export const scaricaExcel = (file, fogli) => {
  const wb = XLSX.utils.book_new();
  const usati = new Set();
  fogli.forEach(({ nome, righe }) => {
    // Due fogli con lo stesso nome fanno fallire il file intero.
    let n = nomeFoglio(nome);
    for (let i = 2; usati.has(n); i++) n = `${nomeFoglio(nome).slice(0, 28)} ${i}`;
    usati.add(n);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(righe.length ? righe : [{ '': 'Nessuna riga' }]), n);
  });
  XLSX.writeFile(wb, `${nomeFile(file)}.xlsx`);
};
