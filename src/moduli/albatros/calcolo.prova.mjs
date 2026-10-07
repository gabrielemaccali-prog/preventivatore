// Banco di prova dei conti di Albatros. Non fa parte dell'app: si esegue con
//   npm run prova:albatros
// Gira in Node senza dev server né browser, perché calcolo.js è fatto di sole funzioni pure.
import {
  quadratura, daSpecificare, giornataDiLavoro, chiusuraModificabile, cassaScrivibile, composizioneCorreggibile, aggiuntaConsentita,
  rigaDaIncrementare, vociFrequenti, voceDiNome, lunediDi, aggiungiGiorni, intervalloPeriodo,
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

verifica('chiusa con residuo: da specificare', true, daSpecificare({ chiusa_il: 'x' }, quadratura(ch, righe)));
verifica('chiusa tutta spiegata: no', false, daSpecificare({ chiusa_il: 'x' }, quadratura({ pos: 175, contanti: 0 }, righe)));
verifica('aperta: no', false, daSpecificare({ chiusa_il: null }, quadratura(ch, righe)));

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
