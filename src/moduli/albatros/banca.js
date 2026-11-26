import { categoriaOneriBancari } from './calcolo.js'
// ============================================================
// Le spese dal conto in banca di Albatros: funzioni pure, provate da calcolo.prova.mjs.
// Il file lo legge leggiEstrattoConto (lib/banca.js), lo stesso dell'estratto di BFM: qui si
// sceglie cosa ne entra (le uscite dal 1 ottobre 2026), come si chiama la spesa, a quale spesa
// scritta a mano si abbina e quale categoria si propone.
// ============================================================

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Prima di questa data il conto teneva altro: i movimenti di prima non entrano. Il 30 settembre
// 2026, alla fine della giornata, il conto aveva 63,78 €.
export const DATA_INIZIO_BANCA = '2026-10-01';

// La data a cui un movimento appartiene: quella di valuta, o quella contabile se manca. Se la banca
// dice il periodo ("CANONE CARTA ... PERIODO 10/26", addebitato con valuta 30/09), conta il primo
// giorno di quel periodo: il canone di ottobre è una spesa di ottobre.
export function dataCompetenza(m) {
  const periodo = /PERIODO (\d{2})\/(\d{2})\b/i.exec(String(m?.descrizione || ''));
  if (periodo) return `20${periodo[2]}-${periodo[1]}-01`;
  return m?.dataValuta || m?.dataContabile;
}

// Il saldo del conto alla fine del giorno prima di DATA_INIZIO_BANCA, ricostruito dal file: il
// saldo iniziale più i movimenti che appartengono a prima. Serve solo se il file parte da prima.
export function saldoAllInizio(estratto) {
  if (!estratto?.dal || estratto.dal >= DATA_INIZIO_BANCA) return null;
  return r2((estratto.movimenti || []).filter(m => dataCompetenza(m) < DATA_INIZIO_BANCA)
    .reduce((t, m) => t + m.importo, estratto.saldoIniziale));
}

// Commissioni, canoni, bolli e competenze della banca: costi del conto, non acquisti.
export const eOnereBancario = (m) => /^(COSTO|COMMISSION[EI]|CANONE|IMPOSTA|COMPETENZE)\b/i.test(String(m?.tipo || '').trim());
// Un prelievo di contanti (allo sportello o in filiale): non è una spesa ma un trasferimento dal
// conto ai contanti in mano (albatros_trasferimenti, da = 'conto').
export const ePrelievo = (m) => /PRELIEV|PRELEV/i.test(String(m?.tipo || ''));
export const ePagamentoPos = (m) => /PAGAMENTO (POS|TRAMITE POS|EFFETTUATO SU POS)/i.test(String(m?.tipo || ''));

const pulisci = (t) => String(t || '').replace(/\s+/g, ' ').trim();
const maiuscoleIniziali = (t) => pulisci(t).toLowerCase().replace(/(^|[\s.-])(\p{L})/gu, (x, a, b) => a + b.toUpperCase());

// Chi c'è dall'altra parte, letto dalla descrizione estesa: il negozio di un pagamento POS, il
// beneficiario di un bonifico, il creditore di un addebito diretto (ADUE).
export function controparteDi(m) {
  const d = pulisci(m?.descrizione);
  const presso = /PRESSO (.+?)(?:\s{2,}|$)/i.exec(d);
  // Del negozio bastano le prime parole: dopo vengono filiale e città, tagliate dalla banca.
  if (presso) return maiuscoleIniziali(presso[1].split(/\s+/).slice(0, 4).join(' '));
  const nome = /NOME: (.+?) MANDATO/i.exec(d);
  if (nome) return maiuscoleIniziali(nome[1]);
  const favore = /a favore di: (.+?)(?: Saldo| Acconto| SALDO| ACCONTO|$)/.exec(d);
  if (favore && !/BENEFICIARI DIVERSI/i.test(favore[1])) return pulisci(favore[1]);
  // "98 SCT (DIS) Cod. Disp.: … disposto verso Wefor srl": il beneficiario sta in fondo.
  const verso = /disposto verso:? (.+)$/i.exec(d);
  if (verso && !/BENEFICIARI DIVERSI/i.test(verso[1])) return pulisci(verso[1]);
  // Un'operazione non ancora contabilizzata ha per descrizione il solo negozio ("METRO FIL SAN DONATO").
  if (m?.nonContabilizzato || m?.non_contabilizzato) return maiuscoleIniziali(d.split(/\s+/).slice(0, 4).join(' '));
  return '';
}

// La chiave con cui si riconosce la stessa controparte fra un mese e l'altro: le prime due parole,
// senza punteggiatura (METRO FIL.SAN DONATO… e METRO FIL SAN DONATO… sono la stessa).
export const chiaveControparte = (m) => controparteDi(m).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2).join(' ');

// La commissione di un bonifico o di un addebito diretto non è una spesa a sé: si somma alla spesa
// del movimento che l'ha generata. Si riconosce dal codice della disposizione, che la commissione
// ripete ("COSTO BONIFICO ISTANTANEO" col codice del bonifico, "COMMISSIONI E SPESE ADUE" con quello
// dell'addebito), o dal riferimento del bonifico nello stesso giorno. Canoni, bolli e competenze non
// hanno un movimento loro: restano spese a sé, negli oneri bancari.
// movimenti: le uscite fra cui cercare (quelle del file e quelle già caricate, con data_contabile).
const codiciIn = (d) => String(d || '').match(/\b\d{13,}\b/g) || [];
const riferimentiIn = (d) => String(d || '').match(/\b\d{10,}[0-9A-Z]*IT\b/g) || [];
const giornoDi = (m) => m.dataContabile || m.data_contabile;
export function principaleDi(onere, movimenti) {
  if (!eOnereBancario(onere)) return null;
  const uscite = (movimenti || []).filter(x => x !== onere && Number(x.importo) < 0 && !eOnereBancario(x));
  const codici = codiciIn(onere.descrizione);
  const perCodice = codici.length ? uscite.find(x => codiciIn(x.descrizione).some(c => codici.includes(c))) : null;
  if (perCodice) return perCodice;
  const rif = riferimentiIn(onere.descrizione);
  return rif.length ? uscite.find(x => giornoDi(x) === giornoDi(onere) && riferimentiIn(x.descrizione).some(r => rif.includes(r))) || null : null;
}

// La spesa che nasce da un'uscita: il giorno è quello dell'acquisto (data valuta, per un POS) o
// della contabilizzazione; il nome è la controparte, o il tipo di movimento. Quando il beneficiario
// sta in fondo ("disposto verso") si tengono tutte e due: "Disposizione Sct · Wefor srl".
export function spesaDaMovimento(m) {
  const pos = ePagamentoPos(m);
  const chi = controparteDi(m);
  return {
    data: (pos && m.dataValuta) || m.dataContabile,
    importo: r2(Math.abs(m.importo)),
    // Un onere si chiama col suo tipo (e di chi è, se c'è): "Commissioni e spese adue · Enegan Spa".
    descrizione: (eOnereBancario(m) || (chi && /disposto verso/i.test(String(m.descrizione || '')))
      ? [maiuscoleIniziali(m.tipo), chi].filter(Boolean).join(' · ')
      : chi || maiuscoleIniziali(m.tipo) || 'Movimento bancario').slice(0, 300),
    metodo: pos ? 'carta' : 'conto',
  };
}

// --- Operazioni non ancora contabilizzate (NC) ---
// La banca le elenca a parte, in fondo al file: entrano come gli altri movimenti, con la loro
// impronta, e si riconoscono dal segno NC. Quando un file successivo le contabilizza, il movimento
// contabilizzato prende il loro posto (vedi contabilizzatoDi).
const normalizzaNC = (t) => String(t || '').toUpperCase().replace(/\s+/g, ' ').trim();
export function movimentiNonContabilizzati(estratto) {
  const visti = new Map();
  return (estratto?.righeNonContabilizzate || []).map(r => {
    const base = `NC|${r.data}|${r2(r.importo).toFixed(2)}|${normalizzaNC(r.tipo)}|${normalizzaNC(r.descrizione)}`;
    const n = (visti.get(base) || 0) + 1;
    visti.set(base, n);
    return { dataContabile: r.data, dataValuta: r.data, tipo: r.tipo, descrizione: r.descrizione, importo: r.importo, nonContabilizzato: true, impronta: n > 1 ? `${base}#${n}` : base };
  });
}
// Il movimento contabilizzato che un'operazione NC è diventata: stesso importo, entro 7 giorni (la
// banca contabilizza qualche giorno dopo, e la data di valuta di un POS è quella dell'acquisto).
export const GIORNI_CONTABILIZZAZIONE = 7;
export function contabilizzatoDi(nc, movimenti, giaPresi = new Set()) {
  const giornoNC = nc.data_valuta || nc.data_contabile;
  return (movimenti || [])
    .filter(m => !m.non_contabilizzato && !giaPresi.has(m.id) && r2(m.importo) === r2(nc.importo))
    .filter(m => giorni(m.data_valuta || m.data_contabile, giornoNC) <= GIORNI_CONTABILIZZAZIONE)
    .sort((a, b) => giorni(a.data_valuta || a.data_contabile, giornoNC) - giorni(b.data_valuta || b.data_contabile, giornoNC))[0] || null;
}

// Le uscite del file che possono entrare: dal 1 ottobre 2026 (vedi dataCompetenza), non ancora caricate.
export function usciteDaImportare(movimenti, impronteGiaPresenti) {
  const gia = new Set(impronteGiaPresenti || []);
  const uscite = (movimenti || []).filter(m => m.importo < 0);
  return {
    nuove: uscite.filter(m => dataCompetenza(m) >= DATA_INIZIO_BANCA && !gia.has(m.impronta)),
    giaCaricate: uscite.filter(m => gia.has(m.impronta)).length,
    primaDellInizio: uscite.filter(m => dataCompetenza(m) < DATA_INIZIO_BANCA).length,
  };
}

// Una spesa scritta a mano come "Pagata con carta" prima che le spese con carta arrivassero dalla
// banca: si abbina al movimento invece di farne una seconda (stesso importo, entro 10 giorni, la
// più vicina). Così si tiene anche il dettaglio dello scontrino già scritto.
export const GIORNI_ABBINAMENTO = 10;
const giorni = (a, b) => Math.abs(new Date(`${a}T12:00:00`) - new Date(`${b}T12:00:00`)) / 86400000;
export function spesaManualeDa(m, spese, giaPrese = new Set()) {
  const s0 = spesaDaMovimento(m);
  return (spese || [])
    .filter(s => s.ente === 'albatros' && s.metodo === 'carta' && s.movimento_id == null && s.spesa_bfm_id == null && !giaPrese.has(s.id))
    .filter(s => r2(s.importo) === s0.importo && giorni(s.data, s0.data) <= GIORNI_ABBINAMENTO)
    .sort((a, b) => giorni(a.data, s0.data) - giorni(b.data, s0.data))[0] || null;
}

// La categoria proposta: gli oneri bancari vanno in Servizi accessori › Banca (categoriaOneriBancari); le
// altre prendono quella dell'ultima spesa dalla banca con la stessa controparte. Se no, nessuna:
// la si sceglie a mano, e dalla volta dopo si propone quella.
export function categoriaProposta(m, precedenti, categorie) {
  if (eOnereBancario(m)) return categoriaOneriBancari(categorie);
  const chiave = chiaveControparte(m);
  if (!chiave) return null;
  const uguale = (precedenti || [])
    .filter(p => p.chiave === chiave && p.categoria_id != null)
    .sort((a, b) => String(b.data).localeCompare(String(a.data)))[0];
  return uguale?.categoria_id ?? null;
}

// Cosa fare dei movimenti caricati che non hanno ancora una destinazione, come elabora() del
// modulo Spese di BFM. Le uscite (non ignorate, senza spesa, senza trasferimento, non già sommate
// come commissione) diventano:
//   oneri         la commissione di un'altra uscita: si somma alla sua spesa
//   prelievi      un prelievo di contanti: un trasferimento dal conto ai contanti (o quello già
//                 scritto a mano nel Cashflow, a cui si lega)
//   collegamenti  la spesa con carta già scritta a mano che il movimento paga
//   nuove         una spesa nuova, con la categoria proposta (o da completare)
// Le entrate restano fuori: l'incasso è quello delle chiusure.
// I movimenti arrivano dal database (data_contabile, data_valuta): qui si leggono come quelli del file.
const comeNelFile = (m) => ({ ...m, dataContabile: m.data_contabile ?? m.dataContabile, dataValuta: m.data_valuta ?? m.dataValuta });
export function elaboraAlbatros({ movimenti, spese, trasferimenti, storico, categorie }) {
  const conSpesa = new Set((spese || []).filter(s => s.movimento_id != null).map(s => s.movimento_id));
  const conTrasferimento = new Set((trasferimenti || []).filter(t => t.movimento_id != null).map(t => t.movimento_id));
  const validi = (movimenti || []).filter(m => !m.ignorato).map(comeNelFile);
  const liberi = validi.filter(m => Number(m.importo) < 0 && m.onere_spesa_id == null && !conSpesa.has(m.id) && !conTrasferimento.has(m.id));
  const esito = { oneri: [], prelievi: [], collegamenti: [], nuove: [] };
  const prese = new Set();
  const presiTrasferimenti = new Set();
  for (const m of liberi) {
    const principale = principaleDi(m, validi);
    if (principale) { esito.oneri.push({ movimento: m, principale, importo: r2(-Number(m.importo)) }); continue; }
    if (ePrelievo(m)) {
      const manuale = trasferimentoManualeDa(m, trasferimenti, 'conto', presiTrasferimenti);
      if (manuale) presiTrasferimenti.add(manuale.id);
      esito.prelievi.push({ movimento: m, spesa: spesaDaMovimento(m), manuale });
      continue;
    }
    const manuale = spesaManualeDa(m, spese, prese);
    if (manuale) { prese.add(manuale.id); esito.collegamenti.push({ movimento: m, spesa: manuale }); continue; }
    esito.nuove.push({ movimento: m, spesa: { ...spesaDaMovimento(m), categoria_id: categoriaProposta(m, storico, categorie) } });
  }
  return esito;
}

// La destinazione di un movimento, per la scheda Movimenti (come la colonna Destinazione della
// scheda Banca di BFM).
export function destinazioneMovimento(m, { spesaDi, trasferimentoDi, spesaPerId }) {
  if (m.ignorato) return { testo: 'Ignorato', classe: '' };
  if (Number(m.importo) > 0) {
    if (trasferimentoDi.has(m.id)) return { testo: 'Versamento contanti', classe: 'chiusa' };
    if (m.entrata === 'pos') return { testo: 'Incasso POS', classe: 'chiusa' };
    if (m.entrata === 'altro') return { testo: 'Altra entrata', classe: 'chiusa' };
    return { testo: 'Entrata da completare', classe: 'da-specificare' };
  }
  const s = spesaDi.get(m.id);
  if (s) return s.categoria_id == null && !s.multicategoria ? { testo: 'Spesa da completare', classe: 'da-specificare' } : { testo: 'Spesa', classe: 'chiusa' };
  if (trasferimentoDi.has(m.id)) return { testo: 'Prelievo (trasferimento)', classe: 'chiusa' };
  if (m.onere_spesa_id != null) return { testo: `Commissione di: ${spesaPerId.get(m.onere_spesa_id)?.descrizione?.slice(0, 40) || 'spesa'}`, classe: 'chiusa' };
  return { testo: 'Senza spesa', classe: 'oltre' };
}

// --- Entrate ---
// Un'entrata del conto è un incasso POS delle chiusure (accreditato da SumUp), un versamento dei
// contanti (un trasferimento dai contanti al conto) o un'altra entrata. Le prime due si riconoscono
// dalla descrizione; le altre si classificano a mano nella vista Incassi.
export const eVersamentoContanti = (m) => /VERSAMENTO CONTANTI/i.test(String(m?.tipo || ''));
export const eIncassoPos = (m) => /SUMUP/i.test(String(m?.descrizione || ''));
export const NATURE_ENTRATA = [
  { id: 'pos', label: 'Incasso POS' },
  { id: 'versamento', label: 'Versamento contanti' },
  { id: 'altro', label: 'Altra entrata' },
  { id: 'ignorato', label: 'Ignorata' },
];
// La natura di un'entrata com'è adesso: ignorata, versamento (ha il suo trasferimento), quella
// scelta, o null se è da completare.
export function naturaEntrata(m, trasferimentoDi) {
  if (m.ignorato) return 'ignorato';
  if (trasferimentoDi.has(m.id)) return 'versamento';
  return m.entrata || null;
}

// Chi ha mandato i soldi e perché, letti dalla descrizione di un bonifico in entrata.
export const mittenteDi = (m) => (/MITT\.: (.+?) BENEF\./i.exec(String(m?.descrizione || ''))?.[1] || '').trim();
export function causaleEntrataDi(m) {
  const d = String(m?.descrizione || '');
  const tra = /CASH \S+ (.+?) Bonifico a Vostro favore/i.exec(d);
  if (tra) return tra[1].replace(/^NOTPROVIDED\s*/i, '').trim();
  return d.replace(/^COD\. DISP\.: \d+\s*/i, '').slice(0, 120).trim();
}

// Un trasferimento scritto a mano nel Cashflow prima che arrivasse dalla banca (un versamento, da =
// 'contanti', o un prelievo, da = 'conto'): stesso importo, entro GIORNI_ABBINAMENTO giorni, non
// ancora legato a un movimento. Si lega al movimento invece di farne un secondo.
export function trasferimentoManualeDa(m, trasferimenti, da, giaPresi = new Set()) {
  const importo = r2(Math.abs(Number(m.importo)));
  const giorno = m.data_contabile ?? m.dataContabile;
  return (trasferimenti || [])
    .filter(t => t.da === da && t.movimento_id == null && !giaPresi.has(t.id) && r2(t.importo) === importo && giorni(t.data, giorno) <= GIORNI_ABBINAMENTO)
    .sort((a, b) => giorni(a.data, giorno) - giorni(b.data, giorno))[0] || null;
}
export const versamentoManualeDa = (m, trasferimenti, giaPresi) => trasferimentoManualeDa(m, trasferimenti, 'contanti', giaPresi);

// Trasferimenti contati due volte: uno nato dalla banca e uno scritto a mano nel Cashflow, stessa
// direzione e stesso importo entro GIORNI_ABBINAMENTO giorni. Si tiene quello scritto a mano (con la
// sua nota) e gli si lega il movimento.
export function trasferimentiDoppi(trasferimenti) {
  const manuali = (trasferimenti || []).filter(t => t.movimento_id == null);
  const presi = new Set();
  return (trasferimenti || []).filter(t => t.movimento_id != null).map(banca => {
    const manuale = trasferimentoManualeDa({ importo: banca.importo, data_contabile: banca.data }, manuali, banca.da, presi);
    if (manuale) presi.add(manuale.id);
    return manuale ? { banca, manuale } : null;
  }).filter(Boolean);
}
