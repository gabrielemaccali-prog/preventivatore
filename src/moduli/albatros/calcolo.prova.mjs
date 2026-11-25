// Banco di prova dei conti di Albatros. Non fa parte dell'app: si esegue con
//   npm run prova:albatros
// Gira in Node senza dev server né browser, perché calcolo.js è fatto di sole funzioni pure.
import {
  quadratura, forseChiusuraDiIeri, fondoProposto, fondoDiverso, fondoDaSpecificare, daSpecificare, giornataDiLavoro, chiusuraModificabile, cassaScrivibile, composizioneCorreggibile, aggiuntaConsentita,
  rigaDaIncrementare, vociFrequenti, voceDiNome, lunediDi, aggiungiGiorni, intervalloPeriodo, dettaglioSpesa, rigaSpesaConsentita, modificaVoceConsentita, voceDaSalvare, voceCorreggibile, importoInCategoria, spesaDettagliabile, DA_DETTAGLIARE, posizioneEnte, contantiAlbatros, contoAlbatros, spesaDaPagare, accontiConfermati, accontoConfermabile, movimentiAcconti, accontoSullaVoce,
} from './calcolo.js';
import { nonInBanca, spesePerCategoria, alberoCategorie, posizioniAlbero, oreCampo, categoriaConOreCampo, testoOre, foglieCategorie, categoriaFoglia, conSottocategorie, importoInCategorie, nomeCategoria, idCategoriaScelta } from './calcolo.js';
import { movimentiNonContabilizzati, contabilizzatoDi, eIncassoPos, eVersamentoContanti, naturaEntrata, mittenteDi, causaleEntrataDi, versamentoManualeDa, trasferimentiDoppi, elaboraAlbatros, ePrelievo, principaleDi, usciteDaImportare, dataCompetenza, saldoAllInizio, spesaDaMovimento, spesaManualeDa, categoriaProposta, eOnereBancario, chiaveControparte } from './banca.js';
import { missioneAperta, missioneScaduta, confrontaMissioni, campiCambioStato, statoDopoAttivita, avanzamento, attivitaScaduta } from './regoleMissioni.js';

const r2t = (n) => Math.round(n * 100) / 100;
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
const vociConId = [{ id: 1, importo: 300 }, { id: 2, importo: 211.5 }];
verifica('voce: alzarla fino al totale si può', true, modificaVoceConsentita(scontrino, vociConId, vociConId[0], 449.5));
verifica('voce: oltre il totale no', false, modificaVoceConsentita(scontrino, vociConId, vociConId[0], 449.51));
verifica('voce appena scritta: la corregge chiunque', true, voceCorreggibile({ salvata: false }, false));
verifica('voce salvata: solo l\'amministratore', false, voceCorreggibile({ salvata: true }, false));
verifica('voce salvata: l\'amministratore sì', true, voceCorreggibile({ salvata: true }, true));
verifica('voce di prima della colonna: salvata', false, voceDaSalvare({}));
verifica('spesa senza voci', 0, dettaglioSpesa(scontrino, []).quota);
const semplice = { importo: 100, categoria_id: 4 };
verifica('spesa semplice: tutta alla sua categoria', 100, importoInCategoria(semplice, [], 4));
verifica("spesa semplice: un'altra categoria no", 0, importoInCategoria(semplice, [], 6));
verifica('spesa semplice: mai da dettagliare', 0, importoInCategoria(semplice, [], DA_DETTAGLIARE));
const scontrinoMisto = { importo: 100, categoria_id: null, multicategoria: true };
const vociMiste = [{ importo: 30, categoria_id: 5 }, { importo: 50, categoria_id: 4 }];
verifica('scontrino: la voce di una categoria', 30, importoInCategoria(scontrinoMisto, vociMiste, 5));
verifica("scontrino: l'altra voce", 50, importoInCategoria(scontrinoMisto, vociMiste, 4));
verifica('scontrino: la parte non dettagliata è da dettagliare', 20, importoInCategoria(scontrinoMisto, vociMiste, DA_DETTAGLIARE));
verifica('scontrino: la testata vuota non è "senza categoria"', 0, importoInCategoria(scontrinoMisto, vociMiste, null));
verifica('scontrino: una voce senza categoria sì', 10, importoInCategoria(scontrinoMisto, [{ importo: 10, categoria_id: null }], null));
verifica('scontrino senza voci: tutto da dettagliare', 100, importoInCategoria(scontrinoMisto, [], DA_DETTAGLIARE));
verifica('dettaglio: lo scontrino sì', true, spesaDettagliabile(scontrinoMisto));
verifica('dettaglio: la spesa semplice no', false, spesaDettagliabile(semplice));

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
const speseMetodo = [{ ente: 'albatros', importo: 100, metodo: 'contanti' }, { ente: 'albatros', importo: 40, metodo: 'carta', movimento_id: 1 }, { ente: 'albatros', importo: 10 }];
verifica('spese: solo quelle in contanti (o senza metodo) toccano i contanti', 110, contantiAlbatros(chiuseCF, speseMetodo, []).speseAlbatros);
verifica('conto: POS - spese con carta - pagamenti non in contanti', -940, contoAlbatros(chiuseCF, speseMetodo, pagati).saldo);
const conDaPagare = [...speseMetodo, { ente: 'albatros', importo: 500, metodo: 'da_pagare' }];
verifica('da pagare: non tocca i contanti', 110, contantiAlbatros(chiuseCF, conDaPagare, []).speseAlbatros);
verifica('da pagare: non tocca il conto', 40, contoAlbatros(chiuseCF, conDaPagare, []).speseCarta);
verifica('da pagare: riconosciuta', true, spesaDaPagare(conDaPagare[3]));
verifica('contanti + conto = saldo', r2t(500 + 100 - 150 - 1400), r2t(contantiAlbatros(chiuseCF, speseMetodo, pagati).inMano + contoAlbatros(chiuseCF, speseMetodo, pagati).saldo));
const trasf = [{ da: 'contanti', importo: 300 }, { da: 'conto', importo: 50 }];
verifica('trasferimenti: versare toglie dai contanti, prelevare aggiunge', r2t(contantiAlbatros(chiuseCF, speseMetodo, pagati).inMano - 300 + 50), contantiAlbatros(chiuseCF, speseMetodo, pagati, trasf).inMano);
verifica('trasferimenti: il conto fa il contrario', r2t(contoAlbatros(chiuseCF, speseMetodo, pagati).saldo + 300 - 50), contoAlbatros(chiuseCF, speseMetodo, pagati, trasf).saldo);
verifica('trasferimenti: il saldo non cambia', r2t(500 + 100 - 150 - 1400), r2t(contantiAlbatros(chiuseCF, speseMetodo, pagati, trasf).inMano + contoAlbatros(chiuseCF, speseMetodo, pagati, trasf).saldo));

// ---------- chiusura di ieri fatta oggi ----------
verifica('le 14 di oggi, ieri non chiusa: avvisa', true, forseChiusuraDiIeri('2026-10-18', '2026-10-18', 14, false));
verifica('le 23 di oggi: normale', false, forseChiusuraDiIeri('2026-10-18', '2026-10-18', 23, false));
verifica('ieri già chiusa: normale', false, forseChiusuraDiIeri('2026-10-18', '2026-10-18', 14, true));
verifica('una giornata passata: normale', false, forseChiusuraDiIeri('2026-10-16', '2026-10-18', 14, false));

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
verifica('anno: dal primo gennaio', '2026-01-01', intervalloPeriodo({ tipo: 'anno', anno: '2026' })[0]);
verifica('anno: al 31 dicembre', '2026-12-31', intervalloPeriodo({ tipo: 'anno', anno: '2026' })[1]);

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

// ---------- missioni ----------
verifica('missione in attesa: non chiusa', true, missioneAperta({ stato: 'in_attesa' }));
verifica('missione chiusa: non conta', false, missioneAperta({ stato: 'chiusa' }));
verifica('scaduta ieri', true, missioneScaduta({ stato: 'aperta', scadenza: '2026-10-21' }, '2026-10-22'));
verifica('scade oggi: non ancora scaduta', false, missioneScaduta({ stato: 'aperta', scadenza: '2026-10-22' }, '2026-10-22'));
verifica('chiusa: mai scaduta', false, missioneScaduta({ stato: 'chiusa', scadenza: '2026-01-01' }, '2026-10-22'));
verifica('senza scadenza: mai scaduta', false, missioneScaduta({ stato: 'aperta', scadenza: null }, '2026-10-22'));
const elenco = [
  { id: 1, stato: 'chiusa', priorita: 'alta', chiusa_il: '2026-10-01' },
  { id: 2, stato: 'aperta', priorita: 'bassa', scadenza: '2026-10-23' },
  { id: 3, stato: 'in_corso', priorita: 'alta', scadenza: null, creato_il: '2026-10-02' },
  { id: 4, stato: 'aperta', priorita: 'alta', scadenza: '2026-11-01' },
  { id: 5, stato: 'chiusa', priorita: 'bassa', chiusa_il: '2026-10-10' },
  { id: 6, stato: 'in_attesa', priorita: 'alta', scadenza: null, creato_il: '2026-10-01' },
];
verifica('ordine missioni', '4,6,3,2,5,1', [...elenco].sort(confrontaMissioni).map(m => m.id).join(','));
const adesso = new Date('2026-10-22T10:00:00Z');
verifica('chiudendo si segna quando', adesso.toISOString(), campiCambioStato({ stato: 'in_corso' }, 'chiusa', adesso).chiusa_il);
verifica('richiudendo resta la data di prima', '2026-10-01', campiCambioStato({ stato: 'chiusa', chiusa_il: '2026-10-01' }, 'chiusa', adesso).chiusa_il);
verifica('riaprendo si toglie', null, campiCambioStato({ stato: 'chiusa', chiusa_il: '2026-10-01' }, 'aperta', adesso).chiusa_il);

verifica('attività: fatte tutte, la missione si chiude', 'chiusa', statoDopoAttivita({ stato: 'in_corso' }, [{ fatta_il: 'x' }, { fatta_il: 'y' }]));
verifica("attività: una da fare, resta com'è", null, statoDopoAttivita({ stato: 'in_attesa' }, [{ fatta_il: 'x' }, { fatta_il: null }]));
verifica('attività: una torna da fare, la chiusa si riapre', 'in_corso', statoDopoAttivita({ stato: 'chiusa' }, [{ fatta_il: 'x' }, {}]));
verifica('attività: già chiusa e tutte fatte, niente', null, statoDopoAttivita({ stato: 'chiusa' }, [{ fatta_il: 'x' }]));
verifica('attività: nessuna, la missione non si tocca', null, statoDopoAttivita({ stato: 'aperta' }, []));
verifica('avanzamento', '1/3', (({ fatte, totale }) => `${fatte}/${totale}`)(avanzamento([{ fatta_il: 'x' }, {}, {}])));
verifica('attività scaduta', true, attivitaScaduta({ scadenza: '2026-10-01' }, '2026-10-22'));
verifica('attività fatta: mai scaduta', false, attivitaScaduta({ scadenza: '2026-10-01', fatta_il: 'x' }, '2026-10-22'));
// ---------- acconti ----------
const acconti = [
  { importo: 50, metodo: 'contanti', stato: 'confermato', data_riferimento: '2026-11-15' },
  { importo: 30, metodo: 'pos', stato: 'atteso', data_riferimento: '2026-11-15' },
  { importo: 20, metodo: 'bonifico', stato: 'rimborsato', rimborso_metodo: 'contanti', data_riferimento: '2026-11-16' },
  { importo: 40, metodo: 'contanti', stato: 'trattenuto', data_riferimento: '2026-11-15' },
];
verifica('acconti: solo i confermati del giorno', 50, accontiConfermati(acconti, '2026-11-15'));
verifica('quadratura: festa 200 battuta, 150 la sera + 50 di acconto = tutto specificato', 0, quadratura({ pos: 100, contanti: 50 }, [{ quantita: 1, prezzo: 200 }], 50).nonSpecificato);
verifica("quadratura: l'acconto non tocca i contanti da ritirare", 50, quadratura({ pos: 100, contanti: 50 }, [], 50).ritirato);
verifica('acconti: si conferma il giorno stesso', true, accontoConfermabile({ stato: 'atteso', data_riferimento: '2026-11-15' }, '2026-11-15'));
verifica('acconti: non prima del giorno', false, accontoConfermabile({ stato: 'atteso', data_riferimento: '2026-11-16' }, '2026-11-15'));
verifica('acconti: in contanti entrano nei contanti, qualunque esito', 90, movimentiAcconti(acconti).versatiContanti);
verifica('acconti: POS e bonifico sul conto', 50, movimentiAcconti(acconti).versatiConto);
verifica('acconti: il rimborso esce da dove si dice', 20, movimentiAcconti(acconti).rimborsatiContanti);
verifica('acconti: in attesa', 30, movimentiAcconti(acconti).inAttesa);
verifica('cassa: + acconti in contanti − rimborsi in contanti', r2t(contantiAlbatros(chiuseCF, speseMetodo, pagati).inMano + 90 - 20), contantiAlbatros(chiuseCF, speseMetodo, pagati, [], acconti).inMano);
verifica('conto: + acconti con POS e bonifico', r2t(contoAlbatros(chiuseCF, speseMetodo, pagati).saldo + 50), contoAlbatros(chiuseCF, speseMetodo, pagati, [], acconti).saldo);

verifica('acconti: non sulle voci del bar', false, accontoSullaVoce({ categoria_id: 3 }, [{ id: 3, acconti: false }]));
verifica('acconti: sulle feste sì', true, accontoSullaVoce({ categoria_id: 2 }, [{ id: 2, acconti: true }]));
verifica('acconti: prima della colonna, sì', true, accontoSullaVoce({ categoria_id: 2 }, [{ id: 2 }]));

// ---------- spese dal conto in banca ----------
const metro = { dataContabile: '2026-10-28', dataValuta: '2026-10-26', tipo: 'PAGAMENTO POS', importo: -1309.29, impronta: 'a',
  descrizione: 'EFFETTUATO IL 26/10/2026 ALLE ORE 10:52 MEDIANTE LA CARTA 4838 XXXX XXXX XX12 PRESSO METRO FIL.SAN DONATO MILANESE MI SAN DONATO MILA' };
const enegan = { dataContabile: '2026-10-28', tipo: 'PAGAMENTO ADUE', importo: -904.25, impronta: 'b', descrizione: 'COD. DISP.: 0126102721720222 NOME: ENEGAN SPA MANDATO: A56S04000203310990969' };
const bollo = { dataContabile: '2026-10-02', tipo: 'IMPOSTA DI BOLLO E/C E RENDICONTO', importo: -29.7, impronta: 'c', descrizione: '' };
const sumup = { dataContabile: '2026-10-31', tipo: 'ACCREDITO BONIFICO ISTANTANEO', importo: 830.83, impronta: 'd', descrizione: 'SumUp incassi' };
const settembre = { dataContabile: '2026-09-29', tipo: 'DISPOSIZIONE DI BONIFICO', importo: -1177, impronta: 'e', descrizione: 'a favore di: SILIPO ROBERTO DIVIDENDO SOCI' };
const uscite = usciteDaImportare([metro, enegan, bollo, sumup, settembre], ['b']);
verifica('banca: entrano le uscite nuove dal 1 ottobre', 2, uscite.nuove.length);
verifica('banca: gli incassi no', false, uscite.nuove.includes(sumup));
verifica('banca: quelle di settembre no', 1, uscite.primaDellInizio);
verifica('banca: quelle già caricate no', 1, uscite.giaCaricate);
const bolloSettembre = { dataContabile: '2026-10-02', dataValuta: '2026-09-30', tipo: 'IMPOSTA DI BOLLO E/C E RENDICONTO', importo: -29.7, impronta: 'f', descrizione: '' };
const canoneOttobre = { dataContabile: '2026-10-07', dataValuta: '2026-09-30', tipo: 'CANONE CARTA DI DEBITO', importo: -3, impronta: 'g', descrizione: 'CARTA N. 4838XXXXXXXXXX12-PERIODO 10/26' };
verifica('banca: conta la data valuta', '2026-09-30', dataCompetenza(bolloSettembre));
verifica('banca: il canone col periodo è del suo mese', '2026-10-01', dataCompetenza(canoneOttobre));
verifica('banca: il bollo di settembre resta fuori, il canone di ottobre entra', 'g', usciteDaImportare([bolloSettembre, canoneOttobre], []).nuove.map(m => m.impronta).join());
verifica('banca: saldo al 30 settembre', 63.78, saldoAllInizio({ dal: '2026-09-09', saldoIniziale: 100, movimenti: [{ ...bolloSettembre, importo: -36.22 }, canoneOttobre] }));
verifica('banca: file che parte da ottobre, niente saldo di partenza', null, saldoAllInizio({ dal: '2026-10-01', saldoIniziale: 100, movimenti: [] }));
verifica('banca: POS = carta, nel giorno dell\'acquisto', 'carta 2026-10-26', `${spesaDaMovimento(metro).metodo} ${spesaDaMovimento(metro).data}`);
verifica('banca: il negozio, senza la città', 'Metro Fil.San Donato Milanese', spesaDaMovimento(metro).descrizione);
verifica('banca: addebito diretto = dal conto, col creditore', 'conto Enegan Spa', `${spesaDaMovimento(enegan).metodo} ${spesaDaMovimento(enegan).descrizione}`);
verifica('banca: il bollo è un onere', true, eOnereBancario(bollo));
verifica('banca: il prelievo allo sportello è un trasferimento', true, ePrelievo({ tipo: 'PRELEVAMENTO CARTA SU SPORTELLO AUTOMATICO' }));
verifica('banca: un pagamento POS no', false, ePrelievo(metro));
const bonificoLasi = { dataContabile: '2026-11-04', tipo: 'BONIFICO ISTANTANEO DA VOI DISPOSTO', importo: -235.6, descrizione: '0126110462587243 02INTER20261104HSRT1513537798 0306921864503801483730199999IT Bonifico da Voi disposto a favore di: LA.SI. distribuzione srl' };
const costoLasi = { dataContabile: '2026-11-04', tipo: 'COSTO BONIFICO ISTANTANEO DA VOI DISPOSTO', importo: -0.5, descrizione: '0126110462587243 02INTER20261104HSRT1513537798 0306921864503801483730199999IT' };
const adue = { dataContabile: '2026-10-28', tipo: 'COMMISSIONI E SPESE ADUE', importo: -0.85, descrizione: 'COD DISP.: 0126102721720222 NOME: ENEGAN SPA MANDATO: A56S04000203310990969' };
const canone = { dataContabile: '2026-11-06', tipo: 'CANONE CARTA DI DEBITO', importo: -3, descrizione: 'CARTA N. 4838XXXXXXXXXX12-PERIODO 11/26' };
verifica('banca: il costo del bonifico va col bonifico', bonificoLasi, principaleDi(costoLasi, [bonificoLasi, costoLasi, enegan]));
verifica("banca: la commissione ADUE va con l'addebito", true, principaleDi(adue, [{ ...enegan, descrizione: 'COD. DISP.: 0126102721720222 NOME: ENEGAN SPA MANDATO: A56S04000203310990969' }, adue]) != null);
verifica('banca: il canone resta a sé', null, principaleDi(canone, [bonificoLasi, canone]));
verifica('banca: un bonifico non è la commissione di niente', null, principaleDi(bonificoLasi, [bonificoLasi, costoLasi]));
verifica('banca: stessa controparte fra filiali', 'METRO FIL', chiaveControparte(metro));
const manuale = { id: 9, ente: 'albatros', metodo: 'carta', importo: 1309.29, data: '2026-10-25', movimento_id: null, spesa_bfm_id: null };
verifica('banca: si abbina alla spesa con carta scritta a mano', 9, spesaManualeDa(metro, [manuale])?.id);
verifica('banca: non a una in contanti', null, spesaManualeDa(metro, [{ ...manuale, metodo: 'contanti' }]));
verifica('banca: non oltre 10 giorni', null, spesaManualeDa(metro, [{ ...manuale, data: '2026-10-10' }]));
const catSpesa = [{ id: 7, tipo: 'spesa', attiva: true, nome: 'Oneri bancari' }];
verifica('banca: gli oneri in "Oneri bancari"', 7, categoriaProposta(bollo, [], catSpesa));
verifica('banca: la categoria dell\'ultima spesa dallo stesso negozio', 4, categoriaProposta(metro, [{ chiave: 'METRO FIL', categoria_id: 3, data: '2026-10-01' }, { chiave: 'METRO FIL', categoria_id: 4, data: '2026-10-20' }], catSpesa));
verifica('banca: negozio nuovo, nessuna categoria', null, categoriaProposta(enegan, [], catSpesa));
verifica('dal conto: tocca il conto, non i contanti', 0, contantiAlbatros([], [{ ente: 'albatros', metodo: 'conto', importo: 50 }], []).speseAlbatros);
verifica('dal conto: tocca il conto', 50, contoAlbatros([], [{ ente: 'albatros', metodo: 'conto', importo: 50, movimento_id: 1 }], []).speseCarta);

const dalDb = (m, id, extra = {}) => ({ id, data_contabile: m.dataContabile, data_valuta: m.dataValuta, tipo: m.tipo, descrizione: m.descrizione, importo: m.importo, ignorato: false, onere_spesa_id: null, ...extra });
const movDb = [dalDb(bonificoLasi, 1), dalDb(costoLasi, 2), dalDb(metro, 3), dalDb({ dataContabile: '2026-11-05', tipo: 'PRELEVAMENTO CARTA', descrizione: '', importo: -100 }, 4), dalDb(sumup, 5), dalDb(canone, 6, { ignorato: true })];
const el = elaboraAlbatros({ movimenti: movDb, spese: [{ id: 9, ente: 'albatros', metodo: 'carta', importo: 1309.29, data: '2026-10-25', movimento_id: null, spesa_bfm_id: null }], trasferimenti: [], storico: [], categorie: [] });
verifica('elabora: la commissione va sul bonifico', 1, el.oneri[0]?.principale.id);
verifica('elabora: il prelievo diventa trasferimento', 4, el.prelievi[0]?.movimento.id);
verifica('elabora: la spesa con carta scritta a mano si collega', 9, el.collegamenti[0]?.spesa.id);
verifica('elabora: il bonifico diventa una spesa nuova', '1', el.nuove.map(n => n.movimento.id).join());
verifica('elabora: le entrate e gli ignorati no', 4, el.oneri.length + el.prelievi.length + el.collegamenti.length + el.nuove.length);
verifica('elabora: un movimento con la sua spesa non si tocca', 0, elaboraAlbatros({ movimenti: [dalDb(bonificoLasi, 1)], spese: [{ id: 2, movimento_id: 1 }], trasferimenti: [], storico: [], categorie: [] }).nuove.length);

// ---------- entrate dal conto ----------
const versamento = { id: 20, data_contabile: '2026-11-04', tipo: 'VERSAMENTO CONTANTI SU SPORTELLO AUTOMATICO', importo: 1400, descrizione: 'Effettuato presso ABI 01025 - ATM 7319' };
verifica('entrate: SumUp è un incasso POS', true, eIncassoPos(sumup));
verifica('entrate: il versamento di contanti', true, eVersamentoContanti(versamento));
verifica('entrate: natura dal trasferimento', 'versamento', naturaEntrata(versamento, new Set([20])));
verifica('entrate: senza niente è da completare', null, naturaEntrata({ id: 21 }, new Set()));
const bonificoEntrata = { descrizione: 'COD. DISP.: 0126101174244849 CASH 7613a8ac8b014f14b84bc43d9d32c485 SumUp 9-10-11/10/26 Bonifico a Vostro favore disposto da: MITT.: ALBATROS SAS DI SILIPO ROBERTO & C. BENEF.: ALBATROS S.A.S.' };
verifica('entrate: il mittente', 'ALBATROS SAS DI SILIPO ROBERTO & C.', mittenteDi(bonificoEntrata));
verifica('entrate: la causale', 'SumUp 9-10-11/10/26', causaleEntrataDi(bonificoEntrata));
verifica('entrate: il versamento scritto nel Cashflow si lega', 7, versamentoManualeDa(versamento, [{ id: 7, da: 'contanti', importo: 1400, data: '2026-11-03', movimento_id: null }])?.id);
verifica('trasferimenti: il prelievo dalla banca e quello scritto a mano sono lo stesso', 8, trasferimentiDoppi([
  { id: 1, da: 'conto', importo: 100, data: '2026-11-20', movimento_id: 55 },
  { id: 8, da: 'conto', importo: 100, data: '2026-11-19', movimento_id: null },
  { id: 9, da: 'contanti', importo: 100, data: '2026-11-19', movimento_id: null },
])[0]?.manuale.id);
const elPrel = elaboraAlbatros({ movimenti: [{ id: 4, data_contabile: '2026-11-20', tipo: 'PRELEVAMENTO CARTA', descrizione: '', importo: -100, ignorato: false, onere_spesa_id: null }], spese: [], trasferimenti: [{ id: 8, da: 'conto', importo: 100, data: '2026-11-19', movimento_id: null }], storico: [], categorie: [] });
verifica('elabora: il prelievo si lega a quello scritto a mano', 8, elPrel.prelievi[0]?.manuale?.id);
verifica('entrate: un prelievo no', null, versamentoManualeDa(versamento, [{ id: 7, da: 'conto', importo: 1400, data: '2026-11-03', movimento_id: null }]));

verifica('non in banca: la spesa con carta scritta a mano senza movimento', true, nonInBanca({ metodo: 'carta', movimento_id: null }));
verifica('non in banca: legata al movimento esiste', false, nonInBanca({ metodo: 'carta', movimento_id: 5 }));
verifica('non in banca: i contanti esistono', false, nonInBanca({ metodo: 'contanti', movimento_id: null }));
verifica('non in banca: non conta nel conto', 0, contoAlbatros([], [{ ente: 'albatros', metodo: 'carta', importo: 50, movimento_id: null }], []).speseCarta);

// ---------- operazioni non contabilizzate ----------
const nc = movimentiNonContabilizzati({ righeNonContabilizzate: [
  { data: '2026-11-06', tipo: 'PAGAMENTO TRAMITE POS', descrizione: 'METRO FIL SAN DONATO MIL', importo: -332.54 },
  { data: '2026-11-06', tipo: 'PAGAMENTO TRAMITE POS', descrizione: 'LEROY MERLIN', importo: -6.91 },
] });
verifica('NC: entrano come movimenti segnati', true, nc.every(m => m.nonContabilizzato));
verifica('NC: diventano spese con carta col nome del negozio', 'carta Metro Fil San Donato', `${spesaDaMovimento(nc[0]).metodo} ${spesaDaMovimento(nc[0]).descrizione}`);
verifica('NC: impronte diverse', 2, new Set(nc.map(m => m.impronta)).size);
const ncDb = { id: 30, non_contabilizzato: true, importo: -332.54, data_valuta: '2026-11-06', data_contabile: '2026-11-06' };
verifica('NC: il movimento contabilizzato che è diventata', 31, contabilizzatoDi(ncDb, [
  { id: 31, non_contabilizzato: false, importo: -332.54, data_valuta: '2026-11-06', data_contabile: '2026-11-09' },
  { id: 32, non_contabilizzato: false, importo: -332.54, data_valuta: '2026-10-20', data_contabile: '2026-10-22' },
])?.id);
verifica('NC: un altro importo no', null, contabilizzatoDi(ncDb, [{ id: 33, non_contabilizzato: false, importo: -330, data_valuta: '2026-11-06', data_contabile: '2026-11-09' }]));

// ---------- cruscotto delle spese ----------
const perCat = spesePerCategoria([
  { id: 1, importo: 50, categoria_id: 4 },
  { id: 2, importo: 100, multicategoria: true, categoria_id: null, movimento_id: 9 },
  { id: 3, importo: 30, metodo: 'carta', movimento_id: null },
  { id: 4, importo: 20, categoria_id: null },
], { 2: [{ importo: 60, categoria_id: 4 }, { importo: 10, categoria_id: 5 }] });
verifica('cruscotto: la spesa semplice e la voce dello scontrino nella stessa categoria', 110, perCat.get(4)?.totale);
verifica("cruscotto: l'altra voce", 10, perCat.get(5)?.totale);
verifica('cruscotto: la parte non dettagliata', 30, perCat.get(DA_DETTAGLIARE)?.totale);
verifica('cruscotto: senza categoria', 20, perCat.get(null)?.totale);
verifica('cruscotto: la spesa con carta non in banca non conta', 170, [...perCat.values()].reduce((t, g) => t + g.totale, 0));

// ---------- categorie delle spese a due livelli ----------
const catAlbero = [
  { id: 1, tipo: 'spesa', nome: 'Bar', ordine: 1, attiva: true, padre_id: null, gruppo: true },
  { id: 2, tipo: 'spesa', nome: 'Bibite', ordine: 1, attiva: true, padre_id: 1 },
  { id: 3, tipo: 'spesa', nome: 'Snack', ordine: 2, attiva: true, padre_id: 1 },
  { id: 4, tipo: 'spesa', nome: 'Manutenzione', ordine: 2, attiva: true, padre_id: null },
  { id: 5, tipo: 'spesa', nome: 'Utenze', ordine: 3, attiva: true, padre_id: null, gruppo: true },
];
verifica('categorie: albero', 'Bar(Bibite,Snack) Manutenzione() Utenze()', alberoCategorie(catAlbero, 'spesa').map(c => `${c.nome}(${c.figlie.map(f => f.nome).join(',')})`).join(' '));
verifica('categorie: si sceglie l\'ultimo livello', '2,3,4', foglieCategorie(catAlbero, 'spesa').map(c => c.id).join());
verifica('categorie: una principale non si sceglie', false, categoriaFoglia(catAlbero, 1));
verifica('categorie: una principale vuota non si sceglie lo stesso', false, foglieCategorie(catAlbero, 'spesa').some(c => c.id === 5));
verifica('categorie: una secondaria non raggruppata sì', true, categoriaFoglia(catAlbero, 4));
verifica('categorie: il nome col padre', 'Bar › Bibite', nomeCategoria(catAlbero, 2));
verifica('categorie: il filtro su Bar prende anche le figlie', '1,2,3', conSottocategorie(catAlbero, 1).join());
verifica('categorie: importo in Bar con le figlie', 70, importoInCategorie({ importo: 100, multicategoria: true }, [{ importo: 40, categoria_id: 2 }, { importo: 30, categoria_id: 3 }, { importo: 30, categoria_id: 4 }], [1, 2, 3]));
verifica('categorie: la prima scelta è una foglia', 2, idCategoriaScelta(null, catAlbero, 'spesa'));
verifica('categorie: posizioni in ordine d\'albero', '1:0 2:1 3:2 4:3 5:4', [...posizioniAlbero(catAlbero, 'spesa')].map(([id, i]) => `${id}:${i}`).join(' '));
const listinoOre = [{ id: 1, nome: 'Campo 1h', ore_campo: 1 }, { id: 2, nome: 'Campo sconto 1,5h', ore_campo: 1.5, tariffa_speciale: true }, { id: 3, nome: 'Birra' }];
const oreProva = oreCampo([{ voce_id: 1, quantita: 3 }, { voce_id: 2, quantita: 2 }, { voce_id: 3, quantita: 10 }, { voce_id: 1, quantita: 1 }], listinoOre);
verifica('ore campo: quantità per ore', 7, oreProva.ore);
verifica('ore campo: a tariffa speciale', 3, oreProva.speciali);
verifica('ore campo: per voce, la birra non conta', '1:4,2:3', oreProva.perVoce.map(x => `${x.voce.id}:${x.ore}`).join());
verifica('ore campo: testo', '1,5 h', testoOre(1.5));
verifica('ore campo: la sottocategoria eredita', true, categoriaConOreCampo([{ id: 1, ore_campo: true }, { id: 2, padre_id: 1 }], 2));
verifica('ore campo: altre categorie no', false, categoriaConOreCampo([{ id: 1, ore_campo: false }, { id: 2, padre_id: 1 }], 2));

const falliti = esiti.filter(e => !e.ok);
esiti.forEach(e => console.log(`${e.ok ? 'ok  ' : 'NO  '} ${e.caso}${e.ok ? '' : ` — atteso ${e.atteso}, ottenuto ${e.ottenuto}`}`));
console.log(`\n${esiti.length - falliti.length}/${esiti.length} verifiche passate`);
if (falliti.length) process.exit(1);
