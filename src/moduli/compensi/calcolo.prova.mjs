// Banco di prova del motore compensi. Non fa parte dell'app: si esegue con
//   npm run prova:compensi
// Gira in Node senza dev server né browser, perché calcolo.js è fatto di sole funzioni pure.
import {
  preventivoGiornata, lordizza, preventiviPerOperatore, consuntivoDiPeriodo, blocchiDiGiornata,
} from './calcolo.js';

const par = {
  prima_ora: 30, ora_successiva: 10, tetto_giornaliero: 120,
  bonus_recensione: 5, aliquota_ritenuta: 20, gap_consecutivita_min: 60,
};

const r2 = (n) => Math.round(n * 100) / 100;
const esiti = [];
const verifica = (caso, atteso, ottenuto) => {
  const ok = typeof atteso === 'number' ? Math.abs(ottenuto - atteso) < 0.005 : atteso === ottenuto;
  esiti.push({ ok, caso, atteso, ottenuto: typeof ottenuto === 'number' ? r2(ottenuto) : ottenuto });
};

const giornata = (partite) => preventivoGiornata(partite, par);

// ---------- blocchi e tariffe ----------
verifica('2h+1h attaccate', 50, giornata([
  { oraInizio: '14:00', oraFine: '16:00' }, { oraInizio: '16:00', oraFine: '17:00' },
]).compenso);

verifica('stacco 60min: attesa pagata', 60, giornata([
  { oraInizio: '14:00', oraFine: '16:00' }, { oraInizio: '17:00', oraFine: '18:00' },
]).compenso);

verifica('stacco 61min: due blocchi', 70, giornata([
  { oraInizio: '14:00', oraFine: '16:00' }, { oraInizio: '17:01', oraFine: '18:01' },
]).compenso);

verifica('mezz-ora oltre la prima', 35, giornata([{ oraInizio: '14:00', oraFine: '15:30' }]).compenso);
verifica('tetto giornaliero', 120, giornata([{ oraInizio: '08:00', oraFine: '20:00' }]).compenso);
verifica('durata fissa da pacchetto', 40, giornata([{ oraInizio: '14:00', durataOre: 2 }]).compenso);
verifica('mezzanotte attraversata', 40, giornata([{ oraInizio: '22:00', oraFine: '00:00' }]).compenso);

const sovrapposte = giornata([{ oraInizio: '14:00', oraFine: '16:00' }, { oraInizio: '14:00', oraFine: '15:00' }]);
verifica('sovrapposte: nessuna attesa negativa', 0, sovrapposte.oreAttesa);
verifica('sovrapposte: si paga il lavorato', 50, sovrapposte.compenso);

const conAttesa = blocchiDiGiornata([
  { id: 'A', oraInizio: '14:00', oraFine: '16:00' }, { id: 'B', oraInizio: '17:00', oraFine: '18:00' },
], 60);
verifica('attesa attribuita alla partita che segue', 2, conAttesa[0].partite[1].oreAttribuite);
verifica('la partita prima non porta attesa', 2, conAttesa[0].partite[0].oreAttribuite);

// ---------- lordizzazione ----------
verifica('lordizza 45 al 20%', 56.25, lordizza(45, 20).lordo);
verifica('ritenuta su 45 al 20%', 11.25, lordizza(45, 20).ritenuta);
verifica('aliquota zero: nessuna ritenuta', 45, lordizza(45, 0).lordo);

// ---------- la giornata di Edoardo, completa ----------
const partite = [
  { id: 'A', data: '2026-08-01', oraInizio: '14:00', oraFine: '16:00', operatori: [{ id: 'edo', nome: 'Edoardo' }] },
  { id: 'B', data: '2026-08-01', oraInizio: '16:00', oraFine: '17:00', operatori: [{ id: 'edo', nome: 'Edoardo' }] },
];
const voci = [
  { operatore: 'edo', data: '2026-08-01', tipo: 'recensione', riferimento: 'B', importo: 5, esente_ritenuta: false },
  { operatore: 'edo', data: '2026-08-01', tipo: 'spesa', descrizione: 'panino', importo: 3.5, esente_ritenuta: true },
];
const [edo] = preventiviPerOperatore(partite, voci, par);

verifica('Edoardo: compenso orario', 50, edo.compensoOrario);
verifica('Edoardo: recensione', 5, edo.aggiunte);
verifica('Edoardo: spese fuori dal compenso', 3.5, edo.spese);
verifica('Edoardo: compenso preventivo', 55, edo.compenso);

const cons = consuntivoDiPeriodo(edo, { forfettario: 10 }, par);
verifica('Edoardo consuntivo: forfettario', 10, cons.rimborsoForfettario);
verifica('Edoardo consuntivo: imponibile', 45, cons.imponibile);
verifica('Edoardo consuntivo: lordo', 56.25, cons.lordo);
verifica('Edoardo consuntivo: ritenuta', 11.25, cons.ritenuta);
verifica('Edoardo consuntivo: costo azienda', 69.75, cons.costoAzienda);
verifica('Edoardo consuntivo: incassa operatore', 58.5, cons.incassaOperatore);

// Il forfettario non cambia quanto incassa l'operatore, solo la base imponibile.
const senza = consuntivoDiPeriodo(edo, {}, par);
verifica('senza forfettario: incassa uguale', 58.5, senza.incassaOperatore);
verifica('senza forfettario: costa di piu', 72.25, senza.costoAzienda);
verifica('la leva vale il 25% di quanto spostato', 2.5, senza.costoAzienda - cons.costoAzienda);

// Il forfettario non puo' superare il compenso maturato.
verifica('forfettario oltre il compenso viene limitato', 55, consuntivoDiPeriodo(edo, { forfettario: 999 }, par).rimborsoForfettario);
verifica('forfettario pieno: nessuna ritenuta', 0, consuntivoDiPeriodo(edo, { forfettario: 999 }, par).ritenuta);

// ---------- compenso concordato ----------
const conc = consuntivoDiPeriodo(edo, { concordato: 80 }, par);
verifica('concordato sostituisce le ore', 80, conc.base);
verifica('concordato: recensione resta sopra', 85, conc.compensoNetto);
verifica('concordato: costo azienda', r2(85 / 0.8 + 3.5), conc.costoAzienda);
verifica('senza concordato si usa il calcolo', 50, consuntivoDiPeriodo(edo, {}, par).base);

// ---------- una spesa in un giorno senza partite ----------
const soloSpesa = preventiviPerOperatore([], [
  { operatore: 'x', data: '2026-08-02', tipo: 'spesa', importo: 20, esente_ritenuta: true },
], par);
verifica('giorno di sola spesa: esiste comunque', 1, soloSpesa.length);
verifica('giorno di sola spesa: compenso zero', 0, soloSpesa[0].compenso);
verifica('giorno di sola spesa: spesa contata', 20, soloSpesa[0].spese);

// ---------- esito ----------
const falliti = esiti.filter(e => !e.ok);
for (const e of esiti) {
  console.log(`${e.ok ? 'OK  ' : 'FAIL'}  ${e.caso.padEnd(46)} atteso ${e.atteso}  ottenuto ${e.ottenuto}`);
}
console.log(`\n${esiti.length - falliti.length}/${esiti.length} superati`);
if (falliti.length) process.exitCode = 1;
