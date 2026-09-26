// Banco di prova del costo dei campi e del loro ricalcolo. Non fa parte dell'app: si esegue con
//   npm run prova:campi
// Gira in Node senza dev server né browser, perché campi.js è fatto di sole funzioni pure.
import { costiCampoDi, ricalcoloCampo } from './campi.js';

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

const falliti = esiti.filter(e => !e.ok);
esiti.forEach(e => console.log(`${e.ok ? 'ok  ' : 'NO  '} ${e.caso}${e.ok ? '' : `\n      atteso ${JSON.stringify(e.atteso)}\n      ottenuto ${JSON.stringify(e.ottenuto)}`}`));
console.log(`\n${esiti.length - falliti.length}/${esiti.length} verifiche superate`);
process.exit(falliti.length ? 1 : 0);
