// Banco di prova dei conti di Albatros. Non fa parte dell'app: si esegue con
//   npm run prova:albatros
// Gira in Node senza dev server né browser, perché calcolo.js è fatto di sole funzioni pure.
import {
  quadratura, fondoProposto, fondoDiverso, fondoDaSpecificare, daSpecificare, giornataDiLavoro, chiusuraModificabile, cassaScrivibile, composizioneCorreggibile, aggiuntaConsentita,
  rigaDaIncrementare, vociFrequenti, voceDiNome, lunediDi, aggiungiGiorni, intervalloPeriodo, dettaglioSpesa, rigaSpesaConsentita, importoInCategoria, spesaDettagliabile, posizioneEnte, contantiAlbatros,
} from './calcolo.js';

const esiti = [];
const verifica = (caso, atteso, ottenuto) => {
  const ok = typeof atteso === 'number' ? Math.abs(ottenuto - atteso) < 0.005 : atteso === ottenuto;
  esiti.push({ ok, caso, atteso, ottenuto });
};

// ---------- quadratura ----------
const ch = { id: 1, data: '2026-10-06', pos: 185, contanti: 112 };
const righe = [
  { chiusura_id: 1, voce_id: 1, quantita: 20, prezzo: 1 },
  { chiusura_id: 1, voce_id: 2, quantita: 2, prezzo: 55 },
  { chiusura_id: 1, voce_id: 2, quantita: 1, prezzo: 45 },
];
const q = quadratura(ch, righe);
verifica('incassato = pos + contanti', 297, q.incassato);
verifica('specificato', 175, q.specificato);
verifica('non specificato', 122, q.nonSpecificato);
verifica("righe oltre l'incassato: non specificato negativo", -10, quadratura({ pos: 10, contanti: 0 }, [{ quantita: 1, prezzo: 20 }]).nonSpecificato);
verifica('quota limitata a 1', 1, quadratura({ pos: 10, contanti: 0 }, [{ quantita: 1, prezzo: 20 }]).quota);
verifica('giornata vuota', 0, quadratura({}, []).quota);
verifica('pos e contanti vuoti valgono zero', 0, quadratura({ pos: null, contanti: null }, []).incassato);

// ---------- fondo cassa ----------
const conFondo = quadratura({ pos: 180, contanti: 190, fondo_partenza: 100, fondo_lasciato: 120 }, righe);
verifica('i contanti scritti sono già senza fondo', 190, conFondo.contanti);
verifica('il fondo non entra nell\'incassato', 370, conFondo.incassato);
verifica('in cassa = contanti + fondo di partenza', 290, conFondo.contantiInCassa);
verifica('ritirato = in cassa - fondo lasciato', 170, conFondo.ritirato);
const ieri = quadratura({ pos: 130, contanti: 455, fondo_partenza: 30, fondo_lasciato: 30 }, [{ quantita: 1, prezzo: 585 }]);
verifica('10 ottobre: incassato uguale al battuto', 0, ieri.nonSpecificato);
verifica('10 ottobre: contanti ritirati', 455, ieri.ritirato);
verifica('senza fondo i conti di prima', 297, quadratura(ch, righe).incassato);
verifica('fondo proposto: quello lasciato ieri', 120, fondoProposto({ fondo_lasciato: 120 }));
verifica('fondo proposto: nessuna chiusura prima', null, fondoProposto(null));
verifica('fondo uguale a ieri', false, fondoDiverso({ chiusa_il: 'x', fondo_partenza: 120 }, { fondo_lasciato: 120 }));
verifica('fondo diverso da ieri', true, fondoDiverso({ chiusa_il: 'x', fondo_partenza: 100 }, { fondo_lasciato: 120 }));
verifica('fondo: prima chiusura, niente da confrontare', false, fondoDiverso({ chiusa_il: 'x', fondo_partenza: 100 }, null));

verifica('chiusa senza fondo: fondo da specificare', true, fondoDaSpecificare({ chiusa_il: 'x', fondo_partenza: null, fondo_lasciato: null }));
verifica('chiusa con fondo: no', false, fondoDaSpecificare({ chiusa_il: 'x', fondo_partenza: 100, fondo_lasciato: 100 }));
verifica('aperta senza fondo: si scrive alla chiusura', false, fondoDaSpecificare({ chiusa_il: null }));

verifica('chiusa con residuo: da specificare', true, daSpecificare({ chiusa_il: 'x' }, quadratura(ch, righe)));
verifica('chiusa tutta spiegata: no', false, daSpecificare({ chiusa_il: 'x' }, quadratura({ pos: 175, contanti: 0 }, righe)));
verifica('aperta: no', false, daSpecificare({ chiusa_il: null }, quadratura(ch, righe)));

// ---------- dettaglio delle spese ----------
const scontrino = { importo: 661 };
const vociScontrino = [{ importo: 300 }, { importo: 211.5 }];
verifica('spesa: dettagliato', 511.5, dettaglioSpesa(scontrino, vociScontrino).dettagliato);
verifica('spesa: non dettagliato', 149.5, dettaglioSpesa(scontrino, vociScontrino).nonDettagliato);
verifica('spesa: voce dentro il totale', true, rigaSpesaConsentita(scontrino, vociScontrino, 149.5));
verifica('spesa: voce oltre il totale', false, rigaSpesaConsentita(scontrino, vociScontrino, 149.51));
verifica('spesa senza voci', 0, dettaglioSpesa(scontrino, []).quota);
const misto = { importo: 100, categoria_id: 4 };
const vociMiste = [{ importo: 30, categoria_id: 5 }, { importo: 50, categoria_id: null }];
verifica('categoria: voci della spesa e parte non dettagliata', 70, importoInCategoria(misto, vociMiste, 4));
verifica("categoria: solo la voce di un'altra categoria", 30, importoInCategoria(misto, vociMiste, 5));
verifica('categoria: spesa senza voci, tutta', 100, importoInCategoria(misto, [], 4));
verifica("categoria: non c'entra", 0, importoInCategoria(misto, [], 6));
const catSpese = [{ id: 4, dettagliabile: true }, { id: 5, dettagliabile: false }];
verifica('dettaglio: spesa bar sì', true, spesaDettagliabile({ categoria_id: 4 }, catSpese));
verifica('dettaglio: pulizia no', false, spesaDettagliabile({ categoria_id: 5 }, catSpese));
verifica('dettaglio: senza categoria no', false, spesaDettagliabile({ categoria_id: null }, catSpese));

// ---------- pagamenti a Lama e BFM ----------
const speseEnti = [{ ente: 'lama', importo: 661 }, { ente: 'albatros', importo: 100 }, { ente: 'bfm', importo: 50 }];
const pagati = [
  { pagante: 'albatros', beneficiario: 'lama', causale: 'rimborso', metodo: 'contanti', importo: 400 },
  { pagante: 'albatros', beneficiario: 'lama', causale: 'stipendio', metodo: 'bonifico', importo: 1000 },
  { pagante: 'bfm', beneficiario: 'lama', causale: 'stipendio', metodo: 'contanti', importo: 300 },
];
verifica('Lama: da rimborsare', 261, posizioneEnte('lama', speseEnti, pagati).daRimborsare);
verifica('Lama: lo stipendio non rimborsa', 1300, posizioneEnte('lama', speseEnti, pagati).altri);
verifica('BFM: niente rimborsi', 50, posizioneEnte('bfm', speseEnti, pagati).daRimborsare);
const chiuseCF = [{ chiusa_il: 'x', pos: 100, contanti: 500 }, { chiusa_il: null, contanti: 999 }];
verifica('contanti in mano: ritirati - spese Albatros - pagati in contanti', 0, contantiAlbatros(chiuseCF, speseEnti, pagati).inMano);
verifica('contanti: le giornate aperte non contano', 500, contantiAlbatros(chiuseCF, speseEnti, pagati).ritirati);
verifica('contanti: i pagamenti di BFM non toccano la cassa di Albatros', 400, contantiAlbatros(chiuseCF, speseEnti, pagati).pagatiInContanti);

// ---------- data della serata ----------
verifica("all'una di notte è ancora ieri", '2026-10-06', giornataDiLavoro(new Date(2026, 9, 7, 1, 30)));
verifica('alle 5 è già oggi', '2026-10-07', giornataDiLavoro(new Date(2026, 9, 7, 5, 0)));

// ---------- settimane ----------
verifica('lunedì di un mercoledì', '2026-10-05', lunediDi('2026-10-07'));
verifica('lunedì di una domenica', '2026-10-05', lunediDi('2026-10-11'));
verifica('lunedì di un lunedì', '2026-10-05', lunediDi('2026-10-05'));
verifica('settimana a cavallo di mese', '2026-09-28', lunediDi('2026-10-01'));
verifica('sei giorni dopo il lunedì', '2026-10-11', aggiungiGiorni('2026-10-05', 6));
verifica("attraverso il cambio dell'ora", '2026-10-26', aggiungiGiorni('2026-10-19', 7));

verifica('mese: primo giorno', '2026-02-01', intervalloPeriodo({ tipo: 'mese', mese: '2026-02' })[0]);
verifica('mese: ultimo giorno', '2026-02-28', intervalloPeriodo({ tipo: 'mese', mese: '2026-02' })[1]);
verifica('settimana: fino a domenica', '2026-10-11', intervalloPeriodo({ tipo: 'settimana', lunedi: '2026-10-05' })[1]);

// ---------- blocchi ----------
const aperta = { chiusa_il: null };
const chiusa = { chiusa_il: '2026-10-07T00:10:00Z' };
verifica('giornata aperta modificabile', true, chiusuraModificabile(aperta));
verifica("giornata chiusa bloccata, anche per l'amministratore", false, chiusuraModificabile(chiusa));
verifica('ragazzi: cassa vuota si scrive', true, cassaScrivibile(aperta, null, false));
verifica('ragazzi: cassa già scritta non si cambia', false, cassaScrivibile(aperta, 120, false));
verifica('ragazzi: anche uno zero scritto non si cambia', false, cassaScrivibile(aperta, 0, false));
verifica('ragazzi: giornata nuova, cassa vuota', true, cassaScrivibile(null, null, false));
verifica('admin: cassa già scritta si cambia', true, cassaScrivibile(aperta, 120, true));
verifica('admin: giornata chiusa no', false, cassaScrivibile(chiusa, 120, true));

// ---------- composizione ----------
const chiusaConCassa = { chiusa_il: '2026-10-07T00:10:00Z', pos: 100, contanti: 50 };
verifica('ragazzi: giornata aperta, si corregge', true, composizioneCorreggibile(aperta, false));
verifica('ragazzi: giornata chiusa, non si toglie', false, composizioneCorreggibile(chiusa, false));
verifica('admin: giornata chiusa, si toglie', true, composizioneCorreggibile(chiusa, true));
verifica('giornata aperta: nessun tetto', true, aggiuntaConsentita(aperta, 500, 100));
verifica('giornata chiusa: dentro il residuo', true, aggiuntaConsentita(chiusaConCassa, 120, 30));
verifica('giornata chiusa: oltre il residuo', false, aggiuntaConsentita(chiusaConCassa, 120, 30.01));
verifica('giornata chiusa: il fondo non cambia il tetto', true, aggiuntaConsentita({ ...chiusaConCassa, fondo_partenza: 20 }, 120, 30));

// ---------- listino ----------
const listino = [
  { id: 1, nome: 'Caffè', prezzo: 1, attiva: true, categoria_id: 3 },
  { id: 2, nome: 'Campo 1h', prezzo: 55, attiva: true, categoria_id: 1 },
  { id: 3, nome: 'Ghiacciolo', prezzo: 1.5, attiva: false, categoria_id: 3 },
];
verifica('incrementa la riga uguale', 1, rigaDaIncrementare(righe, listino[0])?.voce_id);
verifica('non incrementa una riga a prezzo diverso', null, rigaDaIncrementare([righe[2]], listino[1]));
verifica('voce per nome, spazi e maiuscole a parte', 2, voceDiNome(listino, '  campo   1H ')?.id);
verifica('frequenti: prima la più usata', 2, vociFrequenti(righe, listino)[0]?.id);
verifica('frequenti: le archiviate no', 2, vociFrequenti([...righe, { voce_id: 3 }], listino).length);

const falliti = esiti.filter(e => !e.ok);
esiti.forEach(e => console.log(`${e.ok ? 'ok  ' : 'NO  '} ${e.caso}${e.ok ? '' : ` — atteso ${e.atteso}, ottenuto ${e.ottenuto}`}`));
console.log(`\n${esiti.length - falliti.length}/${esiti.length} verifiche passate`);
if (falliti.length) process.exit(1);
