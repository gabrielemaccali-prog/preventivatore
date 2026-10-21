// Banco di prova dell'abbinamento fra le fatture dell'export e le partite. Non fa parte dell'app:
// si esegue con
//   npm run prova:fatturazione
// Gira in Node senza dev server né browser, perché fatturazione.js è fatto di sole funzioni pure.
import { abbinaFatture } from './fatturazione.js';
import { STATO_PREN } from './costanti.js';

const esiti = [];
const verifica = (caso, atteso, ottenuto) => {
  const ok = typeof atteso === 'number' ? Math.abs(ottenuto - atteso) < 0.005 : JSON.stringify(atteso) === JSON.stringify(ottenuto);
  esiti.push({ ok, caso, atteso, ottenuto });
};
const parti = (pr) => pr.ripartizione.map(r => [r.riferimento, r.importo]);

// Lo stesso cliente, riconoscibile per codice fiscale, con due feste a ottobre e una a dicembre.
const cliente = { stato: STATO_PREN.CONFERMATO, nominativo: 'Rossi Anna', fattTipo: 'privato', fattNome: 'Anna', fattCognome: 'Rossi', fattCF: 'RSSNNA80A41F205X' };
const p1 = { ...cliente, id: 'PRN-1', data: '2026-10-04', prezzoVendita: 300 };
const p2 = { ...cliente, id: 'PRN-2', data: '2026-10-11', prezzoVendita: 220 };
const p3 = { ...cliente, id: 'PRN-3', data: '2026-12-06', prezzoVendita: 400 };
const fattura = (importo, numero = '101', data = '2026-10-15') => ({ data, numero, cliente: 'Rossi Anna', cf: 'RSSNNA80A41F205X', piva: '', centro: '', importo });

// ---------- una fattura, una partita: come prima ----------
const una = abbinaFatture([fattura(300)], { prenotazioni: [p1, p2, p3] }).proposte[0];
verifica('importo di una partita sola: va su quella', [['PRN-1', 300]], parti(una));
verifica('una partita sola, per CF e importo giusto: certa', true, una.certa);

// ---------- una fattura, due partite ----------
const due = abbinaFatture([fattura(520)], { prenotazioni: [p1, p2, p3] }).proposte[0];
verifica('somma di due partite: ripartita, ognuna col suo resto', [['PRN-1', 300], ['PRN-2', 220]], parti(due));
verifica('ripartizione unica, per CF: certa', true, due.certa);
verifica('il motivo dice la ripartizione', true, due.motivi.includes('ripartita su 2 partite'));

// Già fatturata in parte: la ripartizione usa quanto resta, non il prezzo pieno.
const parziale = abbinaFatture([fattura(420)], {
  prenotazioni: [p1, p2], fatture: [{ tipo: 'prenotazione', riferimento: 'PRN-1', numero: '90', data: '2026-10-04', importo: 100 }],
}).proposte[0];
verifica('ripartizione sul resto da fatturare', [['PRN-1', 200], ['PRN-2', 220]], parti(parziale));

// I contanti non si fatturano: senza toglierli 300 + 220 non tornerebbe con una fattura da 470.
const conContanti = abbinaFatture([fattura(470)], { prenotazioni: [p1, p2], inContanti: (id) => (id === 'PRN-1' ? 50 : 0) }).proposte[0];
verifica('il contante esce dal resto, come nella tabella', [['PRN-1', 250], ['PRN-2', 220]], parti(conContanti));

// Due combinazioni danno lo stesso totale: si propone, ma va verificata.
const p4 = { ...cliente, id: 'PRN-4', data: '2026-10-18', prezzoVendita: 300 };
const ambigua = abbinaFatture([fattura(520)], { prenotazioni: [p1, p2, p4] }).proposte[0];
verifica('più ripartizioni possibili: da verificare', false, ambigua.certa);
verifica('fra le possibili, la più vicina alla data della fattura', [['PRN-2', 220], ['PRN-4', 300]], parti(ambigua));

// Riconosciuto solo per nome: si propone, ma va verificata.
const perNome = abbinaFatture([{ ...fattura(520), cf: '' }], { prenotazioni: [p1, p2] }).proposte[0];
verifica('ripartizione per solo nome: da verificare', [false, [['PRN-1', 300], ['PRN-2', 220]]], [perNome.certa, parti(perNome)]);

// Nessuna combinazione fa il totale: resta la proposta su una partita, con l'importo diverso.
const nessuna = abbinaFatture([fattura(999)], { prenotazioni: [p1, p2] }).proposte[0];
verifica('nessuna combinazione: una partita, da verificare', [1, false], [nessuna.ripartizione.length, nessuna.certa]);

// Due righe dello stesso export: la seconda non ricopre le partite già coperte dalla prima.
const dueRighe = abbinaFatture([fattura(520), fattura(400, '102', '2026-12-10')], { prenotazioni: [p1, p2, p3] }).proposte;
verifica('la seconda fattura va sulla partita rimasta', [['PRN-3', 400]], parti(dueRighe[1]));

const falliti = esiti.filter(e => !e.ok);
esiti.forEach(e => console.log(`${e.ok ? 'ok  ' : 'NO  '} ${e.caso}${e.ok ? '' : `\n      atteso ${JSON.stringify(e.atteso)}\n      ottenuto ${JSON.stringify(e.ottenuto)}`}`));
console.log(`\n${esiti.length - falliti.length}/${esiti.length} verifiche superate`);
process.exit(falliti.length ? 1 : 0);
