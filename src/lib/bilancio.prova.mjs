// Banco di prova del bilancio di cassa. Non fa parte dell'app: si esegue con
//   node src/lib/bilancio.prova.mjs
// Gira in Node senza dev server né browser, perché bilancio.js è fatto di sole funzioni pure.
import { costruisciBilancio, ripartizionePrenotazione } from './bilancio.js';

const esiti = [];
const verifica = (caso, atteso, ottenuto) => {
  const ok = typeof atteso === 'number' ? Math.abs(ottenuto - atteso) < 0.005 : JSON.stringify(atteso) === JSON.stringify(ottenuto);
  esiti.push({ ok, caso, atteso, ottenuto });
};

const categorieSpese = [
  { id: 1, nome: 'Struttura', padre_id: null }, { id: 2, nome: 'Banca', padre_id: 1 }, { id: 3, nome: 'Commercialista', padre_id: 1 },
  { id: 4, nome: 'Direttivo', padre_id: null }, { id: 5, nome: 'Rimborso', padre_id: 4 },
  { id: 6, nome: 'Gestione', padre_id: null }, { id: 7, nome: 'Segreteria', padre_id: 6 },
  { id: 8, nome: 'Tasse e imposte', padre_id: null }, { id: 9, nome: 'Segreteria', padre_id: 8 },
];
const categorieIncassi = [{ id: 10, nome: 'Altri Ricavi', padre_id: null }, { id: 11, nome: 'Vendita Attrezzatura', padre_id: 10 }, { id: 12, nome: 'Capitale Sociale', padre_id: null }];
const movimenti = [
  { id: 1, data_contabile: '2026-10-01', importo: 220 },          // prenotazione
  { id: 2, data_contabile: '2026-10-02', importo: 400 },          // voucher
  { id: 3, data_contabile: '2026-10-03', importo: 3733.2, incasso_categoria_id: 11 },
  { id: 4, data_contabile: '2026-10-04', importo: 50 },           // da classificare
  { id: 5, data_contabile: '2026-10-05', importo: -500 },         // campo
  { id: 6, data_contabile: '2026-10-05', importo: -1, onere_spesa_id: 105 }, // commissione del bonifico al campo
  { id: 7, data_contabile: '2026-10-06', importo: -120 },         // commercialista
  { id: 8, data_contabile: '2026-10-07', importo: -990 },         // rimborso direttivo
  { id: 9, data_contabile: '2026-10-08', importo: -300 },         // Albatros
  { id: 10, data_contabile: '2026-10-09', importo: -20 },         // senza spesa
  { id: 11, data_contabile: '2026-10-10', importo: 1000, ignorato: true }, // giroconto
  { id: 12, data_contabile: '2026-11-01', importo: 220 },         // fuori periodo
  { id: 13, data_contabile: '2026-10-11', importo: 7600, incasso_categoria_id: 12 }, // capitale versato
  { id: 14, data_contabile: '2026-10-12', importo: -200 },        // segreteria (Gestione)
  { id: 15, data_contabile: '2026-10-13', importo: -130 },        // F24 della segreteria (Tasse e imposte)
];
const spese = [
  { id: 105, movimento_id: 5, ente: 'bfm', natura: 'operativa', operativa: 'campo', controparte_id: 'cmp_q' },
  { id: 107, movimento_id: 7, ente: 'bfm', natura: 'generale', categoria_id: 3 },
  { id: 108, movimento_id: 8, ente: 'bfm', natura: 'generale', categoria_id: 5 },
  { id: 109, movimento_id: 9, ente: 'albatros', albatros_categoria_id: null },
  { id: 114, movimento_id: 14, ente: 'bfm', natura: 'generale', categoria_id: 7 },
  { id: 115, movimento_id: 15, ente: 'bfm', natura: 'generale', categoria_id: 9 },
];
const pagamenti = [{ tipo: 'prenotazione', movimento_id: 1 }, { tipo: 'voucher', movimento_id: 2 }, { tipo: 'prenotazione', movimento_id: 12 }];
const b = costruisciBilancio({
  movimenti, spese, pagamenti, categorieSpese, categorieIncassi,
  nomeControparte: (tipo, id) => (id === 'cmp_q' ? 'Quintosole' : null), dal: '2026-10-01', al: '2026-10-31',
});

verifica('ricavi operativi: prenotazioni e voucher', 620, b.ricaviOperativi.importo);
verifica('ricavi operativi divisi', ['Voucher', 'Prenotazioni'], b.ricaviOperativi.figli.map(f => f.nome));
verifica('costi operativi: il campo con la sua commissione', 501, b.costiOperativi.importo);
verifica('costi operativi per controparte', 'Quintosole', b.costiOperativi.figli[0].figli[0].nome);
verifica('risultato operativo', 119, b.risultatoOperativo);
verifica('altri ricavi per categoria', ['Altri Ricavi', 'Vendita Attrezzatura'], [b.altriRicavi.figli[0].nome, b.altriRicavi.figli[0].figli[0].nome]);
verifica('costi di struttura: Struttura e Gestione, per categoria', [['Gestione', 'Struttura'], 450], [b.costiStruttura.figli.map(f => f.nome), b.costiStruttura.importo]);
verifica('Tasse e imposte › Segreteria si legge in Gestione, in una voce sua', [['Segreteria', 200], ['Segreteria (tasse e imposte)', 130], false],
  [...b.costiStruttura.figli.find(f => f.nome === 'Gestione').figli.map(f => [f.nome, f.importo]), b.altriCosti.figli.some(f => f.nome === 'Tasse e imposte')]);
verifica('costi di struttura: poi per sottocategoria', 'Commercialista', b.costiStruttura.figli.find(f => f.nome === 'Struttura').figli[0].nome);
verifica('risultato dopo la struttura', 119 + 3733.2 - 450, b.risultatoStruttura);
verifica('altri costi: le altre categorie e Albatros', 1290, b.altriCosti.importo);
verifica('da classificare, in entrata e in uscita', [50, 20], [b.entrateDaClassificare.importo, b.usciteDaClassificare.importo]);
verifica('il capitale non è un ricavo: resta fuori, contato a parte', [3733.2, 7600], [b.altriRicavi.importo, b.capitale]);
verifica('il risultato finale più il capitale è la variazione del saldo', b.variazione, b.risultatoFinale + b.capitale);
verifica('i movimenti ignorati restano fuori, e si contano a parte', 1000, b.ignorati);
verifica('fuori periodo: non conta', 620, b.ricaviOperativi.importo);

// ---------- incassi delle prenotazioni: BFM o altre sedi, pacchetti o noleggi, gioco ----------
const anag = {
  pacchetti: [{ id: 'pk_campo', locationTipo: 'campi' }, { id: 'pk_nol', locationTipo: 'libera' }],
  giochi: [{ id: 10, nome: 'Bubble Football' }, { id: 31, nome: 'Calcio Saponato' }, { id: 40, nome: 'Toro meccanico' }],
  sedi: [{ id: 'loc_bfm', nome: 'BFM', bfm: true }, { id: 'loc_laq', nome: 'Laquilone', bfm: false }],
};
const prenPacchetto = { id: 'PRN-1', pacchettoId: 'pk_campo', giocoId: 10 };
const prenNoleggio = { id: 'PRN-2', pacchettoId: 'pk_nol', giocoId: 31, voci: [
  { giocoId: 31, sedeId: 'loc_laq', ricavo: 600 }, { giocoId: 10, sedeId: 'loc_bfm', ricavo: 300 }, { giocoId: null, nome: 'Trasporto', sede: '—', ricavo: 100 },
] };
const prenVecchia = { id: 'PRN-3', pacchettoId: 'pk_nol', giocoId: 10, voci: [{ giocoId: 40, sede: 'Laquilone', ricavo: 500 }] };
verifica('un pacchetto da campo: BFM › Pacchetti › gioco', [['BFM', 'Pacchetti', 'Bubble Football']], ripartizionePrenotazione(prenPacchetto, anag).map(x => x.percorso));
verifica('un noleggio senza righe col gioco nostro: BFM › Noleggi', [['BFM', 'Noleggi', 'Calcio Saponato']], ripartizionePrenotazione({ ...prenNoleggio, voci: [] }, anag).map(x => x.percorso));
verifica('una riga senza id di sede si riconosce dal nome', [['Altre sedi', 'Laquilone', 'Toro meccanico']], ripartizionePrenotazione(prenVecchia, anag).map(x => x.percorso));
const conPren = costruisciBilancio({
  movimenti: [{ id: 1, data_contabile: '2026-10-01', importo: 220 }, { id: 2, data_contabile: '2026-10-02', importo: 1000 }, { id: 3, data_contabile: '2026-10-03', importo: 100 }],
  pagamenti: [
    { tipo: 'prenotazione', riferimento: 'PRN-1', importo: 220, movimento_id: 1 },
    { tipo: 'prenotazione', riferimento: 'PRN-2', importo: 1000, movimento_id: 2 },
    { tipo: 'prenotazione', riferimento: 'PRN-1', importo: 33.33, movimento_id: 3 }, { tipo: 'voucher', riferimento: 'V1', importo: 66.67, movimento_id: 3 },
  ],
  prenotazioni: [prenPacchetto, prenNoleggio], ...anag,
});
const pren = conPren.ricaviOperativi.figli.find(f => f.nome === 'Prenotazioni');
const voce = (...nomi) => nomi.reduce((x, n) => x?.figli.find(f => f.nome === n), pren);
verifica('prenotazioni: BFM e altre sedi', [['BFM', 653.33], ['Altre sedi', 600]], pren.figli.map(f => [f.nome, f.importo]));
verifica('BFM: pacchetti e noleggi, poi il gioco', [253.33, 400, 300, 100], [voce('BFM', 'Pacchetti').importo, voce('BFM', 'Noleggi').importo, voce('BFM', 'Noleggi', 'Bubble Football').importo, voce('BFM', 'Noleggi', 'Trasporto').importo]);
verifica('altre sedi: per sede, poi il gioco', 600, voce('Altre sedi', 'Laquilone', 'Calcio Saponato').importo);
verifica('un bonifico su prenotazione e voucher si divide per i pagamenti', 66.67, conPren.ricaviOperativi.figli.find(f => f.nome === 'Voucher').importo);
verifica('la somma torna al centesimo', 1320, conPren.ricaviOperativi.importo);

// ---------- altri ricavi e costi: le spese della categoria Altri costi stanno con gli altri ricavi ----------
const conAltriCosti = costruisciBilancio({
  movimenti: [{ id: 1, data_contabile: '2026-10-01', importo: 500, incasso_categoria_id: 11 }, { id: 2, data_contabile: '2026-10-02', importo: -80 }, { id: 3, data_contabile: '2026-10-03', importo: -120 }],
  spese: [{ id: 1, movimento_id: 2, ente: 'bfm', natura: 'generale', categoria_id: 21 }, { id: 2, movimento_id: 3, ente: 'bfm', natura: 'generale', categoria_id: 3 }],
  categorieSpese: [...categorieSpese, { id: 20, nome: 'Altri costi', padre_id: null }, { id: 21, nome: 'Rimborsi', padre_id: 20 }],
  categorieIncassi,
});
verifica('le spese di Altri costi stanno con gli altri ricavi, non con gli altri costi', [80, 0, 120], [conAltriCosti.costiAltriRicavi.importo, conAltriCosti.altriCosti.importo, conAltriCosti.costiStruttura.importo]);
verifica('e si tolgono prima del risultato dopo la struttura', 500 - 80 - 120, conAltriCosti.risultatoStruttura);

// ---------- le tasse dei compensi stanno sotto i compensi dei bubbler ----------
const conTasseCompensi = costruisciBilancio({
  movimenti: [{ id: 1, data_contabile: '2026-10-01', importo: -300 }, { id: 2, data_contabile: '2026-10-02', importo: -60 }],
  spese: [{ id: 1, movimento_id: 1, ente: 'bfm', natura: 'operativa', operativa: 'bubbler', controparte_id: 7 }, { id: 2, movimento_id: 2, ente: 'bfm', natura: 'generale', categoria_id: 31 }],
  categorieSpese: [...categorieSpese, { id: 31, nome: 'Compensi', padre_id: 8 }],
  nomeControparte: () => 'Mario',
});
const compensi = conTasseCompensi.costiOperativi.figli.find(x => x.nome === 'Compensi bubbler');
verifica('le tasse dei compensi sotto i compensi bubbler, accanto ai bubbler', [360, [['Mario', 300], ['Tasse sui compensi', 60]]], [compensi?.importo, compensi?.figli.map(x => [x.nome, x.importo])]);
verifica('e non più fra le tasse e imposte', 0, conTasseCompensi.altriCosti.importo);

const falliti = esiti.filter(e => !e.ok);
esiti.forEach(e => console.log(`${e.ok ? 'ok  ' : 'NO  '} ${e.caso}${e.ok ? '' : ` — atteso ${JSON.stringify(e.atteso)}, ottenuto ${JSON.stringify(e.ottenuto)}`}`));
console.log(`\n${esiti.length - falliti.length}/${esiti.length} verifiche passate`);
process.exit(falliti.length ? 1 : 0);
