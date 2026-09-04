import { toMinutes, oreDaOrari } from '../../lib/utils.js'

// ============================================================
// Calcolo del preventivo compensi. Funzioni pure: entrano prenotazioni e parametri, escono numeri.
// Niente supabase e niente React qui dentro, così il motore si può verificare da solo — ed è
// l'unico posto dove vive la regola dei blocchi.
// ============================================================

// Gli importi si ripartiscono al centesimo: senza arrotondare, le quote per partita si portano
// dietro code binarie che poi non tornano con il totale mostrato.
const arrotondaCentesimi = (n) => Math.round(n * 100) / 100;

// Durata in ore di una partita: dagli orari quando c'è l'ora di fine, altrimenti dalla durata
// fissa del pacchetto (stessa lettura che fa il modulo prenotazioni).
export const oreDiPartita = (p) => p.oraFine
  ? (oreDaOrari(p.oraInizio, p.oraFine) || 0)
  : (parseFloat(p.durataOre) || 0);

// Inizio e fine in minuti sulla linea del giorno. La fine può superare i 1440 minuti quando la
// partita sconfina oltre la mezzanotte: va bene, serve solo a misurare gli stacchi.
const estremiDi = (p) => {
  const inizio = toMinutes(p.oraInizio);
  if (inizio == null) return null;
  return { inizio, fine: inizio + oreDiPartita(p) * 60 };
};

// Partite di una giornata raggruppate in blocchi consecutivi: due partite restano nello stesso
// blocco se lo stacco fra la fine dell'una e l'inizio dell'altra rientra nel limite. Oltre, il
// blocco nuovo riparte dalla prima ora — che è il motivo per cui il compenso non è calcolabile
// guardando una partita per volta.
//
// L'attesa dentro un blocco è pagata: l'operatore è comunque lì. Quindi le ore del blocco sono la
// sua estensione da inizio a fine, non la somma delle durate — e ogni attesa viene attribuita alla
// partita che la segue, che è quella per cui si è aspettato.
export const blocchiDiGiornata = (partite, gapMassimoMin) => {
  const ordinate = partite
    .map(p => ({ partita: p, ...(estremiDi(p) || {}) }))
    .filter(x => x.inizio != null)
    .sort((a, b) => a.inizio - b.inizio);

  const blocchi = [];
  for (const voce of ordinate) {
    const ultimo = blocchi[blocchi.length - 1];
    // Stacco negativo = partite sovrapposte (di norma un errore nei dati): niente attesa da pagare.
    const stacco = ultimo ? voce.inizio - ultimo.fine : null;
    const inserimento = {
      partita: voce.partita,
      attesaMin: ultimo && stacco > 0 ? stacco : 0,
      oreAttribuite: oreDiPartita(voce.partita) + (ultimo && stacco > 0 ? stacco / 60 : 0),
    };
    if (ultimo && stacco <= gapMassimoMin) {
      ultimo.partite.push(inserimento);
      ultimo.fine = Math.max(ultimo.fine, voce.fine);
    } else {
      blocchi.push({ inizio: voce.inizio, fine: voce.fine, partite: [{ ...inserimento, attesaMin: 0, oreAttribuite: oreDiPartita(voce.partita) }] });
    }
  }

  return blocchi.map(b => {
    const oreLavorate = b.partite.reduce((s, x) => s + oreDiPartita(x.partita), 0);
    const estensione = (b.fine - b.inizio) / 60;
    // Con partite sovrapposte l'estensione può risultare minore delle ore lavorate: si paga il maggiore.
    const ore = Math.max(estensione, oreLavorate);
    return { ...b, oreLavorate, oreAttesa: Math.max(0, ore - oreLavorate), ore };
  });
};

// Compenso orario di un blocco: la prima ora vale sempre la tariffa piena (anche se il blocco
// dura meno), le ore successive si pagano in proporzione — così la mezz'ora vale metà.
export const compensoDiBlocco = (ore, par) => {
  if (ore <= 0) return 0;
  const prima = parseFloat(par.prima_ora) || 0;
  const successiva = parseFloat(par.ora_successiva) || 0;
  return ore <= 1 ? prima : prima + (ore - 1) * successiva;
};

// Preventivo di una giornata per un operatore: blocchi, ore lavorate e compenso orario col tetto.
// Il tetto agisce sulla somma dei blocchi del giorno, non sul singolo blocco.
export const preventivoGiornata = (partite, par) => {
  const blocchi = blocchiDiGiornata(partite, parseFloat(par.gap_consecutivita_min) || 0);
  const dettaglio = blocchi.map(b => ({ ...b, compenso: compensoDiBlocco(b.ore, par) }));
  const ore = dettaglio.reduce((s, b) => s + b.ore, 0);
  const oreLavorate = dettaglio.reduce((s, b) => s + b.oreLavorate, 0);
  const oreAttesa = dettaglio.reduce((s, b) => s + b.oreAttesa, 0);
  const primaDelTetto = dettaglio.reduce((s, b) => s + b.compenso, 0);
  const tetto = parseFloat(par.tetto_giornaliero) || Infinity;
  const compenso = Math.min(primaDelTetto, tetto);

  // Quota di compenso di ogni singola partita: serve a mostrare una riga per partita e sarà la base
  // dell'attribuzione ai costi.
  //
  // Il riparto è cronologico, non proporzionale: si percorrono le ore del blocco in ordine e ognuna
  // vale la sua tariffa. La prima ora cara appartiene a chi ha aperto il blocco, non si spalma su
  // tutti. Due partite da 2 ore attaccate fanno quindi 40 e 20, non 30 e 30 — chi è arrivato dopo
  // trova le ore già scontate. Poi si scala del taglio del tetto, se ha morso, e l'ultima quota
  // assorbe il resto così la somma torna al centesimo.
  const fattoreTetto = primaDelTetto > 0 ? compenso / primaDelTetto : 1;
  for (const b of dettaglio) {
    const daRipartire = arrotondaCentesimi(b.compenso * fattoreTetto);
    let orePrecedenti = 0;
    let assegnato = 0;
    b.partite.forEach((x, i) => {
      const oreFinQui = orePrecedenti + x.oreAttribuite;
      const marginale = compensoDiBlocco(oreFinQui, par) - compensoDiBlocco(orePrecedenti, par);
      x.compenso = i === b.partite.length - 1
        ? arrotondaCentesimi(daRipartire - assegnato)
        : arrotondaCentesimi(marginale * fattoreTetto);
      assegnato = arrotondaCentesimi(assegnato + x.compenso);
      orePrecedenti = oreFinQui;
    });
    b.compenso = daRipartire;
  }

  return { blocchi: dettaglio, ore, oreLavorate, oreAttesa, primaDelTetto, compenso, tettoApplicato: primaDelTetto > tetto };
};

// Lordizzazione: il compenso calcolato è quello che l'operatore incassa in mano, quindi la ritenuta
// si aggiunge sopra invece di essere trattenuta. Con aliquota 20% un netto di 45 costa 56,25.
export const lordizza = (netto, aliquotaPerc) => {
  const a = (parseFloat(aliquotaPerc) || 0) / 100;
  if (a <= 0 || a >= 1) return { lordo: netto, ritenuta: 0 };
  const lordo = netto / (1 - a);
  return { lordo, ritenuta: lordo - netto };
};

// Somma le voci manuali di una giornata separando ciò che concorre al compenso (recensioni e
// rettifiche, su cui poi si calcola la ritenuta) da ciò che è puro rimborso spese (esente).
export const totaliVoci = (voci) => (voci || []).reduce((a, v) => {
  const importo = parseFloat(v.importo) || 0;
  return v.esente_ritenuta
    ? { ...a, spese: a.spese + importo }
    : { ...a, aggiunte: a.aggiunte + importo };
}, { aggiunte: 0, spese: 0 });

// Tutte le giornate da consuntivare, raggruppate per operatore. Le partite arrivano già filtrate
// (confermate, non future e non già consuntivate): qui si distribuiscono per operatore e data e si
// agganciano le voci manuali registrate su quello stesso giorno.
// `giaConsuntivato(operatore, data)` permette di escludere le giornate già chiuse. L'esclusione è
// per operatore e non per partita: la stessa partita può essere chiusa per un operatore e ancora
// aperta per un altro che c'era insieme a lui.
export const preventiviPerOperatore = (prenotazioni, voci, par, giaConsuntivato = () => false) => {
  const perOperatore = new Map();
  // Il nome arriva dallo snapshot della prenotazione e può mancare: un operatore che ha solo
  // voci registrate, e nessuna partita, non ce l'ha. Resta null e lo risolve chi mostra il dato,
  // che ha l'anagrafica sotto mano: qui l'id è un numero, e spacciarlo per nome faceva esplodere
  // l'ordinamento alfabetico.
  const registra = (id, nome) => {
    if (!perOperatore.has(id)) perOperatore.set(id, { id, nome: nome || null, giorni: new Map() });
    return perOperatore.get(id);
  };

  for (const p of prenotazioni) {
    for (const op of (p.operatori || [])) {
      if (giaConsuntivato(op.id, p.data)) continue;
      const voce = registra(op.id, op.nome);
      if (!voce.giorni.has(p.data)) voce.giorni.set(p.data, []);
      voce.giorni.get(p.data).push(p);
    }
  }

  // Le voci vivono su operatore + data: una spesa può esistere anche in un giorno senza partite
  // (un pernottamento alla vigilia), quindi il giorno va creato lo stesso.
  const vociPerChiave = new Map();
  for (const v of (voci || [])) {
    if (giaConsuntivato(v.operatore_id, v.data)) continue;
    const chiave = `${v.operatore_id}|${v.data}`;
    if (!vociPerChiave.has(chiave)) vociPerChiave.set(chiave, []);
    vociPerChiave.get(chiave).push(v);
    const voceOp = registra(v.operatore_id, null);
    if (!voceOp.giorni.has(v.data)) voceOp.giorni.set(v.data, []);
  }

  return [...perOperatore.values()].map(voce => {
    const giornate = [...voce.giorni.entries()]
      .map(([data, partite]) => {
        const vociGiorno = vociPerChiave.get(`${voce.id}|${data}`) || [];
        const { aggiunte, spese } = totaliVoci(vociGiorno);
        const calcolo = preventivoGiornata(partite, par);
        return {
          data, ...calcolo, voci: vociGiorno, aggiunte, spese,
          // Compenso della giornata: ore + recensioni e rettifiche. Le spese restano fuori,
          // sono un rimborso e non un compenso.
          compensoConVoci: calcolo.compenso + aggiunte,
        };
      })
      // Dalla più vecchia alla più recente: il dettaglio si legge come un diario, e l'ultima riga
      // prima del totale è l'ultima giornata lavorata.
      .sort((a, b) => a.data.localeCompare(b.data));

    const somma = (f) => giornate.reduce((s, g) => s + f(g), 0);
    const compensoOrario = somma(g => g.compenso);
    const aggiunte = somma(g => g.aggiunte);
    const spese = somma(g => g.spese);
    // Le aggiunte separate per tipo servono ai totali di colonna: rettifiche e recensioni
    // concorrono entrambe al compenso, ma nella tabella stanno in due colonne diverse.
    const perTipo = (tipo) => giornate.reduce(
      (s, g) => s + g.voci.filter(v => v.tipo === tipo).reduce((t, v) => t + (parseFloat(v.importo) || 0), 0), 0
    );
    const compenso = compensoOrario + aggiunte;
    const { lordo, ritenuta } = lordizza(compenso, par.aliquota_ritenuta);
    return {
      ...voce, giornate,
      ore: somma(g => g.ore), oreAttesa: somma(g => g.oreAttesa),
      compensoOrario, aggiunte, spese, compenso, lordo, ritenuta,
      totaleRettifiche: perTipo('rettifica'), totaleRecensioni: perTipo('recensione'),
      costoAzienda: lordo + spese,
    };
  }).sort((a, b) => String(a.nome ?? a.id).localeCompare(String(b.nome ?? b.id)));
};

// Rettifiche che portano il compenso a ore di un periodo esattamente all'importo concordato.
//
// Invece di tenere il concordato come valore a parte e ricalcolare tutto in modo diverso, si
// materializza la differenza in righe di rettifica: da quel momento il calcolo normale arriva da
// solo al totale pattuito, e il dettaglio per partita è leggibile senza conoscere regole speciali.
// La quota di ogni partita è proporzionale alle ore attribuite; l'ultima assorbe il resto, così la
// somma torna al centesimo.
//
// Restituisce una riga per partita (anche a differenza nulla, per non lasciare buchi nel racconto).
// Senza ore non c'è divisore e non si genera niente.
export const rettificheForfait = (preventivo, importo) => {
  const tutte = preventivo.giornate.flatMap(g =>
    g.blocchi.flatMap(b => b.partite.map(x => ({ ...x, data: g.data }))));
  const oreTotali = tutte.reduce((s, x) => s + x.oreAttribuite, 0);
  if (oreTotali <= 0 || tutte.length === 0) return [];

  const totale = arrotondaCentesimi(parseFloat(importo) || 0);
  let assegnato = 0;
  return tutte.map((x, i) => {
    const quota = i === tutte.length - 1
      ? arrotondaCentesimi(totale - assegnato)
      : arrotondaCentesimi(totale * (x.oreAttribuite / oreTotali));
    assegnato = arrotondaCentesimi(assegnato + quota);
    return {
      riferimento: x.partita.id,
      data: x.data,
      quota,
      calcolato: x.compenso,
      differenza: arrotondaCentesimi(quota - x.compenso),
    };
  });
};

// Riparto di un compenso concordato sulle partite del periodo, in proporzione alle ore attribuite.
// Qui non vale la regola cronologica della prima ora: quella descrive una tariffa che il concordato
// ha sostituito. L'importo pattuito è un blocco unico, e si divide per le ore effettivamente fatte —
// quindi ogni partita ne prende la sua quota. Anche il tetto giornaliero decade: il tetto limita il
// calcolo a ore, non un importo deciso a mano.
//
// Senza ore non c'è divisore: il preventivo torna com'era e l'importo resta non attribuito.
export const ripartisciSuOre = (preventivo, importo, par) => {
  const tutte = preventivo.giornate.flatMap(g => g.blocchi.flatMap(b => b.partite));
  const oreTotali = tutte.reduce((s, x) => s + x.oreAttribuite, 0);
  if (oreTotali <= 0) return preventivo;

  const totale = arrotondaCentesimi(parseFloat(importo) || 0);
  // L'ultima quota assorbe il resto, così la somma torna esattamente all'importo pattuito.
  const quote = new Map();
  let assegnato = 0;
  tutte.forEach((x, i) => {
    const quota = i === tutte.length - 1
      ? arrotondaCentesimi(totale - assegnato)
      : arrotondaCentesimi(totale * (x.oreAttribuite / oreTotali));
    quote.set(x, quota);
    assegnato = arrotondaCentesimi(assegnato + quota);
  });

  const giornate = preventivo.giornate.map(g => {
    const blocchi = g.blocchi.map(b => {
      const partite = b.partite.map(x => ({ ...x, compenso: quote.get(x) }));
      return { ...b, partite, compenso: arrotondaCentesimi(partite.reduce((s, x) => s + x.compenso, 0)) };
    });
    const compenso = arrotondaCentesimi(blocchi.reduce((s, b) => s + b.compenso, 0));
    return { ...g, blocchi, compenso, primaDelTetto: compenso, tettoApplicato: false, compensoConVoci: compenso + g.aggiunte };
  });

  const compensoOrario = arrotondaCentesimi(giornate.reduce((s, g) => s + g.compenso, 0));
  const compenso = compensoOrario + preventivo.aggiunte;
  const { lordo, ritenuta } = lordizza(compenso, par.aliquota_ritenuta);
  return { ...preventivo, giornate, compensoOrario, compenso, lordo, ritenuta, costoAzienda: lordo + preventivo.spese };
};

// Importi del documento di rimborso.
//
// Il totale a pagare è deciso in consuntivazione e non si muove: è quanto l'operatore incassa.
// I rimborsi — spese registrate e trasferte — non si aggiungono sopra, si scorporano da dentro:
// spostano una fetta dal compenso ai rimborsi, e su quella la ritenuta non si paga perché è denaro
// anticipato e restituito, non guadagnato. L'operatore incassa uguale, l'azienda versa meno
// ritenuta. Sul solo compenso residuo, che è netto in mano, l'imponibile si ottiene lordizzando.
export const importiRimborso = ({ daPagare, spese = 0, trasferte = 0 }, aliquotaPerc) => {
  const totale = arrotondaCentesimi(parseFloat(daPagare) || 0);
  // I rimborsi non possono superare quello che c'è da pagare: oltre, si starebbe restituendo
  // denaro mai maturato e il compenso diventerebbe negativo.
  const rimborsi = Math.min(
    arrotondaCentesimi((parseFloat(spese) || 0) + (parseFloat(trasferte) || 0)),
    Math.max(totale, 0)
  );
  const netto = arrotondaCentesimi(totale - rimborsi);
  const { lordo, ritenuta } = lordizza(netto, aliquotaPerc);
  return {
    imponibile: arrotondaCentesimi(lordo),
    ritenuta: arrotondaCentesimi(ritenuta),
    netto,
    rimborsi,
    totale,
  };
};

// Consuntivo di un periodo: prende il preventivo di un operatore e ci applica le due leve del
// manager. Restituisce i numeri che verranno congelati in op_periodi.
//
// - `concordato` (se valorizzato) sostituisce il compenso calcolato dalle ore; recensioni e
//   rettifiche restano e si sommano sopra, come sopra il calcolo orario.
// - `forfettario` non aggiunge nulla al totale: sposta una fetta di compenso fuori dalla base
//   imponibile, quindi l'operatore incassa uguale e l'azienda paga meno ritenuta.
export const consuntivoDiPeriodo = (preventivo, { concordato = null, forfettario = 0 } = {}, par) => {
  const base = concordato != null && concordato !== ''
    ? (parseFloat(concordato) || 0)
    : preventivo.compensoOrario;
  const compenso = base + preventivo.aggiunte;
  // Il forfettario non può superare il compenso: oltre, si starebbe rimborsando denaro mai maturato.
  const rimborsoForfettario = Math.min(Math.max(parseFloat(forfettario) || 0, 0), Math.max(compenso, 0));
  const imponibile = compenso - rimborsoForfettario;
  const { lordo, ritenuta } = lordizza(imponibile, par.aliquota_ritenuta);
  const spese = preventivo.spese;
  return {
    base,
    compensoNetto: compenso,
    rimborsoForfettario,
    imponibile,
    lordo,
    ritenuta,
    spese,
    costoAzienda: lordo + rimborsoForfettario + spese,
    incassaOperatore: compenso + spese,
    concordatoApplicato: concordato != null && concordato !== '',
  };
};
