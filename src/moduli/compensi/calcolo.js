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
  const registra = (id, nome) => {
    if (!perOperatore.has(id)) perOperatore.set(id, { id, nome: nome || id, giorni: new Map() });
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
    if (giaConsuntivato(v.operatore, v.data)) continue;
    const chiave = `${v.operatore}|${v.data}`;
    if (!vociPerChiave.has(chiave)) vociPerChiave.set(chiave, []);
    vociPerChiave.get(chiave).push(v);
    const voceOp = registra(v.operatore, null);
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
      .sort((a, b) => b.data.localeCompare(a.data));

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
  }).sort((a, b) => a.nome.localeCompare(b.nome));
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
