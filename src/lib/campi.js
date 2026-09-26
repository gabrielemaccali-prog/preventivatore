import { toMinutes } from './utils.js';

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

// Gli importi che una prenotazione salva per il campo, netti e lordi. `tipoRinfresco` va passato
// solo se il pacchetto prevede il rinfresco: senza, il rinfresco vale zero.
export const costiCampoDi = ({ campo, tariffe = [], data, oraInizio, tipoRinfresco, numeroPartecipanti }) => {
  if (!campo) return { costoCampoNetto: 0, costoCampoLordo: 0, costoRinfrescoNetto: 0, costoRinfrescoLordo: 0 };
  const ivaCampo = fracIva(campo.ivaCampo);
  const ivaRinfresco = fracIva(campo.ivaRinfresco);
  const affitto = tariffaCampoDi(campo, tariffe, data, oraInizio);
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

// Una giornata di quel campo è già chiusa in un periodo consuntivato: i suoi importi sono stati
// pagati e non si ricalcolano. Stessa regola della consuntivazione (fornitori.js).
export const giornataChiusa = (periodi, campoId, data) => periodi.some(pe =>
  (pe.controparte || 'fornitore') === 'campo' && String(pe.controparte_id) === String(campoId) && data >= pe.dal && data <= pe.al);

// Le prenotazioni di un campo i cui importi cambierebbero con le tariffe di adesso, fuori dai
// periodi già consuntivati. Per ognuna: gli importi salvati, quelli nuovi e il record da scrivere.
export const ricalcoloCampo = ({ campo, tariffe = [], prenotazioni = [], periodi = [] }) => {
  const r2 = (n) => Math.round((+n || 0) * 100) / 100;
  const netto = (n, l) => (n != null ? (parseFloat(n) || 0) : (parseFloat(l) || 0) / 1.22);
  return prenotazioni
    .filter(p => p.campoId === campo.id && p.data && !giornataChiusa(periodi, campo.id, p.data))
    .map(p => {
      const nuovi = costiCampoDi({ campo, tariffe, data: p.data, oraInizio: p.oraInizio, tipoRinfresco: p.tipoRinfresco, numeroPartecipanti: p.numeroPartecipanti });
      return {
        prenotazione: p,
        prima: { affitto: r2(netto(p.costoCampoNetto, p.costoCampo)), rinfresco: r2(netto(p.costoRinfrescoNetto, p.costoRinfresco)) },
        dopo: { affitto: r2(nuovi.costoCampoNetto), rinfresco: r2(nuovi.costoRinfrescoNetto) },
        rec: {
          costoCampo: nuovi.costoCampoLordo, costoCampoNetto: nuovi.costoCampoNetto, costoCampoLordo: nuovi.costoCampoLordo,
          costoRinfresco: nuovi.costoRinfrescoLordo, costoRinfrescoNetto: nuovi.costoRinfrescoNetto, costoRinfrescoLordo: nuovi.costoRinfrescoLordo,
        },
      };
    })
    .filter(x => Math.abs(x.prima.affitto - x.dopo.affitto) > 0.005 || Math.abs(x.prima.rinfresco - x.dopo.rinfresco) > 0.005)
    .sort((a, b) => String(a.prenotazione.data).localeCompare(String(b.prenotazione.data)));
};
