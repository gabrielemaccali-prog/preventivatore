// Banco di prova della lettura dell'estratto conto e della classificazione dei movimenti. Non fa
// parte dell'app: si esegue con
//   npm run prova:banca
// Gira in Node senza dev server né browser, perché banca.js è fatto di sole funzioni pure.
// Il file di prova si costruisce qui, con la stessa forma della "Lista Movimenti" della banca.
import * as XLSX from 'xlsx';
import {
  leggiEstrattoConto, controlloSaldi, elabora, regolaPer, controparteDi, preparaControparti, codiceDi, oneriDi, daCompletare,
  cosaManca, completaDaRegola, regolaDaSpesa, cercaCategorie, percorsoCategoria, eFoglia, esitoRegola,
} from './banca.js';

const esiti = [];
const verifica = (caso, atteso, ottenuto) => {
  const ok = typeof atteso === 'number' ? Math.abs(ottenuto - atteso) < 0.005 : JSON.stringify(atteso) === JSON.stringify(ottenuto);
  esiti.push({ ok, caso, atteso, ottenuto });
};

// Le date come le scrive la banca: numero di serie di Excel con una frazione d'ora.
const serie = (iso) => (Date.UTC(...iso.split('-').map((n, i) => (i === 1 ? n - 1 : +n))) - Date.UTC(1899, 11, 30)) / 86400000 + 1 / 6;
const riga = (dc, tipo, importo, descrizione) => [serie(dc), serie(dc), tipo, importo > 0 ? importo : '', importo < 0 ? importo : '', descrizione];
const BONIFICO = 'BONIFICO ISTANTANEO DA VOI DISPOSTO';
const COSTO = 'COSTO BONIFICO ISTANTANEO DA VOI DISPOSTO';
const righeBanca = [
  riga('2026-07-21', 'ACCREDITO BEU CON CONTABILE', 550, 'COD.DISP.: 0126072127751778 CASH NOTPROVIDED Leonardo - 13 settembre padel Bonifico a Vostro favore'),
  riga('2026-08-01', BONIFICO, -1064.5, '0126080175775289 02INTER20260801HSRT1468696839 0306922487392503481604199999IT Bonifico da Voi disposto a favore di: Gabriele Maccali Rimborso note spese Luglio 2026'),
  riga('2026-08-01', COSTO, -1, '0126080175775289 02INTER20260801HSRT1468696839 0306922487392503481604199999IT'),
  riga('2026-08-01', BONIFICO, -477, '0126080175776765 02INTER Bonifico da Voi disposto a favore di: Daniele Inzaghi Compensi prest occ e rimborsi Luglio 2026'),
  riga('2026-08-01', COSTO, -1, '0126080175776765 02INTER'),
  riga('2026-08-20', 'PAGAMENTO DELEGA F24', -130.32, ''),
  riga('2026-08-20', 'PAGAMENTO DELEGA F24', -130.32, ''),
  riga('2026-08-31', 'CANONE MENSILE BASE E SERVIZI AGGIUNTIVI', -0.2, 'CANONE MENSILE MESE DI AGOSTO'),
  riga('2026-09-10', 'PAGAMENTO ADUE B2B', -14.64, 'COD. DISP.: 0126080726753282 NOME: TIM SPA MANDATO: MU0101'),
  riga('2026-09-10', 'COMMISSIONE PAGAMENTO ADUE B2B', -0.9, 'COD DISP.: 0126080726753282 NOME: TIM SPA MANDATO: MU0101'),
  riga('2026-09-12', 'PAGAMENTO TRAMITE POS', -87.8, 'OBI SAN GIULIANO MILA.. VIA26/09-16:40 - Carta n.4108 XXXX'),
];
const somma = righeBanca.reduce((t, r) => t + (Number(r[3]) || 0) + (Number(r[4]) || 0), 0);
const iniziale = 1000;
const finale = Math.round((iniziale + somma) * 100) / 100;
const foglio = [
  [], [null, null, 'Numero conto:', '100000065853'],
  [null, null, 'Saldo contabile iniziale al:', '21.07.2026', iniziale],
  [null, null, 'Saldo contabile finale al:', '12.09.2026', finale],
  [], ['Data contabile', 'Data valuta', 'Descrizione', 'Accrediti', 'Addebiti', 'Descrizione estesa', 'Effettuata tramite:'],
  ['', '', 'Saldo contabile iniziale in Euro', '', iniziale, ''],
  ...righeBanca,
  ['', '', 'Saldo contabile finale in Euro', '', finale, ''],
  [], [null, null, null, 'Operazioni non contabilizzate'], [],
  [null, 'Data', 'Descrizione', 'Accrediti', 'Addebiti', 'Descrizione estesa'],
  [null, serie('2026-09-12'), 'PAGAMENTO POS', null, -59.7, 'BRICOMAN ITALIA SRL'],
];
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(foglio), 'Lista Movimenti');
const file = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

// ---------- lettura ----------
const e = leggiEstrattoConto(XLSX, file);
verifica('periodo dai saldi', ['2026-07-21', '2026-09-12'], [e.dal, e.al]);
verifica('le non contabilizzate restano fuori, ma si contano', [righeBanca.length, 1], [e.movimenti.length, e.nonContabilizzati]);
verifica('il file torna con se stesso', 0, e.differenzaFile);
verifica('date dal numero di serie, senza l\'ora', '2026-08-01', e.movimenti[1].dataContabile);
verifica('accrediti positivi, addebiti negativi', [550, -1064.5], [e.movimenti[0].importo, e.movimenti[1].importo]);

// ---------- codici e impronte ----------
verifica('addebito: il codice è la prima parola', '0126080175775289', codiceDi(righeBanca[1][5]));
verifica('accredito: il codice è dopo COD.DISP.', '0126072127751778', codiceDi(righeBanca[0][5]));
verifica('bonifico ricevuto ordinario: dopo "Bonifico n."', '907784461460976', codiceDi('Riccardo - 4 ottobre CRO: 46286126595 Bonifico n. 907784461460976 Disposto da: X'));
verifica('F24 e POS non hanno codice', [null, null], [e.movimenti[5].codice, e.movimenti[10].codice]);
const impronte = e.movimenti.map(m => m.impronta);
verifica('ogni movimento ha la sua impronta', impronte.length, new Set(impronte).size);
verifica('bonifico e suo costo: stesso codice, impronte diverse', true, e.movimenti[1].codice === e.movimenti[2].codice && impronte[1] !== impronte[2]);
verifica('due F24 identici lo stesso giorno: distinti dall\'ordine', true, impronte[6] === `${impronte[5]}#2`);
const diNuovo = leggiEstrattoConto(XLSX, file).movimenti.map(m => m.impronta);
verifica('ricaricando lo stesso file le impronte non cambiano', impronte, diNuovo);

// ---------- controllo dei saldi ----------
const mov = e.movimenti.map((m, i) => ({ id: i + 1, data_contabile: m.dataContabile, importo: m.importo, tipo: m.tipo, descrizione: m.descrizione, codice: m.codice, ignorato: false, onere_spesa_id: null }));
const car = { id: 1, dal: e.dal, al: e.al, saldo_iniziale: iniziale, saldo_finale: finale };
verifica('un caricamento completo torna', true, controlloSaldi([car], mov).esiti[0].ok);
verifica('saldo attuale', finale, controlloSaldi([car], mov).saldoAttuale);
// Un secondo file che si sovrappone al primo e prosegue: torna anch'esso.
const car2 = { id: 2, dal: '2026-09-10', al: '2026-09-30', saldo_iniziale: Math.round((finale + 14.64 + 0.9 + 87.8) * 100) / 100, saldo_finale: finale - 50 };
const mov2 = [...mov, { id: 99, data_contabile: '2026-09-25', importo: -50, tipo: 'PAGAMENTO POS', descrizione: '' }];
verifica('file sovrapposto che prosegue: torna', true, controlloSaldi([car, car2], mov2).esiti[1].ok);
// Manca un movimento nel mezzo: il secondo caricamento lo denuncia.
verifica('manca un pezzo: differenza segnalata', -50, controlloSaldi([car, car2], mov).esiti[1].diffFinale);

// ---------- controparti ----------
const controparti = preparaControparti({
  bubbler: [{ id: 7, nome: 'Daniele', cognome: 'Inzaghi' }, { id: 8, nome: 'Gabriele', cognome: 'Rossi' }],
  campi: [{ id: 'cmp_1', nome: 'Il Campetto', nomeCompleto: 'IL CAMPETTO SSD A R.L.' }, { id: 'cmp_2', nome: 'Sporting Dora' }],
  sedi: [{ id: 's1', nome: 'BFM Milano', bfm: true }, { id: 's2', nome: 'Stomboli' }],
});
const conTesto = (testo) => ({ importo: -10, tipo: BONIFICO, descrizione: `0126 Bonifico da Voi disposto a favore di: ${testo}` });
verifica('bubbler riconosciuto per nome e cognome', '7', controparteDi(mov[3], 'bubbler', controparti)?.id);
verifica('un nome solo non basta', null, controparteDi(mov[1], 'bubbler', controparti));
verifica('campo riconosciuto dalla ragione sociale, senza la forma societaria', 'cmp_1', controparteDi(conTesto('IL CAMPETTO SSD A R.L. Affitto campi Luglio'), 'campo', controparti)?.id);
verifica('fornitore riconosciuto dal nome', 's2', controparteDi(conTesto('Stomboli Marcello Saldo ft 2'), 'fornitore', controparti)?.id);
verifica('la sede di BFM non è un fornitore', null, controparteDi(conTesto('BFM Milano giroconto'), 'fornitore', controparti));

// ---------- regole ----------
const regole = [
  { id: 1, ordine: 1, attiva: true, segno: 'uscita', tipo_contiene: 'BONIFICO', testo_contiene: 'COMPENSI', richiede_controparte: true, azione: 'spesa', ente: 'bfm', natura: 'operativa', operativa: 'bubbler' },
  { id: 2, ordine: 2, attiva: true, segno: 'uscita', tipo_contiene: 'BONIFICO', testo_contiene: 'NOTE SPESE', azione: 'spesa', ente: 'bfm', natura: 'generale', categoria_id: 21 },
  { id: 3, ordine: 3, attiva: true, segno: 'uscita', tipo_contiene: 'ADUE', testo_contiene: 'TIM SPA', azione: 'spesa', ente: 'bfm', natura: 'generale', categoria_id: 22, descrizione: 'TIM' },
  { id: 4, ordine: 4, attiva: false, segno: 'uscita', tipo_contiene: 'POS', azione: 'ignora' },
  { id: 5, ordine: 5, attiva: true, segno: 'uscita', tipo_contiene: 'CANONE|BOLLO', azione: 'spesa', ente: 'bfm', natura: 'generale', categoria_id: 23 },
  { id: 6, ordine: 6, attiva: true, segno: 'uscita', tipo_contiene: 'F24', azione: 'spesa', ente: 'albatros', albatros_categoria_id: 90 },
];
verifica('regola che chiede la controparte: vale col bubbler riconosciuto', 1, regolaPer(mov[3], regole, controparti)?.id);
verifica('… e non vale senza', null, regolaPer({ ...mov[3], descrizione: 'a favore di: Mario Bianchi Compensi luglio' }, regole, controparti));
verifica('regola con alternative "|"', 5, regolaPer(mov[7], regole, controparti)?.id);
verifica('regola spenta non vale', null, regolaPer(mov[10], regole, controparti));
verifica('le regole delle uscite non toccano le entrate', null, regolaPer(mov[0], regole, controparti));

// ---------- categorie a due livelli ----------
const categorie = [
  { id: 20, nome: 'Struttura', padre_id: null, ordine: 1, attiva: true },
  { id: 21, nome: 'Magazzino/box', padre_id: 20, ordine: 1, attiva: true },
  { id: 24, nome: 'Affitto sede', padre_id: 20, ordine: 2, attiva: true },
  { id: 22, nome: 'Utenze', padre_id: null, ordine: 2, attiva: true },
  { id: 23, nome: 'Banca', padre_id: null, ordine: 3, attiva: true },
  { id: 25, nome: 'Vecchia', padre_id: 23, ordine: 1, attiva: false },
];
verifica('percorso della sottocategoria', 'Struttura › Magazzino/box', percorsoCategoria(categorie, 21));
verifica('una categoria con sottocategorie non è l\'ultimo livello', [false, true, true], [eFoglia(categorie, 20), eFoglia(categorie, 21), eFoglia(categorie, 22)]);
verifica('una sottocategoria archiviata non conta', true, eFoglia(categorie, 23));
verifica('cercando "magazzino" la voce è una sola, col suo percorso', [21], cercaCategorie(categorie, 'magazzino').map(c => c.id));
verifica('cercando la categoria escono le sue sottocategorie', [21, 24], cercaCategorie(categorie, 'struttura').map(c => c.id));

// ---------- da completare ----------
verifica('senza ente', 'BFM o Albatros', cosaManca({}, categorie));
verifica('Albatros senza la sua categoria', 'la categoria di Albatros', cosaManca({ ente: 'albatros' }, categorie));
verifica('BFM senza natura', 'operativa o generale', cosaManca({ ente: 'bfm' }, categorie));
verifica('operativa senza tipo', 'il tipo di costo operativo', cosaManca({ ente: 'bfm', natura: 'operativa' }, categorie));
verifica('operativa col tipo ma senza controparte: da completare', 'il campo', cosaManca({ ente: 'bfm', natura: 'operativa', operativa: 'campo' }, categorie));
verifica('operativa con tipo e controparte: completa (da riconciliare)', null, cosaManca({ ente: 'bfm', natura: 'operativa', operativa: 'campo', controparte_id: 'cmp_1' }, categorie));
verifica('generale sulla categoria che ha sottocategorie', 'la sottocategoria', cosaManca({ ente: 'bfm', natura: 'generale', categoria_id: 20 }, categorie));
verifica('generale all\'ultimo livello: completa', null, cosaManca({ ente: 'bfm', natura: 'generale', categoria_id: 21 }, categorie));

// ---------- elaborazione ----------
const el = elabora({ movimenti: mov, spese: [], regole, controparti });
verifica('entrate e oneri non diventano spese', 7, el.nuove.length);
verifica('costi dei bonifici e commissione ADUE: oneri della spesa principale', [[3, 2], [5, 4], [10, 9]], el.oneri.map(o => [o.movimento.id, o.principale.id]));
const note = el.nuove.find(n => n.movimento.id === 2).spesa;
verifica('spesa generale dalla regola, importo senza oneri', [1064.5, 'bfm', 'generale', 21, 2], [note.importo, note.ente, note.natura, note.categoria_id, note.regola_id]);
verifica('descrizione dal testo dopo "a favore di"', 'Gabriele Maccali Rimborso note spese Luglio 2026', note.descrizione);
const bub = el.nuove.find(n => n.movimento.id === 4).spesa;
verifica('compenso bubbler: operativa, con controparte e beneficiario', ['operativa', 'bubbler', '7', 'Daniele Inzaghi', null], [bub.natura, bub.operativa, bub.controparte_id, bub.beneficiario, bub.categoria_id]);
const f24 = el.nuove.find(n => n.movimento.id === 6).spesa;
verifica('regola di Albatros: categoria di Albatros e niente natura', ['albatros', 90, null], [f24.ente, f24.albatros_categoria_id, f24.natura]);
verifica('senza regola: da completare', true, daCompletare(el.nuove.find(n => n.movimento.id === 11).spesa, categorie));
verifica('descrizione della regola', 'TIM', el.nuove.find(n => n.movimento.id === 9).spesa.descrizione);

// Una spesa scritta a mano con lo stesso importo, pagata dal conto: il movimento la paga, non ne crea un'altra.
const manuale = { id: 50, data: '2026-09-11', importo: 87.8, origine: 'manuale', metodo: 'conto', movimento_id: null };
const elM = elabora({ movimenti: mov, spese: [manuale], regole, controparti });
verifica('collegata alla spesa scritta a mano', [[11, 50]], elM.collegamenti.map(c => [c.movimento.id, c.spesa.id]));
verifica('pagata in contanti: non si collega', 0, elabora({ movimenti: mov, spese: [{ ...manuale, metodo: 'contanti' }], regole, controparti }).collegamenti.length);

// Rielaborare dopo aver salvato non crea niente due volte.
const spese = el.nuove.map((n, i) => ({ ...n.spesa, id: 100 + i }));
const spesaDi = (movId) => spese.find(s => s.movimento_id === movId).id;
const movSalvati = mov.map(m => { const o = el.oneri.find(x => x.movimento.id === m.id); return o ? { ...m, onere_spesa_id: spesaDi(o.principale.id) } : m; });
const ancora = elabora({ movimenti: movSalvati, spese, regole, controparti });
verifica('seconda elaborazione: niente di nuovo', [0, 0, 0], [ancora.nuove.length, ancora.oneri.length, ancora.collegamenti.length]);
verifica('oneri bancari della spesa: 1064,50 + 1,00', 1, oneriDi(spese.find(s => s.movimento_id === 2), movSalvati));

// ---------- regole dalle spese ricorrenti ----------
const obi = { ente: 'bfm', natura: 'generale', categoria_id: 21 };
const proposta = regolaDaSpesa(obi, mov[10]);
verifica('regola proposta da una spesa POS: tipo e nome del negozio', ['POS', 'OBI SAN', false], [proposta.tipo_contiene, proposta.testo_contiene, proposta.richiede_controparte]);
verifica('… con la classificazione della spesa', ['bfm', 'generale', 21], [proposta.ente, proposta.natura, proposta.categoria_id]);
verifica('la regola proposta prende il movimento da cui nasce', true, regolaPer(mov[10], [{ ...proposta, id: 99, ordine: 0 }], controparti)?.id === 99);
const daBubbler = regolaDaSpesa(bub, mov[3]);
verifica('da un compenso: la regola porta con sé il bubbler della spesa', ['BONIFICO', 'DANIELE', false, '7'], [daBubbler.tipo_contiene, daBubbler.testo_contiene, daBubbler.richiede_controparte, daBubbler.controparte_id]);
// La controparte scritta nella regola vince sul nome nel movimento: è chi la regola ha deciso.
const conChi = { id: 40, ordine: 40, attiva: true, segno: 'uscita', testo_contiene: 'INZAGHI', azione: 'spesa', ente: 'bfm', natura: 'operativa', operativa: 'bubbler', controparte_id: '8' };
verifica('controparte indicata nella regola', '8', elabora({ movimenti: mov, spese: [], regole: [conChi], controparti }).nuove.find(n => n.movimento.id === 4).spesa.controparte_id);
verifica('… col suo nome come beneficiario', 'Gabriele Rossi', elabora({ movimenti: mov, spese: [], regole: [conChi], controparti }).nuove.find(n => n.movimento.id === 4).spesa.beneficiario);
verifica('regola senza controparte: si cerca nel movimento', '7', elabora({ movimenti: mov, spese: [], regole: [{ ...conChi, controparte_id: null }], controparti }).nuove.find(n => n.movimento.id === 4).spesa.controparte_id);
// Completare una spesa esistente: solo i campi vuoti, e mai contro quello che c'è.
verifica('completa i campi vuoti', { natura: 'generale', categoria_id: 21 }, completaDaRegola({ ente: 'bfm' }, regole[1], mov[1], controparti));
verifica('non cambia l\'ente già scelto', {}, completaDaRegola({ ente: 'albatros' }, regole[1], mov[1], controparti));
verifica('non cambia la natura già scelta', {}, completaDaRegola({ ente: 'bfm', natura: 'operativa' }, regole[1], mov[1], controparti));


// ---------- una regola sola, applicata a mano ----------
// spese: quelle nate dall'elaborazione; l'OBI (movimento 11) è senza regola, quindi da completare.
const obiRegola = { id: 30, ordine: 30, attiva: true, segno: 'uscita', tipo_contiene: 'POS', testo_contiene: 'OBI', azione: 'spesa', ente: 'bfm', natura: 'generale', categoria_id: 21 };
const sulPos = esitoRegola({ regola: obiRegola, regole: [...regole, obiRegola], spese, movimenti: movSalvati, controparti, categorie });
verifica('applicata a mano: completa la spesa da completare che prende', [[11, 'completa']], sulPos.map(x => [x.movimento.id, x.esito]));
verifica('… riempiendo i campi vuoti', { ente: 'bfm', natura: 'generale', categoria_id: 21 }, sulPos[0].patch);
// La TIM è già classificata dalla sua regola: un'altra regola che la prende non la tocca.
const timBis = { id: 31, ordine: 31, attiva: true, segno: 'uscita', tipo_contiene: 'ADUE', azione: 'spesa', ente: 'albatros', albatros_categoria_id: 90 };
const sullaTim = esitoRegola({ regola: timBis, regole: [...regole, timBis], spese, movimenti: movSalvati, controparti, categorie });
// "ADUE" prende anche la commissione dell'addebito, che è un onere e non ha spesa propria.
verifica('spesa già classificata: non si tocca', ['gia_classificata', 'senza_spesa'], sullaTim.map(x => x.esito));
verifica('… e si dice quale regola più in alto vince', 3, sullaTim[0].precedente?.id);
// I costi dei bonifici non hanno spesa propria: si contano a parte.
const costi = { id: 32, ordine: 32, attiva: true, segno: 'uscita', tipo_contiene: 'COSTO BONIFICO', azione: 'spesa', ente: 'bfm', natura: 'generale', categoria_id: 23 };
verifica('oneri agganciati: senza spesa', ['senza_spesa', 'senza_spesa'], esitoRegola({ regola: costi, regole: [costi], spese, movimenti: movSalvati, controparti, categorie }).map(x => x.esito));
// Una regola che chiede un bubbler che non c'è non prende niente: è la prima cosa da controllare.
const karin = { id: 33, ordine: 33, attiva: true, segno: 'uscita', testo_contiene: 'KARIN', richiede_controparte: true, azione: 'spesa', ente: 'bfm', natura: 'operativa', operativa: 'bubbler' };
const movKarin = [...movSalvati, { id: 70, data_contabile: '2026-08-01', importo: -500, tipo: BONIFICO, descrizione: '0126 Bonifico da Voi disposto a favore di: Karin Sergi Compenso luglio 2026 Karin Sergi' }];
verifica('regola sul bubbler che non è in anagrafica: non prende niente', 0, esitoRegola({ regola: karin, regole: [karin], spese, movimenti: movKarin, controparti, categorie }).length);
verifica('… senza "riconosco il bubbler" sì', 1, esitoRegola({ regola: { ...karin, richiede_controparte: false }, regole: [karin], spese, movimenti: movKarin, controparti, categorie }).length);

// ---------- esito ----------
const falliti = esiti.filter(x => !x.ok);
esiti.forEach(x => console.log(`${x.ok ? 'ok  ' : 'NO  '} ${x.caso}${x.ok ? '' : `\n      atteso ${JSON.stringify(x.atteso)}\n      ottenuto ${JSON.stringify(x.ottenuto)}`}`));
console.log(`\n${esiti.length - falliti.length}/${esiti.length} verifiche superate`);
if (falliti.length) process.exit(1);
