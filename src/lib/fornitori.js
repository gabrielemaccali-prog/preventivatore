import { STATO_PREN, COSTO_ANNULLAMENTO, costiAnnullamentoDi } from './costanti.js';
import { oreDaOrari } from './utils.js';

// ============================================================
// Fornitori e campi: da quale sede arriva il costo di una prenotazione, e cosa resta da
// consuntivare per ogni controparte a cui si paga qualcosa.
//
// La serve Costi/Ricavi, che attribuisce i costi alle sedi, e la Consuntivazione dei fornitori,
// che li chiude. Le due devono dire la stessa cifra sulla stessa partita, per questo la regola
// sta qui e non in ciascuna.
// Niente React e niente Supabase: funzioni pure, così il conto si può provare da solo.
// ============================================================

export const arrotonda2 = (n) => Math.round((+n || 0) * 100) / 100;

export const nettoRicavoDi = (p) => (p.prezzoVenditaNetto != null
  ? (parseFloat(p.prezzoVenditaNetto) || 0)
  : (parseFloat(p.prezzoVendita) || 0) / 1.22);
export const nettoEreditatoDi = (p) => (p.ereditaCosti ? (parseFloat(p.costoEreditato) || 0) : 0);

export const SEDE_NON_INDICATA = 'Non indicata';
// Come la prenotazione scrive la sede di una riga che non parte da nessun magazzino: un extra.
const SENZA_SEDE = '—';

// Da quale sede è partito il gioco di una prenotazione, e quanto costa per ognuna.
// Le sedi si chiamano per nome perché è così che le scrivono le righe della prenotazione.
//
// Dove il dettaglio non dice la sede non è una resa: la risposta esiste quasi sempre, basta
// seguire gli id.
//   1. se la partita è stata giocata su un nostro campo, il gioco è partito da casa nostra:
//      i pacchetti da campo si vendono con la nostra attrezzatura, non con quella di un altro;
//   2. se c'è un preventivo collegato, la sede sta nelle sue righe -- non scritta, ma
//      raggiungibile: riga di offerta -> riga di listino -> sede. Vale quando tutte le righe
//      partono dalla stessa, che è il caso di un noleggio da un fornitore solo;
//   3. se il gioco esiste a listino presso la nostra sede, è nostro. È il caso dei noleggi
//      senza preventivo, che l'app permette solo sui giochi nostri proprio perché non c'è
//      nessun fornitore da pagare.
// Resta "Non indicata" solo ciò che davvero non si sa.
export const risolutoreSedi = ({ sedi = [], listino = [], preventivi = [] }) => {
  const sedePropria = sedi.find(s => s.bfm)?.nome || '';
  const nomeSede = Object.fromEntries(sedi.map(s => [s.id, s.nome]));
  const sedeDelGonfiabile = Object.fromEntries(
    listino.map(g => [g.id, nomeSede[g.locationId]]).filter(([, n]) => !!n)
  );
  // I giochi che teniamo noi: non un flag da mantenere allineato, ma un fatto che sta già nel
  // listino -- esiste una riga presso la nostra sede.
  const idSediProprie = new Set(sedi.filter(s => s.bfm).map(s => s.id));
  const giochiNostri = new Set(listino.filter(g => idSediProprie.has(g.locationId)).map(g => g.giocoId));

  const sedeDelPreventivo = {};
  preventivi.forEach(pv => {
    const trovate = [...new Set((pv.gonfiabili || []).map(g => sedeDelGonfiabile[g.gonfiabileId]).filter(Boolean))];
    if (trovate.length === 1) sedeDelPreventivo[pv.codice] = trovate[0];
  });

  // I nomi che esistono davvero in anagrafica. Una riga che ne porta uno diverso parla di una sede
  // rinominata (o sparita): il nome da solo non la identifica più, e vale come se non ci fosse.
  const nomiValidi = new Set(sedi.map(s => s.nome).filter(Boolean));

  const sedeDiRipiego = (p) => {
    if (p.campoId && sedePropria) return sedePropria;
    const dalPreventivo = p.preventivoCollegato ? sedeDelPreventivo[p.preventivoCollegato] : null;
    if (dalPreventivo) return dalPreventivo;
    if (p.giocoId != null && giochiNostri.has(p.giocoId) && sedePropria) return sedePropria;
    return SEDE_NON_INDICATA;
  };
  const nostra = (sede) => !!sedePropria && String(sede || '') === String(sedePropria);

  // Il costo di fornitore di una prenotazione, sede per sede: { [nomeSede]: { costo, giochi } }.
  // La nostra sede non compare: la logistica di un gioco che parte da casa non è un costo, e
  // l'uscita vera è il compenso dell'operatore, che si conta altrove.
  //
  // Un extra del preventivo arriva sulla prenotazione senza sede ("—"): non parte da nessun
  // magazzino. Se il preventivo è di un fornitore solo, l'extra è suo e si paga a lui insieme al
  // noleggio. Se invece la partita è nostra resta un costo senza fornitore, come prima: il
  // pernotto di un nostro operatore è un'uscita vera, e non deve sparire col gioco che parte da casa.
  const costiPerSede = (p) => {
    const per = {};
    const aggiungi = (sede, costo, gioco) => {
      if (nostra(sede)) return;
      if (!per[sede]) per[sede] = { costo: 0, giochi: [] };
      per[sede].costo += costo;
      if (gioco) per[sede].giochi.push(gioco);
    };
    const sedeDellaVoce = (v) => {
      // L'id vince sul nome: è l'unica cosa che una rinomina non cambia.
      if (v.sedeId && nomeSede[v.sedeId]) return nomeSede[v.sedeId];
      if (!v.sede) return sedeDiRipiego(p);
      // Nome che non esiste più in anagrafica: si riparte dagli id, come per una riga senza sede.
      // Succede solo alle righe scritte prima che l'id ci fosse: da quando c'è, una rinomina non le
      // tocca più (vedi sql/sedi_nomi_congelati.sql, che ha scritto l'id su quelle vecchie).
      if (v.sede !== SENZA_SEDE && !nomiValidi.has(v.sede)) return sedeDiRipiego(p);
      if (v.sede !== SENZA_SEDE || v.giocoId != null) return v.sede;
      const ripiego = sedeDiRipiego(p);
      return nostra(ripiego) || ripiego === SEDE_NON_INDICATA ? SENZA_SEDE : ripiego;
    };
    const voci = Array.isArray(p.voci) ? p.voci.filter(Boolean) : [];
    if (voci.length > 0) voci.forEach(v => aggiungi(sedeDellaVoce(v), parseFloat(v.costo) || 0, v.nome));
    else if (nettoEreditatoDi(p) > 0) aggiungi(sedeDiRipiego(p), nettoEreditatoDi(p), null);
    return per;
  };

  // Di cosa è fatto il costo di una sede: tariffa di noleggio, logistica a km ed extra, come li ha
  // calcolati il preventivo collegato. La prenotazione tiene solo il totale per riga, arrotondato
  // alla decina; le parti stanno nel preventivo, e si rileggono da lì. Null quando il preventivo
  // non c'è o non dice niente di quella sede: il totale resta, il dettaglio no.
  const preventivoPerCodice = Object.fromEntries(preventivi.map(pv => [String(pv.codice), pv]));
  const sedeDellaRigaPreventivo = (g) => nomeSede[g.sedeId] || g.sedePartenza || sedeDelGonfiabile[g.gonfiabileId] || null;
  const dettaglioCostoDi = (p, sede) => {
    const pv = p.preventivoCollegato ? preventivoPerCodice[String(p.preventivoCollegato)] : null;
    if (!pv) return null;
    const righe = (pv.gonfiabili || []).filter(g => sedeDellaRigaPreventivo(g) === sede);
    // Gli extra seguono la stessa regola del costo: sono del fornitore se il preventivo è solo suo.
    const extras = sedeDelPreventivo[pv.codice] === sede ? (pv.extras || []) : [];
    if (righe.length === 0 && extras.length === 0) return null;
    const sommaDi = (elenco, campo) => elenco.reduce((t, x) => t + (parseFloat(x[campo]) || 0), 0);
    return {
      tariffa: arrotonda2(sommaDi(righe, 'costoNoleggio')),
      km: arrotonda2(sommaDi(righe, 'costoLogistica')),
      kmPercorsi: arrotonda2(sommaDi(righe, 'kmCalcolati')),
      extra: arrotonda2(sommaDi(extras, 'costo')),
      concordato: righe.some(g => g.concordato),
    };
  };

  return { sedePropria, giochiNostri, sedeDiRipiego, nostra, costiPerSede, dettaglioCostoDi };
};

const somma = (elenco, campo) => elenco.reduce((s, x) => s + (parseFloat(x[campo]) || 0), 0);

// Se un periodo chiuso copre una riga. I periodi nati scegliendo le righe da consuntivare
// (per_righe) le elencano una per una: le partite lasciate fuori, anche se cadono fra le stesse
// date, restano da consuntivare. I periodi più vecchi coprono tutte le giornate fra dal e al.
export const periodoCopre = (pe, { riferimento, lato, data }) => (pe.per_righe
  ? (pe.righe || []).some(r => String(r.riferimento) === String(riferimento) && r.lato === lato)
  : data >= pe.dal && data <= pe.al);

// I totali di un gruppo di righe. Il saldo è quello che si paga davvero: i costi meno le partite
// che il fornitore ci ha commissionato. Positivo lo paghiamo noi, negativo ce lo deve lui.
export const totaliDi = (righe) => {
  const costi = righe.filter(r => r.lato === 'costo');
  const ricavi = righe.filter(r => r.lato === 'ricavo');
  const costo = arrotonda2(somma(costi, 'consuntivato'));
  const ricavo = arrotonda2(somma(ricavi, 'consuntivato'));
  return {
    costoPreventivato: arrotonda2(somma(costi, 'preventivato')),
    costo,
    ricavo,
    saldo: arrotonda2(costo - ricavo),
  };
};

// Cosa resta da consuntivare, controparte per controparte. Vale per i fornitori e per i campi:
// le regole sono le stesse, cambia solo da dove vengono i costi.
//
// Ogni controparte raccoglie due lati:
//   costo   le partite in cui le dobbiamo qualcosa: il preventivato è il costo scritto sulla
//           prenotazione, il consuntivato è quello più le rettifiche;
//   ricavo  le partite che ci ha commissionato lei, segnate "cliente fornitore": non si incassano
//           e si compensano qui, al loro prezzo netto.
// Una partita già dentro un periodo chiuso di quella controparte non compare più.
//
//   controparti  [{ id, nome }]
//   costiDi(p)   [{ id, costo, giochi, dettaglio }] -- id null quando non si sa a chi pagare
//   clienteDi(p) l'id della controparte che ha commissionato la partita, o null
// Voci e periodi arrivano già filtrati sul tipo di controparte.
//
// `senzaControparte` sono i costi che non si sa a chi pagare: vanno detti, non persi.
//   chiusoAltrove(c, p, lato)  se la riga è già chiusa in un periodo di un'altra controparte (vedi
//                              i rinfreschi dei campi col bar separato); di norma mai
const consuntivoControparti = ({ prenotazioni, controparti, costiDi, clienteDi, voci, periodi, nelFiltro, chiusoAltrove = () => false }) => {
  const perId = Object.fromEntries(controparti.map(c => [String(c.id), c]));
  const chiuso = (c, p, lato) => chiusoAltrove(c, p, lato) || periodi.some(pe => String(pe.controparte_id) === String(c.id)
    && periodoCopre(pe, { riferimento: p.id, lato, data: p.data }));

  const gruppi = new Map();
  const righeDi = (c) => {
    if (!gruppi.has(c.id)) gruppi.set(c.id, { controparte: c, righe: [] });
    return gruppi.get(c.id).righe;
  };
  const senzaControparte = [];

  const riga = (c, p, lato, preventivato, giochi) => {
    const proprie = voci.filter(v => String(v.controparte_id) === String(c.id)
      && String(v.riferimento) === String(p.id) && v.lato === lato);
    const rettifiche = somma(proprie, 'importo');
    return {
      lato, riferimento: String(p.id), data: p.data, nominativo: p.nominativo || '', giochi,
      ...(p.stato === STATO_PREN.ANNULLATA ? { annullata: true } : {}),
      preventivato: arrotonda2(preventivato),
      rettifiche: arrotonda2(rettifiche),
      consuntivato: arrotonda2(preventivato + rettifiche),
      voci: proprie,
      prenotazione: p,
    };
  };

  prenotazioni.forEach(p => {
    // Una FORSE non è stata giocata, un'annullata non c'è stata: non c'è niente da pagare. Salvo
    // l'annullata con costi segnati, di cui costiDi restituisce solo quelli (vedi costanti.js).
    const annullata = p.stato === STATO_PREN.ANNULLATA;
    if ((p.stato !== STATO_PREN.CONFERMATO && !annullata) || !nelFiltro(p.data)) return;

    costiDi(p).forEach(c => {
      const controparte = c.id != null ? perId[String(c.id)] : null;
      if (!controparte) {
        if (c.costo > 0) senzaControparte.push({ prenotazione: p, nome: c.nome, costo: arrotonda2(c.costo) });
        return;
      }
      if (chiuso(controparte, p, 'costo')) return;
      const r = { ...riga(controparte, p, 'costo', c.costo, c.giochi || []), dettaglio: c.dettaglio || null };
      // Una riga a zero senza rettifiche non ha niente da consuntivare.
      if (r.preventivato !== 0 || r.voci.length > 0) righeDi(controparte).push(r);
    });

    if (annullata) return; // niente ricavo da compensare: la partita non si è giocata
    const idCliente = clienteDi(p);
    const cliente = idCliente ? perId[String(idCliente)] : null;
    if (cliente && !chiuso(cliente, p, 'ricavo')) righeDi(cliente).push(riga(cliente, p, 'ricavo', nettoRicavoDi(p), []));
  });

  const elenco = [...gruppi.values()].map(({ controparte, righe }) => {
    const ordinate = [...righe].sort((a, b) => String(a.data).localeCompare(String(b.data)) || a.riferimento.localeCompare(b.riferimento));
    const date = ordinate.map(r => r.data).filter(Boolean);
    return { controparte, righe: ordinate, dal: date[0] || null, al: date[date.length - 1] || null, ...totaliDi(ordinate) };
  }).sort((a, b) => String(a.controparte.nome).localeCompare(String(b.controparte.nome), 'it'));

  return { controparti: elenco, senzaControparte };
};

const soloDi = (tipo, righe) => righe.filter(r => (r.controparte || 'fornitore') === tipo);

// I fornitori: il costo è quello dei noleggi, sede per sede, con il dettaglio del preventivo.
// Un extra senza sede su una partita nostra non è di nessun fornitore, e non si segnala.
export const daConsuntivareFornitori = ({ prenotazioni = [], sedi = [], risolutore, voci = [], periodi = [], nelFiltro = () => true }) => {
  const sedePerNome = Object.fromEntries(sedi.map(s => [s.nome, s]));
  return consuntivoControparti({
    prenotazioni, controparti: sedi, nelFiltro,
    voci: soloDi('fornitore', voci), periodi: soloDi('fornitore', periodi),
    // Fra i costi di un'annullata non c'è il noleggio: si segnano campo, rinfresco e operatori.
    costiDi: (p) => (p.stato !== STATO_PREN.CONFERMATO ? [] : Object.entries(risolutore.costiPerSede(p)))
      .filter(([nome]) => nome !== SENZA_SEDE)
      .map(([nome, c]) => ({ id: sedePerNome[nome]?.id ?? null, nome, costo: c.costo, giochi: c.giochi, dettaglio: risolutore.dettaglioCostoDi?.(p, nome) || null })),
    clienteDi: (p) => p.clienteSedeId || null,
  });
};

// I campi: il costo è l'affitto più il rinfresco, al netto dell'IVA, come li ha calcolati la
// prenotazione con le tariffe del campo. Il dettaglio li tiene separati: si pagano insieme allo
// stesso centro sportivo, ma sono due cose diverse e possono cambiare ognuna per conto suo.
// Una partita commissionata dal campo stesso si gioca a casa sua: l'affitto non si paga.
export const suoCampoDi = (p) => !!p.campoId && p.clienteCampoId === p.campoId;
export const nettoAffittoDi = (p) => (suoCampoDi(p) ? 0
  : p.costoCampoNetto != null ? (parseFloat(p.costoCampoNetto) || 0) : (parseFloat(p.costoCampo) || 0) / 1.22);
export const nettoRinfrescoDi = (p) => (p.costoRinfrescoNetto != null ? (parseFloat(p.costoRinfrescoNetto) || 0) : (parseFloat(p.costoRinfresco) || 0) / 1.22);

// Quanto dura la partita, in ore: dagli orari quando c'è l'ora di fine, altrimenti dalla durata del
// pacchetto. Stessa lettura dei compensi.
const oreDi = (p) => (p.oraFine ? (oreDaOrari(p.oraInizio, p.oraFine) || 0) : (parseFloat(p.durataOre) || 0));

// Ore e paganti del rinfresco: spiegano affitto e rinfresco, sono i numeri su cui il campo fa il
// conto e quelli che si confrontano con la sua richiesta. Non sono importi: si possono rileggere
// dalla prenotazione anche per un periodo chiuso prima che si salvassero nelle righe.
// Le ore sono quelle che il centro mette in fattura: un'ora su due campi affiancati sono due ore.
// I paganti contano quando il rinfresco è dovuto -- di un'annullata solo se è stato segnato --
// anche se costa zero: un aperitivo su un campo senza prezzo dell'aperitivo va visto, non nascosto.
export const quantitaCampoDi = (p) => {
  const dovuto = p.stato !== STATO_PREN.ANNULLATA || costiAnnullamentoDi(p).has(COSTO_ANNULLAMENTO.RINFRESCO);
  const tipo = String(p.tipoRinfresco || '').trim().toLowerCase();
  const paganti = dovuto ? (parseFloat(p.numeroPartecipanti) || 0) : 0;
  return {
    ore: oreDi(p) * Math.max(parseInt(p.campiOccupati, 10) || 1, 1),
    merende: tipo === 'merenda' ? paganti : 0,
    aperitivi: tipo === 'aperitivo' ? paganti : 0,
  };
};

// ---- Campi col bar di un'altra società ----
// In alcuni centri il bar (merende e aperitivi) è un'azienda diversa da chi affitta i campi: si
// pagano a parte, e in consuntivazione diventano due controparti, "Comasina campi" e "Comasina
// rinfreschi: Bar Srl". La prenotazione non cambia: è solo il modo in cui si divide il costo.
// I rinfreschi hanno un id loro, ricavato da quello del campo, che è quello che finisce nei
// periodi e nelle rettifiche: controparte_id è testo, e non serve un'anagrafica a parte.
const SUFFISSO_BAR = ':bar';
export const idBar = (campoId) => `${campoId}${SUFFISSO_BAR}`;
export const eIdBar = (id) => String(id ?? '').endsWith(SUFFISSO_BAR);
export const campoDiIdBar = (id) => String(id).slice(0, -SUFFISSO_BAR.length);
export const barSeparato = (campo) => !!campo?.barSeparato;

// Le controparti della consuntivazione campi: un campo col bar separato ne vale due.
export const contropartiCampi = (campi = []) => campi.flatMap(c => (barSeparato(c)
  ? [
    { ...c, nome: `${c.nome} campi` },
    { id: idBar(c.id), nome: `${c.nome} rinfreschi${c.barSocieta ? `: ${c.barSocieta}` : ''}`, campoId: c.id, bar: true },
  ]
  : [c]));

// Un periodo del campo chiuso prima della separazione ha pagato affitto e rinfresco insieme: il
// rinfresco di quelle partite non va pagato di nuovo al bar. Lo si riconosce dalla riga, che porta
// il rinfresco nel dettaglio; un periodo per intervallo (i più vecchi) le copre tutte.
const periodoCampoCopreRinfresco = (pe, p) => {
  if (!pe.per_righe) return p.data >= pe.dal && p.data <= pe.al;
  const r = (pe.righe || []).find(x => String(x.riferimento) === String(p.id) && x.lato === 'costo');
  return !!r && (!r.dettaglio || (parseFloat(r.dettaglio.rinfresco) || 0) > 0.005);
};

export const daConsuntivareCampi = ({ prenotazioni = [], campi = [], voci = [], periodi = [], nelFiltro = () => true }) => {
  const perId = Object.fromEntries(campi.map(c => [String(c.id), c]));
  const periodiCampo = soloDi('campo', periodi);
  return consuntivoControparti({
    prenotazioni, controparti: contropartiCampi(campi), nelFiltro,
    voci: soloDi('campo', voci), periodi: periodiCampo,
    chiusoAltrove: (c, p, lato) => !!c.bar && lato === 'costo' && periodiCampo.some(pe =>
      String(pe.controparte_id) === String(c.campoId) && periodoCampoCopreRinfresco(pe, p)),
    costiDi: (p) => {
      if (!p.campoId) return [];
      // Di un'annullata si paga solo quello che è stato segnato; il resto vale zero.
      const annullata = p.stato === STATO_PREN.ANNULLATA;
      const segnati = costiAnnullamentoDi(p);
      if (annullata && !segnati.has(COSTO_ANNULLAMENTO.CAMPO) && !segnati.has(COSTO_ANNULLAMENTO.RINFRESCO)) return [];
      const affitto = !annullata || segnati.has(COSTO_ANNULLAMENTO.CAMPO) ? arrotonda2(nettoAffittoDi(p)) : 0;
      const rinfresco = !annullata || segnati.has(COSTO_ANNULLAMENTO.RINFRESCO) ? arrotonda2(nettoRinfrescoDi(p)) : 0;
      const { ore, merende, aperitivi } = quantitaCampoDi(p);
      const nome = p.campoNome || p.campoId;
      // Col bar separato l'affitto resta al campo e il rinfresco va al bar, ognuno con i suoi numeri.
      if (barSeparato(perId[String(p.campoId)])) {
        return [
          { id: p.campoId, nome, costo: affitto, giochi: [], dettaglio: { affitto, rinfresco: 0, ore, merende: 0, aperitivi: 0 } },
          { id: idBar(p.campoId), nome: `${nome} rinfreschi`, costo: rinfresco, giochi: [], dettaglio: { affitto: 0, rinfresco, ore: 0, merende, aperitivi } },
        ];
      }
      return [{
        id: p.campoId, nome, costo: affitto + rinfresco, giochi: [],
        dettaglio: { affitto, rinfresco, ore, merende, aperitivi },
      }];
    },
    clienteDi: (p) => p.clienteCampoId || null,
  });
};

// La fotografia di una controparte al momento della consuntivazione: quello che si scrive nel
// periodo. Solo dati, niente riferimenti agli oggetti vivi, che domani direbbero altro.
// `perRighe`: il periodo copre solo le righe che porta, non tutte le giornate fra dal e al (vedi
// periodoCopre). Resta spento finché sql/consuntivazione_selezione.sql non è stato eseguito.
export const periodoDaControparte = (c, tipo, dataConsuntivo, perRighe = false) => ({
  controparte: tipo,
  ...(perRighe ? { per_righe: true } : {}),
  controparte_id: c.controparte.id,
  dal: c.dal,
  al: c.al,
  data_consuntivo: dataConsuntivo,
  costo_preventivato: c.costoPreventivato,
  costo: c.costo,
  ricavo: c.ricavo,
  saldo: c.saldo,
  righe: c.righe.map(r => ({
    lato: r.lato, riferimento: r.riferimento, data: r.data, nominativo: r.nominativo, giochi: r.giochi,
    ...(r.annullata ? { annullata: true } : {}),
    preventivato: r.preventivato, rettifiche: r.rettifiche, consuntivato: r.consuntivato,
    ...(r.dettaglio ? { dettaglio: r.dettaglio } : {}),
  })),
});
