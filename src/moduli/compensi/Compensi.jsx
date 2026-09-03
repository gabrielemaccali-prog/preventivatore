import { useState, useEffect, useMemo, useCallback, Fragment } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { puoVedere } from '../../lib/permessi'
import Icona from '../../components/Icona'
import html2pdf from 'html2pdf.js'
import { preventiviPerOperatore, rettificheForfait, importiRimborso, oreDiPartita } from './calcolo'
import { toMinutes } from '../../lib/utils'
import { useOrdinamentoTabella } from '../../lib/ordinamentoTabella'

// Parametri del calcolo compensi. I default replicano quelli in sql/compensi.sql: valgono solo
// finché la riga non è stata letta dal DB, così i campi non partono vuoti al primo render.
const PARAMETRI_DEFAULT = {
  prima_ora: 30,
  ora_successiva: 10,
  tetto_giornaliero: 120,
  bonus_recensione: 5,
  aliquota_ritenuta: 20,
  gap_consecutivita_min: 60,
};

// Etichetta e spiegazione di ogni manopola: l'elenco guida il render, così aggiungere un
// parametro domani significa aggiungere una riga qui e una colonna nella tabella.
const CAMPI_PARAMETRI = [
  { chiave: 'prima_ora', label: 'Prima ora', unita: '€', aiuto: 'Compenso della prima ora di ogni blocco consecutivo.' },
  { chiave: 'ora_successiva', label: 'Ore successive', unita: '€', aiuto: 'Compenso di ogni ora oltre la prima; la mezz\'ora vale metà.' },
  { chiave: 'tetto_giornaliero', label: 'Tetto giornaliero', unita: '€', aiuto: 'Massimo sul solo compenso orario. Recensioni e rimborsi si sommano sopra il tetto.' },
  { chiave: 'bonus_recensione', label: 'Bonus recensione', unita: '€', aiuto: 'Una sola recensione per operatore per partita.' },
  { chiave: 'aliquota_ritenuta', label: 'Ritenuta d\'acconto', unita: '%', aiuto: 'Il compenso calcolato è netto in mano: la ritenuta è un costo che si aggiunge sopra.' },
  { chiave: 'gap_consecutivita_min', label: 'Stacco massimo', unita: 'min', aiuto: 'Entro questo stacco due partite restano nello stesso blocco; oltre, riparte la prima ora.' },
];

const stileInput = { width: '100%', boxSizing: 'border-box', height: '36px', padding: '6px 10px', fontSize: '0.85rem', border: '1px solid #ccc', borderRadius: '4px' };

// Cella cliccabile di rettifica o spesa: mostra il totale quando c'è qualcosa, un "+" quando è
// vuota. Deve sembrare interattiva anche da vuota, altrimenti nessuno scopre che si può cliccare.
const cellaVoce = (valorizzata, colore) => ({
  border: `1px solid ${valorizzata ? colore : '#ddd'}`,
  background: valorizzata ? '#fff' : 'transparent',
  color: valorizzata ? colore : '#aaa',
  borderRadius: '4px', padding: '3px 8px', cursor: 'pointer',
  fontSize: '0.8rem', fontWeight: valorizzata ? 600 : 400,
  minWidth: '52px', textAlign: 'right',
});
const btnSalva = { display: 'inline-flex', alignItems: 'center', padding: '9px 18px', background: '#0288d1', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' };

const arrotonda2 = (n) => Math.round((+n || 0) * 100) / 100;
const euro = (v) => `€${(+v || 0).toFixed(2)}`;
// Le ore si scrivono senza decimali inutili: 3 invece di 3,00 ma 1,5 resta 1,5.
const ore = (v) => `${(+v || 0).toFixed(2).replace(/\.?0+$/, '').replace('.', ',')} h`;
const oggiIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const oraDiMinuti = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(Math.round(min % 60)).padStart(2, '0')}`;
// "2026-08-14" -> "14/08/26", come le tabelle del modulo prenotazioni. Il campo date del filtro
// resta ISO, perché è il browser a disegnarlo.
const dataBreve = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : (iso || "");
};

const MESI_IT = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
// "2026-07-10" -> "10 luglio 2026": sul documento la data si scrive per esteso.
const dataEstesa = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return m ? `${+m[3]} ${MESI_IT[+m[2] - 1]} ${m[1]}` : (iso || "");
};

// Dove si è giocato: il nome breve del campo se è uno dei nostri, altrimenti il solo comune.
// All'operatore serve riconoscere il posto, non l'indirizzo per esteso.
const locationDi = (p) => p.campoNome || p.locationCitta || '—';

// Orario della singola partita, non del blocco che la contiene: due partite dello stesso blocco
// hanno lo stesso intervallo di blocco, e mostrarlo su entrambe le farebbe sembrare lunghe uguali.
const intervalloPartita = (p) => {
  const inizio = toMinutes(p.oraInizio);
  if (inizio == null) return '';
  return `${oraDiMinuti(inizio)}–${oraDiMinuti(inizio + oreDiPartita(p) * 60)}`;
};

function Compensi({ user }) {
  const primaScheda = ['config', 'gestione', 'indicatori'].find(s => puoVedere(user, 'compensi', s)) || 'config';
  const [currentView, setCurrentView] = useState(primaScheda);
  const primaSottoscheda = ['daconsuntivare', 'rimborsi', 'evasi'].find(s => puoVedere(user, 'compensi', 'gestione', s)) || 'daconsuntivare';
  const [gestioneTab, setGestioneTab] = useState(primaSottoscheda);

  const [parametri, setParametri] = useState(PARAMETRI_DEFAULT);
  const [salvataggio, setSalvataggio] = useState(false);
  // Messaggio del DB quando la tabella non esiste ancora: null = schema a posto.
  const [schemaMancante, setSchemaMancante] = useState(null);

  const fetchTutto = async () => {
    const par = await supabase.from('compensi_parametri').select('*').eq('id', 1).maybeSingle();
    // Finché sql/compensi.sql non è stato eseguito la tabella non esiste: senza questo controllo la
    // scheda mostrerebbe i default come se fossero i valori salvati, e il salvataggio fallirebbe
    // senza che sia chiaro il perché.
    setSchemaMancante(par.error ? par.error.message : null);
    if (par.data) setParametri(par.data);
  };

  useEffect(() => { fetchTutto(); }, []);

  // ---------------- DA CONSUNTIVARE ----------------
  // Nessun periodo di partenza: si apre su tutto quello che resta da consuntivare, perché è quello
  // che il manager vuole sapere. Le date servono a restringere, non a trovare.
  const [dal, setDal] = useState('');
  const [al, setAl] = useState('');
  const [partite, setPartite] = useState([]);
  const [voci, setVoci] = useState([]);
  const [periodi, setPeriodi] = useState([]);
  const [caricamentoPartite, setCaricamentoPartite] = useState(false);
  const [operatoreEspanso, setOperatoreEspanso] = useState(null);
  const [inCorso, setInCorso] = useState(null); // chiave dell'azione in corso, per disabilitare il pulsante giusto
  const [formVoce, setFormVoce] = useState(null); // { operatore, data, tipo, descrizione, importo }

  // Il limite superiore c'è sempre, anche a filtro vuoto: il futuro non si consuntiva.
  const alEffettivo = al && al < oggiIso() ? al : oggiIso();

  // Si scarica tutto lo scaricabile una volta sola e si filtra qui: le due schede guardano periodi
  // diversi — quella dei consuntivati deve poter mostrare partite fuori dal filtro dell'altra —
  // e con questi volumi restringere lato database non fa risparmiare niente.
  const fetchPartite = async () => {
    setCaricamentoPartite(true);
    // Solo partite confermate: una FORSE non giocata non genera compenso.
    const [pr, vc, pe] = await Promise.all([
      supabase.from('prenotazioni')
        .select('id, data, oraInizio, oraFine, durataOre, nominativo, campoNome, pacchettoNome, locationCitta, operatori')
        .eq('stato', 'CONF').lte('data', oggiIso()).order('data', { ascending: false }),
      supabase.from('op_voci').select('*').lte('data', oggiIso()),
      supabase.from('op_periodi').select('*').order('dal', { ascending: false }),
    ]);
    setCaricamentoPartite(false);
    if (pr.error || vc.error || pe.error) { console.error(pr.error || vc.error || pe.error); return; }
    setPartite((pr.data || []).filter(p => (p.operatori || []).length > 0));
    setVoci(vc.data || []);
    setPeriodi(pe.data || []);
  };

  useEffect(() => {
    if (currentView === 'gestione') fetchPartite();
  }, [currentView]);

  const nelFiltro = useCallback((data) => (!dal || data >= dal) && data <= alEffettivo, [dal, alEffettivo]);

  const giaConsuntivato = useCallback(
    (operatore, data) => periodi.some(p => p.operatore === operatore && data >= p.dal && data <= p.al),
    [periodi]
  );

  const preventivi = useMemo(
    () => preventiviPerOperatore(
      partite.filter(p => nelFiltro(p.data)),
      voci.filter(v => nelFiltro(v.data)),
      parametri, giaConsuntivato
    ),
    [partite, voci, parametri, giaConsuntivato, nelFiltro]
  );

  // Una riga per periodo chiuso, non per operatore: la data di consuntivazione e il ripristino
  // appartengono al singolo periodo, e raggruppandoli si finiva per doverli ripetere dentro.
  // Il dettaglio si ricalcola con i parametri congelati nel periodo, non con quelli di oggi:
  // altrimenti ritoccare una tariffa cambierebbe sotto gli occhi un consuntivo già chiuso.
  const consuntivati = useMemo(() => periodi.map(p => {
    const parUsati = p.parametri && Object.keys(p.parametri).length ? p.parametri : parametri;
    const partiteDelPeriodo = partite.filter(x =>
      x.data >= p.dal && x.data <= p.al && (x.operatori || []).some(o => o.id === p.operatore));
    const vociDelPeriodo = voci.filter(v =>
      v.operatore === p.operatore && v.data >= p.dal && v.data <= p.al);
    // Un eventuale compenso concordato è già dentro le voci, sotto forma di rettifiche "forfait":
    // qui non serve nessuna regola speciale, il calcolo normale arriva da solo al totale pattuito.
    const [dettaglio] = preventiviPerOperatore(partiteDelPeriodo, vociDelPeriodo, parUsati);
    // Il dettaglio può mancare quando il periodo non ha più partite né voci: la riga resta
    // comunque, con i suoi valori congelati.
    return { ...p, dettaglio: dettaglio || null };
  }), [periodi, partite, voci, parametri]);

  // Colonne ordinabili della tabella consuntivati, come negli storici degli altri moduli.
  // Il periodo ordina sulla data d'inizio: è quella con cui si cerca un periodo, non la fine.
  const COLONNE_CONSUNTIVATI = [
    { chiave: 'operatore', label: 'Operatore', valore: (p) => p.operatore || '' },
    { chiave: 'periodo', label: 'Periodo', valore: (p) => p.dal || '' },
    { chiave: 'consuntivato', label: 'Consuntivato il', valore: (p) => p.creato_il || '' },
    { chiave: 'costo', label: 'Costo', stile: { textAlign: 'right' }, valore: (p) => parseFloat(p.costo_azienda) || 0 },
  ];
  const { ordina: ordinaConsuntivati, propsTestata: testataConsuntivati, frecciaOrdinamento: frecciaConsuntivati } =
    useOrdinamentoTabella(Object.fromEntries(COLONNE_CONSUNTIVATI.map(c => [c.chiave, c.valore])));

  // ---- scritture su op_voci ----
  const recensioneDi = (operatore, prenotazioneId) =>
    voci.find(v => v.tipo === 'recensione' && v.operatore === operatore && v.riferimento === prenotazioneId);

  // Voci di un certo tipo attaccate a una partita (o alla giornata, con riferimento nullo).
  const vociDi = (operatore, riferimento, tipo) =>
    voci.filter(v => v.operatore === operatore && v.tipo === tipo && (v.riferimento || null) === (riferimento || null));

  const sommaDi = (elenco) => elenco.reduce((s, v) => s + (parseFloat(v.importo) || 0), 0);

  const alternaRecensione = async (operatore, data, prenotazioneId) => {
    const chiave = `rec-${operatore}-${prenotazioneId}`;
    setInCorso(chiave);
    const esistente = recensioneDi(operatore, prenotazioneId);
    const { error } = esistente
      ? await supabase.from('op_voci').delete().eq('id', esistente.id)
      : await supabase.from('op_voci').insert([{
          operatore, data, tipo: 'recensione', riferimento: prenotazioneId,
          descrizione: 'Recensione positiva',
          importo: parseFloat(parametri.bonus_recensione) || 0, esente_ritenuta: false,
        }]);
    setInCorso(null);
    if (error) { console.error(error); return alert("Errore nel salvataggio della recensione."); }
    fetchPartite();
  };

  const salvaVoce = async (e) => {
    e.preventDefault();
    const f = formVoce;
    if (!f.descrizione.trim()) return alert("Scrivi una descrizione: serve a ricordare a cosa si riferisce.");
    if (f.importo === '' || isNaN(parseFloat(f.importo))) return alert("Inserisci un importo.");
    setInCorso('voce');
    // Le spese sono rimborsi (esenti da ritenuta), le rettifiche correggono il compenso (imponibili).
    const { error } = await supabase.from('op_voci').insert([{
      operatore: f.operatore, data: f.data, tipo: f.tipo,
      riferimento: f.riferimento || null, descrizione: f.descrizione.trim(),
      importo: parseFloat(f.importo), esente_ritenuta: f.tipo === 'spesa',
    }]);
    setInCorso(null);
    if (error) { console.error(error); return alert("Errore nel salvataggio della voce."); }
    // L'overlay resta aperto con i campi svuotati: spesso le voci si aggiungono a raffica
    // (pranzo, casello, parcheggio) e riaprirlo ogni volta sarebbe una seccatura.
    setFormVoce(f => ({ ...f, descrizione: '', importo: '' }));
    fetchPartite();
  };

  const rimuoviVoce = async (v) => {
    if (!window.confirm(`Eliminare "${v.descrizione || v.tipo}" da ${v.data}?`)) return;
    setInCorso(`del-${v.id}`);
    const { error } = await supabase.from('op_voci').delete().eq('id', v.id);
    setInCorso(null);
    if (error) { console.error(error); return alert("Errore nell'eliminazione della voce."); }
    fetchPartite();
  };

  // ---- consuntivazione ----
  // Chiudere un periodo lo sposta e basta: congela quello che c'è e lo toglie dall'elenco.
  // Rimborso forfettario e ritenuta non si calcolano qui — sono il mestiere della scheda
  // "Elabora rimborso", che arriva dopo e lavora sui periodi già chiusi.
  const consuntiva = async (op) => {
    const date = op.giornate.map(g => g.data).sort();
    if (date.length === 0) return alert("Niente da consuntivare per questo operatore.");
    const dal = date[0];
    const al = date[date.length - 1];
    if (!window.confirm(
      `Consuntivare ${op.nome} dal ${dataBreve(dal)} al ${dataBreve(al)}?\n\n`
      + `${euro(op.compenso + op.spese)} da pagare su ${op.giornate.length} giornate.\n\n`
      + `Il periodo passa fra i consuntivati e le sue giornate non accettano più modifiche.`
    )) return;

    setInCorso(`consuntiva-${op.id}`);
    const { error } = await supabase.from('op_periodi').insert([{
      operatore: op.id, dal, al,
      compenso_netto: op.compenso, spese: op.spese,
      // Il costo azienda qui è il solo esborso verso l'operatore: la ritenuta si aggiunge
      // quando si elabora il rimborso, non adesso.
      costo_azienda: op.compenso + op.spese,
      // Snapshot dei parametri: ritoccarli domani non deve riscrivere questo consuntivo.
      parametri,
    }]);
    setInCorso(null);
    if (error) {
      console.error(error);
      // Il vincolo di esclusione è la rete di sicurezza contro il doppio pagamento: se scatta,
      // vale la pena dirlo con parole comprensibili invece del messaggio di Postgres.
      return alert(error.message.includes('op_periodi_no_sovrapposizioni')
        ? "Una parte di questo intervallo è già stata consuntivata per questo operatore."
        : "Errore nella consuntivazione.");
    }
    fetchPartite();
  };

  const annullaConsuntivo = async (p) => {
    if (!window.confirm(`Riaprire il periodo di ${p.operatore} dal ${dataBreve(p.dal)} al ${dataBreve(p.al)}?\n\nLe giornate tornano fra quelle da consuntivare e i valori congelati vengono persi.`)) return;
    setInCorso(`riapri-${p.id}`);
    const { error } = await supabase.from('op_periodi').delete().eq('id', p.id);
    setInCorso(null);
    if (error) { console.error(error); return alert("Errore nella riapertura del periodo."); }
    fetchPartite();
  };

  // ---- compenso concordato ----
  // Non è un valore a parte: si materializza in rettifiche "forfait", una per partita, che portano
  // il calcolo a ore esattamente all'importo pattuito. Da lì in poi tutto il resto del modulo
  // continua a fare i suoi conti normali senza sapere che c'è stato un accordo.
  const [formForfait, setFormForfait] = useState(null); // { operatore, nome, importo }

  const anteprimaForfait = useMemo(() => {
    if (!formForfait) return null;
    const op = preventivi.find(o => o.id === formForfait.operatore);
    if (!op) return null;
    // Un forfait già applicato: serve a dire che c'è e a poterlo togliere.
    const giorni = new Set(op.giornate.map(g => g.data));
    const esistenti = voci.filter(v =>
      v.operatore === op.id && v.tipo === 'rettifica' && v.descrizione === 'forfait' && giorni.has(v.data));
    const importo = parseFloat(formForfait.importo);
    const base = { op, esistenti, totaleEsistente: op.compensoOrario + sommaDi(esistenti) };
    if (isNaN(importo)) return { ...base, righe: [], importo: null };
    return { ...base, importo, righe: rettificheForfait(op, importo) };
  }, [formForfait, preventivi, voci]);

  const rimuoviForfait = async () => {
    const a = anteprimaForfait;
    if (!a || a.esistenti.length === 0) return;
    if (!window.confirm(
      `Rimuovere il compenso concordato di ${a.op.nome}?\n\n`
      + `Le ${a.esistenti.length} rettifiche "forfait" vengono cancellate e il compenso torna al calcolo a ore: `
      + `${euro(a.op.compensoOrario)}.`
    )) return;
    setInCorso('forfait');
    const { error } = await supabase.from('op_voci').delete().in('id', a.esistenti.map(v => v.id));
    setInCorso(null);
    if (error) { console.error(error); return alert("Errore nella rimozione del forfait."); }
    setFormForfait(null);
    fetchPartite();
  };

  const applicaForfait = async () => {
    const a = anteprimaForfait;
    if (!a || a.importo == null) return alert("Inserisci l'importo concordato.");
    if (a.righe.length === 0) return alert("Nessuna partita con ore nel periodo: non c'è su cosa ripartire.");

    setInCorso('forfait');
    // Un forfait applicato due volte deve sostituire il precedente, non sommarcisi: si tolgono
    // prima tutte le rettifiche "forfait" delle giornate coinvolte.
    const date = [...new Set(a.righe.map(r => r.data))];
    const pulizia = await supabase.from('op_voci').delete()
      .eq('operatore', a.op.id).eq('tipo', 'rettifica').eq('descrizione', 'forfait').in('data', date);
    if (pulizia.error) {
      setInCorso(null); console.error(pulizia.error);
      return alert("Errore nella rimozione del forfait precedente.");
    }

    const { error } = await supabase.from('op_voci').insert(a.righe.map(r => ({
      operatore: a.op.id, data: r.data, tipo: 'rettifica', riferimento: r.riferimento,
      descrizione: 'forfait', importo: r.differenza, esente_ritenuta: false,
    })));
    setInCorso(null);
    if (error) { console.error(error); return alert("Errore nell'applicazione del forfait."); }
    setFormForfait(null);
    fetchPartite();
  };


  // I periodi consuntivati si dividono in due code: quelli che aspettano la ricevuta e quelli
  // che l'hanno già avuta. La data di evasione basta a distinguerli, senza uno stato che possa
  // contraddirla.
  const daElaborare = useMemo(() => consuntivati.filter(p => !p.evaso_il), [consuntivati]);
  const evasi = useMemo(() => consuntivati.filter(p => p.evaso_il), [consuntivati]);

  // ---- elaborazione del rimborso ----
  // Un periodo consuntivato aspetta che se ne faccia la ricevuta. Qui si sceglie cosa scrivere
  // nel documento — le giornate e il rimborso trasferta — e si calcolano gli importi.
  const [elaborazione, setElaborazione] = useState(null);

  const apriElaborazione = (p) => {
    // Le giornate si propongono dalle partite del periodo: una riga per data e luogo, come le
    // scriverebbe a mano il manager. Da lì si correggono o si tolgono.
    const daPartite = [];
    for (const g of (p.dettaglio?.giornate || [])) {
      const luoghi = [...new Set(g.blocchi.flatMap(b => b.partite.map(x => locationDi(x.partita))))];
      daPartite.push({ data: g.data, luogo: luoghi.filter(l => l !== '—').join(', ') });
    }
    const salvate = p.rimborso?.giornate;
    setElaborazione({
      periodo: p,
      giornate: salvate?.length ? salvate : daPartite,
      // Di norma una trasferta per giornata: il numero si corregge, l'importo unitario si decide qui.
      numeroTrasferte: String(p.rimborso?.trasferte?.numero ?? daPartite.length),
      importoTrasferta: String(p.rimborso?.trasferte?.importo ?? ''),
    });
  };

  // Le spese registrate a mano sul periodo: vanno elencate come rimborsi ed escono dalla base
  // imponibile, perché sono denaro anticipato e restituito, non guadagnato.
  const speseDelPeriodo = useCallback((p) => voci.filter(v =>
    v.operatore === p.operatore && v.tipo === 'spesa' && v.data >= p.dal && v.data <= p.al), [voci]);

  const importiElaborazione = useMemo(() => {
    if (!elaborazione) return null;
    const p = elaborazione.periodo;
    const elencoSpese = speseDelPeriodo(p);
    const numero = parseInt(elaborazione.numeroTrasferte, 10) || 0;
    const unitario = parseFloat(elaborazione.importoTrasferta) || 0;
    const trasferte = arrotonda2(numero * unitario);
    // compenso_netto congelato è già il solo compenso, spese escluse: quelle si sommano ai
    // rimborsi più sotto, non vanno tolte di nuovo qui.
    const compenso = arrotonda2(parseFloat(p.compenso_netto) || 0);
    return {
      ...importiRimborso({ compenso, spese: sommaDi(elencoSpese), trasferte }, p.parametri?.aliquota_ritenuta ?? parametri.aliquota_ritenuta),
      trasferte, numero, unitario, elencoSpese,
    };
  }, [elaborazione, speseDelPeriodo, parametri]);

  const scaricaDocumentoRimborso = (nomeFile) => {
    const element = document.getElementById('documento-rimborso');
    html2pdf().set({
      margin: 12,
      filename: `${nomeFile}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'legacy'], avoid: ['tr'] },
    }).from(element).save();
  };

  const evadiRimborso = async () => {
    const e = elaborazione;
    const i = importiElaborazione;
    if (!e || !i) return;
    if (e.giornate.length === 0) return alert("Indica almeno una giornata: il documento deve dire per cosa si paga.");
    if (i.numero > 0 && i.unitario <= 0) return alert("Indica l'importo di una trasferta, oppure porta a zero il numero.");

    setInCorso('rimborso');
    const { error } = await supabase.from('op_periodi').update({
      evaso_il: new Date().toISOString(),
      // Il contenuto del documento si congela: serve a ristamparlo identico, non a rifarci i conti.
      rimborso: {
        giornate: e.giornate,
        trasferte: { numero: i.numero, importo: i.unitario, totale: i.trasferte },
        spese: i.elencoSpese.map(v => ({ descrizione: v.descrizione, importo: v.importo, data: v.data })),
        imponibile: i.imponibile, ritenuta: i.ritenuta, netto: i.netto, rimborsi: i.rimborsi, totale: i.totale,
        aliquota: e.periodo.parametri?.aliquota_ritenuta ?? parametri.aliquota_ritenuta,
      },
    }).eq('id', e.periodo.id);
    setInCorso(null);
    if (error) { console.error(error); return alert("Errore nel salvataggio del rimborso."); }

    scaricaDocumentoRimborso(`rimborso-${e.periodo.operatore.replace(/\s+/g, '-')}-${e.periodo.dal}`);
    setElaborazione(null);
    fetchPartite();
  };

  // Ristampa: si riapre l'elaborazione con i valori congelati, così il documento esce identico
  // a quello emesso e non ricalcolato con i dati di oggi.
  const ristampaRimborso = (p) => {
    if (!p.rimborso) return alert("Questo periodo non ha un documento salvato: riaprilo e rielaboralo.");
    apriElaborazione(p);
    // Il nodo del documento esiste solo quando la schermata è a video: si aspetta il render.
    setTimeout(() => scaricaDocumentoRimborso(`rimborso-${p.operatore.replace(/\s+/g, '-')}-${p.dal}`), 600);
  };

  const riapriRimborso = async (p) => {
    if (!window.confirm(
      `Riaprire l'elaborazione del rimborso di ${p.operatore}?\n\n`
      + `Il periodo torna fra quelli da elaborare. Il documento salvato resta come bozza, `
      + `così ripartendo ritrovi giornate e trasferte già impostate.`
    )) return;
    setInCorso(`riapri-rimborso-${p.id}`);
    const { error } = await supabase.from('op_periodi').update({ evaso_il: null }).eq('id', p.id);
    setInCorso(null);
    if (error) { console.error(error); return alert("Errore nella riapertura del rimborso."); }
    fetchPartite();
  };

  // Un parametro per volta, come pacchetti e fasce negli altri configuratori: in sola lettura
  // finché non si preme la matita. Sono le cifre da cui dipendono tutti i compensi, e con le
  // caselle sempre aperte bastava un clic distratto per cambiarne una senza accorgersene.
  const [chiaveInline, setChiaveInline] = useState(null);
  const [valoreInline, setValoreInline] = useState("");

  const iniziaModificaParametro = (chiave) => {
    setChiaveInline(chiave);
    setValoreInline(String(parametri[chiave] ?? ""));
  };

  const salvaParametro = async (chiave) => {
    if (valoreInline === "" || isNaN(parseFloat(valoreInline))) return alert("Inserisci un valore numerico.");
    setSalvataggio(true);
    const { error } = await supabase.from('compensi_parametri')
      .update({ [chiave]: parseFloat(valoreInline), aggiornato_il: new Date().toISOString() }).eq('id', 1);
    setSalvataggio(false);
    if (error) { console.error(error); return alert("Errore nel salvataggio del parametro."); }
    setChiaveInline(null);
    fetchTutto();
  };

  // Dettaglio di un operatore: le stesse righe e le stesse colonne nelle due schede.
  // In sola lettura (periodi già chiusi) recensioni, rettifiche e spese si mostrano come importi
  // invece che come comandi: quello che è stato consuntivato non si tocca più.
  const tabellaDettaglio = (op, soloLettura = false) => (
    <div style={{ borderTop: '1px solid #eee', overflowX: 'auto' }}>
      <table className="storico-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.8rem' }}>
        <thead>
          <tr style={{ background: '#f8f8f8', borderBottom: '1px solid #ddd' }}>
            <th style={{ padding: '8px 10px', width: '82px' }}>Data</th>
            <th style={{ padding: '8px 10px', width: '104px' }}>Orario</th>
            <th style={{ padding: '8px 10px', width: '124px' }}>Partita</th>
            <th style={{ padding: '8px 10px' }}>Nominativo</th>
            <th style={{ padding: '8px 10px' }}>Pacchetto</th>
            <th style={{ padding: '8px 10px' }}>Location</th>
            <th style={{ padding: '8px 10px', textAlign: 'right', width: '58px' }}>Ore</th>
            <th style={{ padding: '8px 10px', textAlign: 'right', width: '80px' }}>Compenso</th>
            <th style={{ padding: '8px 10px', textAlign: 'right', width: '78px' }}>Rettifica</th>
            <th style={{ padding: '8px 10px', textAlign: 'center', width: '86px' }}>Recensione</th>
            <th style={{ padding: '8px 10px', textAlign: 'right', width: '78px' }}>Spese</th>
            <th style={{ padding: '8px 10px', textAlign: 'right', width: '92px' }}>Totale partita</th>
          </tr>
        </thead>
        <tbody>
          {op.giornate.map(g => {
            const righePartite = g.blocchi.flatMap(b => b.partite);
            // Voci registrate sulla giornata e non su una partita: non se ne creano più, ma se ne
            // esistono vanno mostrate — nei totali continuano a contare.
            const vociGiornata = g.voci.filter(v => !v.riferimento);
            const totaleGiornata = g.compenso + g.aggiunte + g.spese;
            const piuRighe = righePartite.length + vociGiornata.length > 1;

            return (
              <Fragment key={g.data}>
                {righePartite.map(x => {
                  const rec = recensioneDi(op.id, x.partita.id);
                  const rettifiche = vociDi(op.id, x.partita.id, 'rettifica');
                  const spese = vociDi(op.id, x.partita.id, 'spesa');
                  const totRettifiche = sommaDi(rettifiche);
                  const totSpese = sommaDi(spese);
                  const chiaveRec = `rec-${op.id}-${x.partita.id}`;
                  const apri = (tipo) => setFormVoce({
                    operatore: op.id, data: g.data, riferimento: x.partita.id,
                    etichetta: `${x.partita.id}${x.partita.nominativo ? ` · ${x.partita.nominativo}` : ''}`,
                    tipo, descrizione: '', importo: '',
                  });
                  return (
                    <tr key={x.partita.id}>
                      <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>
                        {righePartite[0] === x && <strong>{dataBreve(g.data)}</strong>}
                      </td>
                      <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>
                        {intervalloPartita(x.partita)}
                        {/* I blocchi restano nel calcolo ma non si nominano qui. L'attesa invece si
                            mostra: è denaro che l'operatore incassa senza una partita a spiegarlo. */}
                        {x.attesaMin > 0 && (
                          <><br /><span style={{ fontSize: '0.72rem', color: '#b26a00' }}>
                            +{ore(x.attesaMin / 60)} di attesa, pagata
                          </span></>
                        )}
                      </td>
                      <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>{x.partita.id}</td>
                      <td style={{ padding: '7px 10px' }}>{x.partita.nominativo || '—'}</td>
                      <td style={{ padding: '7px 10px', color: '#666' }}>{x.partita.pacchettoNome || '—'}</td>
                      <td style={{ padding: '7px 10px', color: '#666' }}>{locationDi(x.partita)}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right' }}>{ore(x.oreAttribuite)}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right' }}>{euro(x.compenso)}</td>

                      <td style={{ padding: '7px 10px', textAlign: 'right' }}>
                        {soloLettura ? (
                          totRettifiche !== 0
                            ? <span title={rettifiche.map(v => `${v.descrizione}: ${euro(v.importo)}`).join('\n')}>{euro(totRettifiche)}</span>
                            : <span style={{ color: '#ccc' }}>—</span>
                        ) : (
                          <button
                            type="button" onClick={() => apri('rettifica')}
                            title={rettifiche.length ? rettifiche.map(v => `${v.descrizione}: ${euro(v.importo)}`).join('\n') : 'Aggiungi una correzione'}
                            style={cellaVoce(totRettifiche !== 0, '#3949ab')}
                          >
                            {rettifiche.length ? euro(totRettifiche) : '+'}
                            {rettifiche.length > 1 && <span style={{ color: '#999', fontSize: '0.7rem' }}> ({rettifiche.length})</span>}
                          </button>
                        )}
                      </td>

                      <td style={{ padding: '7px 10px', textAlign: 'center' }}>
                        {soloLettura ? (
                          rec ? <span style={{ color: '#1c7a4e' }}>{euro(rec.importo)}</span> : <span style={{ color: '#ccc' }}>—</span>
                        ) : (
                          <label
                            title="Una sola recensione per operatore per partita"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', cursor: 'pointer', color: rec ? '#1c7a4e' : '#aaa' }}
                          >
                            <input
                              type="checkbox" checked={!!rec} disabled={inCorso === chiaveRec}
                              onChange={() => alternaRecensione(op.id, g.data, x.partita.id)}
                            />
                            {rec ? euro(rec.importo) : '—'}
                          </label>
                        )}
                      </td>

                      <td style={{ padding: '7px 10px', textAlign: 'right' }}>
                        {soloLettura ? (
                          totSpese !== 0
                            ? <span title={spese.map(v => `${v.descrizione}: ${euro(v.importo)}`).join('\n')}>{euro(totSpese)}</span>
                            : <span style={{ color: '#ccc' }}>—</span>
                        ) : (
                          <button
                            type="button" onClick={() => apri('spesa')}
                            title={spese.length ? spese.map(v => `${v.descrizione}: ${euro(v.importo)}`).join('\n') : 'Aggiungi un rimborso spese'}
                            style={cellaVoce(totSpese !== 0, '#b26a00')}
                          >
                            {spese.length ? euro(totSpese) : '+'}
                            {spese.length > 1 && <span style={{ color: '#999', fontSize: '0.7rem' }}> ({spese.length})</span>}
                          </button>
                        )}
                      </td>

                      <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 500 }}>
                        {euro(x.compenso + totRettifiche + totSpese + (rec ? parseFloat(rec.importo) || 0 : 0))}
                      </td>
                    </tr>
                  );
                })}

                {vociGiornata.map(v => (
                  <tr key={v.id}>
                    <td style={{ padding: '7px 10px' }}>
                      {righePartite.length === 0 && <strong>{dataBreve(g.data)}</strong>}
                    </td>
                    <td colSpan="5" style={{ padding: '7px 10px', color: '#666' }}>
                      <span style={{
                        fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.05em',
                        padding: '1px 6px', borderRadius: '3px', marginRight: '6px',
                        background: v.tipo === 'spesa' ? '#fff3e0' : '#e8eaf6',
                        color: v.tipo === 'spesa' ? '#b26a00' : '#3949ab',
                      }}>{v.tipo}</span>
                      {v.descrizione} <span style={{ color: '#999', fontSize: '0.74rem' }}>· non attribuita a una partita</span>
                    </td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', color: '#ccc' }}>—</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', color: '#ccc' }}>—</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right' }}>{v.tipo === 'rettifica' ? euro(v.importo) : <span style={{ color: '#ccc' }}>—</span>}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'center', color: '#ccc' }}>—</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right' }}>{v.tipo === 'spesa' ? euro(v.importo) : <span style={{ color: '#ccc' }}>—</span>}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right' }}>
                      <span style={{ fontWeight: 500, marginRight: '6px' }}>{euro(v.importo)}</span>
                      {!soloLettura && (
                        <button
                          type="button" className="btn-icon-action" aria-label="Elimina voce" title="Elimina voce"
                          disabled={inCorso === `del-${v.id}`} onClick={() => rimuoviVoce(v)}
                        >
                          <Icona nome="elimina" size={13} style={{ marginRight: 0 }} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}

                {righePartite.length === 0 && vociGiornata.length === 0 && (
                  <tr>
                    <td style={{ padding: '7px 10px' }}><strong>{dataBreve(g.data)}</strong></td>
                    <td colSpan="11" style={{ padding: '7px 10px', color: '#999' }}>Giornata senza partite né voci</td>
                  </tr>
                )}

                {/* Totale di giornata: solo quando c'è più di una riga, altrimenti ripete quella sopra. */}
                {piuRighe && (
                  <tr style={{ background: '#fafafa' }}>
                    <td></td>
                    <td colSpan="5" style={{ padding: '5px 10px', color: '#888', fontSize: '0.76rem' }}>
                      totale {dataBreve(g.data)}
                      {g.tettoApplicato && (
                        <span style={{ color: '#c62828' }}> · ridotto dal tetto ({euro(g.primaDelTetto)} → {euro(g.compenso)})</span>
                      )}
                    </td>
                    <td style={{ padding: '5px 10px', textAlign: 'right', color: '#888' }}>{ore(g.ore)}</td>
                    <td style={{ padding: '5px 10px', textAlign: 'right', color: '#888' }}>{euro(g.compenso)}</td>
                    <td colSpan="3"></td>
                    <td style={{ padding: '5px 10px', textAlign: 'right', fontWeight: 'bold' }}>{euro(totaleGiornata)}</td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: '2px solid #333', background: '#f5f8fa' }}>
            <td style={{ padding: '10px', fontWeight: 'bold' }} colSpan="6">Totale {op.nome}</td>
            <td style={{ padding: '10px', textAlign: 'right', fontWeight: 'bold' }}>{ore(op.ore)}</td>
            <td style={{ padding: '10px', textAlign: 'right', fontWeight: 'bold' }}>{euro(op.compensoOrario)}</td>
            <td style={{ padding: '10px', textAlign: 'right', fontWeight: 'bold' }}>{euro(op.totaleRettifiche)}</td>
            <td style={{ padding: '10px', textAlign: 'center', fontWeight: 'bold' }}>{euro(op.totaleRecensioni)}</td>
            <td style={{ padding: '10px', textAlign: 'right', fontWeight: 'bold' }}>{euro(op.spese)}</td>
            <td style={{ padding: '10px', textAlign: 'right', fontWeight: 'bold' }}>{euro(op.compenso + op.spese)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );

  // Tabella dei periodi consuntivati, condivisa fra "elabora rimborsi" e "rimborsi evasi":
  // stesse colonne e stesso dettaglio, cambia solo l'azione in coda alla riga.
  const tabellaPeriodi = (righe, messaggioVuoto, evasi) => {
    if (righe.length === 0) {
      return (
        <div className="admin-table-box-full" style={{ marginTop: '20px', padding: '30px', textAlign: 'center', color: '#666' }}>
          {messaggioVuoto}
        </div>
      );
    }
    return (
      <div className="admin-table-box-full" style={{ marginTop: '20px', overflowX: 'auto' }}>
        <table className="storico-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem', background: '#fff' }}>
          <thead>
            <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
              {COLONNE_CONSUNTIVATI.map(c => {
                const { style: stileOrdinabile, ...propsOrdinabile } = testataConsuntivati(c.chiave);
                return (
                  <th key={c.chiave} {...propsOrdinabile} style={{ padding: '10px', ...c.stile, ...stileOrdinabile }}>
                    {c.label}{frecciaConsuntivati(c.chiave)}
                  </th>
                );
              })}
              <th style={{ padding: '10px', width: '86px' }}></th>
            </tr>
          </thead>
          <tbody>
            {ordinaConsuntivati(righe).map(p => {
              const espansa = operatoreEspanso === `cons-${p.id}`;
              return (
                <Fragment key={p.id}>
                  <tr
                    onClick={() => setOperatoreEspanso(espansa ? null : `cons-${p.id}`)}
                    style={{ cursor: 'pointer', background: espansa ? '#f8fafc' : undefined, borderBottom: espansa ? 'none' : '1px solid #eee' }}
                  >
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                      <span className="riga-espandibile-chevron" style={{ transform: espansa ? 'rotate(90deg)' : 'none' }}>›</span>
                      <strong>{p.operatore}</strong>
                    </td>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                      {p.dal === p.al ? dataBreve(p.dal) : `${dataBreve(p.dal)} → ${dataBreve(p.al)}`}
                    </td>
                    <td style={{ padding: '8px 10px', color: '#64748b', whiteSpace: 'nowrap' }}>
                      {dataBreve((p.creato_il || '').slice(0, 10))}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 'bold' }}>
                      {evasi ? euro(p.rimborso?.totale) : euro(p.costo_azienda)}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {evasi ? (
                        <>
                          <button
                            type="button" className="btn-icon-action" aria-label="Ristampa il documento" title="Ristampa il documento"
                            onClick={(e) => { e.stopPropagation(); ristampaRimborso(p); }}
                          >
                            <Icona nome="stampa" size={16} style={{ marginRight: 0 }} />
                          </button>
                          <button
                            type="button" className="btn-icon-action" aria-label="Riapri l'elaborazione" title="Riapri l'elaborazione"
                            disabled={inCorso === `riapri-rimborso-${p.id}`}
                            onClick={(e) => { e.stopPropagation(); riapriRimborso(p); }}
                          >
                            <Icona nome="riporta" size={16} style={{ marginRight: 0 }} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button" className="btn-icon-action" aria-label="Elabora il rimborso" title="Elabora il rimborso"
                            onClick={(e) => { e.stopPropagation(); apriElaborazione(p); }}
                          >
                            <Icona nome="rimborsi" size={16} style={{ marginRight: 0 }} />
                          </button>
                          <button
                            type="button" className="btn-icon-action" aria-label="Ripristina fra i da consuntivare" title="Ripristina fra i da consuntivare"
                            disabled={inCorso === `riapri-${p.id}`}
                            onClick={(e) => { e.stopPropagation(); annullaConsuntivo(p); }}
                          >
                            <Icona nome="riporta" size={16} style={{ marginRight: 0 }} />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                  {espansa && (
                    <tr className="riga-espandibile-dettaglio">
                      <td colSpan={5} onClick={(e) => e.stopPropagation()} style={{ padding: 0 }}>
                        {p.dettaglio
                          ? tabellaDettaglio(p.dettaglio, true)
                          : (
                            <div style={{ padding: '16px', color: '#999', fontSize: '0.82rem' }}>
                              Nessuna partita né voce in questo intervallo: restano solo i valori congelati.
                            </div>
                          )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  // Il documento di rimborso. È lo stesso nodo che html2pdf cattura, quindi l'anteprima a video
  // e il PDF non possono divergere: quello che si vede è quello che si stampa.
  const documentoRimborso = (periodo, giornate, i) => (
    <div className="documento-preventivo" id="documento-rimborso" style={{ background: '#fff', padding: '34px 40px', maxWidth: '820px', color: '#000', fontSize: '0.9rem', lineHeight: 1.6 }}>
      <div style={{ marginBottom: '30px', fontWeight: 'bold' }}>{periodo.operatore}</div>

      <div style={{ marginBottom: '26px' }}>
        Per Animazione svolta nei giorni:
        <ul style={{ margin: '6px 0 0 0', paddingLeft: '22px' }}>
          {giornate.map((g, k) => (
            <li key={k}>{dataEstesa(g.data)}{g.luogo ? `, ${g.luogo}` : ''}</li>
          ))}
        </ul>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          <tr>
            <td style={{ padding: '3px 0' }}>COMPENSO LORDO</td>
            <td style={{ padding: '3px 0', textAlign: 'right', width: '150px' }}>{euro(i.imponibile)}</td>
          </tr>
          <tr>
            <td style={{ padding: '3px 0' }}>A DEDURRE RITENUTA D'ACCONTO {periodo.parametri?.aliquota_ritenuta ?? parametri.aliquota_ritenuta}%</td>
            <td style={{ padding: '3px 0', textAlign: 'right' }}>{euro(i.ritenuta)}</td>
          </tr>
          <tr>
            <td style={{ padding: '6px 0', borderTop: '1px solid #000', fontWeight: 'bold' }}>NETTO A PAGARE</td>
            <td style={{ padding: '6px 0', borderTop: '1px solid #000', textAlign: 'right', fontWeight: 'bold' }}>{euro(i.netto)}</td>
          </tr>

          {i.elencoSpese.map(v => (
            <tr key={v.id}>
              <td style={{ padding: '3px 0' }}>Rimborso {v.descrizione}</td>
              <td style={{ padding: '3px 0', textAlign: 'right' }}>{euro(v.importo)}</td>
            </tr>
          ))}
          {i.numero > 0 && (
            <tr>
              <td style={{ padding: '3px 0' }}>
                Rimborso trasferta forfait = {i.numero} x {(+i.unitario).toFixed(2).replace('.', ',')}
              </td>
              <td style={{ padding: '3px 0', textAlign: 'right' }}>{euro(i.trasferte)}</td>
            </tr>
          )}

          <tr>
            <td style={{ padding: '6px 0', borderTop: '1px solid #000', fontWeight: 'bold' }}>TOTALE A PAGARE</td>
            <td style={{ padding: '6px 0', borderTop: '1px solid #000', textAlign: 'right', fontWeight: 'bold' }}>{euro(i.totale)}</td>
          </tr>
        </tbody>
      </table>

      <div style={{ marginTop: '34px' }}>Milano, {dataBreve(oggiIso())}</div>
    </div>
  );

  const schedaVuota = (titolo, testo) => (
    <div className="schermata-storico no-print">
      <h2 style={{ margin: 0 }}>{titolo}</h2>
      <p className="descrizione-pagina">{testo}</p>
      <div className="admin-table-box-full" style={{ marginTop: '20px', padding: '40px 20px', textAlign: 'center', color: '#666' }}>
        Scheda non ancora attiva: arriva con i prossimi passi del modulo.
      </div>
    </div>
  );

  return (
    <>
      <nav className="modulo-subnav no-print subnav-segmented">
        {puoVedere(user, 'compensi', 'config') && (
          <button className={`nav-btn ${currentView === 'config' ? 'active' : ''}`} onClick={() => setCurrentView("config")}><Icona nome="configuratore" />Configuratore</button>
        )}
        {puoVedere(user, 'compensi', 'gestione') && (
          <button className={`nav-btn ${currentView === 'gestione' ? 'active' : ''}`} onClick={() => setCurrentView("gestione")}><Icona nome="gestione" />Gestione</button>
        )}
        {puoVedere(user, 'compensi', 'indicatori') && (
          <button className={`nav-btn ${currentView === 'indicatori' ? 'active' : ''}`} onClick={() => setCurrentView("indicatori")}><Icona nome="indicatori" />Indicatori</button>
        )}
      </nav>


      {/* ===================== CONFIGURATORE ===================== */}
      {currentView === "config" && puoVedere(user, 'compensi', 'config') && (
        <div className="schermata-storico no-print">
          <h2 style={{ margin: 0 }}>Configuratore compensi</h2>
          <p className="descrizione-pagina">
            Parametri del calcolo del preventivo, uguali per tutti i bubbler. Valgono da adesso in avanti:
            i periodi già consuntivati conservano i parametri con cui erano stati chiusi.
          </p>

          {schemaMancante && (
            <div style={{ marginTop: '16px', padding: '14px 18px', background: '#fff8e1', border: '1px solid #f0d999', borderLeft: '4px solid #f0a000', borderRadius: '4px' }}>
              <strong style={{ display: 'block', marginBottom: '4px' }}>Schema del database non ancora aggiornato</strong>
              <span style={{ fontSize: '0.85rem', color: '#555' }}>
                Esegui <code>sql/compensi.sql</code> nell'SQL Editor di Supabase: finché manca, i valori qui sotto sono
                solo i default e il salvataggio non va a buon fine. Il database risponde: <em>{schemaMancante}</em>
              </span>
            </div>
          )}
          <div className="admin-table-box-full" style={{ marginTop: '20px', padding: '20px' }}>
            <h3 style={{ margin: '0 0 4px 0', fontSize: '1rem' }}>Calcolo a ore</h3>
            <p style={{ margin: '0 0 6px 0', fontSize: '0.82rem', color: '#777', maxWidth: '68ch' }}>
              Le ore di più partite dello stesso giorno si sommano in un unico blocco se lo stacco fra una e
              l'altra rientra nel limite qui sotto. Il preventivo si calcola così per tutti: un eventuale
              compenso concordato si applica in fase di consuntivazione, non qui.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {CAMPI_PARAMETRI.map((c, i) => {
                const inModifica = chiaveInline === c.chiave;
                return (
                  <div
                    key={c.chiave}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      gap: '16px', flexWrap: 'wrap', padding: '12px 0',
                      borderTop: i > 0 ? '1px solid #f0f0f0' : '1px solid #eee',
                    }}
                  >
                    <div style={{ flex: '1 1 320px' }}>
                      <div style={{ fontSize: '0.88rem', fontWeight: 'bold' }}>{c.label}</div>
                      <div style={{ fontSize: '0.78rem', color: '#888', lineHeight: 1.4, marginTop: '2px' }}>{c.aiuto}</div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {inModifica ? (
                        <>
                          <input
                            type="number" step="any" min="0" autoFocus
                            value={valoreInline}
                            onChange={(e) => setValoreInline(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { e.preventDefault(); salvaParametro(c.chiave); }
                              if (e.key === 'Escape') setChiaveInline(null);
                            }}
                            style={{ ...stileInput, width: '110px', textAlign: 'right' }}
                          />
                          <span style={{ color: '#888', fontSize: '0.85rem', width: '26px' }}>{c.unita}</span>
                          <button
                            type="button" className="btn-icon-action" aria-label="Salva" title="Salva"
                            disabled={salvataggio} onClick={() => salvaParametro(c.chiave)}
                          >
                            <Icona nome="salva" size={16} style={{ marginRight: 0 }} />
                          </button>
                          <button
                            type="button" className="btn-icon-action" aria-label="Annulla" title="Annulla"
                            onClick={() => setChiaveInline(null)}
                          >
                            <Icona nome="annulla" size={16} style={{ marginRight: 0 }} />
                          </button>
                        </>
                      ) : (
                        <>
                          <span style={{ fontSize: '1rem', fontWeight: 500, minWidth: '110px', textAlign: 'right' }}>
                            {c.unita === '€' ? euro(parametri[c.chiave]) : `${parametri[c.chiave]}`}
                          </span>
                          <span style={{ color: '#888', fontSize: '0.85rem', width: '26px' }}>{c.unita === '€' ? '' : c.unita}</span>
                          <button
                            type="button" className="btn-icon-action" aria-label="Modifica" title="Modifica"
                            onClick={() => iniziaModificaParametro(c.chiave)}
                          >
                            <Icona nome="modifica" size={16} style={{ marginRight: 0 }} />
                          </button>
                          {/* Segnaposto della larghezza del secondo pulsante, così i valori
                              restano incolonnati anche sulla riga in modifica. */}
                          <span style={{ display: 'inline-block', width: '30px' }} />
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ===================== SCHEDE IN ARRIVO ===================== */}
      {/* ===================== GESTIONE ===================== */}
      {/* Un contenitore solo, come negli altri moduli: il titolo e la sotto-barra restano fermi
          mentre cambia la fase, e ogni fase si spiega con la propria riga di descrizione. */}
      {currentView === "gestione" && puoVedere(user, 'compensi', 'gestione') && (
        <div className="schermata-storico no-print">
          <h2 style={{ margin: 0 }}>Gestione</h2>
          <p className="descrizione-pagina">Le tre fasi che un compenso attraversa, dal calcolo alla ricevuta.</p>

          <nav className="modulo-subnav subnav-segmented" style={{ margin: '10px 0' }}>
            {puoVedere(user, 'compensi', 'gestione', 'daconsuntivare') && (
              <button className={`nav-btn ${gestioneTab === 'daconsuntivare' ? 'active' : ''}`} onClick={() => setGestioneTab("daconsuntivare")}><Icona nome="daconsuntivare" />Da consuntivare</button>
            )}
            {puoVedere(user, 'compensi', 'gestione', 'rimborsi') && (
              <button className={`nav-btn ${gestioneTab === 'rimborsi' ? 'active' : ''}`} onClick={() => setGestioneTab("rimborsi")}><Icona nome="rimborsi" />Elabora rimborsi</button>
            )}
            {puoVedere(user, 'compensi', 'gestione', 'evasi') && (
              <button className={`nav-btn ${gestioneTab === 'evasi' ? 'active' : ''}`} onClick={() => setGestioneTab("evasi")}><Icona nome="evasi" />Rimborsi evasi</button>
            )}
          </nav>

      {gestioneTab === "daconsuntivare" && puoVedere(user, 'compensi', 'gestione', 'daconsuntivare') && (
        <>
          <p className="descrizione-pagina">
            Tutto quello che resta da consuntivare, operatore per operatore, calcolato dalle partite confermate.
            Spunta le recensioni, aggiungi spese e correzioni, poi consuntiva: da quel momento i valori si congelano
            e la giornata non accetta più modifiche, sparendo da questo elenco.
          </p>

          <div className="filtri-storico" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="filtro-group" style={{ flex: '1 1 160px' }}>
              <label>Dal:</label>
              <input type="date" value={dal} max={al || oggiIso()} onChange={(e) => setDal(e.target.value)} />
            </div>
            <div className="filtro-group" style={{ flex: '1 1 160px' }}>
              <label>Al:</label>
              <input type="date" value={al} min={dal} max={oggiIso()} onChange={(e) => setAl(e.target.value)} />
            </div>
            <div className="filtro-group" style={{ flex: '0 0 auto' }}>
              {(dal || al) ? (
                <button
                  type="button" onClick={() => { setDal(''); setAl(''); }}
                  className="btn-outline-annulla"
                  style={{ display: 'inline-flex', alignItems: 'center', padding: '7px 14px', borderRadius: '4px', fontSize: '0.8rem' }}
                >
                  <Icona nome="annulla" size={14} style={{ marginRight: '5px' }} />Tutto il periodo
                </button>
              ) : (
                <span style={{ fontSize: '0.78rem', color: '#888' }}>Date vuote: tutto quello che resta da consuntivare.</span>
              )}
            </div>
          </div>

          {caricamentoPartite ? (
            <div className="admin-table-box-full" style={{ marginTop: '20px', padding: '30px', textAlign: 'center', color: '#666' }}>Calcolo in corso...</div>
          ) : preventivi.length === 0 ? (
            <div className="admin-table-box-full" style={{ marginTop: '20px', padding: '30px', textAlign: 'center', color: '#666' }}>
              Niente da consuntivare: tutte le partite confermate con operatori assegnati sono gia state chiuse.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '20px' }}>
                {preventivi.map(op => {
                  const espanso = operatoreEspanso === op.id;
                  return (
                    <div key={op.id} style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', overflow: 'hidden' }}>
                      <div
                        onClick={() => setOperatoreEspanso(espanso ? null : op.id)}
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', padding: '14px 16px', cursor: 'pointer' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '0.7rem', color: '#888' }}>{espanso ? '▼' : '▶'}</span>
                          <strong style={{ fontSize: '1rem' }}>{op.nome}</strong>
                          <span style={{ color: '#888', fontSize: '0.8rem' }}>{op.giornate.length} giornat{op.giornate.length === 1 ? 'a' : 'e'}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '14px', alignItems: 'center', fontSize: '0.85rem', flexWrap: 'wrap' }}>
                          {/* Le voci si sommano fra loro: compenso (ore più eventuali correzioni),
                              recensioni e spese. Compaiono solo quando valgono qualcosa. */}
                          <span>{ore(op.ore)}</span>
                          {/* La scomposizione compare solo se c'è davvero qualcosa da scomporre:
                              senza extra ripeterebbe due volte lo stesso importo. */}
                          {(op.totaleRecensioni !== 0 || op.spese !== 0) && (
                            <>
                              <span>{euro(op.compenso - op.totaleRecensioni)} compenso</span>
                              {op.totaleRecensioni !== 0 && (
                                <span style={{ color: '#1c7a4e' }}>+{euro(op.totaleRecensioni)} recensioni</span>
                              )}
                              {op.spese !== 0 && <span style={{ color: '#b26a00' }}>+{euro(op.spese)} spese</span>}
                            </>
                          )}
                          {/* La somma delle voci sopra: quello che l'operatore incassa davvero. */}
                          <span><strong>{euro(op.compenso + op.spese)}</strong> da pagare</span>
                          <button
                            type="button"
                            title="Sostituisce il calcolo a ore con un importo pattuito, ripartito sulle ore del periodo"
                            onClick={(e) => { e.stopPropagation(); setFormForfait({ operatore: op.id, nome: op.nome, importo: '' }); }}
                            className="btn-outline-annulla"
                            style={{ display: 'inline-flex', alignItems: 'center', padding: '6px 12px', borderRadius: '4px', fontSize: '0.78rem' }}
                          >
                            <Icona nome="offerta" size={14} style={{ marginRight: '5px' }} />Concordato
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); consuntiva(op); }}
                            disabled={inCorso === `consuntiva-${op.id}`}
                            style={{ ...btnSalva, padding: '6px 12px', fontSize: '0.78rem' }}
                          >
                            <Icona nome="consuntivati" size={14} style={{ marginRight: '5px' }} />Consuntiva
                          </button>
                        </div>
                      </div>

                      {espanso && tabellaDettaglio(op)}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

      {/* ---------- Aggiunta di una voce manuale ---------- */}
      {formVoce && (
        <div className="modal-form-backdrop" onClick={() => setFormVoce(null)}>
          <div className="modal-form-box" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-form-close" aria-label="Chiudi" onClick={() => setFormVoce(null)}>✕</button>
            <h3 style={{ margin: '0 0 4px 0', fontSize: '1.1rem', color: '#0288d1' }}>
              {formVoce.tipo === 'spesa' ? 'Rimborso spese' : 'Correzione del compenso'}
            </h3>
            <p style={{ margin: '0 0 4px 0', fontSize: '0.82rem', color: '#333' }}>{formVoce.etichetta}</p>
            <p style={{ margin: '0 0 15px 0', fontSize: '0.8rem', color: '#777' }}>
              {formVoce.tipo === 'spesa'
                ? 'Pranzo, hotel, pedaggi. Esente da ritenuta: si rimborsa e basta, non è compenso.'
                : "Si aggiunge al compenso senza sovrascrivere il calcolo — l'ora persa nel traffico diventa una riga in più. Un importo negativo lo riduce."}
            </p>

            {/* Le voci già presenti su questa partita: si tolgono da qui, non si modificano.
                Correggere un importo sbagliato è eliminarlo e riscriverlo, così resta chiaro
                che ogni riga è una decisione a sé. */}
            {(() => {
              const esistenti = vociDi(formVoce.operatore, formVoce.riferimento, formVoce.tipo)
                .filter(v => v.data === formVoce.data);
              if (esistenti.length === 0) return null;
              return (
                <div style={{ marginBottom: '14px', border: '1px solid #eee', borderRadius: '6px', overflow: 'hidden' }}>
                  {esistenti.map((v, i) => (
                    <div key={v.id} style={{
                      display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px',
                      fontSize: '0.83rem', borderTop: i > 0 ? '1px solid #f0f0f0' : undefined,
                    }}>
                      <span style={{ flex: 1 }}>{v.descrizione}</span>
                      <strong>{euro(v.importo)}</strong>
                      <button
                        type="button" className="btn-icon-action" aria-label="Elimina" title="Elimina"
                        disabled={inCorso === `del-${v.id}`} onClick={() => rimuoviVoce(v)}
                      >
                        <Icona nome="elimina" size={14} style={{ marginRight: 0 }} />
                      </button>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: '#fafafa', fontSize: '0.83rem', fontWeight: 'bold', borderTop: '1px solid #eee' }}>
                    <span>Totale</span><span>{euro(sommaDi(esistenti))}</span>
                  </div>
                </div>
              );
            })()}

            <form onSubmit={salvaVoce} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '4px' }}>Descrizione</label>
                <input
                  type="text" autoFocus value={formVoce.descrizione}
                  placeholder={formVoce.tipo === 'spesa' ? 'es. pranzo' : "es. un'ora in più per il traffico"}
                  onChange={(e) => setFormVoce(f => ({ ...f, descrizione: e.target.value }))} style={stileInput}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '4px' }}>Importo (€)</label>
                <input
                  type="number" step="any" value={formVoce.importo}
                  onChange={(e) => setFormVoce(f => ({ ...f, importo: e.target.value }))} style={stileInput}
                />
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="submit" style={btnSalva} disabled={inCorso === 'voce'}>
                  <Icona nome="nuovo" size={16} style={{ marginRight: '6px' }} />
                  {inCorso === 'voce' ? 'Salvataggio...' : 'Aggiungi'}
                </button>
                <button type="button" className="btn-outline-annulla" style={{ display: 'inline-flex', alignItems: 'center', padding: '9px 18px', borderRadius: '4px', fontSize: '0.85rem' }} onClick={() => setFormVoce(null)}>
                  <Icona nome="annulla" size={16} style={{ marginRight: '6px' }} />Chiudi
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---------- Compenso concordato ---------- */}
      {formForfait && anteprimaForfait && (
        <div className="modal-form-backdrop" onClick={() => setFormForfait(null)}>
          <div className="modal-form-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '560px' }}>
            <button type="button" className="modal-form-close" aria-label="Chiudi" onClick={() => setFormForfait(null)}>✕</button>
            <h3 style={{ margin: '0 0 4px 0', fontSize: '1.1rem', color: '#0288d1' }}>Compenso concordato · {formForfait.nome}</h3>
            <p style={{ margin: '0 0 15px 0', fontSize: '0.8rem', color: '#777' }}>
              L'importo pattuito si ripartisce sulle ore delle partite in elenco. La differenza rispetto al calcolo
              a ore diventa una rettifica con causale <strong>forfait</strong> su ogni partita, così il compenso
              arriva esattamente alla cifra concordata.
            </p>

            {anteprimaForfait.esistenti.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '14px', padding: '10px 14px', background: '#eef4fb', border: '1px solid #cfe0f2', borderRadius: '6px' }}>
                <span style={{ fontSize: '0.83rem', color: '#1a4f8a' }}>
                  Forfait attivo da <strong>{euro(anteprimaForfait.totaleEsistente)}</strong>.
                  Scrivendo un altro importo lo sostituisci.
                </span>
                <button
                  type="button" onClick={rimuoviForfait} disabled={inCorso === 'forfait'}
                  className="btn-outline-annulla"
                  style={{ display: 'inline-flex', alignItems: 'center', padding: '6px 12px', borderRadius: '4px', fontSize: '0.78rem', flexShrink: 0 }}
                >
                  <Icona nome="elimina" size={14} style={{ marginRight: '5px' }} />Rimuovi forfait
                </button>
              </div>
            )}

            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '4px' }}>Importo concordato (€)</label>
              <input
                type="number" step="any" min="0" autoFocus
                value={formForfait.importo}
                placeholder={`a ore sarebbero ${(+anteprimaForfait.op.compensoOrario).toFixed(2)}`}
                onChange={(e) => setFormForfait(f => ({ ...f, importo: e.target.value }))}
                style={stileInput}
              />
            </div>

            {anteprimaForfait.righe.length > 0 && (
              <div style={{ marginTop: '16px', background: '#f8fafc', border: '1px solid #e0e0e0', borderRadius: '6px', overflow: 'hidden' }}>
                <div style={{ padding: '8px 14px', fontSize: '0.78rem', color: '#666', borderBottom: '1px solid #e8e8e8' }}>
                  {euro(anteprimaForfait.importo)} su {ore(anteprimaForfait.op.ore)} ·{' '}
                  {euro(anteprimaForfait.importo / (anteprimaForfait.op.ore || 1))} l'ora
                </div>
                <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                    <thead>
                      <tr style={{ background: '#f2f5f8', color: '#666' }}>
                        <th style={{ padding: '6px 14px', textAlign: 'left' }}>Partita</th>
                        <th style={{ padding: '6px 10px', textAlign: 'right' }}>A ore</th>
                        <th style={{ padding: '6px 10px', textAlign: 'right' }}>Rettifica</th>
                        <th style={{ padding: '6px 14px', textAlign: 'right' }}>Quota</th>
                      </tr>
                    </thead>
                    <tbody>
                      {anteprimaForfait.righe.map(r => (
                        <tr key={r.riferimento} style={{ borderTop: '1px solid #eee' }}>
                          <td style={{ padding: '6px 14px' }}>
                            {r.riferimento}<br />
                            <span style={{ color: '#999', fontSize: '0.72rem' }}>{dataBreve(r.data)}</span>
                          </td>
                          <td style={{ padding: '6px 10px', textAlign: 'right', color: '#888' }}>{euro(r.calcolato)}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'right', color: r.differenza < 0 ? '#c62828' : '#3949ab' }}>
                            {r.differenza >= 0 ? '+' : ''}{euro(r.differenza)}
                          </td>
                          <td style={{ padding: '6px 14px', textAlign: 'right', fontWeight: 500 }}>{euro(r.quota)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
              <button type="button" onClick={applicaForfait} style={btnSalva} disabled={inCorso === 'forfait' || anteprimaForfait.righe.length === 0}>
                <Icona nome="salva" size={16} style={{ marginRight: '6px' }} />
                {inCorso === 'forfait' ? 'Applicazione...' : 'Applica il forfait'}
              </button>
              <button
                type="button" className="btn-outline-annulla"
                style={{ display: 'inline-flex', alignItems: 'center', padding: '9px 18px', borderRadius: '4px', fontSize: '0.85rem' }}
                onClick={() => setFormForfait(null)}
              >
                <Icona nome="annulla" size={16} style={{ marginRight: '6px' }} />Annulla
              </button>
            </div>
          </div>
        </div>
      )}

      {gestioneTab === "rimborsi" && puoVedere(user, 'compensi', 'gestione', 'rimborsi') && (
        <>
          <p className="descrizione-pagina">
            Periodi consuntivati in attesa della ricevuta. Il dettaglio è ricostruito con i parametri di allora,
            non con quelli di oggi. Ripristinare un periodo rimette le sue giornate fra quelle da consuntivare e
            cancella i valori salvati; le voci registrate restano.
          </p>
          {tabellaPeriodi(daElaborare, "Nessun rimborso da elaborare.", false)}
        </>
      )}

      {/* ---------- Elaborazione del rimborso ---------- */}
      {/* Largo, perché contiene l'anteprima del documento: è quella che si sta decidendo, e
          vederla mentre si compila è tutto il senso della schermata. */}
      {elaborazione && importiElaborazione && (
        <div className="modal-form-backdrop" onClick={() => setElaborazione(null)}>
          <div className="modal-form-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '900px' }}>
            <button type="button" className="modal-form-close" aria-label="Chiudi" onClick={() => setElaborazione(null)}>✕</button>
            <h3 style={{ margin: '0 0 4px 0', fontSize: '1.1rem', color: '#0288d1' }}>
              Rimborso · {elaborazione.periodo.operatore}
            </h3>
            <p style={{ margin: '0 0 15px 0', fontSize: '0.8rem', color: '#777' }}>
              Quello che scrivi qui finisce nel documento. Le giornate sono proposte dalle partite del periodo:
              correggile o toglile se il documento deve dire altro.
            </p>

          <div>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '1rem' }}>Giornate</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {elaborazione.giornate.map((g, i) => (
                <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    type="date" value={g.data}
                    onChange={(e) => setElaborazione(s => ({ ...s, giornate: s.giornate.map((x, j) => j === i ? { ...x, data: e.target.value } : x) }))}
                    style={{ ...stileInput, width: '160px' }}
                  />
                  <input
                    type="text" value={g.luogo} placeholder="indirizzo o località"
                    onChange={(e) => setElaborazione(s => ({ ...s, giornate: s.giornate.map((x, j) => j === i ? { ...x, luogo: e.target.value } : x) }))}
                    style={{ ...stileInput, flex: '1 1 260px' }}
                  />
                  <button
                    type="button" className="btn-icon-action" aria-label="Togli la giornata" title="Togli la giornata"
                    onClick={() => setElaborazione(s => ({ ...s, giornate: s.giornate.filter((_, j) => j !== i) }))}
                  >
                    <Icona nome="elimina" size={14} style={{ marginRight: 0 }} />
                  </button>
                </div>
              ))}
              <div>
                <button
                  type="button"
                  onClick={() => setElaborazione(s => ({ ...s, giornate: [...s.giornate, { data: s.periodo.dal, luogo: '' }] }))}
                  style={{ background: 'none', border: 'none', color: '#0288d1', cursor: 'pointer', fontSize: '0.8rem', padding: 0 }}
                >+ giornata</button>
              </div>
            </div>

            <h3 style={{ margin: '22px 0 4px 0', fontSize: '1rem' }}>Rimborso trasferta forfait</h3>
            <p style={{ margin: '0 0 12px 0', fontSize: '0.8rem', color: '#777', maxWidth: '66ch' }}>
              Quante trasferte riconosci e quanto vale ciascuna. Come le altre spese resta fuori dalla base
              imponibile: è denaro anticipato e restituito, non guadagnato.
            </p>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '4px' }}>Numero</label>
                <input
                  type="number" min="0" step="1" value={elaborazione.numeroTrasferte}
                  onChange={(e) => setElaborazione(s => ({ ...s, numeroTrasferte: e.target.value }))}
                  style={{ ...stileInput, width: '100px' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '4px' }}>Importo unitario (€)</label>
                <input
                  type="number" min="0" step="any" value={elaborazione.importoTrasferta}
                  onChange={(e) => setElaborazione(s => ({ ...s, importoTrasferta: e.target.value }))}
                  style={{ ...stileInput, width: '140px' }}
                />
              </div>
              <div style={{ paddingBottom: '9px', color: '#666', fontSize: '0.85rem' }}>
                = <strong>{euro(importiElaborazione.trasferte)}</strong>
              </div>
            </div>

          </div>

            <h4 style={{ margin: '22px 0 10px 0', fontSize: '0.78rem', letterSpacing: '0.09em', textTransform: 'uppercase', color: '#888' }}>
              Anteprima del documento
            </h4>
            <div style={{ border: '1px solid #e0e0e0', borderRadius: '6px', overflow: 'auto', maxHeight: '420px' }}>
              {documentoRimborso(elaborazione.periodo, elaborazione.giornate, importiElaborazione)}
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '18px', paddingTop: '16px', borderTop: '1px solid #eee' }}>
              <button type="button" onClick={evadiRimborso} style={btnSalva} disabled={inCorso === 'rimborso'}>
                <Icona nome="stampa" size={16} style={{ marginRight: '6px' }} />
                {inCorso === 'rimborso' ? 'Elaborazione...' : 'Genera il documento e segna evaso'}
              </button>
              <button
                type="button" className="btn-outline-annulla"
                style={{ display: 'inline-flex', alignItems: 'center', padding: '9px 18px', borderRadius: '4px', fontSize: '0.85rem' }}
                onClick={() => setElaborazione(null)}
              >
                <Icona nome="annulla" size={16} style={{ marginRight: '6px' }} />Annulla
              </button>
            </div>
          </div>
        </div>
      )}

      {gestioneTab === "evasi" && puoVedere(user, 'compensi', 'gestione', 'evasi') && (
        <>
          <p className="descrizione-pagina">
            Periodi con la ricevuta già emessa. Il documento si ristampa identico a com'era stato generato:
            i suoi importi sono congelati, non ricalcolati.
          </p>
          {tabellaPeriodi(evasi, "Nessun rimborso evaso.", true)}
        </>
      )}
        </div>
      )}

      {currentView === "indicatori" && puoVedere(user, 'compensi', 'indicatori') && schedaVuota(
        "Indicatori",
        "Ore per operatore, costo medio orario e incidenza del personale sul margine."
      )}
    </>
  );
}

export default Compensi
