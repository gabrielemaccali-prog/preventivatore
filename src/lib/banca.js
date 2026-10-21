// ============================================================
// Banca e spese: la logica che serve al modulo Spese.
//
// Qui si legge l'estratto conto, si dà a ogni movimento un'impronta che lo riconosce anche quando
// il file si ricarica, si controlla che i saldi tornino e si decide che spesa nasce da ogni uscita
// (regole, oneri da agganciare al bonifico, spese scritte a mano da collegare).
// Niente React e niente Supabase: funzioni pure, così si provano da sole (npm run prova:banca).
// ============================================================

export const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
export const euro = (n) => `€${r2(n).toFixed(2)}`;

// ------------------------------------------------------------
// Lettura del file
// ------------------------------------------------------------

// Le date arrivano come numero di serie di Excel con una frazione di ora (46224,1666...): conta il
// giorno, quindi si tronca. Come testo sono "21/07/26" nelle righe e "21.07.2026" nei saldi.
const isoDaSerie = (v) => {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};
export const isoDaCella = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return isoDaSerie(v);
  const t = String(v ?? '').trim();
  const m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2}|\d{4})$/.exec(t);
  if (!m) return '';
  const anno = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${anno}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
};

// "39,287.03", "-477.00", 550: il file scrive gli importi all'inglese quando sono testo.
const numeroDaCella = (v) => {
  if (typeof v === 'number') return v;
  const t = String(v ?? '').trim().replace(/\s/g, '');
  if (!t || t === '-') return null;
  const n = Number(/,\d{1,2}$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

// Il codice della disposizione: identifica il movimento in banca. Sugli addebiti è la prima parola
// della descrizione estesa; sugli accrediti viene dopo "COD.DISP.:" (o "COD. DISP.:"); sui bonifici
// dall'estero dopo "N."; sui bonifici ordinari ricevuti dopo "Bonifico n.". Un pagamento POS, un F24
// o il canone non ne hanno.
// ATTENZIONE: il costo di un bonifico ha lo STESSO codice del bonifico, e così la commissione di un
// addebito diretto. Il codice da solo non è unico: lo è insieme al tipo (vedi impronta).
export const codiceDi = (descrizione) => {
  const t = String(descrizione ?? '').trim();
  const dopo = /COD\.?\s*DISP\.?:?\s*(\d{8,})/i.exec(t) || /Bonifico n\.\s*(\d{8,})/i.exec(t) || /^N\.\s*([0-9A-Z]{12,})/.exec(t);
  if (dopo) return dopo[1];
  const prima = /^(\d{12,})\b/.exec(t);
  return prima ? prima[1] : null;
};

// Una commissione che porta dentro il codice di un'altra disposizione ("... COMMISSIONI 0126...").
const codiciCitati = (descrizione) => String(descrizione ?? '').match(/\b\d{13,}\b/g) || [];

// L'impronta di un movimento: la stessa a ogni ricaricamento del file, diversa fra due movimenti.
// Con il codice basta tipo + codice. Senza, si usano i dati del movimento; e se nello stesso file
// due righe sono identiche (due F24 uguali lo stesso giorno) le distingue l'ordine: "#2".
const normalizza = (s) => String(s ?? '').toUpperCase().replace(/\s+/g, ' ').trim();
export function assegnaImpronte(movimenti) {
  const visti = new Map();
  return movimenti.map(m => {
    const base = m.codice
      ? `${normalizza(m.tipo)}|${m.codice}`
      : `${normalizza(m.tipo)}|${m.dataContabile}|${m.dataValuta || ''}|${r2(m.importo).toFixed(2)}|${normalizza(m.descrizione)}`;
    const n = (visti.get(base) || 0) + 1;
    visti.set(base, n);
    return { ...m, impronta: n === 1 ? base : `${base}#${n}` };
  });
}

// Legge l'estratto conto ("Lista Movimenti"). L'intestazione dei movimenti non è in prima riga:
// sopra ci sono conto, periodo e saldi, che servono al controllo. Le "operazioni non
// contabilizzate" in fondo restano fuori: si contano soltanto.
export function leggiEstrattoConto(XLSX, buffer) {
  const wb = XLSX.read(buffer, { type: 'array' });
  const righe = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
  const etichetta = (r) => String(r[2] ?? '').trim();
  const trova = (re) => righe.find(r => re.test(etichetta(r)));
  const rIniziale = trova(/^Saldo contabile iniziale al/i);
  const rFinale = trova(/^Saldo contabile finale al/i);
  const rConto = trova(/^Numero conto/i);
  const iIntest = righe.findIndex(r => String(r[0]).trim() === 'Data contabile' && String(r[2]).trim() === 'Descrizione');
  if (iIntest === -1 || !rIniziale || !rFinale) {
    throw new Error("non trovo i saldi e le colonne Data contabile e Descrizione: è la Lista Movimenti esportata dalla banca?");
  }
  const iNonContab = righe.findIndex((r, i) => i > iIntest && r.some(c => /Operazioni non contabilizzate/i.test(String(c))));
  const fine = iNonContab === -1 ? righe.length : iNonContab;

  const movimenti = [];
  for (const r of righe.slice(iIntest + 1, fine)) {
    const dataContabile = isoDaCella(r[0]);
    if (!dataContabile) continue;                         // righe dei saldi, vuote
    const accredito = numeroDaCella(r[3]);
    const addebito = numeroDaCella(r[4]);
    const importo = r2(accredito ? Math.abs(accredito) : addebito ? -Math.abs(addebito) : 0);
    if (!importo) continue;
    const descrizione = String(r[5] ?? '').replace(/\s+/g, ' ').trim();
    movimenti.push({
      dataContabile, dataValuta: isoDaCella(r[1]) || null,
      tipo: String(r[2] ?? '').replace(/\s+/g, ' ').trim(), descrizione, importo, codice: codiceDi(descrizione),
    });
  }
  const nonContabilizzati = iNonContab === -1 ? 0 : righe.slice(iNonContab + 1).filter(r => isoDaCella(r[1]) && numeroDaCella(r[3] || r[4])).length;

  const saldoIniziale = r2(numeroDaCella(rIniziale[4]));
  const saldoFinale = r2(numeroDaCella(rFinale[4]));
  const somma = r2(movimenti.reduce((t, m) => t + m.importo, 0));
  return {
    conto: rConto ? String(rConto[3] ?? '').trim() : '',
    dal: isoDaCella(rIniziale[3]), al: isoDaCella(rFinale[3]),
    saldoIniziale, saldoFinale,
    movimenti: assegnaImpronte(movimenti),
    nonContabilizzati,
    // Il file torna con se stesso: saldo iniziale + movimenti = saldo finale. Se no, qualche riga
    // non è stata letta, e prima di importare va capito perché.
    differenzaFile: r2(saldoIniziale + somma - saldoFinale),
  };
}

// ------------------------------------------------------------
// Controllo dei saldi fra un caricamento e l'altro
// ------------------------------------------------------------

// Il primo saldo noto fa da punto di partenza; da lì, saldo atteso a fine giornata X = saldo di
// partenza + tutti i movimenti fino a X. Ogni caricamento dichiara un saldo all'inizio del suo primo
// giorno e uno alla fine dell'ultimo: se uno dei due non torna, manca (o c'è in più) un pezzo di
// estratto conto prima di quella data.
export function controlloSaldi(caricamenti, movimenti) {
  const ordinati = [...(caricamenti || [])].sort((a, b) => a.dal.localeCompare(b.dal) || a.id - b.id);
  if (ordinati.length === 0) return { partenza: null, esiti: [] };
  const partenza = { data: ordinati[0].dal, saldo: r2(ordinati[0].saldo_iniziale) };
  const fino = (data, compresa) => r2(partenza.saldo + (movimenti || [])
    .filter(m => m.data_contabile >= partenza.data && (compresa ? m.data_contabile <= data : m.data_contabile < data))
    .reduce((t, m) => t + Number(m.importo), 0));
  const esiti = ordinati.map(c => {
    const attesoIniziale = fino(c.dal, false);
    const attesoFinale = fino(c.al, true);
    const diffIniziale = r2(r2(c.saldo_iniziale) - attesoIniziale);
    const diffFinale = r2(r2(c.saldo_finale) - attesoFinale);
    return { caricamento: c, attesoIniziale, attesoFinale, diffIniziale, diffFinale, ok: diffIniziale === 0 && diffFinale === 0 };
  });
  const ultimo = ordinati.reduce((u, c) => (c.al > u.al ? c : u), ordinati[0]);
  return { partenza, esiti, saldoAttuale: fino(ultimo.al, true), alGiorno: ultimo.al };
}

// ------------------------------------------------------------
// Dalla riga di banca alla spesa
// ------------------------------------------------------------

// Commissioni e costi: si sommano alla spesa principale quando c'è un'uscita con lo stesso codice.
export const eOnere = (m) => /^(COSTO|COMMISSIONE)\b/i.test(String(m?.tipo || '').trim());

// Cosa è stato pagato, per la descrizione della spesa: il testo utile senza i codici della banca.
export function descrizioneDi(m) {
  const t = String(m?.descrizione || '');
  const aFavore = /a favore di:\s*(.+)$/i.exec(t);
  if (aFavore) return aFavore[1].trim();
  const presso = /\bPRESSO\s+(.+)$/i.exec(t);
  if (presso) return presso[1].trim();
  const nome = /NOME:\s*(.+?)\s+MANDATO:/i.exec(t);
  if (nome) return nome[1].trim();
  const pos = /^(?:Pagamento su POS\s+)?(.+?)\s*(?:VIA)?\s*\d{2}\/\d{2}-\d{2}:\d{2}/i.exec(t);
  if (pos && /POS/i.test(m?.tipo || '')) return pos[1].replace(/\s+\d{5,}$/, '').trim();
  const pulito = t.replace(/^\S*\d{10,}\S*\s*/g, '').trim();
  return pulito || String(m?.tipo || '').trim();
}


// ------------------------------------------------------------
// Controparti: a chi va un'uscita operativa
// ------------------------------------------------------------

// Le controparti si riconoscono dal nome nel testo del bonifico, dopo "a favore di:" (o in tutta
// la descrizione, se non c'è). controparti = { bubbler, campo, fornitore }, ognuna un elenco di
// { id, nome, nomi }: nomi sono i modi in cui può comparire (nome e cognome, nome completo...).
// Un nome si riconosce quando tutte le sue parole significative ci sono, in qualunque ordine
// ("Stomboli Marcello", "Daniele Inzaghi"). Se due controparti vanno bene ugualmente non se ne
// sceglie nessuna: meglio chiedere che indovinare.
const parole = (s) => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^A-Z0-9]+/).filter(p => p.length > 1);
// Forme societarie e parole che da sole non distinguono nessuno.
const NON_DISTINTIVE = new Set(['SRL', 'SRLS', 'SPA', 'SAS', 'SNC', 'SSD', 'ASD', 'ARL', 'RL', 'SOCIETA', 'SPORTIVA', 'DILETTANTISTICA', 'IL', 'LA', 'LO', 'DI', 'DEL', 'DELLA', 'CENTRO', 'SPORTIVO']);
const testoBeneficiario = (m) => {
  const t = String(m?.descrizione || '');
  return (/a favore di:\s*(.+)$/i.exec(t)?.[1]) || t;
};
export function controparteDi(m, tipo, controparti) {
  const testo = new Set(parole(testoBeneficiario(m)));
  let migliore = null;
  let punti = 0;
  let pari = false;
  for (const c of (controparti?.[tipo] || [])) {
    for (const nome of (c.nomi || [c.nome])) {
      const p = [...new Set(parole(nome).filter(x => !NON_DISTINTIVE.has(x)))];
      // Un bubbler si riconosce da nome e cognome insieme; un campo o un fornitore da una parola sua.
      if (p.length < (tipo === 'bubbler' ? 2 : 1) || !p.every(x => testo.has(x))) continue;
      if (p.length > punti) { migliore = c; punti = p.length; pari = false; } else if (p.length === punti && c.id !== migliore?.id) pari = true;
    }
  }
  return pari ? null : migliore;
}

// Le anagrafiche dell'app nella forma che serve qui.
export const preparaControparti = ({ bubbler = [], campi = [], sedi = [] }) => ({
  // Un bubbler disattivo resta (dà il nome alle sue spese e si riconosce nei bonifici vecchi), ma
  // `attivo: false` lo toglie dalle tendine.
  bubbler: bubbler.map(b => ({ id: String(b.id), nome: [b.nome, b.cognome].filter(Boolean).join(' '), nomi: [[b.nome, b.cognome].filter(Boolean).join(' ')], attivo: b.attivo !== false })),
  campo: campi.map(c => ({ id: String(c.id), nome: c.nome, nomi: [c.nome, c.nomeCompleto].filter(Boolean) })),
  // La sede di BFM non è un fornitore: è casa nostra.
  fornitore: sedi.filter(s => !s.bfm).map(s => ({ id: String(s.id), nome: s.nome, nomi: [s.nome].filter(Boolean) })),
});
export const nomeControparte = (controparti, tipo, id) => (controparti?.[tipo] || []).find(c => c.id === String(id))?.nome || null;

// ------------------------------------------------------------
// Regole
// ------------------------------------------------------------

// Una condizione con alternative separate da "|": basta che una compaia (maiuscole indifferenti).
const contieneUna = (testo, condizione) => {
  const alt = String(condizione || '').split('|').map(s => s.trim().toUpperCase()).filter(Boolean);
  if (alt.length === 0) return true;
  const t = String(testo || '').toUpperCase();
  return alt.some(a => t.includes(a));
};

// La prima regola attiva, in ordine, le cui condizioni valgono tutte per il movimento.
export function regolaPer(m, regole, controparti) {
  const segno = Number(m.importo) < 0 ? 'uscita' : 'entrata';
  return [...(regole || [])]
    .filter(r => r.attiva)
    .sort((a, b) => a.ordine - b.ordine || a.id - b.id)
    .find(r => (r.segno || 'uscita') === segno
      && (r.tipo_contiene || r.testo_contiene || r.richiede_controparte)
      && contieneUna(m.tipo, r.tipo_contiene)
      && contieneUna(m.descrizione, r.testo_contiene)
      && (!r.richiede_controparte || !!controparteDi(m, r.operativa, controparti))) || null;
}

// La classificazione che una regola dà a una spesa, con la controparte riconosciuta nel movimento.
// Ogni livello c'è solo se ha senso per quello sopra: una spesa di Albatros non ha natura, una
// generale non ha controparte.
export function classificazioneDaRegola(regola, m, controparti) {
  const c = { ente: regola?.ente || null, natura: null, operativa: null, controparte_id: null, categoria_id: null, albatros_categoria_id: null };
  if (c.ente === 'albatros') c.albatros_categoria_id = regola.albatros_categoria_id ?? null;
  if (c.ente === 'bfm') {
    c.natura = regola.natura || null;
    if (c.natura === 'generale') c.categoria_id = regola.categoria_id ?? null;
    if (c.natura === 'operativa') {
      c.operativa = regola.operativa || null;
      // La controparte scritta nella regola; se non c'è, quella riconosciuta per nome nel movimento.
      c.controparte_id = !c.operativa ? null
        : regola.controparte_id != null ? String(regola.controparte_id)
          : (controparteDi(m, c.operativa, controparti)?.id ?? null);
    }
  }
  return c;
}

// Quello che una regola aggiunge a una spesa già esistente: solo i campi vuoti, e solo se la regola
// non contraddice quello che c'è già scritto (un altro ente, un'altra natura).
export function completaDaRegola(spesa, regola, m, controparti) {
  const c = classificazioneDaRegola(regola, m, controparti);
  if (!c.ente || (spesa.ente && spesa.ente !== c.ente)) return {};
  if (spesa.natura && c.natura && spesa.natura !== c.natura) return {};
  if (spesa.operativa && c.operativa && spesa.operativa !== c.operativa) return {};
  const patch = {};
  for (const k of Object.keys(c)) if ((spesa[k] ?? null) == null && c[k] != null) patch[k] = c[k];
  return patch;
}

// La regola proposta a partire da una spesa già classificata, per le uscite che si ripetono: il
// tipo di pagamento e il nome di chi riceve. Se la spesa ha la sua controparte (il bubbler, il
// fornitore) la regola la porta con sé. Si rivede sempre prima di salvarla.
export function regolaDaSpesa(spesa, m) {
  const tipo = String(m?.tipo || '');
  const chiaveTipo = ['BONIFICO', 'POS', 'ADUE', 'F24'].find(k => tipo.toUpperCase().includes(k)) || tipo.toUpperCase();
  const nomi = parole(descrizioneDi(m)).filter(p => !/^\d+$/.test(p));
  const testo = nomi.length === 0 ? '' : (nomi[0].length >= 4 ? nomi[0] : nomi.slice(0, 2).join(' '));
  const operativa = spesa.natura === 'operativa' ? spesa.operativa || null : null;
  return {
    nome: (testo || tipo).slice(0, 60), segno: Number(m?.importo) > 0 ? 'entrata' : 'uscita',
    tipo_contiene: chiaveTipo, testo_contiene: testo, richiede_controparte: false,
    azione: 'spesa', ente: spesa.ente || null, natura: spesa.natura || null, operativa,
    controparte_id: operativa ? spesa.controparte_id ?? null : null,
    categoria_id: spesa.categoria_id ?? null, albatros_categoria_id: spesa.albatros_categoria_id ?? null, descrizione: '', attiva: true,
  };
}

const giorniFra = (a, b) => Math.abs((Date.parse(b) - Date.parse(a)) / 86400000);
// Una spesa scritta a mano può essere quella che il movimento paga: stesso importo, pagata dal
// conto, ancora senza movimento, entro GIORNI_COLLEGAMENTO giorni.
export const GIORNI_COLLEGAMENTO = 10;
export const candidatiManuali = (m, spese) => (spese || []).filter(s =>
  s.origine === 'manuale' && s.metodo === 'conto' && s.movimento_id == null
  && r2(s.importo) === r2(-Number(m.importo)) && giorniFra(s.data, m.data_contabile) <= GIORNI_COLLEGAMENTO);

// Cosa fare dei movimenti ancora senza destinazione. Restituisce:
//   collegamenti  [{ movimento, spesa }]   la spesa scritta a mano che il movimento paga (una sola candidata)
//   nuove         [{ movimento, spesa }]   le spese da creare, classificate dalla regola (o da completare)
//   ignorati      [{ movimento, regola }]  i movimenti che una regola dice di ignorare
//   oneri         [{ movimento, principale }] commissioni da agganciare alla spesa del movimento principale
// Le entrate restano fuori: il loro abbinamento agli incassi è un passo successivo.
// Prima si decidono le uscite principali e poi gli oneri, che si appoggiano alla spesa di quelle.
export function elabora({ movimenti, spese, regole, controparti }) {
  const esito = { collegamenti: [], nuove: [], ignorati: [], oneri: [] };
  const conSpesa = new Set((spese || []).filter(s => s.movimento_id != null).map(s => s.movimento_id));
  const liberi = (movimenti || []).filter(m => Number(m.importo) < 0 && !m.ignorato && m.onere_spesa_id == null && !conSpesa.has(m.id));
  const usate = new Set();

  // Il movimento principale di un onere: un'uscita, non un onere, con lo stesso codice (o col codice
  // che la commissione cita nella descrizione).
  const principaleDi = (o) => {
    const codici = [o.codice, ...codiciCitati(o.descrizione)].filter(Boolean);
    return codici.length === 0 ? null : (movimenti || []).find(x => x.id !== o.id && !eOnere(x) && Number(x.importo) < 0 && !x.ignorato && codici.includes(x.codice)) || null;
  };

  for (const m of liberi) {
    if (eOnere(m) && principaleDi(m)) continue;
    const candidati = candidatiManuali(m, spese).filter(s => !usate.has(s.id));
    if (candidati.length === 1) {
      usate.add(candidati[0].id);
      esito.collegamenti.push({ movimento: m, spesa: candidati[0] });
      continue;
    }
    const regola = regolaPer(m, regole, controparti);
    if (regola?.azione === 'ignora') { esito.ignorati.push({ movimento: m, regola }); continue; }
    const c = classificazioneDaRegola(regola, m, controparti);
    esito.nuove.push({
      movimento: m,
      spesa: {
        data: m.data_contabile,
        importo: r2(-Number(m.importo)),
        descrizione: (regola?.descrizione || '').trim() || descrizioneDi(m),
        beneficiario: c.operativa ? nomeControparte(controparti, c.operativa, c.controparte_id) : null,
        ...c,
        metodo: 'conto', origine: 'banca', movimento_id: m.id, regola_id: regola?.id ?? null,
      },
    });
  }
  for (const m of liberi) {
    if (!eOnere(m)) continue;
    const p = principaleDi(m);
    if (p) esito.oneri.push({ movimento: m, principale: p });
  }
  return esito;
}

// ------------------------------------------------------------
// Categorie a due livelli
// ------------------------------------------------------------

// Le voci di primo livello in ordine, ognuna con le sue sottocategorie.
export const alberoCategorie = (categorie, { ancheArchiviate = false } = {}) => {
  const visibile = (c) => ancheArchiviate || c.attiva;
  const ordina = (a, b) => a.ordine - b.ordine || a.nome.localeCompare(b.nome);
  return (categorie || []).filter(c => c.padre_id == null && visibile(c)).sort(ordina)
    .map(c => ({ ...c, figlie: (categorie || []).filter(f => f.padre_id === c.id && visibile(f)).sort(ordina) }));
};
// Una spesa si attribuisce sempre all'ultimo livello: una sottocategoria, o una categoria che non
// ne ha di attive.
export const eFoglia = (categorie, id) => {
  const c = (categorie || []).find(x => x.id === id);
  return !!c && !(categorie || []).some(f => f.padre_id === c.id && f.attiva);
};
export const percorsoCategoria = (categorie, id) => {
  const c = (categorie || []).find(x => x.id === id);
  if (!c) return null;
  const padre = c.padre_id != null ? (categorie || []).find(x => x.id === c.padre_id) : null;
  return padre ? `${padre.nome} › ${c.nome}` : c.nome;
};
// Le voci sceglibili (l'ultimo livello) che corrispondono a un testo, nel loro nome o in quello del
// padre: "magazzino" trova Struttura › Magazzino/box, "struttura" tutte le voci di Struttura.
export const cercaCategorie = (categorie, testo) => {
  const t = String(testo || '').trim().toLowerCase();
  return alberoCategorie(categorie).flatMap(c => (c.figlie.length ? c.figlie : [c]))
    .filter(f => !t || (percorsoCategoria(categorie, f.id) || '').toLowerCase().includes(t));
};

// ------------------------------------------------------------
// La spesa come si mostra
// ------------------------------------------------------------

export const ENTI = [{ id: 'bfm', label: 'BFM' }, { id: 'albatros', label: 'Albatros' }];
export const NATURE = [{ id: 'operativa', label: 'Operativa (legata alle prenotazioni)' }, { id: 'generale', label: 'Generale' }];
export const OPERATIVE = [
  { id: 'bubbler', label: 'Compensi bubbler', controparte: 'Bubbler' },
  { id: 'campo', label: 'Affitto campi', controparte: 'Campo' },
  { id: 'fornitore', label: 'Fornitore', controparte: 'Fornitore' },
];
export const etichetta = (elenco, id) => elenco.find(x => x.id === id)?.label || '';

// Cosa manca alla classificazione di una spesa, nell'ordine in cui si sceglie; null se è completa.
export function cosaManca(s, categorie) {
  if (!s.ente) return 'BFM o Albatros';
  if (s.ente === 'albatros') return s.albatros_categoria_id == null ? 'la categoria di Albatros' : null;
  if (!s.natura) return 'operativa o generale';
  // Un'operativa si riconcilia con la sua controparte: senza il bubbler, il campo o il fornitore
  // non si sa con quale consuntivo abbinarla.
  if (s.natura === 'operativa') {
    if (!s.operativa) return 'il tipo di costo operativo';
    return s.controparte_id == null ? `il ${(OPERATIVE.find(o => o.id === s.operativa)?.controparte || 'controparte').toLowerCase()}` : null;
  }
  if (s.categoria_id == null) return 'la categoria';
  return eFoglia(categorie, s.categoria_id) ? null : 'la sottocategoria';
}
export const daCompletare = (s, categorie) => cosaManca(s, categorie) != null;
// Le operative sono costi che un altro modulo conosce già: andranno abbinate ai loro consuntivi.
export const daRiconciliare = (s) => s.ente === 'bfm' && s.natura === 'operativa' && !!s.operativa && s.controparte_id != null;

// Gli oneri bancari di una spesa: i movimenti agganciati come commissione (importi negativi).
export const oneriDi = (spesa, movimenti) =>
  r2((movimenti || []).filter(m => m.onere_spesa_id === spesa.id).reduce((t, m) => t - Number(m.importo), 0));

// Una spesa pagata dal conto e scritta a mano, che nell'estratto conto non è ancora comparsa.
export const nonInBanca = (s) => s.origine === 'manuale' && s.metodo === 'conto' && s.movimento_id == null;

export const METODI = [
  { id: 'conto', label: 'Conto corrente' },
  { id: 'contanti', label: 'Contanti' },
  { id: 'altro', label: 'Altro' },
];

// Una regola vuota, come la apre "Nuova regola".
export const REGOLA_VUOTA = {
  id: null, nome: '', segno: 'uscita', tipo_contiene: '', testo_contiene: '', azione: 'spesa', attiva: true, descrizione: '',
  ente: null, natura: null, operativa: null, richiede_controparte: false, controparte_id: null, categoria_id: null, albatros_categoria_id: null,
};

// Cosa farebbe una regola, applicata da sola, ai movimenti già caricati che prende. Per ognuno:
//   'completa'          la sua spesa è da completare e la regola riempie i campi vuoti (patch)
//   'gia_classificata'  la spesa è già completa: non si tocca
//   'contraddice'       la spesa ha già un ente, una natura o un tipo diversi da quelli della regola
//   'senza_spesa'       il movimento non ha una spesa (ignorato, onere di un bonifico, entrata)
// precedente è la regola più in alto che all'import prenderebbe il movimento al posto di questa:
// spiega perché una regola giusta "non funziona" sui movimenti nuovi.
export function esitoRegola({ regola, regole, spese, movimenti, controparti, categorie }) {
  const spesaDi = new Map((spese || []).filter(s => s.movimento_id != null).map(s => [s.movimento_id, s]));
  const sola = [{ ...regola, attiva: true }];
  return (movimenti || []).filter(m => regolaPer(m, sola, controparti)).map(m => {
    const prima = regolaPer(m, regole, controparti);
    const precedente = prima && prima.id !== regola.id ? prima : null;
    const spesa = spesaDi.get(m.id) || null;
    if (!spesa) return { movimento: m, spesa, esito: 'senza_spesa', precedente };
    if (!daCompletare(spesa, categorie)) return { movimento: m, spesa, esito: 'gia_classificata', precedente };
    const patch = regola.azione === 'spesa' ? completaDaRegola(spesa, regola, m, controparti) : {};
    return { movimento: m, spesa, esito: Object.keys(patch).length ? 'completa' : 'contraddice', patch, precedente };
  });
}
