// Banco di prova della consuntivazione di fornitori e campi. Non fa parte dell'app: si esegue con
//   npm run prova:fornitori
// Gira in Node senza dev server né browser, perché fornitori.js è fatto di sole funzioni pure.
import { risolutoreSedi, daConsuntivareFornitori, daConsuntivareCampi, periodoDaControparte, SEDE_NON_INDICATA } from './fornitori.js';

const esiti = [];
const verifica = (caso, atteso, ottenuto) => {
  const ok = typeof atteso === 'number' ? Math.abs(ottenuto - atteso) < 0.005 : JSON.stringify(atteso) === JSON.stringify(ottenuto);
  esiti.push({ ok, caso, atteso, ottenuto });
};

const sedi = [
  { id: 'loc_bfm', nome: 'BFM', bfm: true },
  { id: 'loc_aq', nome: 'Laquilone', bfm: false },
  { id: 'loc_em', nome: 'E.M. Gonfiabili', bfm: false },
];
const listino = [
  { id: 'g_bubble_bfm', giocoId: 10, locationId: 'loc_bfm' },
  { id: 'g_balilla_aq', giocoId: 11, locationId: 'loc_aq' },
  { id: 'g_balilla_em', giocoId: 11, locationId: 'loc_em' },
];
const preventivi = [
  { codice: 'PRV-AQ', gonfiabili: [{ gonfiabileId: 'g_balilla_aq' }] },
  { codice: 'PRV-MISTO', gonfiabili: [{ gonfiabileId: 'g_balilla_aq' }, { gonfiabileId: 'g_balilla_em' }] },
];
const risolutore = risolutoreSedi({ sedi, listino, preventivi });

// Il caso che ha fatto nascere tutto: a Laquilone dobbiamo 920 per un noleggio (costo ereditato
// dal preventivo, senza righe), e lui ci ha commissionato una partita da 600 netti.
const pren1032 = { id: 'PRN-2026-1032', data: '2026-09-03', stato: 'CONF', nominativo: 'Beatrice', ereditaCosti: true, costoEreditato: 920, preventivoCollegato: 'PRV-AQ', voci: null, giocoId: 11, prezzoVenditaNetto: 1250 };
const pren1047 = { id: 'PRN-2026-1047', data: '2026-09-06', stato: 'CONF', nominativo: 'Ezio', ereditaCosti: false, voci: null, giocoId: 10, prezzoVenditaNetto: 600, prezzoVendita: 732, clienteSedeId: 'loc_aq' };

// ---------- da quale sede arriva il costo ----------
verifica('costo ereditato: sede dal preventivo', { Laquilone: { costo: 920, giochi: [] } }, risolutore.costiPerSede(pren1032));
verifica('partita su un nostro campo: nessun fornitore', {}, risolutore.costiPerSede({ campoId: 'c1', ereditaCosti: true, costoEreditato: 100 }));
verifica('righe per gioco: la nostra sede non è un costo', { 'E.M. Gonfiabili': { costo: 765, giochi: ['Calcio Balilla Umano'] } }, risolutore.costiPerSede({
  voci: [{ nome: 'Calcio Balilla Umano', sede: 'E.M. Gonfiabili', costo: 765 }, { nome: 'Bubble Football', sede: 'BFM', costo: 190 }],
}));
verifica('preventivo con due sedi: non si sceglie a caso', SEDE_NON_INDICATA, risolutore.sedeDiRipiego({ preventivoCollegato: 'PRV-MISTO' }));

// ---------- compensazione ----------
const base = { prenotazioni: [pren1032, pren1047], sedi, risolutore };
const { controparti: fornitori, senzaControparte: senzaFornitore } = daConsuntivareFornitori(base);
const aq = fornitori.find(f => f.controparte.id === 'loc_aq');
verifica('Laquilone: un costo e un ricavo', ['costo', 'ricavo'], aq.righe.map(r => r.lato));
verifica('Laquilone: costo 920', 920, aq.costo);
verifica('Laquilone: ricavo 600 netti', 600, aq.ricavo);
verifica('Laquilone: gli paghiamo 320', 320, aq.saldo);
verifica('Laquilone: periodo dalla prima all\'ultima partita', ['2026-09-03', '2026-09-06'], [aq.dal, aq.al]);
verifica('nessun costo senza fornitore', 0, senzaFornitore.length);

// ---------- rettifiche ----------
const voci = [
  { controparte_id: 'loc_aq', riferimento: 'PRN-2026-1032', lato: 'costo', importo: -20 },
  { controparte_id: 'loc_aq', riferimento: 'PRN-2026-1047', lato: 'costo', importo: 999 }, // lato sbagliato: non tocca il ricavo
];
const conRettifiche = daConsuntivareFornitori({ ...base, voci }).controparti.find(f => f.controparte.id === 'loc_aq');
verifica('rettifica: il preventivato resta 920', 920, conRettifiche.costoPreventivato);
verifica('rettifica: il consuntivato scende a 900', 900, conRettifiche.costo);
verifica('rettifica: il saldo scende a 300', 300, conRettifiche.saldo);

// ---------- periodi chiusi ----------
const periodi = [{ controparte_id: 'loc_aq', dal: '2026-09-01', al: '2026-09-04' }];
const dopoPeriodo = daConsuntivareFornitori({ ...base, periodi }).controparti.find(f => f.controparte.id === 'loc_aq');
verifica('periodo chiuso: resta solo la partita fuori', ['PRN-2026-1047'], dopoPeriodo.righe.map(r => r.riferimento));
verifica('periodo chiuso: il saldo diventa un credito', -600, dopoPeriodo.saldo);

// ---------- esclusioni ----------
const forse = { ...pren1032, id: 'PRN-FORSE', stato: 'FORSE' };
verifica('una FORSE non si consuntiva', 1, daConsuntivareFornitori({ ...base, prenotazioni: [forse, pren1047] }).controparti[0].righe.length);
const ignota = { id: 'PRN-X', data: '2026-09-10', stato: 'CONF', ereditaCosti: true, costoEreditato: 50, voci: null };
verifica('costo di sede ignota: segnalato, non perso', [{ sede: SEDE_NON_INDICATA, costo: 50 }],
  daConsuntivareFornitori({ ...base, prenotazioni: [ignota] }).senzaControparte.map(s => ({ sede: s.nome, costo: s.costo })));

// ---------- fotografia ----------
const foto = periodoDaControparte(aq, 'fornitore', '2026-09-16');
verifica('fotografia: totali', [920, 920, 600, 320], [foto.costo_preventivato, foto.costo, foto.ricavo, foto.saldo]);
verifica('fotografia: le righe non si portano dietro la prenotazione', false, foto.righe.some(r => 'prenotazione' in r || 'voci' in r));

// ---------- dettaglio del costo: tariffa + km + extra ----------
// Il preventivo vero della 1032: 600 di tariffa e 310,67 di logistica, arrotondati a 920.
const preventiviDettaglio = [
  { codice: 'PRV-AQ', gonfiabili: [{ gonfiabileId: 'g_balilla_aq', sedePartenza: 'Laquilone', costoNoleggio: 600, costoLogistica: 310.6704, kmCalcolati: 129.446 }], extras: [{ nome: 'Pernotto', costo: 100 }] },
  { codice: 'PRV-BFM', gonfiabili: [{ gonfiabileId: 'g_bubble_bfm', sedePartenza: 'BFM', costoNoleggio: 0, costoLogistica: 182.85 }], extras: [{ nome: 'Pernotto', costo: 100 }] },
];
const conDettaglio = risolutoreSedi({ sedi, listino, preventivi: preventiviDettaglio });
verifica('dettaglio: tariffa, km ed extra dal preventivo', { tariffa: 600, km: 310.67, kmPercorsi: 129.45, extra: 100, concordato: false },
  conDettaglio.dettaglioCostoDi({ preventivoCollegato: 'PRV-AQ' }, 'Laquilone'));
verifica('dettaglio: senza preventivo non si inventa', null, conDettaglio.dettaglioCostoDi({ preventivoCollegato: null }, 'Laquilone'));
verifica('dettaglio: di un altro fornitore non dice niente', null, conDettaglio.dettaglioCostoDi({ preventivoCollegato: 'PRV-AQ' }, 'E.M. Gonfiabili'));

const vociAq = [{ nome: 'Calcio Balilla Umano', sede: 'Laquilone', costo: 920, giocoId: 11 }, { nome: 'Pernotto', sede: '—', costo: 100, giocoId: null }];
verifica("extra su preventivo di un fornitore: si paga a lui", { Laquilone: { costo: 1020, giochi: ['Calcio Balilla Umano', 'Pernotto'] } },
  conDettaglio.costiPerSede({ preventivoCollegato: 'PRV-AQ', voci: vociAq }));
verifica('extra su partita nostra: resta un costo, di nessun fornitore', { '—': { costo: 100, giochi: ['Pernotto'] } },
  conDettaglio.costiPerSede({ preventivoCollegato: 'PRV-BFM', voci: [{ nome: 'Bubble', sede: 'BFM', costo: 190, giocoId: 10 }, { nome: 'Pernotto', sede: '—', costo: 100, giocoId: null }] }));
const nostraConExtra = { id: 'PRN-BFM', data: '2026-09-05', stato: 'CONF', preventivoCollegato: 'PRV-BFM', voci: [{ nome: 'Pernotto', sede: '—', costo: 100, giocoId: null }] };
verifica('extra su partita nostra: non è un avviso di fornitore mancante', 0,
  daConsuntivareFornitori({ prenotazioni: [nostraConExtra], sedi, risolutore: conDettaglio }).senzaControparte.length);
const rigaAq = daConsuntivareFornitori({ prenotazioni: [{ ...pren1032, voci: vociAq }], sedi, risolutore: conDettaglio }).controparti[0].righe[0];
verifica('la riga di costo porta il dettaglio, e la fotografia lo congela', [100, 100],
  [rigaAq.dettaglio.extra, periodoDaControparte({ controparte: sedi[1], righe: [rigaAq], costoPreventivato: 0, costo: 0, ricavo: 0, saldo: 0 }, 'fornitore', '2026-09-16').righe[0].dettaglio.extra]);

// ---------- tipi di controparte: le voci di un campo non toccano un fornitore ----------
const vociMiste = [{ controparte: 'campo', controparte_id: 'loc_aq', riferimento: 'PRN-2026-1032', lato: 'costo', importo: -500 }];
verifica('una voce di campo non rettifica un fornitore con lo stesso id', 920,
  daConsuntivareFornitori({ ...base, voci: vociMiste }).controparti.find(f => f.controparte.id === 'loc_aq').costo);
verifica('fotografia: dice di che controparte è', ['fornitore', 'loc_aq'], [foto.controparte, foto.controparte_id]);

// ---------- campi: affitto + rinfresco ----------
const campiAnagrafica = [{ id: 'cmp_q', nome: 'Quintosole' }, { id: 'cmp_c', nome: 'Comasina' }];
const partitaCampo = { id: 'PRN-C1', data: '2026-09-13', stato: 'CONF', nominativo: 'Marco', campoId: 'cmp_q', campoNome: 'Quintosole', costoCampoNetto: 45.08196721311476, costoRinfrescoNetto: 98.36065573770492, prezzoVenditaNetto: 400 };
const soloAffitto = { id: 'PRN-C2', data: '2026-09-12', stato: 'CONF', campoId: 'cmp_q', costoCampo: 61, costoRinfrescoNetto: 0 };
const commissionata = { id: 'PRN-C3', data: '2026-09-14', stato: 'CONF', campoId: null, prezzoVenditaNetto: 150, clienteCampoId: 'cmp_q' };
const campiBase = { prenotazioni: [partitaCampo, soloAffitto, commissionata], campi: campiAnagrafica };
const quintosole = daConsuntivareCampi(campiBase).controparti.find(c => c.controparte.id === 'cmp_q');
verifica('campo: affitto e rinfresco separati', { affitto: 45.08, rinfresco: 98.36 }, quintosole.righe.find(r => r.riferimento === 'PRN-C1').dettaglio);
verifica('campo: senza netto salvato, il lordo si scorpora', 50, quintosole.righe.find(r => r.riferimento === 'PRN-C2').preventivato);
verifica('campo: costo = affitto + rinfresco di tutte le partite', 193.44, quintosole.costo);
verifica('campo: la partita commissionata è un credito', 150, quintosole.ricavo);
verifica('campo: saldo', 43.44, quintosole.saldo);
verifica('campo: una partita senza campo non è di nessun campo', 1, daConsuntivareCampi(campiBase).controparti.length);
verifica('campo: un periodo di fornitore non chiude un campo', 3,
  daConsuntivareCampi({ ...campiBase, periodi: [{ controparte: 'fornitore', controparte_id: 'cmp_q', dal: '2026-09-01', al: '2026-09-30' }] }).controparti[0].righe.length);
verifica('campo: il suo periodo sì', 0,
  daConsuntivareCampi({ ...campiBase, periodi: [{ controparte: 'campo', controparte_id: 'cmp_q', dal: '2026-09-01', al: '2026-09-30' }] }).controparti.length);
verifica('campo: rettifica sul rinfresco', 183.44,
  daConsuntivareCampi({ ...campiBase, voci: [{ controparte: 'campo', controparte_id: 'cmp_q', riferimento: 'PRN-C1', lato: 'costo', importo: -10 }] }).controparti[0].costo);
const campoIgnoto = { id: 'PRN-C4', data: '2026-09-10', stato: 'CONF', campoId: 'cmp_sparito', campoNome: 'Vecchio', costoCampoNetto: 40 };
verifica('campo tolto dall\'anagrafica: segnalato, non perso', [{ nome: 'Vecchio', costo: 40 }],
  daConsuntivareCampi({ prenotazioni: [campoIgnoto], campi: campiAnagrafica }).senzaControparte.map(x => ({ nome: x.nome, costo: x.costo })));

const falliti = esiti.filter(e => !e.ok);
esiti.forEach(e => console.log(`${e.ok ? 'ok  ' : 'NO  '} ${e.caso}${e.ok ? '' : ` — atteso ${JSON.stringify(e.atteso)}, ottenuto ${JSON.stringify(e.ottenuto)}`}`));
console.log(`\n${esiti.length - falliti.length}/${esiti.length} verifiche passate`);
process.exit(falliti.length ? 1 : 0);
