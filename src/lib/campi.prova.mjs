// Banco di prova del costo dei campi e del loro ricalcolo. Non fa parte dell'app: si esegue con
//   npm run prova:campi
// Gira in Node senza dev server né browser, perché campi.js è fatto di sole funzioni pure.
import { costiCampoDi, ricalcoloCampo, allestimentoDi, costiCampoPrenotazione } from './campi.js';

const esiti = [];
const verifica = (caso, atteso, ottenuto) => {
  const ok = typeof atteso === 'number' ? Math.abs(ottenuto - atteso) < 0.005 : JSON.stringify(atteso) === JSON.stringify(ottenuto);
  esiti.push({ ok, caso, atteso, ottenuto });
};

// Affitto IVA esclusa, rinfresco IVA inclusa, tariffa serale il venerdì (2026-09-25 è venerdì).
const campo = { id: 'cmp_1', costoFlat: 100, ivaCampo: 22, ivaInclusaCampo: false, costoMerenda: 6.1, costoAperitivo: 12.2, ivaRinfresco: 22, ivaInclusaRinfresco: true };
const tariffe = [{ campoId: 'cmp_1', giorni: '5', oraInizio: '19:00', oraFine: '00:00', costo: 150 }];

const flat = costiCampoDi({ campo, tariffe, data: '2026-09-25', oraInizio: '17:00' });
verifica('fuori fascia: la flat, netta', 100, flat.costoCampoNetto);
verifica('fuori fascia: la flat, lorda', 122, flat.costoCampoLordo);
verifica('in fascia fino a mezzanotte', 150, costiCampoDi({ campo, tariffe, data: '2026-09-25', oraInizio: '21:30' }).costoCampoNetto);
verifica('altro giorno: la flat', 100, costiCampoDi({ campo, tariffe, data: '2026-09-26', oraInizio: '21:30' }).costoCampoNetto);
const merenda = costiCampoDi({ campo, tariffe, data: '2026-09-25', oraInizio: '17:00', tipoRinfresco: 'merenda', numeroPartecipanti: 10 });
verifica('rinfresco IVA inclusa: lordo', 61, merenda.costoRinfrescoLordo);
verifica('rinfresco IVA inclusa: netto', 50, merenda.costoRinfrescoNetto);
verifica('senza rinfresco nel pacchetto: zero', 0, costiCampoDi({ campo, tariffe, data: '2026-09-25', oraInizio: '17:00', tipoRinfresco: null, numeroPartecipanti: 10 }).costoRinfrescoNetto);

// ---------- piu' campi nella stessa ora ----------
// Due campi affiancati sono due ore che il centro fattura: raddoppia l'affitto, non il rinfresco,
// che segue le persone.
const due = costiCampoDi({ campo, tariffe, data: '2026-09-25', oraInizio: '17:00', tipoRinfresco: 'merenda', numeroPartecipanti: 10, campiOccupati: 2 });
verifica('due campi: affitto raddoppiato', 200, due.costoCampoNetto);
verifica('due campi: rinfresco invariato', 50, due.costoRinfrescoNetto);
verifica('due campi in fascia serale', 300, costiCampoDi({ campo, tariffe, data: '2026-09-25', oraInizio: '21:30', campiOccupati: 2 }).costoCampoNetto);
verifica('campi non indicati: vale uno', 100, costiCampoDi({ campo, tariffe, data: '2026-09-25', oraInizio: '17:00', campiOccupati: null }).costoCampoNetto);

// ---------- ricalcolo ----------
const prenotazioni = [
  { id: 'P-VECCHIA', campoId: 'cmp_1', data: '2026-09-25', oraInizio: '17:00', costoCampoNetto: 80, costoRinfrescoNetto: 0 },
  { id: 'P-GIUSTA', campoId: 'cmp_1', data: '2026-09-25', oraInizio: '21:00', costoCampoNetto: 150, costoRinfrescoNetto: 0 },
  { id: 'P-CHIUSA', campoId: 'cmp_1', data: '2026-09-01', oraInizio: '17:00', costoCampoNetto: 80, costoRinfrescoNetto: 0 },
  { id: 'P-ALTRO', campoId: 'cmp_2', data: '2026-09-25', oraInizio: '17:00', costoCampoNetto: 80, costoRinfrescoNetto: 0 },
  // Prenotazione antica: solo il lordo, il netto si ricava al 22%.
  { id: 'P-SOLO-LORDO', campoId: 'cmp_1', data: '2026-09-26', oraInizio: '17:00', costoCampo: 122, costoRinfresco: 0 },
];
const periodi = [{ controparte: 'campo', controparte_id: 'cmp_1', dal: '2026-09-01', al: '2026-09-15' }];
const righe = ricalcoloCampo({ campo, tariffe, prenotazioni, periodi });
verifica('solo quelle che cambiano, del campo, fuori dai periodi chiusi', ['P-VECCHIA'], righe.map(r => r.prenotazione.id));
verifica('prima e dopo in netto', { prima: { affitto: 80, rinfresco: 0 }, dopo: { affitto: 100, rinfresco: 0 } }, { prima: righe[0].prima, dopo: righe[0].dopo });
verifica('scrive netto e lordo, e il lordo anche nella colonna storica', [100, 122, 122], [righe[0].rec.costoCampoNetto, righe[0].rec.costoCampoLordo, righe[0].rec.costoCampo]);
verifica('un periodo di un fornitore con lo stesso id non chiude il campo', 1,
  ricalcoloCampo({ campo, tariffe, prenotazioni: [prenotazioni[2]], periodi: [{ controparte: 'fornitore', controparte_id: 'cmp_1', dal: '2026-09-01', al: '2026-09-15' }] }).length);

// ---------- affitto a ore ----------
const comasina = { id: 'cmp_c', costoFlat: 55, ivaCampo: 22, ivaInclusaCampo: false };
verifica('a ore: due ore a 55 €/ora fanno 110', 110, costiCampoDi({ campo: comasina, data: '2026-09-26', oraInizio: '15:00', durataOre: 2 }).costoCampoNetto);
verifica("a ore: dall'ora di fine", 82.5, costiCampoDi({ campo: comasina, data: '2026-09-26', oraInizio: '15:00', oraFine: '16:30' }).costoCampoNetto);
verifica('a ore: a cavallo di due fasce ogni ora paga la sua', 250, costiCampoDi({ campo, tariffe, data: '2026-09-25', oraInizio: '18:00', durataOre: 2 }).costoCampoNetto);
verifica('a ore: senza durata vale un\'ora', 55, costiCampoDi({ campo: comasina, data: '2026-09-26', oraInizio: '15:00' }).costoCampoNetto);

// ---------- allestimento: una volta per blocco di partite continue ----------
const bergamo = { id: 'cmp_b', costoFlat: 60, ivaCampo: 22, ivaInclusaCampo: false, minutiAllestimento: 60 };
const pb = (id, oraInizio, durataOre, extra = {}) => ({ id, campoId: 'cmp_b', data: '2026-09-26', stato: 'CONFERMATO', oraInizio, durataOre, ...extra });
const blocco = [pb('B1', '15:00', 2), pb('B2', '17:00', 2), pb('B3', '21:00', 1)];
verifica('allestimento: la prima del blocco porta la mezz\'ora prima', { prima: 30, dopo: 0 }, allestimentoDi(blocco[0], blocco, bergamo));
verifica('allestimento: l\'ultima porta quella dopo', { prima: 0, dopo: 30 }, allestimentoDi(blocco[1], blocco, bergamo));
verifica('allestimento: una partita da sola le porta tutte e due', { prima: 30, dopo: 30 }, allestimentoDi(blocco[2], blocco, bergamo));
verifica('allestimento: B1 = 2 ore + mezz\'ora', 150, costiCampoPrenotazione(blocco[0], { campo: bergamo, altre: blocco }).costoCampoNetto);
verifica('allestimento: stacco più corto dell\'allestimento, stesso blocco', { prima: 0, dopo: 30 },
  allestimentoDi(pb('B5', '17:30', 1), [pb('B4', '15:00', 2), pb('B5', '17:30', 1)], bergamo));
verifica('allestimento: le annullate non fanno blocco', { prima: 30, dopo: 30 },
  allestimentoDi(blocco[1], [blocco[0], blocco[1]].map((x, i) => (i === 0 ? { ...x, stato: 'ANNULLATA' } : x)), bergamo));
verifica('allestimento: senza minuti nel configuratore niente', { prima: 0, dopo: 0 }, allestimentoDi(blocco[2], blocco, comasina));
verifica('allestimento: due campi, doppio anche il montaggio', 300, costiCampoPrenotazione({ ...blocco[0], campiOccupati: 2 }, { campo: bergamo, altre: blocco }).costoCampoNetto);

// ---------- bar di un'altra società: affitto e rinfresco si chiudono a parte ----------
// Affitto salvato 80 (le tariffe dicono 100), merenda per 10 salvata 40 (le tariffe dicono 50).
const campoBar = { ...campo, barSeparato: true };
const conMerenda = { id: 'P-BAR', campoId: 'cmp_1', data: '2026-09-25', oraInizio: '17:00', tipoRinfresco: 'merenda', numeroPartecipanti: 10, costoCampoNetto: 80, costoRinfrescoNetto: 40 };
const perRighe = (id, dettaglio) => ({ controparte: 'campo', controparte_id: id, per_righe: true, dal: '2026-09-25', al: '2026-09-25', righe: [{ riferimento: 'P-BAR', lato: 'costo', dettaglio }] });
const soloAffittoPagato = ricalcoloCampo({ campo: campoBar, tariffe, prenotazioni: [conMerenda], periodi: [perRighe('cmp_1', { affitto: 80, rinfresco: 0 })] })[0];
verifica("bar separato, affitto pagato: si ricalcola il rinfresco", [{ affitto: 80, rinfresco: 50 }, ['costoRinfresco', 'costoRinfrescoNetto', 'costoRinfrescoLordo']],
  [soloAffittoPagato.dopo, Object.keys(soloAffittoPagato.rec)]);
const soloBarPagato = ricalcoloCampo({ campo: campoBar, tariffe, prenotazioni: [conMerenda], periodi: [perRighe('cmp_1:bar', { affitto: 0, rinfresco: 40 })] })[0];
verifica("bar separato, rinfresco pagato: si ricalcola l'affitto", [{ affitto: 100, rinfresco: 40 }, ['costoCampo', 'costoCampoNetto', 'costoCampoLordo']],
  [soloBarPagato.dopo, Object.keys(soloBarPagato.rec)]);
verifica('bar separato, tutti e due pagati: niente da ricalcolare', 0,
  ricalcoloCampo({ campo: campoBar, tariffe, prenotazioni: [conMerenda], periodi: [perRighe('cmp_1', { affitto: 80, rinfresco: 0 }), perRighe('cmp_1:bar', { affitto: 0, rinfresco: 40 })] }).length);
verifica('bar separato: un periodo di prima della separazione ha pagato anche il rinfresco', 0,
  ricalcoloCampo({ campo: campoBar, tariffe, prenotazioni: [conMerenda], periodi: [perRighe('cmp_1', { affitto: 80, rinfresco: 40 })] }).length);
verifica('senza bar separato il periodo del campo chiude tutto, come prima', 0,
  ricalcoloCampo({ campo, tariffe, prenotazioni: [conMerenda], periodi: [perRighe('cmp_1', { affitto: 80, rinfresco: 0 })] }).length);

const falliti = esiti.filter(e => !e.ok);
esiti.forEach(e => console.log(`${e.ok ? 'ok  ' : 'NO  '} ${e.caso}${e.ok ? '' : `\n      atteso ${JSON.stringify(e.atteso)}\n      ottenuto ${JSON.stringify(e.ottenuto)}`}`));
console.log(`\n${esiti.length - falliti.length}/${esiti.length} verifiche superate`);
process.exit(falliti.length ? 1 : 0);
