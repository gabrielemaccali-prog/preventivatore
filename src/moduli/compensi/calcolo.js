import { toMinutes, oreDaOrari } from '../../lib/utils'

// ============================================================
// Calcolo del preventivo compensi. Funzioni pure: entrano prenotazioni e parametri, escono numeri.
// Niente supabase e niente React qui dentro, così il motore si può verificare da solo — ed è
// l'unico posto dove vive la regola dei blocchi.
// ============================================================

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

// Tutte le giornate da consuntivare, raggruppate per operatore. Le partite arrivano già filtrate
// (confermate e non future): qui si occupa solo di distribuirle per operatore e data.
export const preventiviPerOperatore = (prenotazioni, par) => {
  const perOperatore = new Map();
  for (const p of prenotazioni) {
    for (const op of (p.operatori || [])) {
      if (!perOperatore.has(op.id)) perOperatore.set(op.id, { id: op.id, nome: op.nome || op.id, giorni: new Map() });
      const voce = perOperatore.get(op.id);
      if (!voce.giorni.has(p.data)) voce.giorni.set(p.data, []);
      voce.giorni.get(p.data).push(p);
    }
  }

  return [...perOperatore.values()].map(voce => {
    const giornate = [...voce.giorni.entries()]
      .map(([data, partite]) => ({ data, ...preventivoGiornata(partite, par) }))
      .sort((a, b) => b.data.localeCompare(a.data));
    const compenso = giornate.reduce((s, g) => s + g.compenso, 0);
    const ore = giornate.reduce((s, g) => s + g.ore, 0);
    const oreAttesa = giornate.reduce((s, g) => s + g.oreAttesa, 0);
    const { lordo, ritenuta } = lordizza(compenso, par.aliquota_ritenuta);
    return { ...voce, giornate, ore, oreAttesa, compenso, lordo, ritenuta };
  }).sort((a, b) => a.nome.localeCompare(b.nome));
};
