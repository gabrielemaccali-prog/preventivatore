import { useState, useEffect, useMemo, useCallback, Fragment } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabaseClient'
import { puoVedere } from '../../lib/permessi'
import { etichettaPartita, etichettaGiochiBreve, formattaDataGGMMAAAA } from '../../lib/utils'
import {
  STATO_PREN, etichettaStatoPren, classeBadgeStato, COSTO_ANNULLAMENTO, ETICHETTA_COSTO_ANNULLAMENTO,
  costiAnnullamentoDi, generaCompenso, STATO_PREVENTIVO, statoPreventivoDi, GIORNI_VALIDITA_PREVENTIVO,
} from '../../lib/costanti'
import Icona from '../../components/Icona'
import { useOrdinamentoTabella } from '../../lib/ordinamentoTabella'
import { preventiviPerOperatore, lordizza, righeConsuntivo, trasfertePerData } from '../compensi/calcolo'
import { risolutoreSedi, arrotonda2 } from '../../lib/fornitori'
import { sommaImporti, statoFatturazione, daFatturarePrenotazione } from '../../lib/fatturazione'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine,
  PieChart, Pie, Cell
} from 'recharts'

const MESI = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

// Palette categoriale validata (dataviz skill): ordine fisso, mai riassegnata in base al filtro attivo.
const PALETTE_CATEGORICA = ['#2a78d6', '#1baf7a', '#eda100', '#008300', '#4a3aa7', '#e34948', '#e87ba4', '#eb6834'];
const COLORE_ALTRO = '#898781'; // ink muted, per "Non assegnato" / "Altro"
const COLORE_RICAVO = '#2a78d6';
const COLORE_COSTO = '#e34948';
const COLORE_MARGINE = '#008300';
const STROKE_ASSE = '#c3c2b7';
const STROKE_GRIGLIA = '#e1e0d9';
const INK_MUTED = '#898781';

const nettoRicavo = (p) => p.prezzoVenditaNetto != null ? parseFloat(p.prezzoVenditaNetto) : (parseFloat(p.prezzoVendita) || 0) / 1.22;
const nettoCampo = (p) => p.costoCampoNetto != null ? parseFloat(p.costoCampoNetto) : (parseFloat(p.costoCampo) || 0) / 1.22;
const nettoRinf = (p) => p.costoRinfrescoNetto != null ? parseFloat(p.costoRinfrescoNetto) : (parseFloat(p.costoRinfresco) || 0) / 1.22;
const nettoEreditato = (p) => p.ereditaCosti ? (parseFloat(p.costoEreditato) || 0) : 0;

// Assegna un colore stabile per nome-centro in base alla posizione nell'elenco completo (ordine alfabetico),
// cosi' un centro mantiene sempre lo stesso colore anche cambiando i filtri attivi.
const mappaColoriCentri = (nomi) => {
  const ordinati = [...new Set(nomi.filter(Boolean))].sort();
  const mappa = {};
  ordinati.forEach((nome, i) => { mappa[nome] = PALETTE_CATEGORICA[i % PALETTE_CATEGORICA.length]; });
  return mappa;
};

const coloreCentro = (mappa, nome) => (nome === 'Non assegnato' || nome === 'Altro') ? COLORE_ALTRO : (mappa[nome] || COLORE_ALTRO);

// Raggruppa le righe per centro, ordina per valore decrescente e piega la coda oltre le prime 7 voci in "Altro".
const raggruppaPerCentro = (righe, getCentro, getValore) => {
  const somme = {};
  righe.forEach(p => {
    const nome = getCentro(p);
    somme[nome] = (somme[nome] || 0) + getValore(p);
  });
  const voci = Object.entries(somme)
    .map(([nome, valore]) => ({ nome, valore }))
    .filter(v => v.valore > 0.001)
    .sort((a, b) => b.valore - a.valore);
  if (voci.length <= 7) return voci;
  const top = voci.slice(0, 7);
  const restoValore = voci.slice(7).reduce((s, v) => s + v.valore, 0);
  return [...top, { nome: 'Altro', valore: restoValore }];
};

// Come le righe scrivono "non parte da nessun magazzino": un extra, un servizio.
const SENZA_SEDE = '—';

const ESITO = { VINTO: 'vinto', PERSO: 'perso', APERTO: 'aperto' };
const esitoDi = (p) => {
  const stato = statoPreventivoDi(p);
  if (stato === STATO_PREVENTIVO.CONFERMATO || stato === STATO_PREVENTIVO.PRENOTATO) return ESITO.VINTO;
  if (stato === STATO_PREVENTIVO.ANNULLATO || stato === STATO_PREVENTIVO.AZIONE_RICHIESTA) return ESITO.PERSO;
  return ESITO.APERTO;
};

const formattaEuro = (v) => `€${(+v || 0).toFixed(2)}`;

// Nella colonna in pila il ricavo non e' una barra: e' l'altezza delle due messe insieme. Il tooltip
// lo dice per esteso, altrimenti l'unico numero che conta si dovrebbe sommare a mente.
const TooltipPila = ({ active, payload, label, campi = { costo: 'costo', margine: 'margine' } }) => {
  if (!active || !payload?.length) return null;
  const riga0 = payload[0].payload;
  const d = { ricavo: riga0.ricavo, costo: riga0[campi.costo], margine: riga0[campi.margine] };
  const riga = (nome, valore, colore) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
      <span style={{ color: colore }}>{nome}</span><span>{formattaEuro(valore)}</span>
    </div>
  );
  return (
    <div style={{ background: '#fff', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '8px 10px', fontSize: '0.85rem' }}>
      <div style={{ fontWeight: 700, marginBottom: '4px' }}>{label}</div>
      {riga('Ricavo', d.ricavo, COLORE_RICAVO)}
      {riga('Costo', d.costo, COLORE_COSTO)}
      {riga('Margine', d.margine, d.margine >= 0 ? COLORE_MARGINE : COLORE_COSTO)}
    </div>
  );
};

// Il compenso che una partita si porta dietro. La quota della singola partita la calcola gia' il
// modulo compensi -- blocchi consecutivi, prima ora, ore successive, tetto giornaliero ripartito
// fra le partite del giorno -- e rifarla qui vorrebbe dire farle dire due numeri diversi. Quindi
// si riusa quella, e questo resta un lavoro di attribuzione.
//
// Il costo e' il LORDO: l'operatore incassa il netto, la ritenuta la versa l'azienda, e l'uscita
// e' la somma dei due. Le spese sono rimborsi e si sommano sopra, senza ritenuta.
//
// `soloOperatore` serve al consuntivo, che si ricostruisce un periodo per volta e un periodo
// appartiene a un operatore solo.
//
// Restituisce { [partita]: { [operatore]: { base, rettifiche, spese } } }, tutti netti.
// Il cruscotto deve sapere di chi e' ogni quota -- un operatore puo' essere gia' stato consuntivato e
// il suo collega no -- e deve poterla scomporre, perche' le tre parti non nascono nello stesso momento:
//   base        ore a tariffa piu' il bonus recensione: quello che la partita vale da come e' fatta
//   rettifiche  le correzioni scritte dopo (ore di viaggio, benzina): esistono perche' e' andata
//               diversamente dal previsto, quindi stanno nel consuntivo e non nella previsione
//   spese       rimborsi vivi (pedaggi, pranzi), esenti da ritenuta: anche questi si scoprono dopo
// Chi legge compone: il preventivo e' la sola base, il consuntivo e' tutto.
// `escludi(operatore, data)` lascia fuori le giornate che non riguardano questo conto: un periodo
// chiuso e' di un operatore solo, e una giornata gia' consuntivata non va calcolata con le tariffe di oggi.
const compensoPerOperatore = (prenotazioni, voci, par, escludi = () => false) => {
  const perPartita = {};
  preventiviPerOperatore(prenotazioni, voci, par, escludi).forEach(op => {
    op.giornate.forEach(g => {
      const partiteDelGiorno = g.blocchi.flatMap(b => b.partite);
      if (partiteDelGiorno.length === 0) return; // una spesa in un giorno senza partite non e' attribuibile
      const totaleQuote = partiteDelGiorno.reduce((s, x) => s + (x.compenso || 0), 0);
      const somma = (elenco, filtro) => elenco.filter(filtro).reduce((s, v) => s + (parseFloat(v.importo) || 0), 0);
      // Il bonus recensione non e' una correzione: vale un importo deciso dai parametri, come le ore.
      const eRecensione = (v) => !v.esente_ritenuta && v.tipo === 'recensione';
      const eRettifica = (v) => !v.esente_ritenuta && v.tipo !== 'recensione';
      const eSpesa = (v) => !!v.esente_ritenuta;
      // Le voci che dicono a quale partita si riferiscono vanno li'. Quelle che non lo dicono si
      // dividono in proporzione alle quote: sono costo di quella giornata, e la giornata e' fatta
      // di queste partite.
      const sparse = g.voci.filter(v => !v.riferimento);
      partiteDelGiorno.forEach(x => {
        const id = x.partita.id;
        const proprie = g.voci.filter(v => String(v.riferimento || '') === String(id));
        const quota = totaleQuote > 0 ? (x.compenso / totaleQuote) : (1 / partiteDelGiorno.length);
        const suo = (perPartita[id] = perPartita[id] || {});
        const gia = suo[op.id] || { base: 0, rettifiche: 0, spese: 0 };
        suo[op.id] = {
          base: gia.base + x.compenso + somma(proprie, eRecensione) + somma(sparse, eRecensione) * quota,
          rettifiche: gia.rettifiche + somma(proprie, eRettifica) + somma(sparse, eRettifica) * quota,
          spese: gia.spese + somma(proprie, eSpesa) + somma(sparse, eSpesa) * quota,
        };
      });
    });
  });
  return perPartita;
};

const costoDelCompenso = (q) => (q ? q.operatore + q.ritenuta : 0);

// La previsione: le ore a tariffa e il bonus recensione, con la ritenuta che ne deriva. Quello che
// e' stato aggiunto dopo non sta qui -- se ci stesse, preventivo e consuntivo direbbero sempre la
// stessa cifra e non ci sarebbe niente da confrontare.
const previstoDaQuota = (q, aliquota) => ({
  operatore: q.base,
  ritenuta: lordizza(q.base, aliquota).ritenuta,
  imponibile: q.base,
  rettifiche: q.rettifiche,
  spese: q.spese,
});

// Il costo che una partita ha oggi, con tutto quello che vi e' stato registrato sopra. Non e' la
// previsione del cruscotto: e' quanto si pagherebbe chiudendo adesso, ed e' il numero che serve alle
// schede Andamento e Per gioco, dove il costo deve esserci su tutte le partite, consuntivate o no.
const costoCorrenteDaQuota = (q, aliquota) => q.base + q.rettifiche + q.spese
  + lordizza(q.base + q.rettifiche, aliquota).ritenuta;
const sommaOperatori = (perOperatore) => Object.fromEntries(
  Object.entries(perOperatore).map(([id, q]) => [id, Object.values(q).reduce((s, v) => s + costoDelCompenso(v), 0)])
);

// Stile degli stati di prenotazione, gli stessi colori del modulo prenotazioni.
const COLORI_STATO_PREN = {
  [STATO_PREN.CONFERMATO]: '#16a34a',
  [STATO_PREN.ANNULLATA]: '#dc2626',
  [STATO_PREN.POSTICIPATA]: '#eab308',
};
const coloreStatoPren = (s) => COLORI_STATO_PREN[s] || '#f59e0b';

// Le schede di andamento guardano solo le partite in piedi: un'annullata o una posticipata non ha
// prodotto niente, e una posticipata lo produrra' alla data nuova.
const nonInPiedi = (p) => p.stato === STATO_PREN.ANNULLATA || p.stato === STATO_PREN.POSTICIPATA;

// Il cruscotto invece le mostra tutte, e fuori dai totali tiene quelle che non muovono soldi: la
// posticipata, e l'annullata senza costi segnati. Un'annullata con costi (il campo pagato lo stesso,
// gli operatori gia' sul posto) resta dentro: il ricavo non c'e', ma quei costi sono usciti davvero.
const fuoriDaiTotali = (p) => p.stato === STATO_PREN.POSTICIPATA
  || (p.stato === STATO_PREN.ANNULLATA && costiAnnullamentoDi(p).size === 0);

// A che punto e' il consuntivo di un gruppo di voci: tutte chiuse, nessuna, oppure alcune.
// Un gruppo vuoto non ha niente da consuntivare, e lo si dice invece di spacciarlo per chiuso.
const statoConsuntivo = (voci) => {
  if (voci.length === 0) return 'vuoto';
  const chiuse = voci.filter(v => v.cons != null).length;
  if (chiuse === voci.length) return 'cons';
  return chiuse === 0 ? 'prev' : 'misto';
};
const ETICHETTA_CONSUNTIVO = { cons: 'Consuntivato', prev: 'Preventivo', misto: 'In parte consuntivato', vuoto: 'Niente da consuntivare' };

function Cruscotto({ user }) {
  const primaSchedaCR = ['cruscotto', 'andamento', 'pergioco', 'preventivi'].find(s => puoVedere(user, 'costiricavi', s)) || 'cruscotto';
  const [currentView, setCurrentView] = useState(primaSchedaCR);

  const [prenotazioni, setPrenotazioni] = useState([]);
  // Il cruscotto le vuole tutte, annullate e posticipate comprese; le altre schede no (vedi sotto).
  const [tutteLePrenotazioni, setTutteLePrenotazioni] = useState([]);
  // I consuntivi che non stanno sulla prenotazione: le fatture dicono il ricavo, i periodi chiusi
  // di fornitori e campi il costo pagato. Il voucher serve perche' la parte che copre non si
  // rifattura: senza il suo valore una partita pagata col voucher non risulterebbe mai fatturata.
  const [fatture, setFatture] = useState([]);
  const [valoriVoucher, setValoriVoucher] = useState({});
  const [consPeriodi, setConsPeriodi] = useState([]);
  const [campi, setCampi] = useState([]);
  // Il catalogo: da qui arrivano nome, famiglia e centro di ricavo di ogni gioco, risolti per id.
  // Risolverli qui invece di congelarli sulla prenotazione è il punto: sposti un gioco di famiglia
  // e il resoconto si riscrive anche sullo storico, che è come deve comportarsi un resoconto.
  const [giochi, setGiochi] = useState([]);
  // Le sedi servono a una cosa sola: sapere come si chiama la nostra, per attribuirle le partite
  // giocate sui campi. Il nome non lo scrivo nel codice perché è un dato, e i dati si rinominano.
  const [sedi, setSedi] = useState([]);
  // Il costo di un operatore non sta su nessuna colonna delle prenotazioni: si calcola dai
  // parametri, dalle ore e da chi c'era. Serve tutto e tre.
  const [parametriCompensi, setParametriCompensi] = useState(null);
  const [opVoci, setOpVoci] = useState([]);
  const [opPeriodi, setOpPeriodi] = useState([]);
  // Il listino e i preventivi servono a rispondere a una domanda sola: da quale sede e' partito
  // il gioco di una prenotazione che il dettaglio non ce l'ha. La risposta c'e' quasi sempre,
  // basta seguire gli id invece di arrendersi al primo campo vuoto.
  const [listino, setListino] = useState([]);
  const [preventivi, setPreventivi] = useState([]);

  useEffect(() => { fetchTutto(); }, []);

  const fetchTutto = async () => {
    const [pr, ca, pag, gi, se, cp, ov, op, li, pv, ft, vc, cpe] = await Promise.all([
      supabase.from('prenotazioni').select('*').order('data', { ascending: false }),
      supabase.from('pren_campi').select('*').order('nome'),
      supabase.from('pagamenti').select('*').eq('tipo', 'prenotazione').order('data'),
      supabase.from('giochi').select('*').order('nome'),
      supabase.from('sedi').select('*'),
      supabase.from('compensi_parametri').select('*').eq('id', 1).maybeSingle(),
      supabase.from('op_voci').select('*'),
      supabase.from('op_periodi').select('*'),
      supabase.from('gonfiabili').select('id, giocoId, locationId'),
      supabase.from('preventivi').select('codice, gonfiabili, stato, dataEmissione, totaleVendita, costoVivoTotale, destinazione, motivoAnnullamento'),
      supabase.from('fatture').select('riferimento, importo').eq('tipo', 'prenotazione'),
      supabase.from('voucher').select('codice, importo'),
      supabase.from('cons_periodi').select('controparte, controparte_id, righe'),
    ]);
    // Fatture e periodi arrivano da script SQL che potrebbero non essere ancora stati eseguiti: in
    // quel caso il cruscotto resta tutto a preventivo, che e' quello che si sa.
    setFatture(ft.data || []);
    setValoriVoucher(Object.fromEntries((vc.data || []).map(v => [String(v.codice), parseFloat(v.importo) || 0])));
    setConsPeriodi(cpe.data || []);
    // I pagamenti stanno nella tabella unica "pagamenti" (condivisa con i voucher), non più
    // nella colonna jsonb prenotazioni.pagamenti: vengono agganciati qui a ogni prenotazione.
    // Una partita annullata non ha prodotto niente, e una posticipata lo produrra' un altro
    // giorno: contarle qui vorrebbe dire mettere a bilancio ricavi che non ci sono e costi che
    // non sono stati sostenuti. Restano nel modulo prenotazioni, che e' dove servono.
    if (pr.data) {
      const conPagamenti = pr.data.map(p => ({
        ...p,
        pagamenti: (pag.data || []).filter(x => x.riferimento === p.id).map(x => ({ data: x.data, importo: x.importo, nominativo: x.nominativo || "" }))
      }));
      setTutteLePrenotazioni(conPagamenti);
      setPrenotazioni(conPagamenti.filter(p => !nonInPiedi(p)));
    }
    if (ca.data) setCampi(ca.data);
    if (gi.data) setGiochi(gi.data);
    if (se.data) setSedi(se.data);
    if (cp.data) setParametriCompensi(cp.data);
    if (ov.data) setOpVoci(ov.data);
    if (op.data) setOpPeriodi(op.data);
    if (li.data) setListino(li.data);
    if (pv.data) setPreventivi(pv.data);
  };

  const giocoPerId = useMemo(() => Object.fromEntries(giochi.map(g => [g.id, g])), [giochi]);
  // Il centro di ricavo viene dal gioco, non più dal pacchetto. Da quando il pacchetto dice solo
  // la modalità -- Party Basic, Noleggio -- non ha più niente da dire su dove finisce il ricavo,
  // mentre il gioco sì: è l'unica cosa che si vende davvero, e il suo centro sta a catalogo.
  const centroRicavoDiRiga = useCallback((r) => (r.giocoId != null ? giocoPerId[r.giocoId]?.centro_ricavo : null) || 'Non assegnato', [giocoPerId]);
  const centroCostoDi = useCallback((p) => campi.find(c => c.id === p.campoId)?.centroCosto || 'Non assegnato', [campi]);
  const campoNomeDi = useCallback((p) => campi.find(c => c.id === p.campoId)?.nome || '—', [campi]);
  // Come si chiama una partita: il gioco e la modalità con cui è stata venduta. Il gioco arriva
  // dal catalogo per id, il pacchetto è quello congelato sulla prenotazione.
  // I giochi di una prenotazione: quelli del dettaglio quando c'e', altrimenti il suo. In una
  // colonna di tabella si usa il nome breve del catalogo, e due giochi che lo condividono
  // contano per uno -- oltre due l'elenco non ci sta e diventa "Vari".
  // I giochi che teniamo noi: non un flag da mantenere allineato, ma un fatto che sta gia' nel
  // listino -- esiste una riga presso la nostra sede.
  const giochiNostri = useMemo(() => {
    const nostre = new Set(sedi.filter(s => s.bfm).map(s => s.id));
    return new Set(listino.filter(g => nostre.has(g.locationId)).map(g => g.giocoId));
  }, [listino, sedi]);

  const etichettaDi = useCallback((p) => {
    const vocePerGioco = (id) => ({
      nome: giocoPerId[id]?.nome_breve || giocoPerId[id]?.nome || '',
      nostro: giochiNostri.has(id),
    });
    const voci = Array.isArray(p.voci) ? p.voci.filter(v => v && v.giocoId != null) : [];
    const elenco = voci.length > 0 ? voci.map(v => vocePerGioco(v.giocoId)) : (p.giocoId != null ? [vocePerGioco(p.giocoId)] : []);
    return etichettaPartita(p.pacchettoNome, etichettaGiochiBreve(elenco)) || '—';
  }, [giocoPerId, giochiNostri]);

  // Quello che ci aspettiamo di pagare agli operatori, con i parametri di oggi, su tutte le
  // partite: e' una previsione, quindi vale anche dove il periodo e' gia' stato chiuso.
  //
  // Le partite sono quelle in piedi piu' le annullate per cui gli operatori si pagano lo stesso: sono
  // nel calcolo dei compensi, quindi ci devono essere anche qui, o i blocchi della giornata e il tetto
  // giornaliero verrebbero ripartiti diversamente dal modulo compensi.
  const partiteConCompenso = useMemo(
    () => tutteLePrenotazioni.filter(p => !nonInPiedi(p) || generaCompenso(p)),
    [tutteLePrenotazioni]
  );
  // Ogni quota si porta dietro l'aliquota con cui va letta. Una giornata gia' consuntivata si calcola
  // con i parametri congelati nel suo periodo, non con quelli di oggi: il confronto fra previsione e
  // consuntivo deve restare quello del giorno in cui e' stata pagata, o ritoccare una tariffa
  // riscriverebbe da sola gli scostamenti di mesi fa. Le giornate ancora aperte, invece, seguono le
  // tariffe di adesso: la previsione e' su quelle che si pagherebbe chiudendo oggi.
  const quotePerOp = useMemo(() => {
    if (!parametriCompensi) return {};
    const perPartita = {};
    const aggiungi = (quote, aliquota) => Object.entries(quote).forEach(([id, perOp]) => {
      const suo = (perPartita[id] = perPartita[id] || {});
      Object.entries(perOp).forEach(([opId, q]) => { suo[opId] = { ...q, aliquota }; });
    });
    // Un periodo copre un intervallo di date, quindi una giornata o e' tutta dentro o e' tutta fuori:
    // dividere il calcolo qui non spezza ne' i blocchi consecutivi ne' il tetto giornaliero, che
    // vivono dentro la giornata.
    const chiusa = (opId, data) => opPeriodi.some(per => String(per.operatore_id) === String(opId)
      && data >= per.dal && data <= per.al);
    aggiungi(compensoPerOperatore(partiteConCompenso, opVoci, parametriCompensi, chiusa), parametriCompensi.aliquota_ritenuta);
    opPeriodi.forEach(per => {
      const par = per.parametri || parametriCompensi;
      const sue = partiteConCompenso.filter(p => generaCompenso(p) && p.data >= per.dal && p.data <= per.al
        && (p.operatori || []).some(o => String(o.id) === String(per.operatore_id)));
      const sueVoci = opVoci.filter(v => String(v.operatore_id) === String(per.operatore_id)
        && v.data >= per.dal && v.data <= per.al);
      aggiungi(
        compensoPerOperatore(sue, sueVoci, par, (opId) => String(opId) !== String(per.operatore_id)),
        par.aliquota_ritenuta
      );
    });
    // Restano fuori le partite che cadono dentro un periodo chiuso ma che quel periodo non paga: una
    // FORSE mai confermata, per esempio. Il primo giro le ha saltate con la giornata, il secondo non
    // le prende perché non generano compenso. Si calcolano qui, con le tariffe di oggi: non sono
    // state pagate, quindi la loro è una previsione come tutte le altre.
    const orfane = partiteConCompenso.filter(p => (p.operatori || []).some(o => !perPartita[p.id]?.[String(o.id)]));
    if (orfane.length > 0) {
      const idOrfane = new Set(orfane.map(p => String(p.id)));
      aggiungi(
        compensoPerOperatore(orfane, opVoci.filter(v => idOrfane.has(String(v.riferimento || ''))), parametriCompensi),
        parametriCompensi.aliquota_ritenuta
      );
    }
    return perPartita;
  }, [partiteConCompenso, opVoci, parametriCompensi, opPeriodi]);
  // Il cruscotto confronta previsione e consuntivo, quindi la sua previsione si ferma alle ore e alle
  // recensioni: le rettifiche sono la differenza che vuole mostrare.
  const compensoPrevistoPerOp = useMemo(() => Object.fromEntries(Object.entries(quotePerOp).map(([id, perOp]) => [
    id,
    Object.fromEntries(Object.entries(perOp).map(([opId, q]) => [opId, previstoDaQuota(q, q.aliquota)])),
  ])), [quotePerOp]);
  // Le altre schede invece vogliono il costo pieno di oggi, rettifiche e rimborsi compresi.
  const compensoPrevisto = useMemo(() => Object.fromEntries(Object.entries(quotePerOp).map(([id, perOp]) => [
    id,
    Object.values(perOp).reduce((s, q) => s + costoCorrenteDaQuota(q, q.aliquota), 0),
  ])), [quotePerOp]);

  // Quello che e' stato davvero pagato. Si ricostruisce un periodo per volta, e ogni periodo con
  // i parametri congelati dentro di lui: ritoccare la tariffa domani non deve riscrivere un
  // consuntivo gia' liquidato. Una partita che nessun periodo copre resta a zero, ed e' la
  // verita' -- non e' ancora stata pagata, non e' gratis.
  //
  // `coperte` dice quali operatori di quale partita stanno dentro un periodo chiuso: e' questo, e
  // non un importo diverso da zero, a dire che il compenso e' consuntivato.
  const { compensoConsuntivatoPerOp, coperte } = useMemo(() => {
    const totale = {};
    const coperte = {};
    opPeriodi.forEach(per => {
      const par = per.parametri || parametriCompensi;
      if (!par) return;
      // Solo le partite che il modulo compensi paga: una FORSE non entra in un periodo chiuso.
      const sue = partiteConCompenso.filter(p => generaCompenso(p) && p.data >= per.dal && p.data <= per.al
        && (p.operatori || []).some(o => String(o.id) === String(per.operatore_id)));
      const copri = (id) => { (coperte[id] = coperte[id] || new Set()).add(String(per.operatore_id)); };
      sue.forEach(p => copri(p.id));
      // Il consuntivo lo dicono le righe congelate nel periodo: gli importi che sono stati pagati,
      // con dentro la ritenuta calcolata sull'imponibile del documento di rimborso. Non si ricalcola
      // niente, così una voce toccata dopo o una tariffa ritoccata domani non riscrivono il passato.
      //
      // I periodi chiusi prima che le righe esistessero non ce le hanno: lì si ricostruisce con i
      // parametri congelati e le voci di allora, ed è il meglio che si può dire. Lo script
      // sql/compensi_righe_partita.sql spiega come riempirli.
      const aggiungi = (id, opId, quota) => {
        const suo = (totale[id] = totale[id] || {});
        const gia = suo[opId] || { operatore: 0, ritenuta: 0, imponibile: 0, trasferta: 0, stimata: false, ricostruita: false };
        suo[opId] = {
          operatore: gia.operatore + quota.operatore,
          ritenuta: gia.ritenuta + quota.ritenuta,
          imponibile: gia.imponibile + quota.imponibile,
          trasferta: gia.trasferta + quota.trasferta,
          stimata: gia.stimata || quota.stimata,
          ricostruita: gia.ricostruita || quota.ricostruita,
        };
      };

      if ((per.righe || []).length > 0) {
        // Anche una partita che oggi non risulta più sua resta consuntivata: è stata pagata.
        per.righe.forEach(r => copri(r.riferimento));
        per.righe.forEach(r => aggiungi(r.riferimento, per.operatore_id, {
          operatore: parseFloat(r.incassaOperatore) || ((parseFloat(r.base) || 0) + (parseFloat(r.rettifiche) || 0) + (parseFloat(r.spese) || 0)),
          ritenuta: parseFloat(r.ritenuta) || 0,
          imponibile: parseFloat(r.imponibile) || 0,
          trasferta: parseFloat(r.trasferta) || 0,
          stimata: !per.evaso_il,
          ricostruita: false,
        }));
        return;
      }

      const sueVoci = opVoci.filter(v => String(v.operatore_id) === String(per.operatore_id)
        && v.data >= per.dal && v.data <= per.al);
      const quote = compensoPerOperatore(sue, sueVoci, par, (opId) => String(opId) !== String(per.operatore_id));
      const dataDi = (id) => sue.find(p => String(p.id) === String(id))?.data;
      const perData = {};
      Object.entries(quote).forEach(([id, perOp]) => {
        const q = perOp[per.operatore_id];
        const data = dataDi(id);
        if (q && data) (perData[data] = perData[data] || []).push({ id, q });
      });
      const trasferte = trasfertePerData(per.rimborso);
      Object.entries(perData).forEach(([data, elenco]) => {
        const righe = righeConsuntivo(
          elenco.map(({ id, q }) => ({ riferimento: id, data, base: q.base, rettifiche: q.rettifiche, spese: q.spese })),
          { aliquota: per.rimborso?.aliquota ?? par?.aliquota_ritenuta, trasfertePerData: trasferte }
        );
        righe.forEach(r => aggiungi(r.riferimento, per.operatore_id, {
          operatore: r.incassaOperatore, ritenuta: r.ritenuta, imponibile: r.imponibile, trasferta: r.trasferta,
          stimata: !per.rimborso, ricostruita: true,
        }));
      });
    });
    return { compensoConsuntivatoPerOp: totale, coperte };
  }, [opPeriodi, partiteConCompenso, opVoci, parametriCompensi]);
  const compensoConsuntivato = useMemo(() => sommaOperatori(compensoConsuntivatoPerOp), [compensoConsuntivatoPerOp]);

  // Da quale sede e' partito il gioco di una prenotazione, e quanto costa ogni fornitore. La regola
  // sta in lib/fornitori perche' la usa anche la consuntivazione dei fornitori: le due pagine
  // devono attribuire lo stesso costo alla stessa sede, o chi paga e chi guarda il margine
  // leggerebbero due cifre diverse sulla stessa partita.
  const risolutore = useMemo(() => risolutoreSedi({ sedi, listino, preventivi }), [sedi, listino, preventivi]);
  const { sedeDiRipiego, nostra } = risolutore;

  // Il costo ereditato di una partita, contato come lo conta la scheda "Per gioco": la logistica
  // di un gioco che parte da una nostra sede non e' un costo. Il prezzo a listino serve a
  // calcolare la vendita, e l'uscita vera e' il rimborso all'operatore, che arriva dal compenso.
  // Contarla qui e non di la' faceva dire alle due schede due margini diversi sulla stessa
  // prenotazione -- e chi apre un modulo di costi non deve scegliere a quale delle due credere.

  // ====================== CRUSCOTTO (tutte le partite, preventivo o consuntivo) ======================
  // Ogni importo di una partita esiste in due versioni: il preventivo, scritto o calcolato sulla
  // prenotazione, e il consuntivo, che arriva quando quella voce e' stata chiusa altrove -- la
  // fattura per il ricavo, il periodo consuntivato per compensi, fornitori e campi. Il cruscotto
  // mostra per ogni voce il consuntivo se c'e' e il preventivo se no, e lo dice con lo stile.
  //
  // Si ragiona voce per voce, non per partita: su una partita con due operatori uno puo' essere
  // gia' stato liquidato e l'altro no, e aspettare il secondo per mostrare il primo vorrebbe dire
  // tenere nascosto un numero vero.

  // Le righe dei periodi chiusi, indicizzate per controparte, partita e lato. Sono congelate nel
  // periodo: se la prenotazione cambia dopo, il consuntivo resta quello pagato.
  const righeConsuntivate = useMemo(() => {
    const indice = {};
    consPeriodi.forEach(pe => (pe.righe || []).forEach(r => {
      const k = `${pe.controparte}|${r.riferimento}|${r.lato}`;
      (indice[k] = indice[k] || []).push({ controparteId: String(pe.controparte_id), ...r });
    }));
    return indice;
  }, [consPeriodi]);

  const fatturatoPer = useMemo(() => {
    const m = {};
    fatture.forEach(f => { (m[String(f.riferimento)] = m[String(f.riferimento)] || []).push(f); });
    return m;
  }, [fatture]);

  const analisiPartite = useMemo(() => {
    const sedePerNome = Object.fromEntries(sedi.map(s => [s.nome, s]));
    const nomeSedePerId = Object.fromEntries(sedi.map(s => [String(s.id), s.nome]));
    const consuntivate = (controparte, p, lato) => righeConsuntivate[`${controparte}|${p.id}|${lato}`] || [];
    const sommaCons = (righe) => righe.reduce((s, r) => s + (parseFloat(r.consuntivato) || 0), 0);
    const risultato = {};

    tutteLePrenotazioni.forEach(p => {
      // --- Ricavo ---
      // Una partita commissionata da un fornitore o da un campo non si fattura: il suo ricavo si
      // consuntiva compensandolo nel periodo di quella controparte.
      let ricavo;
      const annullata = p.stato === STATO_PREN.ANNULLATA;
      const segnati = costiAnnullamentoDi(p);
      if (annullata) {
        // Annullata vuol dire senza incasso (con un incasso sarebbe posticipata): il ricavo non c'e'.
        ricavo = { prev: 0, cons: null, nessuno: true, nota: 'Nessun ricavo', titolo: 'Annullata senza incasso' };
      } else if (p.clienteSedeId || p.clienteCampoId) {
        const righe = consuntivate(p.clienteSedeId ? 'fornitore' : 'campo', p, 'ricavo');
        ricavo = {
          prev: nettoRicavo(p), cons: righe.length ? sommaCons(righe) : null,
          nota: righe.length ? 'Compensato' : 'Da compensare',
          titolo: "Partita commissionata da un fornitore o da un campo: non si fattura, si compensa con quello che gli dobbiamo",
        };
      } else {
        // Altrimenti il ricavo e' consuntivato quando le fatture coprono tutto il dovuto. Le fatture
        // sono lorde: si riportano al netto con lo stesso rapporto della prenotazione, che non e'
        // sempre 1,22 (un cliente estero non paga IVA). Il voucher si somma perche' e' stato
        // fatturato quando e' stato venduto.
        const lordo = parseFloat(p.prezzoVendita) || 0;
        const voucher = p.voucherCodice ? (valoriVoucher[String(p.voucherCodice)] || 0) : 0;
        const fatturato = sommaImporti(fatturatoPer[String(p.id)]);
        const stato = statoFatturazione(daFatturarePrenotazione(p, voucher), fatturato);
        const chiuso = lordo > 0 && (stato === 'fatturata' || (stato === 'nonDovuta' && voucher > 0));
        ricavo = {
          prev: nettoRicavo(p),
          cons: chiuso ? (fatturato + voucher) * (nettoRicavo(p) / lordo) : null,
          nota: { fatturata: 'Fatturato', nonDovuta: voucher > 0 ? 'Coperto da voucher' : 'Niente da fatturare', parziale: 'Fatturato in parte', daFatturare: 'Da fatturare' }[stato],
          titolo: {
            fatturata: `Fatture per €${fatturato.toFixed(2)} lordi${voucher > 0 ? ` più il voucher ${p.voucherCodice} da €${voucher.toFixed(2)}` : ''}`,
            nonDovuta: voucher > 0 ? `Coperto dal voucher ${p.voucherCodice} (€${voucher.toFixed(2)}), già fatturato quando è stato venduto` : undefined,
            parziale: `Fatture per €${fatturato.toFixed(2)} lordi su €${daFatturarePrenotazione(p, voucher).toFixed(2)} da fatturare`,
            daFatturare: undefined,
          }[stato],
        };
      }

      // --- Costi ---
      const costi = [];
      // Campo: affitto e rinfresco, che si consuntivano insieme allo stesso centro sportivo.
      // Di un'annullata contano solo le parti segnate all'annullamento, come in consuntivazione.
      const righeCampo = consuntivate('campo', p, 'costo');
      const affittoPrev = !annullata || segnati.has(COSTO_ANNULLAMENTO.CAMPO) ? nettoCampo(p) : 0;
      const rinfrescoPrev = !annullata || segnati.has(COSTO_ANNULLAMENTO.RINFRESCO) ? nettoRinf(p) : 0;
      const prevCampo = affittoPrev + rinfrescoPrev;
      if (prevCampo > 0.005 || righeCampo.length) {
        const d = righeCampo[0]?.dettaglio;
        // Il rinfresco si nomina solo se c'e': "+ rinfresco €0.00" su una partita senza merenda e' rumore.
        const parti = (affitto, rinfresco) => `€${(+affitto || 0).toFixed(2)}${(+rinfresco || 0) > 0.005 ? ` + rinfresco €${(+rinfresco).toFixed(2)}` : ''}`;
        costi.push({
          tipo: 'Campo', nome: campoNomeDi(p), prev: prevCampo, cons: righeCampo.length ? sommaCons(righeCampo) : null,
          nota: rinfrescoPrev > 0.005 ? 'Affitto e rinfresco' : 'Affitto',
          titolo: `Preventivati ${parti(affittoPrev, rinfrescoPrev)}${d ? ` · consuntivati ${parti(d.affitto, d.rinfresco)}` : ''}`,
        });
      }

      // Fornitori, sede per sede. Una sede consuntivata che oggi la prenotazione non attribuisce
      // piu' (il costo e' stato spostato dopo il pagamento) resta: e' un'uscita che c'e' stata.
      const righeForn = consuntivate('fornitore', p, 'costo');
      const sediViste = new Set();
      // Un'annullata non ha noleggi da pagare: fra i costi segnabili ci sono campo, rinfresco e operatori.
      Object.entries(annullata ? {} : risolutore.costiPerSede(p)).forEach(([nome, c]) => {
        const id = sedePerNome[nome]?.id;
        const proprie = id != null ? righeForn.filter(r => r.controparteId === String(id)) : [];
        if (id != null) sediViste.add(String(id));
        if (c.costo < 0.005 && proprie.length === 0) return;
        costi.push({
          tipo: 'Fornitore', nome: nome === '—' ? 'Extra senza fornitore' : nome,
          prev: c.costo, cons: proprie.length ? sommaCons(proprie) : null,
          // Un extra senza fornitore (il pernotto di un nostro operatore) non ha nessun periodo in
          // cui chiudersi: resta a preventivo, ma non deve impedire alla partita di dirsi consuntivata.
          nonConsuntivabile: nome === '—',
          nota: c.giochi.length ? c.giochi.join(', ')
            : nome === '—' ? 'Senza fornitore'
              : id == null ? 'Fornitore non riconosciuto' : 'Noleggio',
          titolo: nome === '—' ? 'Nessun fornitore a cui pagarlo: resta a preventivo'
            : id == null ? 'Collega il preventivo o indica la sede nelle righe della prenotazione' : undefined,
        });
      });
      righeForn.filter(r => !sediViste.has(r.controparteId)).forEach(r => {
        costi.push({ tipo: 'Fornitore', nome: nomeSedePerId[r.controparteId] || r.controparteId, prev: 0, cons: parseFloat(r.consuntivato) || 0, nota: 'Non più attribuito', titolo: 'Pagato a suo tempo, ma oggi la prenotazione non attribuisce più niente a questa sede' });
      });

      // Operatori: la quota del compenso di ognuno, lorda di ritenuta e con i rimborsi.
      const prevOp = compensoPrevistoPerOp[p.id] || {};
      const consOp = compensoConsuntivatoPerOp[p.id] || {};
      const chiusi = coperte[p.id] || new Set();
      const idOperatori = [...new Set([...(p.operatori || []).map(o => String(o.id)), ...Object.keys(prevOp), ...chiusi])];
      idOperatori.forEach(opId => {
        const prev = prevOp[opId];
        const chiuso = chiusi.has(opId);
        const cons = chiuso ? consOp[opId] : null;
        if (costoDelCompenso(prev) < 0.005 && !chiuso) return;
        const nome = (p.operatori || []).find(o => String(o.id) === opId)?.nome || `Operatore ${opId}`;
        // Due righe, perché sono due uscite diverse: quella verso l'operatore e quella verso l'Erario.
        // Solo la seconda si muove quando una fetta di compenso viene messa a rimborso trasferta.
        // L'operatore si dice una volta sola: la seconda riga è sua, e a distinguerle è la nota.
        // Finché il periodo non è chiuso, rettifiche e spese già registrate non compaiono in nessuna
        // delle due colonne: sono fuori dalla previsione e non sono ancora state pagate. Dirlo qui
        // evita di farle sparire dagli occhi di chi guarda una partita ancora aperta.
        const daPagare = (prev?.rettifiche || 0) + (prev?.spese || 0);
        costi.push({
          tipo: 'Operatore', nome, prev: prev?.operatore || 0, cons: cons ? cons.operatore : null,
          nota: cons ? 'Compenso' : daPagare > 0.005 ? `Compenso · €${daPagare.toFixed(2)} da consuntivare` : 'Compenso',
          titolo: cons
            ? 'Ore, recensioni, rettifiche e rimborsi: quello che ha incassato in mano'
            : daPagare > 0.005
              ? `Previsione su ore e recensioni. Registrate rettifiche e spese per €${daPagare.toFixed(2)}, non ancora consuntivate`
              : 'Ore e recensioni: quello che la partita vale a tariffa',
        });
        costi.push({
          tipo: '', nome: '', prev: prev?.ritenuta || 0, cons: cons ? cons.ritenuta : null,
          nota: cons ? (cons.stimata ? 'Ritenuta stimata' : cons.ricostruita ? 'Ritenuta ricostruita' : 'Ritenuta') : 'Ritenuta',
          titolo: cons
            ? cons.stimata
              ? "Il rimborso non è ancora stato elaborato: la ritenuta è calcolata, non ancora decisa"
              : `Calcolata sull'imponibile del documento di rimborso${cons.trasferta > 0.005 ? `: €${cons.trasferta.toFixed(2)} di trasferta sono esenti` : ''}${cons.ricostruita ? '. Il periodo è stato chiuso prima che le righe venissero congelate, quindi è ricostruita' : ''}`
            : "Versata all'Erario per lui, sopra al compenso",
        });
      });

      const arrotondata = (v) => ({ ...v, prev: arrotonda2(v.prev), cons: v.cons == null ? null : arrotonda2(v.cons) });
      const ricavoA = arrotondata(ricavo);
      const costiA = costi.map(arrotondata);
      const efficace = (v) => v.cons ?? v.prev;
      const costoPrev = costiA.reduce((s, v) => s + v.prev, 0);
      const costoEff = costiA.reduce((s, v) => s + efficace(v), 0);
      const statoCosto = statoConsuntivo(costiA.filter(v => !v.nonConsuntivabile));
      const statoRicavo = ricavoA.nessuno ? 'vuoto' : ricavoA.cons != null ? 'cons' : 'prev';
      // Il margine e' consuntivo solo quando lo sono entrambi i lati: meta' e meta' e' ancora una stima.
      // Senza ricavo (un'annullata) il margine e' solo il costo, e ne segue lo stato.
      const statoMargine = statoRicavo === 'vuoto' ? statoCosto
        : statoRicavo === 'cons' && (statoCosto === 'cons' || statoCosto === 'vuoto') ? 'cons'
          : (statoRicavo === 'cons' || statoCosto === 'cons' || statoCosto === 'misto') ? 'misto' : 'prev';
      risultato[p.id] = {
        ricavo: ricavoA, costi: costiA,
        ricavoEff: efficace(ricavoA), costoPrev, costoEff,
        margineEff: efficace(ricavoA) - costoEff, marginePrev: ricavoA.prev - costoPrev,
        statoRicavo, statoCosto, statoMargine,
      };
    });
    return risultato;
  }, [tutteLePrenotazioni, righeConsuntivate, fatturatoPer, valoriVoucher, sedi, risolutore, campoNomeDi,
    compensoPrevistoPerOp, compensoConsuntivatoPerOp, coperte]);

  // Una cella di importo del cruscotto: "—" quando la voce non c'e' (nessun ricavo, nessun costo).
  const cellaImportoCr = (valore, stato, colore) => (stato === 'vuoto' ? <span style={{ color: '#94a3b8' }}>—</span> : importoCr(valore, stato, colore));

  const [crMese, setCrMese] = useState(""); // mese dell'evento (aaaa-mm), "" = tutti
  const [crStato, setCrStato] = useState("");
  const [crNome, setCrNome] = useState("");
  const [crConsuntivo, setCrConsuntivo] = useState("");
  const [crOperatore, setCrOperatore] = useState("");
  const [crEspansa, setCrEspansa] = useState(null);

  // I bubbler dell'elenco sono quelli che compaiono sulle partite, non l'anagrafica intera: filtrare
  // per uno che non ha mai lavorato darebbe una tabella vuota senza spiegare perché.
  const operatoriDisponibili = useMemo(() => {
    const per = new Map();
    tutteLePrenotazioni.forEach(p => (p.operatori || []).forEach(o => {
      if (o?.id != null && !per.has(String(o.id))) per.set(String(o.id), o.nome || `Operatore ${o.id}`);
    }));
    return [...per.entries()].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
  }, [tutteLePrenotazioni]);

  const spostaMeseCr = (delta) => {
    const [a, m] = crMese ? crMese.split('-').map(Number) : [new Date().getFullYear(), new Date().getMonth() + 1];
    const d = new Date(a, m - 1 + delta, 1);
    setCrMese(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };
  const etichettaMese = (mese) => {
    const [a, m] = mese.split('-').map(Number);
    const testo = new Date(a, m - 1, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
    return testo.charAt(0).toUpperCase() + testo.slice(1);
  };

  // Il filtro sul consuntivo guarda la partita intera: "consuntivata" vuol dire che il margine lo e'.
  const righeCruscotto = tutteLePrenotazioni.filter(p => {
    const a = analisiPartite[p.id];
    if (!a) return false;
    // Un'annullata che non ha mosso niente -- nessun ricavo, nessun costo segnato -- nel cruscotto
    // e' solo rumore: resta nel modulo prenotazioni, con il suo motivo.
    if (p.stato === STATO_PREN.ANNULLATA && a.statoCosto === 'vuoto') return false;
    if (crMese && !String(p.data || '').startsWith(crMese)) return false;
    if (crStato && p.stato !== crStato) return false;
    if (crNome && !`${p.id} ${p.nominativo || ''}`.toLowerCase().includes(crNome.toLowerCase())) return false;
    if (crConsuntivo && a.statoMargine !== crConsuntivo) return false;
    if (crOperatore && !(p.operatori || []).some(o => String(o.id) === crOperatore)) return false;
    return true;
  });

  const COLONNE_CRUSCOTTO = [
    { chiave: 'data', label: 'Data evento', valore: (p) => `${p.data || ''}T${p.oraInizio || ''}` },
    { chiave: 'id', label: 'ID', valore: (p) => String(p.id || '') },
    { chiave: 'nominativo', label: 'Nominativo', valore: (p) => p.nominativo || '' },
    { chiave: 'partita', label: 'Partita', valore: (p) => etichettaDi(p) },
    { chiave: 'location', label: 'Location', valore: (p) => p.campoNome || [p.locationCitta, p.locationProvincia].filter(Boolean).join(' ') || '' },
    { chiave: 'stato', label: 'Stato', valore: (p) => p.stato || '' },
    { chiave: 'ricavo', label: 'Ricavo', destra: true, valore: (p) => analisiPartite[p.id]?.ricavoEff ?? 0 },
    { chiave: 'costo', label: 'Costi', destra: true, valore: (p) => analisiPartite[p.id]?.costoEff ?? 0 },
    { chiave: 'margine', label: 'Margine', destra: true, valore: (p) => analisiPartite[p.id]?.margineEff ?? 0 },
  ];
  const ordinamentoCruscotto = useOrdinamentoTabella(Object.fromEntries(COLONNE_CRUSCOTTO.map(c => [c.chiave, c.valore])));

  const totaliCruscotto = righeCruscotto.filter(p => !fuoriDaiTotali(p)).reduce((t, p) => {
    const a = analisiPartite[p.id];
    return { n: t.n + 1, ricavo: t.ricavo + a.ricavoEff, costo: t.costo + a.costoEff, margine: t.margine + a.margineEff };
  }, { n: 0, ricavo: 0, costo: 0, margine: 0 });

  // Un importo detto con lo stile del suo stato: in tondo e in evidenza il consuntivo, in corsivo e
  // piu' tenue il preventivo. Il segno ◐ resta solo dove il peso non basta, cioe' quando una parte e'
  // consuntivata e una no.
  const CLASSE_IMPORTO = { cons: 'importo-consuntivo', misto: 'importo-misto', prev: 'importo-preventivo' };
  const SEGNO_IMPORTO = { misto: '◐' };
  const importoCr = (valore, stato, colore) => (
    <span className={CLASSE_IMPORTO[stato] || 'importo-preventivo'} style={{ color: colore }} title={ETICHETTA_CONSUNTIVO[stato]}>
      {SEGNO_IMPORTO[stato] && <span className="importo-segno">{SEGNO_IMPORTO[stato]}</span>}€{valore.toFixed(2)}
    </span>
  );

  const esportaCruscotto = () => {
    if (righeCruscotto.length === 0) return alert("Nessuna partita da esportare.");
    const ws = XLSX.utils.json_to_sheet(ordinamentoCruscotto.ordina(righeCruscotto).map(p => {
      const a = analisiPartite[p.id];
      return {
        Codice: p.id, 'Data evento': p.data, Nominativo: p.nominativo || '', Partita: etichettaDi(p), Stato: etichettaStatoPren(p.stato),
        'Ricavo preventivo': a.ricavo.prev, 'Ricavo consuntivo': a.ricavo.cons ?? '',
        'Costi preventivo': +a.costoPrev.toFixed(2), 'Costi consuntivo': a.statoCosto === 'cons' ? +a.costoEff.toFixed(2) : '',
        Ricavo: +a.ricavoEff.toFixed(2), Costi: +a.costoEff.toFixed(2), Margine: +a.margineEff.toFixed(2),
        Consuntivo: ETICHETTA_CONSUNTIVO[a.statoMargine],
      };
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Cruscotto");
    XLSX.writeFile(wb, "Cruscotto_Dettaglio.xlsx");
  };

  // Il dettaglio esploso: qui preventivo e consuntivo stanno affiancati, voce per voce, con lo
  // scostamento dove il consuntivo c'e'.
  const dettaglioCruscotto = (p, a) => {
    const scostamento = (v) => (v.cons == null ? null : v.cons - v.prev);
    const cellaScostamento = (d, perCosto) => {
      if (d == null || Math.abs(d) < 0.005) return <span style={{ color: '#94a3b8' }}>{d == null ? '—' : '€0.00'}</span>;
      // Un costo che sale e un ricavo che scende sono entrambi una cattiva notizia.
      const buono = perCosto ? d < 0 : d > 0;
      return <span style={{ color: buono ? '#15803d' : '#b91c1c' }}>{d > 0 ? '+' : '−'}€{Math.abs(d).toFixed(2)}</span>;
    };
    const cons = (v) => (v.cons == null ? <span style={{ color: '#94a3b8' }}>—</span> : `€${v.cons.toFixed(2)}`);
    const consCosti = a.costi.filter(v => v.cons != null);
    const scostCosti = consCosti.length ? consCosti.reduce((s, v) => s + scostamento(v), 0) : null;
    const vuoto = <span style={{ color: '#94a3b8' }}>—</span>;
    const riga = (chiave, tipo, voce, nota, prev, consCella, scostCella, classe, titolo) => (
      <tr key={chiave} className={classe}>
        <td className="cella-tipo">{tipo}</td>
        <td>{voce}</td>
        <td className="cella-nota" title={titolo || undefined}>{nota || vuoto}</td>
        <td>€{prev.toFixed(2)}</td>
        <td>{consCella}</td>
        <td>{scostCella}</td>
      </tr>
    );
    const parziale = consCosti.length > 0 && consCosti.length < a.costi.length;
    return (
      <tr className="riga-espandibile-dettaglio" style={{ borderLeft: `3px solid ${coloreStatoPren(p.stato)}` }}>
        <td colSpan={COLONNE_CRUSCOTTO.length} onClick={(e) => e.stopPropagation()}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px', fontSize: '0.8rem', color: '#334155', marginBottom: '8px' }}>
            <span><span style={{ color: '#94a3b8' }}>Codice </span><strong>{p.id}</strong></span>
            <span><span style={{ color: '#94a3b8' }}>Data </span>{formattaDataGGMMAAAA(p.data)}{p.oraInizio ? ` ${p.oraInizio}` : ''}{p.oraFine ? `–${p.oraFine}` : ''}</span>
            <span><span style={{ color: '#94a3b8' }}>Stato </span><span className={`badge-stato badge-mini ${classeBadgeStato(p.stato)}`}>{etichettaStatoPren(p.stato)}</span></span>
            {p.stato === STATO_PREN.ANNULLATA && (costiAnnullamentoDi(p).size > 0
              ? <em style={{ color: '#991b1b' }}>Annullata con costi da sostenere: {[...costiAnnullamentoDi(p)].map(c => ETICHETTA_COSTO_ANNULLAMENTO[c] || c).join(', ').toLowerCase()}.</em>
              : null)}
            {p.stato === STATO_PREN.POSTICIPATA && <em style={{ color: '#854d0e' }}>Posticipata: esclusa dai totali, conterà alla data nuova.</em>}
          </div>
          <table className="tabella-dettaglio-cruscotto">
            <colgroup>
              <col style={{ width: '90px' }} /><col /><col style={{ width: '210px' }} /><col style={{ width: '110px' }} /><col style={{ width: '130px' }} /><col style={{ width: '110px' }} />
            </colgroup>
            <thead>
              <tr><th>Tipo</th><th>Voce</th><th>Note</th><th>Preventivo</th><th>Consuntivo</th><th>Scostamento</th></tr>
            </thead>
            <tbody>
              <tr className="riga-gruppo-cruscotto"><td colSpan={6}>Ricavi</td></tr>
              {a.statoRicavo === 'vuoto'
                ? <tr><td className="cella-tipo">Vendita</td><td>{etichettaDi(p)}</td><td className="cella-nota" title={a.ricavo.titolo || undefined}>{a.ricavo.nota}</td><td>{vuoto}</td><td>{vuoto}</td><td>{vuoto}</td></tr>
                : riga('ricavo', 'Vendita', etichettaDi(p), a.ricavo.nota, a.ricavo.prev, cons(a.ricavo), cellaScostamento(scostamento(a.ricavo), false), undefined, a.ricavo.titolo)}
              <tr className="riga-gruppo-cruscotto"><td colSpan={6}>Costi</td></tr>
              {a.costi.length === 0 && <tr><td colSpan={6} style={{ color: '#94a3b8', textAlign: 'center' }}>Nessun costo su questa partita.</td></tr>}
              {a.costi.map((v, i) => riga(`costo-${i}`, v.tipo, v.nome, v.nota, v.prev, cons(v), cellaScostamento(scostamento(v), true), undefined, v.titolo))}
            </tbody>
            <tfoot>
              {riga('totale-costi', '', 'Totale costi', parziale ? `${consCosti.length} voci su ${a.costi.length} consuntivate` : null,
                a.costoPrev,
                consCosti.length ? `€${consCosti.reduce((s, v) => s + v.cons, 0).toFixed(2)}` : vuoto,
                cellaScostamento(scostCosti, true), 'riga-totale-cruscotto')}
              <tr className="riga-totale-cruscotto riga-margine-cruscotto">
                <td className="cella-tipo"></td>
                <td>Margine</td>
                <td className="cella-nota">{ETICHETTA_CONSUNTIVO[a.statoMargine]}</td>
                <td style={{ color: a.marginePrev >= 0 ? '#2e7d32' : '#c62828' }}>€{a.marginePrev.toFixed(2)}</td>
                <td style={{ color: a.margineEff >= 0 ? '#2e7d32' : '#c62828' }}>{a.statoMargine === 'prev' || a.statoMargine === 'vuoto' ? vuoto : `€${a.margineEff.toFixed(2)}`}</td>
                <td>{a.statoMargine === 'prev' || a.statoMargine === 'vuoto' ? vuoto : cellaScostamento(a.margineEff - a.marginePrev, false)}</td>
              </tr>
            </tfoot>
          </table>
        </td>
      </tr>
    );
  };

  // ====================== ANDAMENTO (grafici) ======================  // ====================== ANDAMENTO (grafici) ======================
  const annoCorrente = String(new Date().getFullYear());
  const anniDisponibili = useMemo(() => {
    const anni = new Set(prenotazioni.filter(p => p.data).map(p => p.data.slice(0, 4)));
    return [...anni].sort().reverse();
  }, [prenotazioni]);

  // null = l'utente non ha ancora scelto esplicitamente un anno -> si applica il default calcolato
  const [annoSelManuale, setAnnoSelManuale] = useState(null);
  const annoDefault = anniDisponibili.includes(annoCorrente) ? annoCorrente : (anniDisponibili[0] || "");
  const annoSel = annoSelManuale ?? annoDefault; // "" = Tutti gli anni
  const setAnnoSel = setAnnoSelManuale;
  const [meseSel, setMeseSel] = useState(""); // "" = Tutti i mesi (attivo solo se annoSel è specifico)
  // Una FORSE non e' ancora una partita: i suoi numeri sono un'ipotesi. Tenerla fuori serve a
  // guardare l'andamento di quello che e' stato venduto davvero; tenerla dentro serve a vedere
  // dove si sta andando. Le due domande sono diverse, quindi si sceglie.
  const [soloConfermate, setSoloConfermate] = useState(false);
  const [centroCostoSel, setCentroCostoSel] = useState("");
  const [centroRicavoSel, setCentroRicavoSel] = useState("");

  const centriCostoDisponibili = useMemo(() => [...new Set(campi.map(c => c.centroCosto).filter(Boolean))].sort(), [campi]);
  const centriRicavoDisponibili = useMemo(() => [...new Set(giochi.map(g => g.centro_ricavo).filter(Boolean))].sort(), [giochi]);

  // ====================== PREVENTIVI (statistiche dell'offerta) ======================
  // Un preventivo finisce in uno di tre esiti, ed e' su questo che si misura tutto il resto:
  //   vinto    confermato dal cliente, o gia' diventato una prenotazione
  //   perso    annullato, oppure scaduto senza risposta -- un'offerta che non e' stata raccolta
  //   aperto   emesso da poco, ancora dentro la validita' dell'offerta: non si sa ancora
  // Gli aperti restano fuori dal calcolo della conversione: contarli fra i persi farebbe sembrare
  // disastroso il mese in corso, dove metà dei preventivi ha appena preso la strada del cliente.
  const [annoPrev, setAnnoPrev] = useState(null); // null = non scelto, vale il default calcolato
  const anniPreventivi = useMemo(() => {
    const anni = new Set(preventivi.filter(p => p.dataEmissione).map(p => String(p.dataEmissione).slice(0, 4)));
    return [...anni].sort().reverse();
  }, [preventivi]);
  const annoPrevSel = annoPrev ?? (anniPreventivi.includes(annoCorrente) ? annoCorrente : (anniPreventivi[0] || ""));
  // Il mese vale solo dentro un anno scelto: "marzo di tutti gli anni" e' una domanda diversa, e
  // la tabella per periodo direbbe una riga sola senza dire di quale anno.
  const [mesePrev, setMesePrev] = useState("");
  const mesePrevSel = annoPrevSel ? mesePrev : "";

  // Da quale sede parte un gioco a listino, e come si chiama: servono a dire quali giochi e quali
  // fornitori compaiono nelle offerte, che il preventivo scrive per id di listino e non per nome.
  const rigaListino = useMemo(() => {
    const nomeSede = Object.fromEntries(sedi.map(s => [String(s.id), s.nome]));
    return Object.fromEntries(listino.map(g => [String(g.id), {
      gioco: giocoPerId[g.giocoId]?.nome || 'Gioco non a catalogo',
      sede: nomeSede[String(g.locationId)] || 'Sede non indicata',
    }]));
  }, [listino, sedi, giocoPerId]);

  const statPreventivi = useMemo(() => {
    const nelPeriodo = preventivi.filter(p => {
      if (!p.dataEmissione) return false;
      const data = String(p.dataEmissione);
      if (annoPrevSel && data.slice(0, 4) !== annoPrevSel) return false;
      if (mesePrevSel && parseInt(data.slice(5, 7), 10) !== parseInt(mesePrevSel, 10)) return false;
      return true;
    });
    const valore = (p) => parseFloat(p.totaleVendita) || 0;
    const costo = (p) => parseFloat(p.costoVivoTotale) || 0;

    const vuoto = () => ({ n: 0, valore: 0 });
    const totali = { emessi: vuoto(), vinto: vuoto(), perso: vuoto(), aperto: vuoto(), margine: 0 };
    const perMese = MESI.map((label, i) => ({ periodo: label, mese: i + 1, emessi: 0, vinto: 0, perso: 0, aperto: 0, valoreVinto: 0, valorePerso: 0, valoreAperto: 0, valore: 0 }));
    const perAnno = {};
    const perGruppo = { gioco: {}, sede: {} };
    const motivi = {};
    let scadutiSenzaRisposta = 0;

    nelPeriodo.forEach(p => {
      const esito = esitoDi(p);
      totali.emessi.n++; totali.emessi.valore += valore(p);
      totali[esito].n++; totali[esito].valore += valore(p);
      totali.margine += valore(p) - costo(p);

      const anno = String(p.dataEmissione).slice(0, 4);
      if (!perAnno[anno]) perAnno[anno] = { periodo: anno, emessi: 0, vinto: 0, perso: 0, aperto: 0, valoreVinto: 0, valorePerso: 0, valoreAperto: 0, valore: 0 };
      const riga = annoPrevSel ? perMese[parseInt(String(p.dataEmissione).slice(5, 7), 10) - 1] : perAnno[anno];
      if (riga) {
        riga.emessi++; riga[esito]++; riga.valore += valore(p);
        riga[esito === ESITO.VINTO ? 'valoreVinto' : esito === ESITO.PERSO ? 'valorePerso' : 'valoreAperto'] += valore(p);
      }

      if (statoPreventivoDi(p) === STATO_PREVENTIVO.AZIONE_RICHIESTA) scadutiSenzaRisposta++;
      const motivo = (p.motivoAnnullamento || '').trim();
      if (statoPreventivoDi(p) === STATO_PREVENTIVO.ANNULLATO) {
        const k = motivo || 'Senza motivo scritto';
        motivi[k] = (motivi[k] || 0) + 1;
      }

      // Un preventivo conta una volta per ogni gioco e per ogni sede che contiene: e' l'offerta a
      // essere vinta o persa, non la singola riga, quindi il valore non si spezza e non si somma
      // qui -- si contano le offerte.
      const righe = Array.isArray(p.gonfiabili) ? p.gonfiabili.filter(Boolean) : [];
      const visti = { gioco: new Set(), sede: new Set() };
      righe.forEach(g => {
        // I preventivi piu' vecchi non agganciano il listino: la riga porta solo il nome scritto
        // allora, e quello si usa. La sede invece non c'era proprio, e non si inventa.
        const info = rigaListino[String(g.gonfiabileId)] || {};
        const sedeScritta = g.sedePartenza === SENZA_SEDE ? 'Senza sede di partenza' : g.sedePartenza;
        const nomi = {
          gioco: info.gioco || g.nome || 'Gioco non riconosciuto',
          sede: sedeScritta || info.sede || 'Sede non indicata',
        };
        ['gioco', 'sede'].forEach(dim => {
          const nome = nomi[dim];
          if (visti[dim].has(nome)) return;
          visti[dim].add(nome);
          const per = (perGruppo[dim][nome] = perGruppo[dim][nome] || { nome, emessi: 0, vinto: 0, perso: 0, aperto: 0, valoreVinto: 0 });
          per.emessi++; per[esito]++;
          if (esito === ESITO.VINTO) per.valoreVinto += valore(p);
        });
      });
    });

    // La conversione si misura su quello che una risposta ce l'ha: vinti su vinti piu' persi.
    const conversione = (v, pr) => (v + pr > 0 ? (v / (v + pr)) * 100 : null);
    const conRapporto = (righe) => righe.map(r => ({ ...r, conversione: conversione(r.vinto, r.perso) }));
    const gruppi = (dim) => Object.values(perGruppo[dim])
      .map(r => ({ ...r, conversione: conversione(r.vinto, r.perso) }))
      .sort((a, b) => b.emessi - a.emessi);

    return {
      totali: {
        ...totali,
        conversione: conversione(totali.vinto.n, totali.perso.n),
        medio: totali.emessi.n > 0 ? totali.emessi.valore / totali.emessi.n : 0,
        medioVinto: totali.vinto.n > 0 ? totali.vinto.valore / totali.vinto.n : 0,
        marginePerc: totali.emessi.valore > 0 ? (totali.margine / totali.emessi.valore) * 100 : null,
      },
      periodi: conRapporto(annoPrevSel ? perMese : Object.values(perAnno).sort((a, b) => a.periodo.localeCompare(b.periodo))),
      giochi: gruppi('gioco'),
      sedi: gruppi('sede'),
      motivi: Object.entries(motivi).map(([nome, n]) => ({ nome, n })).sort((a, b) => b.n - a.n),
      scadutiSenzaRisposta,
      annullati: nelPeriodo.filter(p => statoPreventivoDi(p) === STATO_PREVENTIVO.ANNULLATO).length,
    };
  }, [preventivi, annoPrevSel, mesePrevSel, rigaListino]);

  const percentuale = (v) => (v == null ? '—' : `${v.toFixed(0)}%`);

  const esportaPreventivi = () => {
    if (statPreventivi.totali.emessi.n === 0) return alert("Nessun preventivo da esportare.");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(statPreventivi.periodi.map(r => ({
      Periodo: r.periodo, Emessi: r.emessi, Vinti: r.vinto, Persi: r.perso, Aperti: r.aperto,
      'Conversione %': r.conversione == null ? '' : +r.conversione.toFixed(1),
      'Valore emesso': +r.valore.toFixed(2), 'Valore vinto': +r.valoreVinto.toFixed(2), 'Valore perso': +r.valorePerso.toFixed(2),
    }))), 'Per periodo');
    const perDimensione = (righe) => righe.map(r => ({
      Nome: r.nome, Preventivi: r.emessi, Vinti: r.vinto, Persi: r.perso, Aperti: r.aperto,
      'Conversione %': r.conversione == null ? '' : +r.conversione.toFixed(1), 'Valore vinto': +r.valoreVinto.toFixed(2),
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(perDimensione(statPreventivi.giochi)), 'Per gioco');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(perDimensione(statPreventivi.sedi)), 'Per sede');
    XLSX.writeFile(wb, `Cruscotto_Preventivi${annoPrevSel ? `_${annoPrevSel}` : ''}.xlsx`);
  };

  // ====================== PER GIOCO ======================
  // Una prenotazione e' una vendita sola, ma le domande a cui questa scheda deve rispondere --
  // quanto rende l'Archery, quanto pesa una sede, come va la famiglia Gonfiabili -- si fanno sul
  // gioco, non sulla vendita. Quindi ogni prenotazione viene aperta nelle sue righe.
  //
  // Dove il dettaglio c'e', una riga per voce. Dove non c'e' -- e oggi e' quasi sempre cosi', il
  // dettaglio e' appena nato -- una riga sola, con il gioco della prenotazione e i suoi totali:
  // il resoconto vale su tutto lo storico, non solo sulle prenotazioni fatte da domani.
  //
  // Due cose sui numeri. Lo sconto e' una percentuale sul totale e sulle voci non compare, quindi
  // le righe vengono riportate in proporzione al netto davvero incassato: senza, questa scheda
  // direbbe importi piu' alti della scheda Tabella sulle stesse partite. Campo e rinfresco non
  // sono di nessun gioco in particolare e vanno sul gioco che identifica la prenotazione: e'
  // un'approssimazione voluta -- quei costi si controllano per campo e per data -- e tiene i
  // totali quadrati con il resto del modulo invece di inventare una categoria che non esiste.
  const [raggruppaPer, setRaggruppaPer] = useState('centro');

  const righePerGioco = useMemo(() => {
    const righe = [];
    prenotazioni.forEach(p => {
      if (!p.data) return;
      if (annoSel && p.data.slice(0, 4) !== annoSel) return;
      if (annoSel && meseSel && parseInt(p.data.slice(5, 7), 10) !== parseInt(meseSel, 10)) return;
      if (soloConfermate && p.stato !== STATO_PREN.CONFERMATO) return;
      const voci = Array.isArray(p.voci) ? p.voci.filter(Boolean) : [];
      const costoStruttura = nettoCampo(p) + nettoRinf(p);
      // Il compenso sta sulla prenotazione, non sul singolo gioco: va sul gioco che la identifica,
      // come campo e rinfresco.
      const compPrev = compensoPrevisto[p.id] || 0;
      const compCons = compensoConsuntivato[p.id] || 0;
      const base = (extra) => ({ pren: p, giocoId: p.giocoId ?? null, nome: '', sede: sedeDiRipiego(p), ricavo: 0, costo: 0, compPrev: 0, compCons: 0, ...extra });
      if (voci.length > 0) {
        const sommaVoci = voci.reduce((t, v) => t + (parseFloat(v.ricavo) || 0), 0);
        // Le righe di un pacchetto a prezzo fisso non portano importi: il prezzo sta sul
        // pacchetto, non su di loro. Senza questo caso il ricavo di quelle prenotazioni sparirebbe
        // dal resoconto -- moltiplicato per zero -- invece di dividersi fra i giochi che lo hanno
        // prodotto. "Due giochi (2h)" e' un'ora per uno, quindi la divisione e' in parti uguali.
        const inPartiUguali = sommaVoci === 0;
        const proporzione = inPartiUguali ? (nettoRicavo(p) / voci.length) : (nettoRicavo(p) / sommaVoci);
        voci.forEach(v => righe.push({
          pren: p,
          giocoId: v.giocoId ?? null,
          nome: v.nome || '',
          sede: v.sede || sedeDiRipiego(p),
          ricavo: inPartiUguali ? proporzione : (parseFloat(v.ricavo) || 0) * proporzione,
          // Un gioco che parte da una nostra sede non ci costa niente di suo: il prezzo a listino
          // serve al preventivatore per calcolare la vendita, e il costo che il preventivo gli
          // attribuisce e' la logistica -- cioe' il rimborso all'operatore, che qui arriva dal
          // compenso. Lasciarlo qui vorrebbe dire pagarlo due volte.
          costo: nostra(v.sede || sedeDiRipiego(p)) ? 0 : (parseFloat(v.costo) || 0),
          compPrev: 0, compCons: 0,
        }));
        righe.push(base({ costo: costoStruttura, compPrev, compCons }));
      } else {
        righe.push(base({ ricavo: nettoRicavo(p), costo: nettoEreditato(p) + costoStruttura, compPrev, compCons }));
      }
    });
    return righe;
  }, [prenotazioni, annoSel, meseSel, soloConfermate, sedeDiRipiego, nostra, compensoPrevisto, compensoConsuntivato]);

  // Anche i grafici guardano le righe, non le vendite intere. Un grafico intitolato "ricavi per
  // centro di ricavo" che non sa mostrare i 600 euro di Archery Tag, perche' sono stati venduti
  // dentro una partita di Bubble Football, sta rispondendo a una domanda diversa da quella che
  // ha scritto in cima. Anno e mese sono gia' applicati a monte: qui restano i due centri.
  const righeAndamento = useMemo(() => righePerGioco.filter(r => {
    if (centroCostoSel && centroCostoDi(r.pren) !== centroCostoSel) return false;
    if (centroRicavoSel && centroRicavoDiRiga(r) !== centroRicavoSel) return false;
    return true;
  }), [righePerGioco, centroCostoSel, centroRicavoSel, centroCostoDi, centroRicavoDiRiga]);

  const datiBarre = useMemo(() => {
    // Qui il costo e' quello preventivo: e' l'unico che esiste su tutte le partite, e un grafico
    // di andamento che si svuota man mano che si indietreggia nel tempo non racconta niente.
    const somma = (dove, r) => {
      const costo = r.costo + r.compPrev;
      dove.ricavo += r.ricavo; dove.costo += costo; dove.margine += (r.ricavo - costo);
    };
    if (!annoSel) {
      const per = {};
      righeAndamento.forEach(r => {
        const anno = r.pren.data.slice(0, 4);
        if (!per[anno]) per[anno] = { periodo: anno, ricavo: 0, costo: 0, margine: 0 };
        somma(per[anno], r);
      });
      return Object.values(per).sort((a, b) => a.periodo.localeCompare(b.periodo));
    }
    const per = MESI.map(label => ({ periodo: label, ricavo: 0, costo: 0, margine: 0 }));
    righeAndamento.forEach(r => {
      const mIdx = parseInt(r.pren.data.slice(5, 7), 10) - 1;
      if (mIdx < 0 || mIdx > 11) return;
      somma(per[mIdx], r);
    });
    return per;
  }, [righeAndamento, annoSel]);

  const mappaColoriRicavo = useMemo(() => mappaColoriCentri(giochi.map(g => g.centro_ricavo)), [giochi]);
  const mappaColoriCosto = useMemo(() => mappaColoriCentri(campi.map(c => c.centroCosto)), [campi]);
  const datiTortaRicavi = useMemo(() => raggruppaPerCentro(righeAndamento, centroRicavoDiRiga, (r) => r.ricavo), [righeAndamento, centroRicavoDiRiga]);
  const datiTortaCosti = useMemo(() => raggruppaPerCentro(righeAndamento, (r) => centroCostoDi(r.pren), (r) => r.costo + r.compPrev), [righeAndamento, centroCostoDi]);


  // A che gruppo appartiene una riga, secondo la dimensione scelta. Il nome arriva dal catalogo
  // per id; un servizio accessorio, che gioco non e', tiene il suo nome quando si guarda per
  // gioco e resta fuori dalle categorie che non ha.
  const gruppoDi = useCallback((r) => {
    const g = r.giocoId != null ? giocoPerId[r.giocoId] : null;
    if (raggruppaPer === 'famiglia') return g?.famiglia || 'Non assegnata';
    if (raggruppaPer === 'gioco') return g?.nome || r.nome || 'Non assegnato';
    if (raggruppaPer === 'sede') return r.sede || 'Non indicata';
    return g?.centro_ricavo || 'Non assegnato';
  }, [giocoPerId, raggruppaPer]);

  // Ogni gruppo porta due costi e due margini: il preventivo dice quanto ci aspettiamo che costi,
  // il consuntivo quanto e' costato davvero. Differiscono solo sul compenso degli operatori --
  // fornitori, campo e rinfresco sono gli stessi -- e finche' un periodo non viene consuntivato
  // il secondo resta piu' basso del primo, perche' quel compenso non e' ancora stato liquidato.
  const gruppiPerGioco = useMemo(() => {
    const per = {};
    righePerGioco.forEach(r => {
      const k = gruppoDi(r);
      if (!per[k]) per[k] = { nome: k, ricavo: 0, costo: 0, compPrev: 0, compCons: 0, partite: new Set() };
      per[k].ricavo += r.ricavo;
      per[k].costo += r.costo;
      per[k].compPrev += r.compPrev;
      per[k].compCons += r.compCons;
      per[k].partite.add(r.pren.id);
    });
    return Object.values(per)
      .map(v => ({
        ...v,
        partite: v.partite.size,
        costoPrev: v.costo + v.compPrev,
        costoCons: v.costo + v.compCons,
        marginePrev: v.ricavo - v.costo - v.compPrev,
        margineCons: v.ricavo - v.costo - v.compCons,
      }))
      .sort((a, b) => b.ricavo - a.ricavo);
  }, [righePerGioco, gruppoDi]);

  // Le partite totali si contano sulle prenotazioni, non sommando i gruppi: una prenotazione con
  // due giochi di centri diversi compare in due gruppi ed e' giusto cosi', ma resta una partita.
  const partiteTotali = useMemo(() => new Set(righePerGioco.map(r => r.pren.id)).size, [righePerGioco]);
  const totaliPerGioco = useMemo(() => gruppiPerGioco.reduce(
    (a, v) => ({
      ricavo: a.ricavo + v.ricavo,
      costoPrev: a.costoPrev + v.costoPrev, costoCons: a.costoCons + v.costoCons,
      marginePrev: a.marginePrev + v.marginePrev, margineCons: a.margineCons + v.margineCons,
    }),
    { ricavo: 0, costoPrev: 0, costoCons: 0, marginePrev: 0, margineCons: 0 }
  ), [gruppiPerGioco]);

  const ETICHETTE_RAGGRUPPAMENTO = { centro: 'Centro di ricavo', famiglia: 'Famiglia', gioco: 'Gioco', sede: 'Sede' };

  const esportaPerGioco = () => {
    if (gruppiPerGioco.length === 0) return alert("Nessun dato da esportare.");
    const ws = XLSX.utils.json_to_sheet(gruppiPerGioco.map(v => ({
      [ETICHETTE_RAGGRUPPAMENTO[raggruppaPer]]: v.nome,
      Partite: v.partite,
      Ricavo: +v.ricavo.toFixed(2),
      'Costo preventivo': +v.costoPrev.toFixed(2),
      'Costo consuntivo': +v.costoCons.toFixed(2),
      'Margine preventivo': +v.marginePrev.toFixed(2),
      'Margine consuntivo': +v.margineCons.toFixed(2),
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "PerGioco");
    XLSX.writeFile(wb, `Costi_Ricavi_per_${raggruppaPer}.xlsx`);
  };

  const etichettaFetta = ({ nome, percent }) => percent > 0.08 ? `${nome} ${(percent * 100).toFixed(0)}%` : '';

  return (
    <>
      <nav className="modulo-subnav no-print subnav-segmented">
        {puoVedere(user, 'costiricavi', 'cruscotto') && (
          <button className={`nav-btn ${currentView === 'cruscotto' ? 'active' : ''}`} onClick={() => setCurrentView("cruscotto")}><Icona nome="cruscotto" />Dettaglio</button>
        )}
        {puoVedere(user, 'costiricavi', 'andamento') && (
          <button className={`nav-btn ${currentView === 'andamento' ? 'active' : ''}`} onClick={() => setCurrentView("andamento")}><Icona nome="andamento" />Andamento</button>
        )}
        {puoVedere(user, 'costiricavi', 'preventivi') && (
          <button className={`nav-btn ${currentView === 'preventivi' ? 'active' : ''}`} onClick={() => setCurrentView("preventivi")}><Icona nome="preventivatore" />Preventivi</button>
        )}
        {puoVedere(user, 'costiricavi', 'pergioco') && (
          <button className={`nav-btn ${currentView === 'pergioco' ? 'active' : ''}`} onClick={() => setCurrentView("pergioco")}><Icona nome="giochi" />Per gioco</button>
        )}
      </nav>

      {/* ===================== CRUSCOTTO ===================== */}
      {currentView === "cruscotto" && puoVedere(user, 'costiricavi', 'cruscotto') && (
        <div className="schermata-storico no-print">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <h2 style={{ margin: 0 }}>Dettaglio partite <span style={{ fontSize: '0.75rem', fontWeight: 'normal', color: '#777' }}>(valori senza IVA)</span></h2>
            <button onClick={esportaCruscotto} style={{ padding: '8px 16px', backgroundColor: '#10b981', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>📊 Esporta Excel</button>
          </div>
          <p className="descrizione-pagina">
            Tutte le partite, in qualunque stato. Ogni importo è il consuntivo quando c'è, altrimenti il preventivo:
            {' '}<span className="importo-consuntivo">€0.00</span> consuntivato,
            {' '}<span className="importo-preventivo">€0.00</span> preventivo,
            {' '}<span className="importo-misto"><span className="importo-segno">◐</span>€0.00</span> in parte consuntivato.
            Il ricavo è consuntivato quando è fatturato per intero; costi di operatori, fornitori e campi quando il loro periodo è chiuso.
            Apri una riga per vedere preventivo e consuntivo voce per voce. Le posticipate restano fuori dai totali. Le annullate compaiono solo se all'annullamento si sono segnati costi (campo, rinfresco, operatori): non hanno ricavo, ma quei costi contano.
          </p>

          <div className="filtri-storico" style={{ flexWrap: 'wrap' }}>
            <div className="filtro-group" style={{ flex: '1 1 250px' }}>
              <label>Mese evento:</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <button type="button" className="btn-chiudi" style={{ float: 'none', padding: '6px 12px' }} title="Mese precedente" onClick={() => spostaMeseCr(-1)}>‹</button>
                <span style={{ flex: 1, textAlign: 'center', fontSize: '0.8rem', whiteSpace: 'nowrap', color: crMese ? '#334155' : '#94a3b8' }}>
                  {crMese ? etichettaMese(crMese) : 'tutti'}
                </span>
                <button type="button" className="btn-chiudi" style={{ float: 'none', padding: '6px 12px' }} title="Mese successivo" onClick={() => spostaMeseCr(1)}>›</button>
                {crMese
                  ? <button type="button" className="btn-chiudi" style={{ float: 'none', padding: '6px 12px' }} title="Togli il filtro per mese" onClick={() => setCrMese("")}>✕</button>
                  : <button type="button" className="btn-chiudi" style={{ float: 'none', padding: '6px 12px' }} title="Mese corrente" onClick={() => spostaMeseCr(0)}>Oggi</button>}
              </div>
            </div>
            <div className="filtro-group" style={{ flex: '1 1 150px' }}>
              <label>Stato:</label>
              <select value={crStato} onChange={(e) => setCrStato(e.target.value)}>
                <option value="">Tutti</option>
                {Object.values(STATO_PREN).map(s => <option key={s} value={s}>{etichettaStatoPren(s)}</option>)}
              </select>
            </div>
            <div className="filtro-group" style={{ flex: '1 1 180px' }}>
              <label>Consuntivo:</label>
              <select value={crConsuntivo} onChange={(e) => setCrConsuntivo(e.target.value)}>
                <option value="">Tutte</option>
                <option value="cons">Consuntivate</option>
                <option value="misto">In parte consuntivate</option>
                <option value="prev">Solo preventivo</option>
              </select>
            </div>
            <div className="filtro-group" style={{ flex: '1 1 160px' }}>
              <label>Bubbler:</label>
              <select value={crOperatore} onChange={(e) => setCrOperatore(e.target.value)}>
                <option value="">Tutti</option>
                {operatoriDisponibili.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}
              </select>
            </div>
            <div className="filtro-group" style={{ flex: '1 1 180px' }}>
              <label>Nominativo o codice:</label>
              <input type="text" value={crNome} onChange={(e) => setCrNome(e.target.value)} />
            </div>
          </div>

          <div className="admin-table-box-full" style={{ marginTop: '20px', overflowX: 'auto' }}>
            <table className="storico-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem', background: '#fff' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                  {COLONNE_CRUSCOTTO.map(c => {
                    const { style: stileOrdinabile, ...propsOrdinabile } = ordinamentoCruscotto.propsTestata(c.chiave);
                    return (
                      <th key={c.chiave} {...propsOrdinabile} style={{ padding: '8px 10px', fontSize: '0.78rem', color: '#64748b', textAlign: c.destra ? 'right' : 'left', ...stileOrdinabile }}>
                        {c.label}{ordinamentoCruscotto.frecciaOrdinamento(c.chiave)}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {righeCruscotto.length === 0
                  ? <tr><td colSpan={COLONNE_CRUSCOTTO.length} style={{ textAlign: 'center', padding: '20px', color: '#666' }}>Nessuna partita.</td></tr>
                  : ordinamentoCruscotto.ordina(righeCruscotto).map(p => {
                    const a = analisiPartite[p.id];
                    const espansa = crEspansa === p.id;
                    const esclusa = fuoriDaiTotali(p);
                    return (
                      <Fragment key={p.id}>
                        <tr
                          onClick={() => setCrEspansa(prev => prev === p.id ? null : p.id)}
                          title={esclusa ? 'Esclusa dai totali' : undefined}
                          style={{ cursor: 'pointer', background: espansa ? '#f8fafc' : undefined, borderBottom: espansa ? 'none' : '1px solid #eee', borderLeft: `3px solid ${coloreStatoPren(p.stato)}`, opacity: esclusa ? 0.6 : 1 }}
                        >
                          <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                            <span className="riga-espandibile-chevron" style={{ transform: espansa ? 'rotate(90deg)' : 'none' }}>›</span>
                            {formattaDataGGMMAAAA(p.data) || '—'}
                          </td>
                          <td style={{ padding: '8px 10px', fontSize: '0.82rem', color: '#64748b', whiteSpace: 'nowrap' }}>{p.id}</td>
                          <td style={{ padding: '8px 10px' }}><strong>{p.nominativo}</strong></td>
                          <td style={{ padding: '8px 10px', fontSize: '0.82rem', color: '#555' }}>{etichettaDi(p)}</td>
                          <td style={{ padding: '8px 10px', fontSize: '0.82rem', color: '#555' }}>{p.campoNome || [p.locationCitta, p.locationProvincia].filter(Boolean).join(' ') || '—'}</td>
                          <td style={{ padding: '8px 10px' }}><span className={`badge-stato badge-mini ${classeBadgeStato(p.stato)}`}>{etichettaStatoPren(p.stato)}</span></td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>{cellaImportoCr(a.ricavoEff, a.statoRicavo, '#1e293b')}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                            {a.statoCosto === 'vuoto' ? <span style={{ color: '#94a3b8' }}>—</span> : importoCr(a.costoEff, a.statoCosto, '#c62828')}
                          </td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>{cellaImportoCr(a.margineEff, a.statoMargine, a.margineEff >= 0 ? '#2e7d32' : '#c62828')}</td>
                        </tr>
                        {espansa && dettaglioCruscotto(p, a)}
                      </Fragment>
                    );
                  })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid #ddd', background: '#f8fafc', fontWeight: 'bold' }}>
                  <td style={{ padding: '10px' }} colSpan={6}>
                    TOTALE ({totaliCruscotto.n})
                    {totaliCruscotto.n < righeCruscotto.length && <span style={{ fontWeight: 'normal', fontSize: '0.78rem', color: '#64748b' }}> · escluse {righeCruscotto.length - totaliCruscotto.n} posticipate</span>}
                  </td>
                  <td style={{ padding: '10px', textAlign: 'right' }}>€{totaliCruscotto.ricavo.toFixed(2)}</td>
                  <td style={{ padding: '10px', textAlign: 'right', color: '#c62828' }}>€{totaliCruscotto.costo.toFixed(2)}</td>
                  <td style={{ padding: '10px', textAlign: 'right', color: totaliCruscotto.margine >= 0 ? '#2e7d32' : '#c62828' }}>€{totaliCruscotto.margine.toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ===================== ANDAMENTO ===================== */}
      {currentView === "andamento" && puoVedere(user, 'costiricavi', 'andamento') && (
        <div className="schermata-storico no-print">
          <h2 style={{ margin: '0 0 15px 0' }}>Andamento <span style={{ fontSize: '0.75rem', fontWeight: 'normal', color: '#777' }}>(valori senza IVA)</span></h2>

          <div className="filtri-storico" style={{ flexWrap: 'wrap' }}>
            <div className="filtro-group" style={{ flex: '1 1 140px' }}>
              <label>Anno:</label>
              <select value={annoSel} onChange={(e) => { setAnnoSel(e.target.value); setMeseSel(""); }}>
                <option value="">Tutti gli anni</option>
                {anniDisponibili.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div className="filtro-group" style={{ flex: '1 1 140px' }}>
              <label>Mese:</label>
              <select value={meseSel} onChange={(e) => setMeseSel(e.target.value)} disabled={!annoSel}>
                <option value="">Tutti i mesi</option>
                {MESI.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
              </select>
            </div>
            <div className="filtro-group" style={{ flex: '1 1 180px' }}>
              <label>Centro di costo:</label>
              <select value={centroCostoSel} onChange={(e) => setCentroCostoSel(e.target.value)}>
                <option value="">Tutti</option>
                {centriCostoDisponibili.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="filtro-group" style={{ flex: '1 1 180px' }}>
              <label>Centro di ricavo:</label>
              <select value={centroRicavoSel} onChange={(e) => setCentroRicavoSel(e.target.value)}>
                <option value="">Tutti</option>
                {centriRicavoDisponibili.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="filtro-group" style={{ flex: '0 1 auto', justifyContent: 'flex-end' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: 0, paddingBottom: '9px' }} title="Lascia fuori le partite ancora da confermare: i loro numeri sono un'ipotesi">
                <input type="checkbox" checked={soloConfermate} onChange={(e) => setSoloConfermate(e.target.checked)} />
                Mostra solo confermate
              </label>
            </div>
          </div>

          <div className="admin-table-box-full" style={{ marginTop: '20px', padding: '16px 8px' }}>
            <h3 style={{ margin: '0 0 2px 14px', fontSize: '1rem' }}>Ricavo {annoSel ? `per mese (${annoSel})` : 'per anno'}</h3>
            {/* Una colonna sola: costo sotto, margine sopra, e la loro altezza insieme e' il ricavo.
                Un mese in perdita esce sotto lo zero, che e' il modo piu' onesto di dirlo. */}
            <p style={{ margin: '0 0 10px 14px', fontSize: '0.78rem', color: INK_MUTED }}>
              Ogni colonna è il ricavo del periodo, diviso in costo e margine. Sotto lo zero il costo ha superato il ricavo.
            </p>
            <ResponsiveContainer width="100%" height={340}>
              <BarChart data={datiBarre} margin={{ top: 10, right: 20, left: 0, bottom: 0 }} barCategoryGap="20%">
                <CartesianGrid vertical={false} stroke={STROKE_GRIGLIA} />
                <XAxis dataKey="periodo" stroke={STROKE_ASSE} tick={{ fill: INK_MUTED, fontSize: 12 }} axisLine={{ stroke: STROKE_ASSE }} tickLine={false} />
                <YAxis stroke={STROKE_ASSE} tick={{ fill: INK_MUTED, fontSize: 12 }} axisLine={{ stroke: STROKE_ASSE }} tickLine={false} tickFormatter={(v) => `€${v}`} />
                <Tooltip content={<TooltipPila />} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
                <Legend wrapperStyle={{ fontSize: '0.85rem' }} />
                <ReferenceLine y={0} stroke={STROKE_ASSE} />
                <Bar dataKey="costo" name="Costo" stackId="conto" fill={COLORE_COSTO} maxBarSize={36} />
                <Bar dataKey="margine" name="Margine" stackId="conto" fill={COLORE_MARGINE} radius={[4, 4, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', marginTop: '20px' }}>
            <div className="admin-table-box-full" style={{ flex: '1 1 380px', padding: '16px 8px' }}>
              <h3 style={{ margin: '0 0 10px 14px', fontSize: '1rem' }}>Distribuzione ricavi per centro di ricavo</h3>
              {datiTortaRicavi.length === 0 ? (
                <p style={{ textAlign: 'center', color: '#666', padding: '20px' }}>Nessun dato nel periodo selezionato.</p>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <PieChart>
                    <Pie data={datiTortaRicavi} dataKey="valore" nameKey="nome" cx="50%" cy="50%" outerRadius={100} label={etichettaFetta}>
                      {datiTortaRicavi.map(v => <Cell key={v.nome} fill={coloreCentro(mappaColoriRicavo, v.nome)} />)}
                    </Pie>
                    <Tooltip formatter={(value) => formattaEuro(value)} />
                    <Legend wrapperStyle={{ fontSize: '0.8rem' }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="admin-table-box-full" style={{ flex: '1 1 380px', padding: '16px 8px' }}>
              <h3 style={{ margin: '0 0 10px 14px', fontSize: '1rem' }}>Distribuzione costi per centro di costo</h3>
              {datiTortaCosti.length === 0 ? (
                <p style={{ textAlign: 'center', color: '#666', padding: '20px' }}>Nessun dato nel periodo selezionato.</p>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <PieChart>
                    <Pie data={datiTortaCosti} dataKey="valore" nameKey="nome" cx="50%" cy="50%" outerRadius={100} label={etichettaFetta}>
                      {datiTortaCosti.map(v => <Cell key={v.nome} fill={coloreCentro(mappaColoriCosto, v.nome)} />)}
                    </Pie>
                    <Tooltip formatter={(value) => formattaEuro(value)} />
                    <Legend wrapperStyle={{ fontSize: '0.8rem' }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
      )}
      {/* ===================== PER GIOCO ===================== */}
      {currentView === "pergioco" && puoVedere(user, 'costiricavi', 'pergioco') && (
        <div className="schermata-storico no-print">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <h2 style={{ margin: 0 }}>Per gioco <span style={{ fontSize: '0.75rem', fontWeight: 'normal', color: '#777' }}>(valori senza IVA, per data dell'evento)</span></h2>
            <button onClick={esportaPerGioco} style={{ padding: '8px 16px', backgroundColor: '#10b981', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>📊 Esporta Excel</button>
          </div>
          <p className="descrizione-pagina">
            Ogni prenotazione è aperta nei giochi che contiene. Una partita con più giochi compare in più gruppi ma resta una partita sola,
            quindi le partite dei gruppi possono sommare più del totale. Campo e rinfresco sono attribuiti al gioco della prenotazione.
          </p>

          <div className="filtri-storico" style={{ flexWrap: 'wrap' }}>
            <div className="filtro-group" style={{ flex: '1 1 140px' }}>
              <label>Anno:</label>
              <select value={annoSel} onChange={(e) => { setAnnoSel(e.target.value); setMeseSel(""); }}>
                <option value="">Tutti gli anni</option>
                {anniDisponibili.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div className="filtro-group" style={{ flex: '1 1 140px' }}>
              <label>Mese:</label>
              <select value={meseSel} onChange={(e) => setMeseSel(e.target.value)} disabled={!annoSel}>
                <option value="">Tutti i mesi</option>
                {MESI.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
              </select>
            </div>
            <div className="filtro-group" style={{ flex: '1 1 200px' }}>
              <label>Raggruppa per:</label>
              <select value={raggruppaPer} onChange={(e) => setRaggruppaPer(e.target.value)}>
                {Object.entries(ETICHETTE_RAGGRUPPAMENTO).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </div>
            <div className="filtro-group" style={{ flex: '0 1 auto', justifyContent: 'flex-end' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: 0, paddingBottom: '9px' }} title="Lascia fuori le partite ancora da confermare: i loro numeri sono un'ipotesi">
                <input type="checkbox" checked={soloConfermate} onChange={(e) => setSoloConfermate(e.target.checked)} />
                Mostra solo confermate
              </label>
            </div>
          </div>

          <div className="admin-table-box-full" style={{ marginTop: '20px', overflowX: 'auto' }}>
            <table className="storico-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem', background: '#fff' }}>
              <thead>
                <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                  <th style={{ padding: '10px' }}>{ETICHETTE_RAGGRUPPAMENTO[raggruppaPer]}</th>
                  <th style={{ padding: '10px', textAlign: 'right' }}>Partite</th>
                  <th style={{ padding: '10px', textAlign: 'right' }}>Ricavo</th>
                  <th style={{ padding: '10px', textAlign: 'right' }}>Costo prev.</th>
                  <th style={{ padding: '10px', textAlign: 'right' }}>Costo cons.</th>
                  <th style={{ padding: '10px', textAlign: 'right' }}>Margine prev.</th>
                  <th style={{ padding: '10px', textAlign: 'right' }}>Margine cons.</th>
                </tr>
              </thead>
              <tbody>
                {gruppiPerGioco.length === 0
                  ? <tr><td colSpan="7" style={{ textAlign: 'center', padding: '20px', color: '#666' }}>Nessuna partita nel periodo selezionato.</td></tr>
                  : gruppiPerGioco.map(v => (
                    <tr key={v.nome} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '10px' }}>{v.nome}</td>
                      <td style={{ padding: '10px', textAlign: 'right' }}>{v.partite}</td>
                      <td style={{ padding: '10px', textAlign: 'right' }}>{formattaEuro(v.ricavo)}</td>
                      <td style={{ padding: '10px', textAlign: 'right', color: '#c62828' }}>{formattaEuro(v.costoPrev)}</td>
                      <td style={{ padding: '10px', textAlign: 'right', color: '#c62828' }}>{formattaEuro(v.costoCons)}</td>
                      <td style={{ padding: '10px', textAlign: 'right', fontWeight: 'bold', color: v.marginePrev >= 0 ? '#2e7d32' : '#c62828' }}>{formattaEuro(v.marginePrev)}</td>
                      <td style={{ padding: '10px', textAlign: 'right', fontWeight: 'bold', color: v.margineCons >= 0 ? '#2e7d32' : '#c62828' }}>{formattaEuro(v.margineCons)}</td>
                    </tr>
                  ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid #ddd', background: '#f8fafc', fontWeight: 'bold' }}>
                  <td style={{ padding: '10px' }}>TOTALE</td>
                  <td style={{ padding: '10px', textAlign: 'right' }}>{partiteTotali}</td>
                  <td style={{ padding: '10px', textAlign: 'right' }}>{formattaEuro(totaliPerGioco.ricavo)}</td>
                  <td style={{ padding: '10px', textAlign: 'right', color: '#c62828' }}>{formattaEuro(totaliPerGioco.costoPrev)}</td>
                  <td style={{ padding: '10px', textAlign: 'right', color: '#c62828' }}>{formattaEuro(totaliPerGioco.costoCons)}</td>
                  <td style={{ padding: '10px', textAlign: 'right', color: totaliPerGioco.marginePrev >= 0 ? '#2e7d32' : '#c62828' }}>{formattaEuro(totaliPerGioco.marginePrev)}</td>
                  <td style={{ padding: '10px', textAlign: 'right', color: totaliPerGioco.margineCons >= 0 ? '#2e7d32' : '#c62828' }}>{formattaEuro(totaliPerGioco.margineCons)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {gruppiPerGioco.length > 0 && (
            <div className="admin-table-box-full" style={{ marginTop: '20px', padding: '16px 8px' }}>
              <h3 style={{ margin: '0 0 2px 14px', fontSize: '1rem' }}>Ricavo per {ETICHETTE_RAGGRUPPAMENTO[raggruppaPer].toLowerCase()}</h3>
              <p style={{ margin: '0 0 10px 14px', fontSize: '0.78rem', color: INK_MUTED }}>
                Ogni colonna è il ricavo del gruppo, diviso in costo e margine preventivi. Sotto lo zero il costo ha superato il ricavo.
              </p>
              <ResponsiveContainer width="100%" height={340}>
                <BarChart data={gruppiPerGioco.slice(0, 12)} margin={{ top: 10, right: 20, left: 0, bottom: 0 }} barCategoryGap="20%">
                  <CartesianGrid vertical={false} stroke={STROKE_GRIGLIA} />
                  <XAxis dataKey="nome" stroke={STROKE_ASSE} tick={{ fill: INK_MUTED, fontSize: 11 }} axisLine={{ stroke: STROKE_ASSE }} tickLine={false} interval={0} />
                  <YAxis stroke={STROKE_ASSE} tick={{ fill: INK_MUTED, fontSize: 12 }} axisLine={{ stroke: STROKE_ASSE }} tickLine={false} tickFormatter={(v) => '€' + v} />
                  <Tooltip content={<TooltipPila campi={{ costo: 'costoPrev', margine: 'marginePrev' }} />} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
                  <Legend wrapperStyle={{ fontSize: '0.85rem' }} />
                  <ReferenceLine y={0} stroke={STROKE_ASSE} />
                  <Bar dataKey="costoPrev" name="Costo preventivo" stackId="conto" fill={COLORE_COSTO} maxBarSize={36} />
                  <Bar dataKey="marginePrev" name="Margine preventivo" stackId="conto" fill={COLORE_MARGINE} radius={[4, 4, 0, 0]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* ===================== PREVENTIVI ===================== */}
      {currentView === "preventivi" && puoVedere(user, 'costiricavi', 'preventivi') && (() => {
        const t = statPreventivi.totali;
        const riquadro = (titolo, valore, sotto, colore) => (
          <div className="admin-table-box-full" style={{ flex: '1 1 180px', padding: '14px 16px' }}>
            <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{titolo}</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: colore || '#0f172a' }}>{valore}</div>
            <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>{sotto}</div>
          </div>
        );
        const tabellaGruppi = (righe, intestazione, vuoto) => (
          <div className="admin-table-box-full" style={{ flex: '1 1 420px', overflowX: 'auto' }}>
            <table className="storico-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem', background: '#fff' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                  {[intestazione, 'Preventivi', 'Vinti', 'Persi', 'Conversione', 'Valore vinto'].map((c, i) => (
                    <th key={c} style={{ padding: '8px 10px', fontSize: '0.78rem', color: '#64748b', textAlign: i === 0 ? 'left' : 'right' }}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {righe.length === 0
                  ? <tr><td colSpan={6} style={{ textAlign: 'center', padding: '20px', color: '#666' }}>{vuoto}</td></tr>
                  : righe.map(r => (
                    <tr key={r.nome} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '8px 10px' }}>{r.nome}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right' }}>{r.emessi}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: '#15803d' }}>{r.vinto}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: '#b91c1c' }}>{r.perso}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>{percentuale(r.conversione)}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right' }}>{formattaEuro(r.valoreVinto)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        );
        return (
          <div className="schermata-storico no-print">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <h2 style={{ margin: 0 }}>Preventivi <span style={{ fontSize: '0.75rem', fontWeight: 'normal', color: '#777' }}>(importi di vendita, per data di emissione)</span></h2>
              <button onClick={esportaPreventivi} style={{ padding: '8px 16px', backgroundColor: '#10b981', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>📊 Esporta Excel</button>
            </div>
            <p className="descrizione-pagina">
              Quanto si offre e quanto si porta a casa. Un preventivo è <strong>vinto</strong> quando il cliente lo conferma (o è già diventato una
              prenotazione), <strong>perso</strong> quando viene annullato o scade senza risposta oltre i {GIORNI_VALIDITA_PREVENTIVO} giorni di validità,
              <strong> aperto</strong> finché quella validità dura. La conversione si calcola solo su quelli con una risposta, vinti su vinti più persi:
              gli aperti non sono ancora né l'uno né l'altro.
            </p>

            <div className="filtri-storico" style={{ flexWrap: 'wrap' }}>
              <div className="filtro-group" style={{ flex: '1 1 140px' }}>
                <label>Anno di emissione:</label>
                <select value={annoPrevSel} onChange={(e) => { setAnnoPrev(e.target.value); setMesePrev(""); }}>
                  <option value="">Tutti gli anni</option>
                  {anniPreventivi.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              <div className="filtro-group" style={{ flex: '1 1 140px' }}>
                <label>Mese di emissione:</label>
                <select value={mesePrevSel} onChange={(e) => setMesePrev(e.target.value)} disabled={!annoPrevSel}>
                  <option value="">Tutti i mesi</option>
                  {MESI.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginTop: '20px' }}>
              {riquadro('Preventivi emessi', t.emessi.n, `${formattaEuro(t.emessi.valore)} offerti`)}
              {riquadro('Conversione', percentuale(t.conversione), `${t.vinto.n} vinti, ${t.perso.n} persi, ${t.aperto.n} aperti`, '#15803d')}
              {riquadro('Valore vinto', formattaEuro(t.vinto.valore), `${formattaEuro(t.perso.valore)} persi`, '#15803d')}
              {riquadro('Preventivo medio', formattaEuro(t.medio), `${formattaEuro(t.medioVinto)} sui vinti`)}
              {riquadro('Margine preventivato', formattaEuro(t.margine), t.marginePerc == null ? 'sul totale offerto' : `${t.marginePerc.toFixed(0)}% del valore offerto`)}
            </div>

            <div className="admin-table-box-full" style={{ marginTop: '20px', padding: '16px 8px' }}>
              <h3 style={{ margin: '0 0 2px 14px', fontSize: '1rem' }}>Valore offerto {annoPrevSel ? `per mese (${annoPrevSel})` : 'per anno'}{mesePrevSel ? `, filtrato su ${MESI[parseInt(mesePrevSel, 10) - 1]}` : ''}</h3>
              <p style={{ margin: '0 0 10px 14px', fontSize: '0.78rem', color: INK_MUTED }}>
                Ogni colonna è il valore dei preventivi emessi nel periodo, diviso per esito.
              </p>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={statPreventivi.periodi} margin={{ top: 10, right: 20, left: 0, bottom: 0 }} barCategoryGap="20%">
                  <CartesianGrid vertical={false} stroke={STROKE_GRIGLIA} />
                  <XAxis dataKey="periodo" stroke={STROKE_ASSE} tick={{ fill: INK_MUTED, fontSize: 12 }} axisLine={{ stroke: STROKE_ASSE }} tickLine={false} />
                  <YAxis stroke={STROKE_ASSE} tick={{ fill: INK_MUTED, fontSize: 12 }} axisLine={{ stroke: STROKE_ASSE }} tickLine={false} tickFormatter={(v) => `€${v}`} />
                  <Tooltip formatter={(value) => formattaEuro(value)} contentStyle={{ fontSize: '0.85rem' }} />
                  <Legend wrapperStyle={{ fontSize: '0.85rem' }} />
                  <Bar dataKey="valoreVinto" name="Vinto" stackId="esito" fill={COLORE_MARGINE} maxBarSize={36} />
                  <Bar dataKey="valorePerso" name="Perso" stackId="esito" fill={COLORE_COSTO} maxBarSize={36} />
                  <Bar dataKey="valoreAperto" name="Aperto" stackId="esito" fill={COLORE_ALTRO} radius={[4, 4, 0, 0]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="admin-table-box-full" style={{ marginTop: '20px', overflowX: 'auto' }}>
              <table className="storico-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem', background: '#fff' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                    {['Periodo', 'Emessi', 'Vinti', 'Persi', 'Aperti', 'Conversione', 'Valore offerto', 'Valore vinto'].map((c, i) => (
                      <th key={c} style={{ padding: '8px 10px', fontSize: '0.78rem', color: '#64748b', textAlign: i === 0 ? 'left' : 'right' }}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {statPreventivi.periodi.filter(r => r.emessi > 0).length === 0
                    ? <tr><td colSpan={8} style={{ textAlign: 'center', padding: '20px', color: '#666' }}>Nessun preventivo nel periodo.</td></tr>
                    : statPreventivi.periodi.filter(r => r.emessi > 0).map(r => (
                      <tr key={r.periodo} style={{ borderBottom: '1px solid #eee' }}>
                        <td style={{ padding: '8px 10px' }}>{r.periodo}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right' }}>{r.emessi}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: '#15803d' }}>{r.vinto}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: '#b91c1c' }}>{r.perso}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: '#64748b' }}>{r.aperto}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>{percentuale(r.conversione)}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right' }}>{formattaEuro(r.valore)}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: '#15803d' }}>{formattaEuro(r.valoreVinto)}</td>
                      </tr>
                    ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid #ddd', background: '#f8fafc', fontWeight: 'bold' }}>
                    <td style={{ padding: '10px' }}>TOTALE</td>
                    <td style={{ padding: '10px', textAlign: 'right' }}>{t.emessi.n}</td>
                    <td style={{ padding: '10px', textAlign: 'right', color: '#15803d' }}>{t.vinto.n}</td>
                    <td style={{ padding: '10px', textAlign: 'right', color: '#b91c1c' }}>{t.perso.n}</td>
                    <td style={{ padding: '10px', textAlign: 'right', color: '#64748b' }}>{t.aperto.n}</td>
                    <td style={{ padding: '10px', textAlign: 'right' }}>{percentuale(t.conversione)}</td>
                    <td style={{ padding: '10px', textAlign: 'right' }}>{formattaEuro(t.emessi.valore)}</td>
                    <td style={{ padding: '10px', textAlign: 'right', color: '#15803d' }}>{formattaEuro(t.vinto.valore)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <p className="descrizione-pagina" style={{ marginTop: '20px' }}>
              Un preventivo conta una volta per ogni gioco e per ogni sede che contiene: a essere vinta o persa è l'offerta intera, non la singola riga,
              quindi le righe qui sotto possono sommare più dei preventivi emessi. I preventivi più vecchi non dicono da quale sede parte il gioco e
              finiscono in "Sede non indicata"; "Senza sede di partenza" sono invece gli extra, che da nessun magazzino partono.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px' }}>
              {tabellaGruppi(statPreventivi.giochi, 'Gioco', 'Nessun gioco nei preventivi del periodo.')}
              {tabellaGruppi(statPreventivi.sedi, 'Sede di partenza', 'Nessuna sede nei preventivi del periodo.')}
            </div>

            <div className="admin-table-box-full" style={{ marginTop: '20px', padding: '16px' }}>
              <h3 style={{ margin: '0 0 10px 0', fontSize: '1rem' }}>Perché si perdono</h3>
              <p style={{ margin: '0 0 12px 0', fontSize: '0.82rem', color: '#64748b' }}>
                {statPreventivi.annullati} annullati con un motivo scritto, {statPreventivi.scadutiSenzaRisposta} scaduti senza risposta del cliente.
              </p>
              {statPreventivi.motivi.length === 0
                ? <p style={{ color: '#94a3b8', fontSize: '0.85rem', margin: 0 }}>Nessun preventivo annullato nel periodo.</p>
                : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {statPreventivi.motivi.map(m => (
                      <div key={m.nome} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.85rem' }}>
                        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.nome}>{m.nome}</div>
                        <div style={{ width: `${Math.max((m.n / statPreventivi.motivi[0].n) * 140, 8)}px`, height: '10px', borderRadius: '5px', background: COLORE_COSTO }} />
                        <strong style={{ width: '28px', textAlign: 'right' }}>{m.n}</strong>
                      </div>
                    ))}
                  </div>
                )}
            </div>
          </div>
        );
      })()}
    </>
  );
}

export default Cruscotto
