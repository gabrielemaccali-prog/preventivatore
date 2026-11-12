import { toMinutes, oreDaOrari } from './utils.js';
import { periodoCopre, idBar, barSeparato } from './fornitori.js';
import { STATO_PREN } from './costanti.js';

// ============================================================
// Quanto costa una partita al campo: l'affitto dalle tariffe, il rinfresco dal costo a persona.
//
// La usano il salvataggio di una prenotazione, che fotografa gli importi sulla riga, e il ricalcolo
// delle prenotazioni di un campo dopo che se ne sono cambiate le tariffe. Devono dare la stessa
// cifra sulla stessa partita, per questo la regola sta qui e non in ciascuno.
// Niente React e niente Supabase: funzioni pure, così il conto si può provare da solo.
// ============================================================

// Frazione IVA da applicare (percentuale del campo, es. 22 -> 0.22); 22% se il campo non la dice.
export const fracIva = (v) => (v != null && v !== '' ? parseFloat(v) : 22) / 100;

// Giorno settimana 1=Lun..7=Dom da una data ISO
export const giornoSettimana = (dataStr) => {
  if (!dataStr) return null;
  const d = new Date(dataStr).getDay(); // 0=Dom..6=Sab
  return d === 0 ? 7 : d;
};

// Affitto come scritto nel configuratore (lordo o netto secondo ivaInclusaCampo): la tariffa
// variabile la cui fascia contiene l'ora di inizio nel giorno scelto, altrimenti la flat.
export const tariffaCampoDi = (campo, tariffe, dataStr, oraInizio) => {
  if (!campo) return 0;
  const flat = parseFloat(campo.costoFlat) || 0;
  const g = giornoSettimana(dataStr);
  const oraMin = toMinutes(oraInizio);
  if (g == null || oraMin == null) return flat;
  for (const tr of tariffe.filter(x => x.campoId === campo.id)) {
    const giorni = (tr.giorni || "").split(',').filter(Boolean).map(Number);
    if (!giorni.includes(g)) continue;
    const ini = toMinutes(tr.oraInizio);
    let fin = toMinutes(tr.oraFine);
    if (ini == null) continue;
    if (fin == null || fin <= ini) fin = 24 * 60; // es. 19:00-00:00 -> mezzanotte
    if (oraMin >= ini && oraMin < fin) return parseFloat(tr.costo) || 0;
  }
  return flat;
};

// ---- Affitto a ore ----
// Le tariffe del configuratore sono orarie: una partita di due ore a 55 €/ora costa 110. Si
// percorre la partita minuto per minuto, così una partita a cavallo di due fasce (17-19 con la
// sera dalle 18) paga ogni ora alla sua tariffa.
const hhmm = (min) => { const m = ((Math.round(min) % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
// I minuti si contano per tratti a tariffa costante e si moltiplicano alla fine: sommare un
// sessantesimo alla volta lascia code di decimali che non tornano col prezzo.
const affittoTra = (campo, tariffe, data, da, a) => {
  const minutiPerTariffa = new Map();
  for (let m = da; m < a; m++) {
    const t = tariffaCampoDi(campo, tariffe, data, hhmm(m));
    minutiPerTariffa.set(t, (minutiPerTariffa.get(t) || 0) + 1);
  }
  return [...minutiPerTariffa].reduce((tot, [t, minuti]) => tot + (t * minuti) / 60, 0);
};

// Quante ore dura una partita: dagli orari se c'è l'ora di fine, altrimenti dal pacchetto.
export const oreDiPrenotazione = (p) => (p?.oraFine ? (oreDaOrari(p.oraInizio, p.oraFine) || 0) : (parseFloat(p?.durataOre) || 0));
// Inizio e fine in minuti sulla linea del giorno; null senza ora di inizio.
const estremi = (p) => {
  const inizio = toMinutes(p?.oraInizio);
  return inizio == null ? null : { inizio, fine: inizio + oreDiPrenotazione(p) * 60 };
};

// ---- Allestimento ----
// Alcuni centri fanno pagare il tempo per montare e smontare: Bergamo un'ora, mezz'ora prima e
// mezz'ora dopo. Si paga una volta per blocco di partite continue nello stesso campo e giorno, non
// a ogni partita: la prima del blocco porta la mezz'ora prima, l'ultima quella dopo. Due partite
// sono dello stesso blocco quando lo stacco fra loro è più corto dell'allestimento: il campo non
// si libera mai, perché il tempo per smontare e quello per rimontare si toccano.
// Contano le partite in programma (confermate e da confermare); `altre` può contenere anche la
// prenotazione stessa, e anche partite di altri campi o giorni: si scartano qui.
const STATI_IN_PROGRAMMA = [STATO_PREN.CONFERMATO, STATO_PREN.FORSE];
export const minutiAllestimentoDi = (campo) => Math.max(parseInt(campo?.minutiAllestimento, 10) || 0, 0);
export const allestimentoDi = (p, altre = [], campo) => {
  const minuti = minutiAllestimentoDi(campo);
  const suo = estremi(p);
  if (!minuti || !suo) return { prima: 0, dopo: 0 };
  const stesse = altre
    .filter(x => x && String(x.id) !== String(p.id) && x.campoId === p.campoId && x.data === p.data && STATI_IN_PROGRAMMA.includes(x.stato))
    .map(x => estremi(x)).filter(Boolean);
  const metà = minuti / 2;
  // Il blocco si allarga finché trova partite abbastanza vicine, da una parte e dall'altra.
  let { inizio, fine } = suo;
  let allargato = true;
  while (allargato) {
    allargato = false;
    for (const e of stesse) {
      if (e.inizio < fine + minuti && e.fine > inizio - minuti && (e.inizio < inizio || e.fine > fine)) {
        inizio = Math.min(inizio, e.inizio); fine = Math.max(fine, e.fine); allargato = true;
      }
    }
  }
  // Prima e ultima del blocco: a parità d'orario la porta chi ha l'id più basso, così due partite
  // identiche non la pagano entrambe.
  const primaDelBlocco = suo.inizio === inizio && !altre.some(x => x && String(x.id) < String(p.id) && x.campoId === p.campoId && x.data === p.data
    && STATI_IN_PROGRAMMA.includes(x.stato) && estremi(x)?.inizio === inizio);
  const ultimaDelBlocco = suo.fine === fine && !altre.some(x => x && String(x.id) < String(p.id) && x.campoId === p.campoId && x.data === p.data
    && STATI_IN_PROGRAMMA.includes(x.stato) && estremi(x)?.fine === fine);
  return { prima: primaDelBlocco ? metà : 0, dopo: ultimaDelBlocco ? metà : 0 };
};

// Gli importi che una prenotazione salva per il campo, netti e lordi. `tipoRinfresco` va passato
// solo se il pacchetto prevede il rinfresco: senza, il rinfresco vale zero.
// L'affitto è a ore: tariffa oraria per la durata della partita, più l'allestimento che le tocca.
// Senza durata vale un'ora, che è quello che il conto ha sempre fatto prima che fosse a ore.
// `campiOccupati`: due campi affiancati nella stessa ora sono due ore che il centro fattura.
// Moltiplica il solo affitto -- il rinfresco segue le persone, non i campi.
export const costiCampoDi = ({ campo, tariffe = [], data, oraInizio, oraFine, durataOre, allestimento = { prima: 0, dopo: 0 }, tipoRinfresco, numeroPartecipanti, campiOccupati = 1 }) => {
  if (!campo) return { costoCampoNetto: 0, costoCampoLordo: 0, costoRinfrescoNetto: 0, costoRinfrescoLordo: 0 };
  const ivaCampo = fracIva(campo.ivaCampo);
  const ivaRinfresco = fracIva(campo.ivaRinfresco);
  const ore = oreDiPrenotazione({ oraInizio, oraFine, durataOre }) || 1;
  const inizio = toMinutes(oraInizio);
  const prima = parseFloat(allestimento?.prima) || 0;
  const dopo = parseFloat(allestimento?.dopo) || 0;
  const perCampo = inizio == null
    ? tariffaCampoDi(campo, tariffe, data, null) * (ore + (prima + dopo) / 60)
    : affittoTra(campo, tariffe, data, inizio - prima, inizio + ore * 60 + dopo);
  const affitto = perCampo * Math.max(parseInt(campiOccupati, 10) || 1, 1);
  const numPart = parseFloat(numeroPartecipanti) || 0;
  const perPersona = tipoRinfresco === 'merenda' ? (parseFloat(campo.costoMerenda) || 0) : (parseFloat(campo.costoAperitivo) || 0);
  const rinfresco = tipoRinfresco && numPart ? perPersona * numPart : 0;
  return {
    costoCampoNetto: campo.ivaInclusaCampo ? affitto / (1 + ivaCampo) : affitto,
    costoCampoLordo: campo.ivaInclusaCampo ? affitto : affitto * (1 + ivaCampo),
    costoRinfrescoNetto: campo.ivaInclusaRinfresco ? rinfresco / (1 + ivaRinfresco) : rinfresco,
    costoRinfrescoLordo: campo.ivaInclusaRinfresco ? rinfresco : rinfresco * (1 + ivaRinfresco),
  };
};

// Quali parti di una prenotazione di quel campo sono già chiuse in un periodo consuntivato: sono
// state pagate e non si ricalcolano. Stessa regola della consuntivazione (fornitori.js).
// Di norma affitto e rinfresco si pagano insieme, quindi o sono chiusi tutti e due o nessuno. Col bar
// di un'altra società si pagano a parte, e ognuno si chiude per conto suo: con l'affitto pagato il
// rinfresco si può ancora ricalcolare, e viceversa. Un periodo del campo di prima della separazione
// ha pagato anche il rinfresco, se la sua riga lo portava.
export const partiChiuse = (periodi, campo, p) => {
  const delCampo = periodi.filter(pe => (pe.controparte || 'fornitore') === 'campo');
  const copre = (pe) => periodoCopre(pe, { riferimento: p.id, lato: 'costo', data: p.data });
  const campoChiuso = delCampo.filter(pe => String(pe.controparte_id) === String(campo.id) && copre(pe));
  if (!barSeparato(campo)) {
    const chiuso = campoChiuso.length > 0 || delCampo.some(pe => String(pe.controparte_id) === idBar(campo.id) && copre(pe));
    return { affitto: chiuso, rinfresco: chiuso };
  }
  const rigaConRinfresco = (pe) => {
    if (!pe.per_righe) return true;
    const r = (pe.righe || []).find(x => String(x.riferimento) === String(p.id) && x.lato === 'costo');
    return !!r && (!r.dettaglio || (parseFloat(r.dettaglio.rinfresco) || 0) > 0.005);
  };
  return {
    affitto: campoChiuso.length > 0,
    rinfresco: campoChiuso.some(rigaConRinfresco) || delCampo.some(pe => String(pe.controparte_id) === idBar(campo.id) && copre(pe)),
  };
};
export const giornataChiusa = (periodi, campo, p) => {
  const c = partiChiuse(periodi, campo, p);
  return c.affitto && c.rinfresco;
};

// Le prenotazioni di un campo i cui importi cambierebbero con le tariffe di adesso, fuori dai
// periodi già consuntivati. Per ognuna: gli importi salvati, quelli nuovi, le parti già pagate
// (che restano come sono) e il record da scrivere, con le sole parti ancora aperte.
// I costi del campo di una prenotazione già salvata, letti dai suoi stessi dati. `altre` sono le
// prenotazioni fra cui cercare quelle attaccate, per l'allestimento. Una partita commissionata dal
// campo stesso si gioca a casa sua: l'affitto non si paga, come al salvataggio.
export const costiCampoPrenotazione = (p, { campo, tariffe = [], altre = [] }) => {
  const c = costiCampoDi({
    campo, tariffe, data: p.data, oraInizio: p.oraInizio, oraFine: p.oraFine, durataOre: p.durataOre,
    allestimento: allestimentoDi(p, altre, campo),
    tipoRinfresco: p.tipoRinfresco, numeroPartecipanti: p.numeroPartecipanti, campiOccupati: p.campiOccupati,
  });
  return campo && p.clienteCampoId === campo.id ? { ...c, costoCampoNetto: 0, costoCampoLordo: 0 } : c;
};

export const ricalcoloCampo = ({ campo, tariffe = [], prenotazioni = [], periodi = [], altre = prenotazioni }) => {
  const r2 = (n) => Math.round((+n || 0) * 100) / 100;
  const netto = (n, l) => (n != null ? (parseFloat(n) || 0) : (parseFloat(l) || 0) / 1.22);
  return prenotazioni
    .filter(p => p.campoId === campo.id && p.data)
    .map(p => {
      const chiuse = partiChiuse(periodi, campo, p);
      const nuovi = costiCampoPrenotazione(p, { campo, tariffe, altre });
      const prima = { affitto: r2(netto(p.costoCampoNetto, p.costoCampo)), rinfresco: r2(netto(p.costoRinfrescoNetto, p.costoRinfresco)) };
      return {
        prenotazione: p,
        chiuse,
        prima,
        dopo: {
          affitto: chiuse.affitto ? prima.affitto : r2(nuovi.costoCampoNetto),
          rinfresco: chiuse.rinfresco ? prima.rinfresco : r2(nuovi.costoRinfrescoNetto),
        },
        rec: {
          ...(chiuse.affitto ? {} : { costoCampo: nuovi.costoCampoLordo, costoCampoNetto: nuovi.costoCampoNetto, costoCampoLordo: nuovi.costoCampoLordo }),
          ...(chiuse.rinfresco ? {} : { costoRinfresco: nuovi.costoRinfrescoLordo, costoRinfrescoNetto: nuovi.costoRinfrescoNetto, costoRinfrescoLordo: nuovi.costoRinfrescoLordo }),
        },
      };
    })
    .filter(x => Math.abs(x.prima.affitto - x.dopo.affitto) > 0.005 || Math.abs(x.prima.rinfresco - x.dopo.rinfresco) > 0.005)
    .sort((a, b) => String(a.prenotazione.data).localeCompare(String(b.prenotazione.data)));
};
