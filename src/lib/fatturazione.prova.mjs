// Banco di prova dell'abbinamento fra le fatture dell'export e le partite. Non fa parte dell'app:
// si esegue con
//   npm run prova:fatturazione
// Gira in Node senza dev server né browser, perché fatturazione.js è fatto di sole funzioni pure.
import { abbinaFatture, daFatturarePrenotazione, daFatturareVoucher } from './fatturazione.js';
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

// ---------- un voucher intestato a un'azienda ----------
// Nasce dal posticipo di una partita di un'azienda: la fattura arriva con la partita IVA e la
// ragione sociale, e il voucher si deve riconoscere lo stesso.
const voucherAzienda = {
  codice: 'VCH-2026-1001', dataEmissione: '2026-10-20', importo: 300, nominativo: 'Rossi Anna',
  fattTipo: 'azienda', ragioneSociale: 'Acme Srl', pIva: '12345678903',
};
const perAzienda = abbinaFatture(
  [{ data: '2026-10-22', numero: '201', cliente: 'Acme Srl', cf: '', piva: '12345678903', centro: '', importo: 300 }],
  { voucher: [voucherAzienda] },
).proposte[0];
verifica('voucher di un\'azienda: trovato per partita IVA', [['VCH-2026-1001', 300]], parti(perAzienda));
verifica('voucher di un\'azienda, importo giusto: certa', true, perAzienda.certa);

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

// ---------- annullata fuori termine: si fattura quello che si e' trattenuto ----------
// La partita non si e' giocata e il prezzo del pacchetto non si deve piu'. Quello che resta da
// fatturare e' l'acconto rimasto a noi, che e' gia' al netto del voucher speso e dei contanti
// che nessuno ha mai ritirato.
const fuoriTermine = { ...cliente, id: 'PRN-9', data: '2026-11-07', stato: STATO_PREN.ANNULLATA, prezzoVendita: 220, incassoTrattenuto: 100 };
verifica('annullata fuori termine: si fattura il trattenuto, non il prezzo', 100, daFatturarePrenotazione(fuoriTermine));
verifica('il trattenuto non si scala di nuovo del voucher ne dei contanti', 100, daFatturarePrenotazione(fuoriTermine, 60, 40));
// Un'annullata dentro i termini invece non ha niente da fatturare: il prezzo non si deve piu' e
// l'acconto se n'e' andato nel voucher, che si fattura per conto suo.
verifica('annullata senza trattenuto: niente da fatturare', 0, daFatturarePrenotazione({ ...fuoriTermine, incassoTrattenuto: null }, 0, 0));
verifica('confermata: dal prezzo si tolgono voucher e contanti', 120, daFatturarePrenotazione({ ...fuoriTermine, stato: STATO_PREN.CONFERMATO, incassoTrattenuto: null }, 60, 40));
// ---------- annullata diventata voucher: soldi e fattura restano sulla partita ----------
const diventataVoucher = { ...fuoriTermine, incassoTrattenuto: null, voucherGenerato: 'BR20261107' };
verifica('annullata diventata voucher: si fattura il valore del voucher', 150, daFatturarePrenotazione(diventataVoucher, 0, 0, 150));
verifica('annullata diventata voucher: il prezzo del pacchetto non conta', 150, daFatturarePrenotazione(diventataVoucher, 60, 40, 150));
verifica('il voucher nato da una partita annullata non si fattura', 0, daFatturareVoucher({ importo: 150, daPosticipo: true }));
verifica('un voucher venduto si fattura per il suo valore', 150, daFatturareVoucher({ importo: 150 }));
const conVoucherPost = abbinaFatture(
  [{ data: '2026-11-08', numero: '210', cliente: 'Rossi Mario', cf: cliente.fattCF, piva: '', centro: '', importo: 150 }],
  { prenotazioni: [diventataVoucher], voucher: [{ codice: 'BR20261107', importo: 150, daPosticipo: true, nominativo: 'Rossi Mario', fattCF: cliente.fattCF }], valoreVoucher: () => 150 },
).proposte[0];
verifica('la fattura di una partita diventata voucher va sulla partita', [['PRN-9', 150]], parti(conVoucherPost));
verifica('confermata: si fattura il prezzo, come sempre', 220, daFatturarePrenotazione({ ...fuoriTermine, stato: STATO_PREN.CONFERMATO, incassoTrattenuto: null }));

// E l'abbinamento la trova: la fattura della penale arriva come tutte le altre.
const penale = abbinaFatture([fattura(100, '110', '2026-11-10')], { prenotazioni: [fuoriTermine] }).proposte[0];
verifica('la fattura della penale si abbina all\'annullata fuori termine', [['PRN-9', 100]], parti(penale));

const falliti = esiti.filter(e => !e.ok);
esiti.forEach(e => console.log(`${e.ok ? 'ok  ' : 'NO  '} ${e.caso}${e.ok ? '' : `\n      atteso ${JSON.stringify(e.atteso)}\n      ottenuto ${JSON.stringify(e.ottenuto)}`}`));
console.log(`\n${esiti.length - falliti.length}/${esiti.length} verifiche superate`);
process.exit(falliti.length ? 1 : 0);
