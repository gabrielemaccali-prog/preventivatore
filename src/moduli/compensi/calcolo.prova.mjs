// Banco di prova del motore compensi. Non fa parte dell'app: si esegue con
//   npm run prova:compensi
// Gira in Node senza dev server né browser, perché calcolo.js è fatto di sole funzioni pure.
import {
  preventivoGiornata, lordizza, preventiviPerOperatore, consuntivoDiPeriodo, blocchiDiGiornata,
  ripartisciSuOre, rettificheForfait, importiRimborso,
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

// ---------- quote per singola partita ----------
// Il riparto e' cronologico: chi apre il blocco si prende la prima ora cara.
// Due partite da 2h attaccate: 30+10 alla prima, 10+10 alla seconda.
const doppia = giornata([
  { id: 'A', oraInizio: '11:00', oraFine: '13:00' }, { id: 'B', oraInizio: '13:00', oraFine: '15:00' },
]);
verifica('giornata doppia: compenso del blocco', 60, doppia.compenso);
verifica('quota di chi apre il blocco', 40, doppia.blocchi[0].partite[0].compenso);
verifica('quota di chi arriva dopo', 20, doppia.blocchi[0].partite[1].compenso);

// L'esempio del progetto: 2h + 1h attaccate fanno 40 e 10.
const edoQuote = giornata([
  { id: 'A', oraInizio: '14:00', oraFine: '16:00' }, { id: 'B', oraInizio: '16:00', oraFine: '17:00' },
]);
verifica('Edoardo: quota della prima partita', 40, edoQuote.blocchi[0].partite[0].compenso);
verifica('Edoardo: quota della seconda', 10, edoQuote.blocchi[0].partite[1].compenso);

// Con un'attesa in mezzo, chi ha fatto aspettare si porta dietro il costo dell'attesa:
// le sue ore attribuite sono 2 (una di attesa e una giocata), pagate a tariffa ridotta.
const attesa = giornata([
  { id: 'A', oraInizio: '14:00', oraFine: '16:00' }, { id: 'B', oraInizio: '17:00', oraFine: '18:00' },
]);
verifica('con attesa: quota di chi precede', 40, attesa.blocchi[0].partite[0].compenso);
verifica("con attesa: quota di chi l'ha causata", 20, attesa.blocchi[0].partite[1].compenso);

// Le quote sommano sempre al compenso della giornata, anche quando il tetto taglia.
const tagliata = giornata([
  { id: 'A', oraInizio: '08:00', oraFine: '14:00' }, { id: 'B', oraInizio: '14:00', oraFine: '20:00' },
]);
const sommaQuote = tagliata.blocchi.flatMap(b => b.partite).reduce((s, x) => s + x.compenso, 0);
verifica('col tetto: le quote sommano al totale', tagliata.compenso, sommaQuote);
verifica('col tetto: il totale resta il tetto', 120, tagliata.compenso);

// Durate diverse: la ripartizione segue le ore, non il numero di partite.
const disuguali = giornata([
  { id: 'A', oraInizio: '10:00', oraFine: '13:00' }, { id: 'B', oraInizio: '13:00', oraFine: '14:00' },
]);
verifica('durate diverse: totale', 60, disuguali.compenso);
verifica('durate diverse: quota della lunga', 50, disuguali.blocchi[0].partite[0].compenso);
verifica('durate diverse: quota della corta', 10, disuguali.blocchi[0].partite[1].compenso);

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

// ---------- riparto del compenso concordato sulle ore ----------
// Tre partite: 2h il 21, 2h il 21, 1h il 30. Totale 5 ore, concordato 500 -> 100 euro/ora.
const perConcordato = [
  { id: 'A', data: '2026-08-21', oraInizio: '11:00', oraFine: '13:00', operatori: [{ id: 'd', nome: 'Diego' }] },
  { id: 'B', data: '2026-08-21', oraInizio: '15:00', oraFine: '17:00', operatori: [{ id: 'd', nome: 'Diego' }] },
  { id: 'C', data: '2026-08-30', oraInizio: '17:00', oraFine: '18:00', operatori: [{ id: 'd', nome: 'Diego' }] },
];
const [prevD] = preventiviPerOperatore(perConcordato, [], par);
verifica('a ore: totale prima del concordato', 110, prevD.compensoOrario);

const spalmato = ripartisciSuOre(prevD, 500, par);
const quoteSpalmate = spalmato.giornate.flatMap(g => g.blocchi.flatMap(b => b.partite))
  .map(x => ({ id: x.partita.id, ore: x.oreAttribuite, quota: x.compenso }));
verifica('concordato: somma delle quote', 500, quoteSpalmate.reduce((s, q) => s + q.quota, 0));
verifica('concordato: quota di 1 ora', 100, quoteSpalmate.find(q => q.id === 'C').quota);
verifica('concordato: quota di 2 ore', 200, quoteSpalmate.find(q => q.id === 'A').quota);
verifica('concordato: le due da 2 ore prendono uguale', true,
  quoteSpalmate.find(q => q.id === 'A').quota === quoteSpalmate.find(q => q.id === 'B').quota);
verifica('concordato: totale operatore', 500, spalmato.compensoOrario);
verifica('concordato: costo azienda', 625, spalmato.costoAzienda);

// Il totale della giornata segue le sue partite, non il calcolo a ore.
verifica('concordato: giornata da 4 ore', 400, spalmato.giornate.find(g => g.data === '2026-08-21').compenso);
verifica('concordato: giornata da 1 ora', 100, spalmato.giornate.find(g => g.data === '2026-08-30').compenso);

// Importo che non si divide esatto: le quote devono comunque sommare al centesimo.
const dispari = ripartisciSuOre(prevD, 100, par);
verifica('concordato indivisibile: somma esatta', 100,
  dispari.giornate.flatMap(g => g.blocchi.flatMap(b => b.partite)).reduce((s, x) => s + x.compenso, 0));

// Il tetto giornaliero non si applica a un importo pattuito a mano.
const lungo = preventiviPerOperatore([
  { id: 'X', data: '2026-08-21', oraInizio: '08:00', oraFine: '20:00', operatori: [{ id: 'd', nome: 'Diego' }] },
], [], par)[0];
verifica('a ore: il tetto morde', 120, lungo.compensoOrario);
verifica('concordato: il tetto non si applica', 300, ripartisciSuOre(lungo, 300, par).compensoOrario);

// Senza ore non c'è divisore: il preventivo resta com'era.
const soloVoci = preventiviPerOperatore([], [
  { operatore: 'd', data: '2026-08-02', tipo: 'spesa', importo: 20, esente_ritenuta: true },
], par)[0];
verifica('concordato senza ore: nessun riparto', 0, ripartisciSuOre(soloVoci, 500, par).compensoOrario);

// ---------- rettifiche che portano il compenso all'importo concordato ----------
const rett = rettificheForfait(prevD, 500);
verifica('forfait: una riga per partita', 3, rett.length);
verifica('forfait: le differenze coprono lo scarto', 390,
  rett.reduce((s, r) => s + r.differenza, 0));
verifica('forfait: quota + differenza tornano alla quota', true,
  rett.every(r => Math.abs((r.calcolato + r.differenza) - r.quota) < 0.005));

// Applicando le rettifiche il calcolo normale arriva da solo al concordato.
const vociForfait = rett.map(r => ({
  operatore: 'd', data: r.data, tipo: 'rettifica', riferimento: r.riferimento,
  descrizione: 'forfait', importo: r.differenza, esente_ritenuta: false,
}));
const [conForfait] = preventiviPerOperatore(perConcordato, vociForfait, par);
verifica('forfait: il compenso arriva al concordato', 500, conForfait.compenso);
verifica('forfait: le ore restano quelle vere', 5, conForfait.ore);

// Le recensioni restano sopra il concordato, non ci finiscono dentro.
const [conForfaitERecensione] = preventiviPerOperatore(perConcordato, [
  ...vociForfait,
  { operatore: 'd', data: '2026-08-30', tipo: 'recensione', riferimento: 'C', importo: 5, esente_ritenuta: false },
], par);
verifica('forfait: la recensione si somma sopra', 505, conForfaitERecensione.compenso);

// Senza ore non si genera nulla.
verifica('forfait senza ore: nessuna rettifica', 0, rettificheForfait(soloVoci, 500).length);

// ---------- importi del documento di rimborso ----------
// L'esempio del PDF: 85 da pagare, di cui 20 di trasferte.
const doc = importiRimborso({ daPagare: 85, trasferte: 20 }, 20);
verifica('documento: imponibile', 81.25, doc.imponibile);
verifica('documento: ritenuta', 16.25, doc.ritenuta);
verifica('documento: netto a pagare', 65, doc.netto);
verifica('documento: rimborsi', 20, doc.rimborsi);
verifica('documento: totale a pagare', 85, doc.totale);
verifica('documento: netto = imponibile - ritenuta', 0, doc.imponibile - doc.ritenuta - doc.netto);

// Il caso di Diego: 165 da pagare, di cui 50 di spesa registrata.
const diego = importiRimborso({ daPagare: 165, spese: 50 }, 20);
verifica('Diego senza trasferte: netto', 115, diego.netto);
verifica('Diego senza trasferte: totale', 165, diego.totale);

// Aggiungendo 10 di trasferta il totale non si muove: cambia il netto, che scende a 105.
const diegoTrasferta = importiRimborso({ daPagare: 165, spese: 50, trasferte: 10 }, 20);
verifica('Diego con trasferta: totale invariato', 165, diegoTrasferta.totale);
verifica('Diego con trasferta: netto scende', 105, diegoTrasferta.netto);
verifica('Diego con trasferta: rimborsi', 60, diegoTrasferta.rimborsi);
verifica('Diego con trasferta: imponibile', 131.25, diegoTrasferta.imponibile);
// La leva vale il 25% di quanto si sposta: 10 spostati fanno 2,50 di ritenuta in meno.
verifica('la trasferta abbassa la ritenuta', 2.5, diego.ritenuta - diegoTrasferta.ritenuta);

// I rimborsi non possono superare quello che c'e' da pagare.
const eccessivo = importiRimborso({ daPagare: 165, spese: 50, trasferte: 999 }, 20);
verifica('rimborsi oltre il totale: limitati', 165, eccessivo.rimborsi);
verifica('rimborsi oltre il totale: nessun compenso', 0, eccessivo.netto);
verifica('rimborsi oltre il totale: nessuna ritenuta', 0, eccessivo.ritenuta);

// Senza rimborsi il totale coincide col netto.
verifica('senza rimborsi: totale = netto', 65, importiRimborso({ daPagare: 65 }, 20).netto);
// Ad aliquota zero non c'e' nulla da lordizzare.
verifica('aliquota zero: imponibile = netto', 65, importiRimborso({ daPagare: 65 }, 0).imponibile);

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
