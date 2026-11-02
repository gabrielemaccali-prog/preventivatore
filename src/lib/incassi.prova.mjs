// Banco di prova degli abbinamenti degli incassi. Non fa parte dell'app: si esegue con
//   node src/lib/incassi.prova.mjs
// Gira in Node senza dev server né browser, perché incassi.js è fatto di sole funzioni pure.
import { ordinanteDi, causaleDi, unitaDiPagamento, proposteIncassi, statoIncasso, controllaAbbinamento, STATI_INCASSO } from './incassi.js';

const esiti = [];
const verifica = (caso, atteso, ottenuto) => {
  const ok = typeof atteso === 'number' ? Math.abs(ottenuto - atteso) < 0.005 : JSON.stringify(atteso) === JSON.stringify(ottenuto);
  esiti.push({ ok, caso, atteso, ottenuto });
};

// Testi veri dell'estratto conto (ottobre 2026).
const ciardullo = { id: 1, data_contabile: '2026-10-25', importo: 220, descrizione: 'COD. DISP.: 0126102690535715 CASH 40318375 Marco Ciardullo - 28/10/2026 - Padel Arena Quintosole Bonifico a Vostro favore disposto da: MITT.: Marco Ciardullo BENEF.: BFM S.R.L' };
const maiTai = { id: 2, data_contabile: '2026-10-20', importo: 2647.3, descrizione: 'COD.DISP.: 0126102001645330 CASH NOTPROVIDED SALDO FATTURE 198, 222 Bonifico a Vostro favore disposto da: MITT.: MAI TAI BENEF.: BFM S.R.L BIC. ORD.: CRPPIT2PXX' };
const cerasa = { id: 3, data_contabile: '2026-10-24', importo: 220, descrizione: 'COD. DISP.: 0126102489664067 CASH 02INTER20261024HSRT1598079773 Luca Cerasa - 25 Ottobre 2026 - Sport Promotion Comasina Bonifico a Vostro favore disposto da: MITT.: LUCA CERASA BENEF.: BFM S.R.L' };
const capitale = { id: 4, data_contabile: '2025-12-18', importo: 7600, descrizione: 'COD. DISP.: 0125121800000000 CASH NOTPROVIDED SVINCOLO CAPITALE SOCIALE Bonifico a Vostro favore disposto da: MITT.: NOTAIO BENEF.: BFM S.R.L' };

verifica("l'ordinante è il nome fra MITT. e BENEF.", 'Marco Ciardullo', ordinanteDi(ciardullo));
verifica('la causale è il testo prima di "Bonifico a Vostro favore"', 'Marco Ciardullo - 28/10/2026 - Padel Arena Quintosole', causaleDi(ciardullo));

const pagamenti = [
  { id: 10, riferimento: 'PRN-1156', data: '2026-10-25', importo: 220, nominativo: 'Marco Ciardullo', contanti: false },
  // Un altro 220 la stessa settimana, di un altro cliente: non deve rubare la proposta.
  { id: 11, riferimento: 'PRN-1158', data: '2026-10-24', importo: 220, nominativo: '', contanti: false },
  // Il bonifico Mai Tai, in due quote.
  { id: 12, riferimento: 'PRN-1133', data: '2026-10-20', importo: 1518.8, nominativo: 'MAi Tai', contanti: false, gruppo: 'BON-1' },
  { id: 13, riferimento: 'PRG-0205', data: '2026-10-20', importo: 1128.5, nominativo: 'MAi Tai', contanti: false, gruppo: 'BON-1' },
  // I contanti non passano dalla banca.
  { id: 14, riferimento: 'PRN-1160', data: '2026-10-24', importo: 220, nominativo: 'Luca Cerasa', contanti: true },
];
const nomi = { 'PRN-1158': ['Luca Cerasa'] };
const unita = unitaDiPagamento(pagamenti, (pg) => nomi[pg.riferimento] || []);
verifica('le quote di un bonifico sono una unità sola', 2647.3, unita.find(u => u.gruppo === 'BON-1').importo);
verifica('i contanti non sono unità di pagamento', false, unita.some(u => u.righe.some(r => r.contanti)));

const proposte = proposteIncassi({ movimenti: [ciardullo, maiTai, cerasa, capitale], unita });
verifica('Ciardullo: si propone il suo pagamento', 'p:10', proposte[1]);
verifica('Mai Tai: si propone il bonifico intero', 'g:BON-1', proposte[2]);
verifica('Cerasa: il nome è quello della prenotazione, non del pagamento', 'p:11', proposte[3]);
verifica('il capitale sociale non si propone a niente', undefined, proposte[4]);

// Il pagamento registrato con la data della partita, un mese dopo il bonifico (PRN-2026-1043): il nome
// torna bene, e la data lontana non lo esclude.
const bertoia = { id: 6, data_contabile: '2026-08-04', importo: 220, descrizione: 'COD.DISP.: 1 CASH NOTPROVIDED Emanuele Bertoia 4 settembre ore 18/19 centro sportpromotion comasina Bonifico a Vostro favore disposto da: MITT.: BERTOIA PAOLO CONGIU MONICA BENEF.: BFM' };
const suoPagamento = unitaDiPagamento([{ id: 61, riferimento: 'PRN-2026-1043', data: '2026-09-04', importo: 220, nominativo: 'Bertoia Paolo Congiu Monica', contanti: false }]);
verifica('un mese dopo, col nome che torna bene: si propone', 'p:61', proposteIncassi({ movimenti: [bertoia], unita: suoPagamento })[6]);
const soloNome = unitaDiPagamento([{ id: 62, riferimento: 'PRN-X', data: '2026-09-04', importo: 220, nominativo: 'Monica', contanti: false }]);
verifica('un mese dopo, con una parola sola in comune: no', undefined, proposteIncassi({ movimenti: [bertoia], unita: soloNome })[6]);

// Solo l'importo non basta.
const anonimo = { id: 5, data_contabile: '2026-10-25', importo: 220, descrizione: 'COD. DISP.: 1 CASH X pagamento Bonifico a Vostro favore disposto da: MITT.: ROSSI BENEF.: BFM' };
verifica('stesso importo e data, nome diverso: nessuna proposta', undefined, proposteIncassi({ movimenti: [anonimo], unita })[5]);

// Un'unità già abbinata non si propone più; un accredito con categoria nemmeno.
const giaAbbinate = unitaDiPagamento(pagamenti.map(p => (p.id === 10 ? { ...p, movimento_id: 99 } : p)));
verifica('un pagamento già abbinato non si ripropone', undefined, proposteIncassi({ movimenti: [ciardullo], unita: giaAbbinate })[1]);
verifica('un accredito con categoria non riceve proposte', undefined, proposteIncassi({ movimenti: [{ ...ciardullo, incasso_categoria_id: 1 }], unita })[1]);

verifica('stato: con un abbinamento', STATI_INCASSO.ABBINATO, statoIncasso(ciardullo, { unitaAbbinate: [unita[0]] }));
verifica('stato: con categoria', STATI_INCASSO.CATEGORIA, statoIncasso({ ...capitale, incasso_categoria_id: 3 }));
verifica('stato: con una proposta', STATI_INCASSO.PROPOSTO, statoIncasso(ciardullo, { proposta: 'p:10' }));

const mt = unita.find(u => u.gruppo === 'BON-1');
verifica("abbinamento a mano: l'importo deve tornare", true, controllaAbbinamento(maiTai, [mt]).torna);
verifica('abbinamento a mano: una quota sola non basta', false, controllaAbbinamento(maiTai, [{ ...mt, importo: 1518.8 }]).torna);
verifica('abbinamento a mano: le date diverse si segnalano', 2, controllaAbbinamento({ ...maiTai, data_contabile: '2026-10-21' }, [mt]).dateDiverse.length);

const falliti = esiti.filter(e => !e.ok);
esiti.forEach(e => console.log(`${e.ok ? 'ok  ' : 'NO  '} ${e.caso}${e.ok ? '' : ` — atteso ${JSON.stringify(e.atteso)}, ottenuto ${JSON.stringify(e.ottenuto)}`}`));
console.log(`\n${esiti.length - falliti.length}/${esiti.length} verifiche passate`);
process.exit(falliti.length ? 1 : 0);
