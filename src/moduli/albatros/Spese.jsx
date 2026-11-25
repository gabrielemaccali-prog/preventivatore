import { useState, useEffect, Fragment } from 'react'
import { supabase, leggiTutte } from '../../lib/supabaseClient'
import Icona from '../../components/Icona'
import { formattaDataGGMMAAAA } from '../../lib/utils'
import {
  nomeCategoria, idCategoriaScelta, ENTI, etichettaEnte, num, r2, euro, giornataDiLavoro, periodoIniziale, intervalloPeriodo, dicituraPeriodo,
  dettaglioSpesa, rigaSpesaConsentita, modificaVoceConsentita, voceDaSalvare, voceCorreggibile, importoInCategoria, importoInCategorie, alberoCategorie, categoriaFoglia, conSottocategorie, spesaDettagliabile, spesaMulticategoria, nonInBanca, DA_DETTAGLIARE, METODI_SPESA, spesaDaPagare, etichettaMetodoSpesa,
  contantiAlbatros,
} from './calcolo'
import { principaleDi, trasferimentiDoppi } from './banca'
import { caricaBanca, ignoraSpesa, unisciTrasferimenti } from './operazioniBanca'
import CaricaEstrattoAlbatros from './CaricaEstrattoAlbatros'
import MovimentiBanca from './MovimentiBanca'
import EntrateBanca from './EntrateBanca'
import SpeseNascoste from './SpeseNascoste'
import Cashflow from './Cashflow'
import { puoVedere } from '../../lib/permessi'
import FiltroPeriodo from './FiltroPeriodo'
import SceltaCategoria from './SceltaCategoria'

// ============================================================
// Le uscite del centro, registrate solo qui: non entrano nella chiusura della serata. Ogni spesa
// la paga uno dei tre enti (Albatros, BFM, Lama), e se la paga Albatros si dice se in contanti o con
// carta (cambia quale saldo scende nel Cashflow), oppure che è ancora da pagare; se non si sa ancora resta "da attribuire" e
// l'elenco la segnala. Attribuirla è riempire un campo vuoto: lo può fare chiunque.
// I ragazzi possono solo aggiungere; modificare ed eliminare spetta all'amministratore.
// Nuova spesa e modifica si fanno nello stesso overlay.
// Le categorie sono un solo livello. Una spesa ha una categoria, oppure è uno scontrino con più
// categorie: allora la testata non ne ha, e toccandola si apre il dettaglio, dove si scrivono le voci
// che lo compongono, ognuna con la sua categoria (anche dopo, anche in parte) senza superare il
// totale; quello che manca è "da dettagliare". Le voci appena scritte si cambiano e si tolgono
// finché non si preme "Salva il dettaglio"; salvate, le corregge solo l'amministratore. Il filtro per categoria guarda la testata delle spese
// semplici e le voci degli scontrini. Aggiungere voci lo può fare chiunque, toglierle solo
// l'amministratore.
//
// Contanti e banca sono separati: a mano si scrivono solo i contanti (o una spesa da pagare, o una di
// Lama); carta e bonifico arrivano dall'estratto conto. Contanti: le spese scritte a mano. Spese:
// quelle arrivate dalla banca. Una spesa con carta scritta a mano che non è in banca non esiste:
// non si vede da nessuna parte finché il suo movimento non arriva e le si lega (vedi nonInBanca).
// BFM: quelle che arrivano dal conto di BFM, scritte nel modulo Spese di BFM. Banca: le uscite del conto di Albatros, caricate
// dall'estratto conto in Excel dall'amministratore (vedi banca.js). Una spesa con carta già scritta
// a mano si abbina al suo movimento (stesso importo, entro 10 giorni) invece di contarla due volte.
// La vista Spese (id 'banca') è fatta come la scheda Spese del modulo di BFM: in cima il caricamento dell'estratto
// (CaricaEstrattoAlbatros) e l'avviso delle spese da completare; la riga si apre col pulsante matita
// (descrizione e categoria, o scontrino), si salva con Salva; "Apri" mostra il movimento da cui è
// nata, e lì si dice se non è una spesa. Le commissioni si vedono accanto all'importo, come in BFM.
// La vista Banca (id 'movimenti') è la scheda Banca di BFM: saldo e destinazione di ogni movimento;
// la vista Incassi (id 'entrate') è la sua scheda Incassi: ogni entrata del conto è un incasso POS, un versamento di contanti,
// un'altra entrata, o da completare. La vista Da dettagliare raccoglie gli scontrini con più
// categorie non ancora dettagliati del tutto, di qualunque periodo.
// Non tutte le uscite sono spese: un prelievo di contanti è un trasferimento dal conto ai contanti
// in mano (albatros_trasferimenti, come quelli del Cashflow). Prelievi e versamenti si riconoscono
// dal tipo di movimento e diventano trasferimenti da soli all'import: non si sceglie a mano. I trasferimenti
// (quelli dalla banca e quelli scritti nel Cashflow) hanno una sotto-scheda loro, Trasferimenti.
// ============================================================

const leggiImporto = (v) => { const n = Number(String(v ?? '').trim().replace(',', '.')); return Number.isFinite(n) ? r2(n) : NaN; };
const VOCE_VUOTA = { descrizione: '', importo: '', categoria: null };
// BFM non si sceglie qui: le spese che BFM sostiene per Albatros si scrivono nel modulo Spese di
// BFM e arrivano da sole (spesa_bfm_id), scriverle anche qui le conterebbe due volte.
const ENTI_SCEGLIBILI = ENTI.filter(e => e.id !== 'bfm');
// Le viste di ogni modulo, nell'ordine in cui compaiono. Cassa è dei ragazzi: le spese in contanti
// (col totale dei contanti in mano), gli scontrini con carta da dettagliare, i trasferimenti. Conti è del
// responsabile, che lavora con la banca. Gli id restano quelli di quando sono nate: 'banca' sono le
// spese dalla banca, 'entrate' gli incassi, 'movimenti' tutti i movimenti del conto. Chi vede quale
// vista lo dicono le sottoschede dei ruoli (permesso).
const VISTE = {
  cassa: [
    { id: 'contanti', label: 'Spese', icona: 'spese', permesso: 'cassa_spese' },
    { id: 'dettagliare', label: 'Da dettagliare', icona: 'listino', permesso: 'cassa_dettagliare' },
    { id: 'trasferimenti', label: 'Trasferimenti', icona: 'cashflow', permesso: 'cassa_trasferimenti' },
  ],
  conti: [
    { id: 'banca', label: 'Spese', icona: 'spese', permesso: 'conti_spese' },
    { id: 'entrate', label: 'Incassi', icona: 'rimborso', permesso: 'conti_incassi' },
    { id: 'movimenti', label: 'Banca', icona: 'banca', permesso: 'conti_banca' },
    { id: 'trasferimenti', label: 'Trasferimenti', icona: 'cashflow', permesso: 'conti_trasferimenti' },
    { id: 'cashflow', label: 'Cashflow', icona: 'riepilogo', permesso: 'conti_cashflow' },
    { id: 'cassa', label: 'Contanti in mano', icona: 'chiusure', permesso: 'conti_contanti' },
    { id: 'bfm', label: 'BFM', icona: 'consuntivazione', permesso: 'conti_bfm' },
    // Il Configuratore delle categorie delle spese sta nel Cruscotto.
  ],
  // Nel Cruscotto: tutte le spese insieme (a mano, dalla banca, dal conto di BFM), per vederle e
  // sistemarle da un posto solo. Ogni riga si modifica come nella vista da cui viene.
  tutte: [
    { id: 'tutte', label: 'Tutte le spese', icona: 'tabella', permesso: 'cruscotto_elenco' },
  ],
};
const SPESA_VUOTA = () => ({ id: null, data: giornataDiLavoro(), importo: '', descrizione: '', categoria: null, multicategoria: false, ente: '', metodo: 'contanti' });

function Spese({ user, categorie, listino, utenti, puoCorreggere, modulo: moduloPagina = 'cassa' }) {
  const schedaPermessi = { cassa: 'spese', conti: 'conti', tutte: 'incassi' }[moduloPagina] || 'spese';
  const viste = (VISTE[moduloPagina] || VISTE.cassa).filter(v => puoVedere(user, 'albatros', schedaPermessi, v.permesso));
  const [spese, setSpese] = useState([]);
  const [periodo, setPeriodo] = useState(periodoIniziale);
  const [filtroEnte, setFiltroEnte] = useState('');
  // filtroCategoria: '' = tutte, 'nessuna' = senza categoria, DA_DETTAGLIARE = la parte non
  // dettagliata degli scontrini, altrimenti l'id. Con un filtro attivo ogni spesa conta per la parte
  // che va a quella categoria (vedi importoInCategoria).
  const [filtroCategoria, setFiltroCategoria] = useState('');
  // La ricerca, come nel modulo Spese di BFM: nella descrizione, nelle voci dello scontrino, nella
  // categoria e nel movimento della banca da cui la spesa è nata.
  const [cerca, setCerca] = useState('');
  // La spesa nell'overlay: null = chiuso; senza id è una spesa nuova.
  const [modulo, setModulo] = useState(null);
  const [inCorso, setInCorso] = useState(false);
  // Le voci di dettaglio, per spesa; la spesa aperta e la voce che si sta scrivendo dentro.
  const [vociPer, setVociPer] = useState({});
  const [espansa, setEspansa] = useState(null);
  const [nuovaVoce, setNuovaVoce] = useState(VOCE_VUOTA);
  // La voce che si sta correggendo (descrizione, importo, categoria): null = nessuna.
  const [voceInModifica, setVoceInModifica] = useState(null);
  // Le viste: Contanti, Banca, Da dettagliare, Movimenti, Entrate, Trasferimenti.
  const [vista, setVista] = useState(viste[0]?.id ?? null);
  const [soloDaCompletare, setSoloDaCompletare] = useState(false);
  // In Conti > Spese: solo gli scontrini con più categorie non ancora dettagliati del tutto.
  const [soloDaDettagliare, setSoloDaDettagliare] = useState(false);
  // La riga dalla banca aperta in modifica: una per volta, si salva col suo pulsante.
  const [rigaBanca, setRigaBanca] = useState(null);
  // I trasferimenti del periodo: dall'estratto conto (prelievi) e scritti nel Cashflow.
  const [trasferimentiBanca, setTrasferimentiBanca] = useState([]);
  // L'estratto conto caricato (vedi caricaBanca): movimenti, caricamenti, spese e trasferimenti che
  // ne sono nati. Serve a Movimenti, alle commissioni sommate e a riunire quelle rimaste a sé.
  const [banca, setBanca] = useState({ movimenti: [], caricamenti: [], spese: [], trasferimenti: [] });
  // Nella Cassa, in cima alle spese, i contanti che Albatros ha in mano (come nel Cashflow).
  const [contantiInMano, setContantiInMano] = useState(null);

  const [da, al] = intervalloPeriodo(periodo);

  const carica = async () => {
    // In un anno le righe superano il limite di una lettura: si leggono a pagine. Da dettagliare
    // guarda tutti gli scontrini, di qualunque periodo.
    const { data } = await leggiTutte(() => {
      const q = supabase.from('albatros_spese').select('*');
      return (vista === 'dettagliare' ? q.eq('multicategoria', true) : q.gte('data', da).lte('data', al))
        .order('data', { ascending: false }).order('id', { ascending: false });
    });
    setSpese(data || []);
    const ids = (data || []).map(x => x.id);
    const { data: voci } = ids.length
      ? await leggiTutte(() => supabase.from('albatros_spese_righe').select('*').in('spesa_id', ids).order('id'))
      : { data: [] };
    const mappa = {};
    (voci || []).forEach(v => { (mappa[v.spesa_id] = mappa[v.spesa_id] || []).push(v); });
    setVociPer(mappa);
    const { data: tr } = await supabase.from('albatros_trasferimenti').select('*, movimento:albatros_banca_movimenti(*)')
      .gte('data', da).lte('data', al).order('data', { ascending: false });
    setTrasferimentiBanca(tr || []);
    // Senza sql/albatros_banca.sql le tabelle non ci sono: nessun estratto ancora.
    const b = await caricaBanca();
    setBanca({ movimenti: b.movimenti.data || [], caricamenti: b.caricamenti.data || [], spese: b.spese.data || [], trasferimenti: b.trasferimenti.data || [] });
    if (moduloPagina === 'cassa') {
      const [ch, sp, pg, tr, ac] = await Promise.all([
        leggiTutte(() => supabase.from('albatros_chiusure').select('*').order('id')),
        leggiTutte(() => supabase.from('albatros_spese').select('*').order('id')),
        leggiTutte(() => supabase.from('albatros_pagamenti').select('*').order('id')),
        leggiTutte(() => supabase.from('albatros_trasferimenti').select('*').order('id')),
        leggiTutte(() => supabase.from('albatros_acconti').select('*').order('id')),
      ]);
      setContantiInMano(contantiAlbatros(ch.data || [], sp.data || [], pg.data || [], tr.data || [], ac.data || []).inMano);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { carica(); }, [da, al, vista === 'dettagliare']);

  // filtroEnte: '' = tutte, 'nessuno' = da attribuire, altrimenti l'id dell'ente.
  const categoriaFiltro = filtroCategoria === 'nessuna' ? null : filtroCategoria === DA_DETTAGLIARE ? DA_DETTAGLIARE : Number(filtroCategoria);
  // Una categoria con sottocategorie nel filtro vuol dire anche le sue sottocategorie.
  const idsFiltro = typeof categoriaFiltro === 'number' ? conSottocategorie(categorie, categoriaFiltro) : [categoriaFiltro];
  const importo = (s) => (filtroCategoria ? (typeof categoriaFiltro === 'number' ? importoInCategorie(s, vociPer[s.id], idsFiltro) : importoInCategoria(s, vociPer[s.id], categoriaFiltro)) : r2(num(s.importo)));
  // BFM: le spese che BFM sostiene per Albatros, arrivate dal modulo Spese di BFM (spesa_bfm_id).
  const speseVista = spese.filter(s => !nonInBanca(s) && (vista === 'banca' ? s.movimento_id != null
    : vista === 'contanti' ? s.movimento_id == null && s.spesa_bfm_id == null
      : vista === 'bfm' ? s.spesa_bfm_id != null
        : vista === 'dettagliare' ? s.movimento_id != null && spesaMulticategoria(s) && dettaglioSpesa(s, vociPer[s.id]).nonDettagliato > 0
          : vista === 'tutte'));
  // Le commissioni sommate a una spesa (come nel modulo Spese di BFM): l'importo della spesa le
  // comprende già, la riga le mostra a parte.
  const oneriPer = new Map();
  // I movimenti non ancora contabilizzati (NC): la loro spesa ha il segno accanto alla data.
  const ncDi = new Set(banca.movimenti.filter(m => m.non_contabilizzato).map(m => m.id));
  banca.movimenti.filter(m => m.onere_spesa_id != null).forEach(m => oneriPer.set(m.onere_spesa_id, r2((oneriPer.get(m.onere_spesa_id) || 0) - num(m.importo))));
  // Commissioni caricate prima che si sommassero: sono ancora spese a sé, ma il loro bonifico o
  // addebito ha una spesa a cui riunirle.
  const speseDaBanca = banca.spese.filter(x => x.movimento_id != null);
  const spesaPerMovimento = new Map(speseDaBanca.map(x => [x.movimento_id, x]));
  const commissioniDaUnire = speseDaBanca.map(sp => {
    const mov = banca.movimenti.find(m => m.id === sp.movimento_id);
    const principale = mov && principaleDi(mov, banca.movimenti.filter(m => !m.ignorato));
    const destinazione = principale && spesaPerMovimento.get(principale.id);
    return destinazione && destinazione.id !== sp.id ? { onere: sp, movimento: mov, destinazione } : null;
  }).filter(Boolean);

  const unisciCommissioni = async () => {
    setInCorso(true);
    try {
      const importi = new Map();
      for (const { onere, movimento, destinazione } of commissioniDaUnire) {
        const { error: e1 } = await supabase.from('albatros_spese').delete().eq('id', onere.id);
        if (e1) throw e1;
        const { error: e2 } = await supabase.from('albatros_banca_movimenti').update({ onere_spesa_id: destinazione.id }).eq('id', movimento.id);
        if (e2) throw e2;
        importi.set(destinazione.id, r2((importi.get(destinazione.id) ?? num(destinazione.importo)) + num(onere.importo)));
      }
      for (const [id, importo] of importi) {
        const { error } = await supabase.from('albatros_spese').update({ importo }).eq('id', id);
        if (error) throw error;
      }
      await carica();
    } catch (err) {
      alert(`Errore: ${err.message}`);
    } finally {
      setInCorso(false);
    }
  };

  // Un trasferimento scritto a mano nel Cashflow e lo stesso arrivato dalla banca: si riuniscono.
  const doppi = trasferimentiDoppi(banca.trasferimenti);
  const riunisciTrasferimenti = async () => {
    setInCorso(true);
    try {
      await unisciTrasferimenti(doppi);
      await carica();
    } catch (err) {
      alert(`Errore: ${err.message}`);
    } finally {
      setInCorso(false);
    }
  };

  const daDettagliare = (s) => spesaMulticategoria(s) && dettaglioSpesa(s, vociPer[s.id]).nonDettagliato > 0;
  // Da completare: senza categoria, o su una categoria che nel frattempo ha sottocategorie (come in BFM).
  const daCompletareBanca = (s) => s.movimento_id != null && !spesaMulticategoria(s) && (s.categoria_id == null || !categoriaFoglia(categorie, s.categoria_id));
  // Come in BFM l'avviso conta tutte le spese da completare, non solo quelle del periodo.
  const daCompletareTutte = speseDaBanca.filter(daCompletareBanca);
  const visibili = speseVista
    .filter(s => !((vista === 'banca' || vista === 'tutte') && soloDaCompletare) || daCompletareBanca(s))
    .filter(s => !((vista === 'banca' || vista === 'tutte') && soloDaDettagliare) || daDettagliare(s))
    .filter(s => !filtroEnte || (filtroEnte === 'nessuno' ? !s.ente : filtroEnte === 'dapagare' ? spesaDaPagare(s) : s.ente === filtroEnte))
    .filter(s => importo(s) > 0)
    .filter(s => {
      const t = cerca.trim().toLowerCase();
      if (!t) return true;
      const mov = s.movimento_id != null ? banca.movimenti.find(m => m.id === s.movimento_id) : null;
      return [s.descrizione, nomeCategoria(categorie, s.categoria_id), mov?.descrizione, ...(vociPer[s.id] || []).flatMap(v => [v.descrizione, nomeCategoria(categorie, v.categoria_id)])]
        .some(v => (v || '').toLowerCase().includes(t));
    });
  const daAttribuire = speseVista.filter(s => !s.ente);
  const daPagare = speseVista.filter(spesaDaPagare);
  const totale = (elenco) => r2(elenco.reduce((t, s) => t + importo(s), 0));

  const salva = async () => {
    // Una spesa arrivata dal modulo Spese di BFM: qui si sceglie solo la categoria di Albatros, e la
    // scelta torna anche sulla spesa di BFM, che altrimenti al prossimo allineamento la rimetterebbe com'era.
    if (modulo.spesaBfm) {
      const categoria_id = idCategoriaScelta(modulo.categoria, categorie, 'spesa');
      setInCorso(true);
      try {
        const [a, b] = await Promise.all([
          supabase.from('albatros_spese').update({ categoria_id }).eq('id', modulo.id),
          supabase.from('spese').update({ albatros_categoria_id: categoria_id }).eq('id', modulo.spesaBfm),
        ]);
        const error = a.error || b.error;
        if (error) return alert(`Errore nel salvataggio: ${error.message}`);
        setModulo(null);
        await carica();
      } finally {
        setInCorso(false);
      }
      return;
    }
    // Una spesa dal conto in banca: data, importo e descrizione sono quelli del movimento; si
    // sceglie la categoria, o se è uno scontrino con più categorie.
    if (modulo.daBanca) {
      const multi = !!modulo.multicategoria;
      if (!multi && (vociPer[modulo.id] || []).length) return alert('Questo scontrino ha già delle voci: per farne una spesa con una sola categoria toglile prima dal dettaglio.');
      setInCorso(true);
      const { error } = await supabase.from('albatros_spese')
        .update({ multicategoria: multi, categoria_id: multi ? null : idCategoriaScelta(modulo.categoria, categorie, 'spesa') }).eq('id', modulo.id);
      setInCorso(false);
      if (error) return alert(`Errore nel salvataggio: ${error.message}`);
      setModulo(null);
      if (multi) { setEspansa(modulo.id); setNuovaVoce(VOCE_VUOTA); }
      return carica();
    }
    const importo = leggiImporto(modulo.importo);
    const descrizione = modulo.descrizione.trim();
    if (!modulo.data) return alert('Scegli la data.');
    if (!descrizione) return alert('Scrivi cosa è stato pagato.');
    if (!importo || importo <= 0) return alert('Importo non valido.');
    if (!modulo.id && modulo.ente === 'bfm') return alert('Le spese pagate da BFM si registrano nel modulo Spese di BFM: da lì arrivano anche qui.');
    const giaDettagliato = modulo.id ? dettaglioSpesa({ importo }, vociPer[modulo.id]).dettagliato : 0;
    if (importo < giaDettagliato) return alert(`Il dettaglio di questa spesa arriva già a ${euro(giaDettagliato)}: il totale non può essere più basso.`);
    const multi = !!modulo.multicategoria;
    if (!multi && giaDettagliato > 0) return alert('Questo scontrino ha già delle voci: per farne una spesa con una sola categoria toglile prima dal dettaglio.');
    const record = {
      data: modulo.data, importo, descrizione, multicategoria: multi,
      categoria_id: multi ? null : idCategoriaScelta(modulo.categoria, categorie, 'spesa'),
      ente: modulo.ente || null, metodo: modulo.ente === 'albatros' ? (modulo.metodo || 'contanti') : null,
    };
    setInCorso(true);
    try {
      const { data, error } = modulo.id
        ? await supabase.from('albatros_spese').update(record).eq('id', modulo.id).select('id').single()
        : await supabase.from('albatros_spese').insert([{ ...record, creato_da: user.id }]).select('id').single();
      if (error) return alert(`Errore nel salvataggio: ${error.message}`);
      setModulo(null);
      // Uno scontrino si apre subito, pronto per scriverci le voci.
      if (multi) { setEspansa(data.id); setNuovaVoce(VOCE_VUOTA); }
      await carica();
    } finally {
      setInCorso(false);
    }
  };

  const elimina = async (s) => {
    if (s.spesa_bfm_id) return alert('Questa spesa arriva dal modulo Spese di BFM: si toglie da lì, cambiandola da Albatros a BFM o eliminandola.');
    if (s.movimento_id) return alert("Questa spesa è un'uscita del conto in banca: non si toglie.");
    if (!window.confirm(`Eliminare la spesa "${s.descrizione}" di ${euro(s.importo)}?`)) return;
    const { error } = await supabase.from('albatros_spese').delete().eq('id', s.id);
    if (error) return alert(`Errore: ${error.message}`);
    if (modulo?.id === s.id) setModulo(null);
    carica();
  };

  // Segnare pagata una spesa da pagare è come attribuirla: si riempie quello che mancava.
  const segnaPagata = async (s, metodo) => {
    if (!metodo) return;
    const { error } = await supabase.from('albatros_spese').update({ metodo }).eq('id', s.id);
    if (error) return alert(`Errore: ${error.message}`);
    carica();
  };

  // Una spesa dalla banca si modifica sulla riga, come nel modulo Spese di BFM: descrizione e
  // categoria (SCONTRINO = scontrino con più categorie), salvate insieme col pulsante Salva.
  const SCONTRINO = 'scontrino';
  const apriRigaBanca = (s) => setRigaBanca({ id: s.id, descrizione: s.descrizione, categoria: spesaMulticategoria(s) ? SCONTRINO : String(s.categoria_id ?? '') });
  // Il movimento non era una spesa (un giroconto, un errore stornato): si ignora e la spesa se ne va,
  // come "Non è una spesa" nel modulo di BFM. Si ripristina dalla vista Banca.
  const nonEUnaSpesa = async (sp) => {
    if (!window.confirm('Questo movimento non è una spesa? La spesa si elimina e il movimento resta nella vista Banca come ignorato.')) return;
    setInCorso(true);
    try {
      await ignoraSpesa(sp);
      setModulo(null);
      await carica();
    } catch (err) {
      alert(`Errore: ${err.message}`);
    } finally {
      setInCorso(false);
    }
  };

  const salvaRigaBanca = async () => {
    const descrizione = rigaBanca.descrizione.trim();
    if (!descrizione) return alert('Scrivi cosa è stato pagato.');
    const multi = rigaBanca.categoria === SCONTRINO;
    if (!multi && (vociPer[rigaBanca.id] || []).length) return alert('Questo scontrino ha già delle voci: per dargli una sola categoria toglile prima dal dettaglio.');
    setInCorso(true);
    const { error } = await supabase.from('albatros_spese').update({
      descrizione, multicategoria: multi, categoria_id: multi ? null : idCategoriaScelta(rigaBanca.categoria, categorie, 'spesa'),
    }).eq('id', rigaBanca.id);
    setInCorso(false);
    if (error) return alert(`Errore nel salvataggio: ${error.message}`);
    if (multi) { setEspansa(rigaBanca.id); setNuovaVoce(VOCE_VUOTA); }
    setRigaBanca(null);
    carica();
  };

  const attribuisci = async (s, ente) => {
    if (!ente) return;
    // Attribuita ad Albatros, è in contanti finché l'amministratore non dice altrimenti.
    const { error } = await supabase.from('albatros_spese').update({ ente, metodo: ente === 'albatros' ? (s.metodo || 'contanti') : s.metodo }).eq('id', s.id);
    if (error) return alert(`Errore: ${error.message}`);
    carica();
  };

  const apriDettaglio = (s) => {
    setEspansa(espansa === s.id ? null : s.id);
    setNuovaVoce(VOCE_VUOTA);
    setVoceInModifica(null);
  };

  const aggiungiVoce = async (s) => {
    const descrizione = nuovaVoce.descrizione.trim();
    const importo = leggiImporto(nuovaVoce.importo);
    if (!descrizione) return alert('Scrivi cosa è stato comprato.');
    if (!importo || importo <= 0) return alert('Importo non valido.');
    const voci = vociPer[s.id] || [];
    if (!rigaSpesaConsentita(s, voci, importo)) return alert(`Così si supera il totale dello scontrino: restano ${euro(dettaglioSpesa(s, voci).nonDettagliato)} da dettagliare.`);
    setInCorso(true);
    const { error } = await supabase.from('albatros_spese_righe').insert([{
      spesa_id: s.id, descrizione, importo, creato_da: user.id,
      categoria_id: idCategoriaScelta(nuovaVoce.categoria, categorie, 'spesa'),
    }]);
    setInCorso(false);
    if (error) return alert(`Errore nel salvataggio: ${error.message}`);
    // La categoria resta quella di prima: le voci di uno scontrino vengono spesso a gruppi.
    setNuovaVoce({ ...VOCE_VUOTA, categoria: nuovaVoce.categoria });
    carica();
  };

  const apriModificaVoce = (v) => setVoceInModifica({ id: v.id, descrizione: v.descrizione, importo: String(r2(v.importo)).replace('.', ','), categoria: String(v.categoria_id ?? '') });

  const salvaVoce = async (s) => {
    const voce = (vociPer[s.id] || []).find(v => v.id === voceInModifica.id);
    const descrizione = voceInModifica.descrizione.trim();
    const importo = leggiImporto(voceInModifica.importo);
    if (!descrizione) return alert('Scrivi cosa è stato comprato.');
    if (!importo || importo <= 0) return alert('Importo non valido.');
    if (!modificaVoceConsentita(s, vociPer[s.id], voce, importo)) return alert(`Così si supera il totale dello scontrino (${euro(s.importo)}).`);
    setInCorso(true);
    const { error } = await supabase.from('albatros_spese_righe')
      .update({ descrizione, importo, categoria_id: idCategoriaScelta(voceInModifica.categoria, categorie, 'spesa') }).eq('id', voce.id);
    setInCorso(false);
    if (error) return alert(`Errore nel salvataggio: ${error.message}`);
    setVoceInModifica(null);
    carica();
  };

  // Fissa le voci scritte finora: da qui le corregge solo l'amministratore.
  const salvaDettaglio = async (s) => {
    setInCorso(true);
    const { error } = await supabase.from('albatros_spese_righe').update({ salvata: true }).eq('spesa_id', s.id).eq('salvata', false);
    setInCorso(false);
    if (error) return alert(`Errore nel salvataggio: ${error.message}`);
    setVoceInModifica(null);
    carica();
  };

  const togliVoce = async (v) => {
    if (!window.confirm(`Togliere "${v.descrizione}" dal dettaglio?`)) return;
    const { error } = await supabase.from('albatros_spese_righe').delete().eq('id', v.id);
    if (error) return alert(`Errore: ${error.message}`);
    carica();
  };

  const modifica = (s) => {
    setModulo({ id: s.id, data: s.data, importo: String(r2(s.importo)).replace('.', ','), descrizione: s.descrizione, categoria: String(s.categoria_id ?? ''), multicategoria: spesaMulticategoria(s), ente: s.ente || '', metodo: s.metodo || 'contanti', spesaBfm: s.spesa_bfm_id ?? null, daBanca: s.movimento_id != null });
  };

  if (viste.length === 0) return <p className="albatros-avviso">Nessuna vista di questa pagina è abilitata per il tuo ruolo.</p>;
  return (
    <div className="albatros-pagina no-print">
      {/* Il selettore delle viste è quello dei moduli di BFM. */}
      {viste.length > 1 && <nav className="modulo-subnav no-print subnav-segmented" style={{ alignSelf: 'flex-start', marginBottom: 0 }}>
        {viste.map(v => (
          <button key={v.id} type="button" className={`nav-btn ${vista === v.id ? 'active' : ''}`} onClick={() => setVista(v.id)}><Icona nome={v.icona} />{v.label}</button>
        ))}
      </nav>}

      {vista === 'banca' && puoCorreggere && (
        <CaricaEstrattoAlbatros user={user} categorie={categorie} ultimoConto={[...banca.caricamenti].reverse().find(c => c.conto)?.conto || null} onCaricato={carica} />
      )}
      {vista === 'banca' && puoCorreggere && <SpeseNascoste speseBanca={speseDaBanca} onCambiate={carica} />}
      {vista === 'banca' && daCompletareTutte.length > 0 && (
        <div className="albatros-avviso" style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span><strong>{daCompletareTutte.length} {daCompletareTutte.length === 1 ? 'spesa da completare' : 'spese da completare'}</strong> ({euro(daCompletareTutte.reduce((x, sp) => x + num(sp.importo), 0))}): manca la categoria.</span>
          {!soloDaCompletare && <button type="button" className="albatros-chip albatros-chip-avviso" onClick={() => setSoloDaCompletare(true)}>Mostrale</button>}
        </div>
      )}
      {vista === 'banca' && puoCorreggere && commissioniDaUnire.length > 0 && (
        <div className="albatros-avviso" style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span><strong>{commissioniDaUnire.length === 1 ? 'Una commissione è' : `${commissioniDaUnire.length} commissioni sono`}</strong> ancora spese a sé: vanno sommate al loro bonifico o addebito.</span>
          <button type="button" className="albatros-chip albatros-chip-avviso" disabled={inCorso} onClick={unisciCommissioni}>Unisci le commissioni</button>
        </div>
      )}

      {vista === 'cashflow' || vista === 'cassa' ? (
        <Cashflow user={user} categorie={categorie} listino={listino} puoCorreggere={puoCorreggere} modo={vista === 'cassa' ? 'contanti' : 'conti'} />
      ) : vista === 'entrate' ? (
        <div className="albatros-card">
          <div className="albatros-testata" style={{ marginBottom: '12px' }}><FiltroPeriodo periodo={periodo} onChange={setPeriodo} /></div>
          <EntrateBanca user={user} banca={banca} puoCorreggere={puoCorreggere} onCambiati={carica} nelPeriodo={(d) => d >= da && d <= al} />
        </div>
      ) : vista === 'movimenti' ? (
        <div className="albatros-card">
          <div className="albatros-testata" style={{ marginBottom: '12px' }}><FiltroPeriodo periodo={periodo} onChange={setPeriodo} /></div>
          <MovimentiBanca user={user} categorie={categorie} banca={banca} puoCorreggere={puoCorreggere} onCambiati={carica} nelPeriodo={(d) => d >= da && d <= al} />
        </div>
      ) : (
      <div className="albatros-card">
        {/* Nella Cassa, in cima alle spese, i contanti in mano: lo stesso riquadro del Cashflow. */}
        {vista === 'contanti' && moduloPagina === 'cassa' && contantiInMano != null && (
          <div className="albatros-cifre" style={{ marginTop: 0, marginBottom: '14px', gridTemplateColumns: 'minmax(0, 340px)' }}>
            <div className="albatros-cifra-saldo"><span>Contanti in mano</span><strong>{euro(contantiInMano)}</strong><small>ritirati − spese e pagamenti in contanti ± versamenti, prelievi e acconti</small></div>
          </div>
        )}
        <div className="albatros-testata filtri-telefono">
          {vista !== 'dettagliare' && <FiltroPeriodo periodo={periodo} onChange={setPeriodo} />}
          {vista === 'dettagliare' && <p className="albatros-nota" style={{ margin: 0, alignSelf: 'center' }}>Gli scontrini pagati con carta (arrivati dalla banca) non ancora dettagliati del tutto, di qualunque periodo. Tocca la riga e aggiungi le voci.</p>}
          {vista === 'trasferimenti' && (
            <div style={{ marginLeft: 'auto', textAlign: 'right', fontSize: '0.88rem' }}>
              <div>Prelevati dal conto: <strong>{euro(trasferimentiBanca.filter(t => t.da === 'conto').reduce((x, t) => x + num(t.importo), 0))}</strong></div>
              <div className="albatros-tenue">versati sul conto {euro(trasferimentiBanca.filter(t => t.da === 'contanti').reduce((x, t) => x + num(t.importo), 0))}</div>
            </div>
          )}
          {vista !== 'trasferimenti' && (<>
          <label className="albatros-etichetta" style={{ flex: '0 1 160px' }}>Pagata da
            <select value={filtroEnte} onChange={(e) => setFiltroEnte(e.target.value)} className="albatros-campo">
              <option value="">Tutti</option>
              {ENTI.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
              <option value="nessuno">Da attribuire</option>
            </select>
          </label>
          <label className="albatros-etichetta" style={{ flex: '0 1 170px' }}>Categoria
            <select value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value)} className="albatros-campo">
              <option value="">Tutte</option>
              {alberoCategorie(categorie, 'spesa', { ancheArchiviate: true }).map(c => [
                <option key={c.id} value={String(c.id)}>{c.nome}{c.attiva ? '' : ' (archiviata)'}</option>,
                ...c.figlie.map(x => <option key={x.id} value={String(x.id)}>{`  › ${x.nome}`}{x.attiva ? '' : ' (archiviata)'}</option>),
              ])}
              <option value="nessuna">Senza categoria</option>
            </select>
          </label>
          <label className="albatros-etichetta filtro-largo" style={{ flex: '1 1 180px' }}>Cerca
            <input type="search" value={cerca} placeholder="Descrizione, voce, categoria…" onChange={(e) => setCerca(e.target.value)} className="albatros-campo" />
          </label>
          {vista === 'contanti' && <button type="button" className="btn-accent-inline albatros-bottone" style={{ alignSelf: 'flex-end' }} onClick={() => setModulo(SPESA_VUOTA())}>+ Nuova spesa</button>}
          {/* Gli stati vanno a capo, in una riga loro con i totali a destra, come nel modulo Spese di BFM. */}
          <div style={{ flexBasis: '100%', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" className={`albatros-chip albatros-chip-avviso ${filtroEnte === 'nessuno' ? 'attivo' : ''}`}
              disabled={filtroEnte !== 'nessuno' && daAttribuire.length === 0} onClick={() => setFiltroEnte(filtroEnte === 'nessuno' ? '' : 'nessuno')}>
              Da attribuire ({daAttribuire.length})
            </button>
            <button type="button" className={`albatros-chip albatros-chip-avviso ${filtroEnte === 'dapagare' ? 'attivo' : ''}`}
              disabled={filtroEnte !== 'dapagare' && daPagare.length === 0} onClick={() => setFiltroEnte(filtroEnte === 'dapagare' ? '' : 'dapagare')}>
              Da pagare ({daPagare.length})
            </button>
            {(vista === 'banca' || vista === 'tutte') && (
              <button type="button" className={`albatros-chip albatros-chip-avviso ${soloDaCompletare ? 'attivo' : ''}`}
                disabled={!soloDaCompletare && !speseVista.some(daCompletareBanca)} onClick={() => setSoloDaCompletare(!soloDaCompletare)}>
                Da completare ({speseVista.filter(daCompletareBanca).length})
              </button>
            )}
            {(vista === 'banca' || vista === 'tutte') && (
              <button type="button" className={`albatros-chip albatros-chip-avviso ${soloDaDettagliare ? 'attivo' : ''}`}
                disabled={!soloDaDettagliare && !speseVista.some(daDettagliare)} onClick={() => setSoloDaDettagliare(!soloDaDettagliare)}>
                Da dettagliare ({speseVista.filter(daDettagliare).length})
              </button>
            )}
            <div style={{ marginLeft: 'auto', textAlign: 'right', fontSize: '0.88rem' }}>
              <div>{vista === 'dettagliare' ? 'Da dettagliare' : `Spese ${dicituraPeriodo(periodo, 'del')}`}: <strong>{euro(vista === 'dettagliare' ? visibili.reduce((t, sp) => t + dettaglioSpesa(sp, vociPer[sp.id]).nonDettagliato, 0) : totale(visibili))}</strong></div>
              {!filtroEnte && (
                <div className="albatros-tenue">{[...ENTI.map(e => `${e.label} ${euro(totale(speseVista.filter(s => s.ente === e.id)))}`), ...(daAttribuire.length ? [`da attribuire ${euro(totale(daAttribuire))}`] : [])].join(' · ')}</div>
              )}
            </div>
            </div>
          </>)}
        </div>

        {vista !== 'trasferimenti' && visibili.length === 0 && <p className="albatros-vuoto">{vista === 'banca' ? 'Nessuna spesa dalla banca in questo periodo.' : vista === 'bfm' ? 'Nessuna spesa dal conto di BFM in questo periodo: si scrivono nel modulo Spese di BFM.' : vista === 'dettagliare' ? 'Nessuno scontrino da dettagliare.' : 'Nessuna spesa.'}</p>}
        {vista === 'trasferimenti' && (
          <div style={{ marginTop: '12px' }}>
            {puoCorreggere && doppi.length > 0 && (
              <div className="albatros-avviso" style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '12px' }}>
                <span><strong>{doppi.length === 1 ? 'Un trasferimento è contato due volte' : `${doppi.length} trasferimenti sono contati due volte`}</strong>: scritto a mano nel Cashflow e arrivato dalla banca ({doppi.map(d => `${euro(d.manuale.importo)} del ${formattaDataGGMMAAAA(d.manuale.data)}`).join(', ')}). Si tiene quello scritto a mano, legato al movimento.</span>
                <button type="button" className="albatros-chip albatros-chip-avviso" disabled={inCorso} onClick={riunisciTrasferimenti}>Unisci</button>
              </div>
            )}
            <p className="albatros-nota" style={{ marginTop: 0 }}>Non sono spese: spostano i soldi fra il conto e i contanti in mano, e il saldo di Albatros non cambia. I prelievi arrivano dall'estratto conto; gli altri si scrivono nel Cashflow.</p>
            {trasferimentiBanca.length === 0 && <p className="albatros-vuoto">Nessun trasferimento {dicituraPeriodo(periodo, 'in')}.</p>}
            {trasferimentiBanca.map(t => (
              <div key={t.id} className="albatros-riga">
                <div className="albatros-riga-testo">
                  <strong>{formattaDataGGMMAAAA(t.data)}</strong> · {t.da === 'conto' ? 'Prelievo dal conto in contanti' : 'Versamento dei contanti sul conto'}
                  {t.note && <span className="albatros-tenue"> · {t.note}</span>}
                  <span className="albatros-badge mini" style={{ marginLeft: '6px', background: '#f1f5f9', color: '#475569' }}>{t.movimento_id ? 'dalla banca' : 'dal Cashflow'}</span>
                </div>
                <div className="albatros-riga-importo">{euro(t.importo)}</div>
              </div>
            ))}
          </div>
        )}
        {visibili.length > 0 && (
          <div style={{ overflowX: 'auto', marginTop: '12px' }}>
            <table className="albatros-tabella tabella-schede">
              <thead>
                <tr><th>Data</th><th>Cosa</th>{vista === 'tutte' && <th>Origine</th>}<th>Categoria</th><th>Pagata da</th><th className="num">Importo</th><th>Scritta da</th>{puoCorreggere && <th></th>}</tr>
              </thead>
              <tbody>
                {visibili.map(s => {
                  const voci = vociPer[s.id] || [];
                  const det = dettaglioSpesa(s, voci);
                  const aperta = espansa === s.id;
                  // Si apre uno scontrino, o una spesa che ha già delle voci da vedere.
                  const dettagliabile = spesaDettagliabile(s);
                  const categorieVoci = [...new Set(voci.map(v => nomeCategoria(categorie, v.categoria_id)))];
                  // Con un filtro per categoria, di uno scontrino si vedono solo le voci di quella categoria.
                  const filtraVoci = !!filtroCategoria && filtroCategoria !== DA_DETTAGLIARE && spesaMulticategoria(s);
                  const vociMostrate = filtraVoci ? voci.filter(v => idsFiltro.includes(v.categoria_id ?? null)) : voci;
                  const altreVoci = voci.filter(v => !vociMostrate.includes(v));
                  const apribile = dettagliabile || voci.length > 0;
                  const inModifica = rigaBanca?.id === s.id;
                  return (
                  <Fragment key={s.id}>
                  <tr onClick={() => apribile && !rigaBanca && apriDettaglio(s)} className={aperta ? 'selezionata' : ''} title={apribile ? 'Apri il dettaglio' : undefined} style={{ cursor: apribile ? 'pointer' : 'default' }}>
                    <td className="sk-sx" style={{ whiteSpace: 'nowrap' }}><span className={`riga-espandibile-chevron ${aperta ? 'aperta' : ''}`}>{apribile ? '▸' : ''}</span>{formattaDataGGMMAAAA(s.data)}{ncDi.has(s.movimento_id) && <span className="albatros-badge mini aperta" style={{ marginLeft: '6px' }} title="Operazione non ancora contabilizzata dalla banca: diventa definitiva col prossimo estratto conto">NC</span>}</td>
                    <td className="sk-testo" onClick={(e) => inModifica && e.stopPropagation()}>
                      {inModifica
                        ? <input type="text" value={rigaBanca.descrizione} autoFocus onChange={(e) => setRigaBanca({ ...rigaBanca, descrizione: e.target.value })} className="albatros-campo albatros-categoria-riga" />
                        : s.descrizione}
                      {vista !== 'tutte' && s.spesa_bfm_id && <span className="albatros-badge mini" style={{ marginLeft: '6px', background: '#e0f2fe', color: '#075985' }} title="Arriva dal modulo Spese di BFM (conto corrente): data, importo e descrizione si cambiano lì">Dal conto BFM</span>}
                      {daCompletareBanca(s) && <span className="albatros-badge mini da-specificare" style={{ marginLeft: '6px' }} title="Spesa dalla banca senza categoria: aprila con la matita e sceglila">Da completare</span>}
                      {dettagliabile && voci.length === 0 && <span className="albatros-badge mini da-specificare" style={{ marginLeft: '6px' }} title="Scontrino da dettagliare: tocca la riga e aggiungi le voci">Da dettagliare</span>}
                      {voci.length > 0 && <span className={`albatros-badge mini ${det.nonDettagliato > 0 ? 'da-specificare' : 'chiusa'}`} style={{ marginLeft: '6px' }}>{det.nonDettagliato > 0 && dettagliabile ? 'Da dettagliare · ' : ''}{voci.length} {voci.length === 1 ? 'voce' : 'voci'} · {Math.round(det.quota * 100)}%</span>}
                    </td>
                    {/* Nel Cruscotto, da dove arriva la spesa, in una colonna sua. */}
                    {vista === 'tutte' && (
                      <td className="sk-mezzo" data-etichetta="Origine" style={{ whiteSpace: 'nowrap' }}>
                        <span className="albatros-badge mini" style={s.spesa_bfm_id ? { background: '#e0f2fe', color: '#075985' } : { background: '#f1f5f9', color: '#475569' }}>
                          {s.spesa_bfm_id ? 'Conto BFM' : s.movimento_id != null ? 'Banca' : 'A mano'}
                        </span>
                      </td>
                    )}
                    <td className="sk-mezzo" data-etichetta="Categoria" onClick={(e) => inModifica && e.stopPropagation()}>{inModifica
                      ? <select value={rigaBanca.categoria} onChange={(e) => setRigaBanca({ ...rigaBanca, categoria: e.target.value })} className="albatros-campo albatros-categoria-riga">
                          {alberoCategorie(categorie, 'spesa').filter(c => !c.gruppo || c.figlie.length).map(c => (c.gruppo
                            ? <optgroup key={c.id} label={c.nome}>{c.figlie.map(x => <option key={x.id} value={String(x.id)}>{x.nome}</option>)}</optgroup>
                            : <option key={c.id} value={String(c.id)}>{c.nome}</option>))}
                          <option value="">Senza categoria</option>
                          <option value={SCONTRINO}>Scontrino con più categorie</option>
                        </select>
                      : spesaMulticategoria(s)
                      ? <span className="albatros-tenue" title={categorieVoci.join(', ') || 'Ancora nessuna voce'}>Multicategoria</span>
                      : nomeCategoria(categorie, s.categoria_id)}</td>
                    <td className="sk-mezzo" data-etichetta="Pagata da" onClick={(e) => e.stopPropagation()}>
                      {s.ente ? <>{etichettaEnte(s.ente)}{s.ente === 'albatros' && (spesaDaPagare(s)
                        ? <> <select value="" onChange={(e) => segnaPagata(s, e.target.value)} className="albatros-badge-select" title="Quando è pagata, scegli con cosa">
                            <option value="">Da pagare</option>
                            <option value="contanti">Pagata in contanti</option>
                            <option value="carta" title="Sparisce finché il suo movimento non arriva dall'estratto conto, e allora le si lega">Pagata dalla banca</option>
                          </select></>
                        : <span className="albatros-tenue"> · {etichettaMetodoSpesa(s)}</span>)}</> : (
                        <select value="" onChange={(e) => attribuisci(s, e.target.value)} className="albatros-badge-select" title="Scegli chi l'ha pagata">
                          <option value="">Da attribuire</option>
                          {ENTI_SCEGLIBILI.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
                        </select>
                      )}
                    </td>
                    <td className="num sk-dx">
                      {/* Come nel modulo Spese di BFM: le commissioni a parte, davanti all'importo della spesa. */}
                      {oneriPer.get(s.id) > 0 && !filtroCategoria
                        ? <span title={`${euro(r2(num(s.importo) - oneriPer.get(s.id)))} di spesa + ${euro(oneriPer.get(s.id))} di oneri bancari`}><span className="albatros-tenue">{euro(oneriPer.get(s.id))} + </span><strong>{euro(r2(num(s.importo) - oneriPer.get(s.id)))}</strong></span>
                        : <strong>{euro(importo(s))}</strong>}
                      {importo(s) !== r2(num(s.importo)) && <div className="albatros-tenue" style={{ fontSize: '0.75rem' }}>su {euro(s.importo)}</div>}
                    </td>
                    <td className="albatros-tenue sk-mezzo" data-etichetta="Scritta da" style={{ whiteSpace: 'nowrap' }}>{utenti[s.creato_da] || '—'}</td>
                    {puoCorreggere && (
                      <td className="sk-azioni" style={{ whiteSpace: 'nowrap', textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                        {inModifica ? (
                          <>
                            <button type="button" className="btn-accent-inline" disabled={inCorso} onClick={salvaRigaBanca} style={{ display: 'inline-flex', alignItems: 'center', fontSize: '0.78rem', padding: '3px 8px', marginRight: '4px' }}><Icona nome="salva" size={13} style={{ marginRight: '4px' }} />Salva</button>
                            <button type="button" className="btn-outline-annulla" disabled={inCorso} onClick={() => setRigaBanca(null)} style={{ display: 'inline-flex', alignItems: 'center', fontSize: '0.78rem', padding: '3px 8px', borderRadius: '4px' }}><Icona nome="annulla" size={13} style={{ marginRight: '4px' }} />Annulla</button>
                          </>
                        ) : (
                          <button type="button" className="btn-icon-action" title={rigaBanca ? 'Finisci prima la riga che stai modificando' : 'Modifica'} disabled={!!rigaBanca}
                            onClick={() => (s.movimento_id ? apriRigaBanca(s) : modifica(s))} style={{ marginRight: '4px' }}><Icona nome="modifica" size={14} style={{ marginRight: 0 }} /></button>
                        )}
                        {!inModifica && s.movimento_id && <button type="button" className="btn-icon-action" title="Apri la spesa" disabled={!!rigaBanca} onClick={() => modifica(s)}><Icona nome="apri" size={14} style={{ marginRight: 0 }} /></button>}
                        {!inModifica && !s.spesa_bfm_id && !s.movimento_id && <button type="button" className="btn-icon-action danger" title="Elimina" onClick={() => elimina(s)}><Icona nome="elimina" size={14} style={{ marginRight: 0 }} /></button>}
                      </td>
                    )}
                  </tr>
                  {aperta && (
                    <tr className="albatros-dettaglio-riga">
                      <td colSpan={(puoCorreggere ? 7 : 6) + (vista === 'tutte' ? 1 : 0)}>
                        {voci.length === 0 && dettagliabile && <p className="albatros-vuoto" style={{ marginTop: 0 }}>Nessuna voce: aggiungi qui sotto cosa c'è nello scontrino.</p>}
                        {vociMostrate.map(v => (voceInModifica?.id === v.id ? (
                          <div key={v.id} className="albatros-form-voce-spesa albatros-voce-in-modifica">
                            <input type="text" value={voceInModifica.descrizione} autoFocus onChange={(e) => setVoceInModifica({ ...voceInModifica, descrizione: e.target.value })} className="albatros-campo" />
                            <input type="text" inputMode="decimal" value={voceInModifica.importo} onChange={(e) => setVoceInModifica({ ...voceInModifica, importo: e.target.value })}
                              onKeyDown={(e) => e.key === 'Enter' && salvaVoce(s)} className="albatros-campo albatros-importo" />
                            <SceltaCategoria categorie={categorie} tipo="spesa" valore={voceInModifica.categoria} onChange={(x) => setVoceInModifica({ ...voceInModifica, categoria: x })} />
                            <span style={{ display: 'flex', gap: '6px' }}>
                              <button type="button" className="btn-outline-annulla albatros-bottone" onClick={() => setVoceInModifica(null)}>Annulla</button>
                              <button type="button" className="btn-accent-inline albatros-bottone" disabled={inCorso} onClick={() => salvaVoce(s)}>OK</button>
                            </span>
                          </div>
                        ) : (
                          <div key={v.id} className="albatros-riga">
                            <div className="albatros-riga-testo">
                              {v.descrizione}
                              <span className="albatros-tenue"> · {nomeCategoria(categorie, v.categoria_id)}</span>
                              {voceDaSalvare(v) && <span className="albatros-badge mini da-specificare" style={{ marginLeft: '6px' }}>da salvare</span>}
                            </div>
                            <div className="albatros-riga-importo">{euro(v.importo)}</div>
                            {voceCorreggibile(v, puoCorreggere) && (
                              <button type="button" className="btn-icon-action" title="Correggi la voce" disabled={inCorso} onClick={() => apriModificaVoce(v)}>
                                <Icona nome="modifica" size={14} style={{ marginRight: 0 }} />
                              </button>
                            )}
                            {voceCorreggibile(v, puoCorreggere) && <button type="button" className="btn-icon-action danger" title="Togli la voce" disabled={inCorso} onClick={() => togliVoce(v)}><Icona nome="elimina" size={14} style={{ marginRight: 0 }} /></button>}
                          </div>
                        )))}
                        {altreVoci.length > 0 && (
                          <p className="albatros-nota" style={{ marginTop: '6px' }}>
                            E {altreVoci.length} {altreVoci.length === 1 ? 'voce' : 'voci'} di altre categorie ({euro(altreVoci.reduce((t, v) => t + num(v.importo), 0))}), nascoste dal filtro.
                          </p>
                        )}
                        <div className="albatros-voce-q" style={{ marginTop: '6px' }}><span>Dettagliato</span><span>{euro(det.dettagliato)} di {euro(det.totale)}</span></div>
                        <div className="albatros-voce-q" style={{ fontWeight: 700, color: det.nonDettagliato > 0 ? '#b45309' : '#15803d' }}>
                          <span>{det.nonDettagliato > 0 ? 'Non dettagliato' : 'Tutto dettagliato'}</span><span>{euro(det.nonDettagliato)}</span>
                        </div>
                        {!dettagliabile && <p className="albatros-nota">Questa spesa ha una sola categoria: le voci qui sopra si possono solo vedere.</p>}
                        {dettagliabile && det.nonDettagliato > 0 && (
                          <div className="albatros-form-voce-spesa">
                            <input type="text" value={nuovaVoce.descrizione} placeholder="Cosa (es. detersivi)" autoFocus
                              onChange={(e) => setNuovaVoce({ ...nuovaVoce, descrizione: e.target.value })} className="albatros-campo" />
                            <input type="text" inputMode="decimal" value={nuovaVoce.importo} placeholder={String(det.nonDettagliato).replace('.', ',')}
                              onChange={(e) => setNuovaVoce({ ...nuovaVoce, importo: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && aggiungiVoce(s)} className="albatros-campo albatros-importo" />
                            <SceltaCategoria categorie={categorie} tipo="spesa" valore={nuovaVoce.categoria} onChange={(v) => setNuovaVoce({ ...nuovaVoce, categoria: v })} />
                            <button type="button" className="btn-accent-inline albatros-bottone" disabled={inCorso} onClick={() => aggiungiVoce(s)}>+ Voce</button>
                          </div>
                        )}
                        {voci.some(voceDaSalvare) && (
                          <div className="albatros-salva-dettaglio">
                            <span className="albatros-nota" style={{ margin: 0 }}>Finché non salvi puoi correggere e togliere le voci nuove; dopo le corregge solo l'amministratore.</span>
                            <button type="button" className="btn-accent-inline albatros-bottone" disabled={inCorso} onClick={() => salvaDettaglio(s)}><Icona nome="salva" />Salva il dettaglio</button>
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
        )}
      </div>
      )}

      {modulo && (
        <div className="modal-form-backdrop" onClick={() => setModulo(null)}>
          <div className="modal-form-box albatros-overlay" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-form-close" aria-label="Chiudi" onClick={() => setModulo(null)}>✕</button>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '1.1rem', color: '#0f172a' }}>{modulo.id ? 'Modifica spesa' : 'Nuova spesa'}</h3>
            {modulo.daBanca && (() => {
              const mov = banca.movimenti.find(m => m.id === spese.find(x => x.id === modulo.id)?.movimento_id);
              const oneri = oneriPer.get(modulo.id) || 0;
              return mov ? (
                <div className="albatros-nota" style={{ margin: '0 0 12px 0', padding: '8px 10px', background: '#f8fafc', borderRadius: '6px' }}>
                  <strong>Dall'estratto conto</strong> · {formattaDataGGMMAAAA(mov.data_contabile)} · {mov.tipo} · {euro(-Number(mov.importo))}
                  <div style={{ marginTop: '4px', wordBreak: 'break-word' }}>{mov.descrizione || '—'}</div>
                  {oneri > 0 && <div style={{ marginTop: '4px' }}>Oneri bancari: <strong>{euro(oneri)}</strong> · uscito dal conto in tutto {euro(-Number(mov.importo) + oneri)}</div>}
                </div>
              ) : null;
            })()}
            <div className="albatros-griglia-2">
              <label className="albatros-etichetta">Data
                <input type="date" value={modulo.data} disabled={!!modulo.spesaBfm || modulo.daBanca} onChange={(e) => setModulo({ ...modulo, data: e.target.value })} className="albatros-campo" />
              </label>
              <label className="albatros-etichetta">Importo €
                <input type="text" inputMode="decimal" value={modulo.importo} placeholder="0,00" disabled={!!modulo.spesaBfm || modulo.daBanca} onChange={(e) => setModulo({ ...modulo, importo: e.target.value })} className="albatros-campo albatros-importo" />
              </label>
              <label className="albatros-etichetta" style={{ gridColumn: '1 / -1' }}>Cosa
                <input type="text" value={modulo.descrizione} autoFocus={!modulo.spesaBfm && !modulo.daBanca} disabled={!!modulo.spesaBfm || modulo.daBanca} placeholder="Es. spesa Esselunga, lampadina campo 2" onChange={(e) => setModulo({ ...modulo, descrizione: e.target.value })} className="albatros-campo" />
              </label>
              {!modulo.spesaBfm && (
                <label className="albatros-etichetta">Tipo
                  <select value={modulo.multicategoria ? 'scontrino' : 'semplice'} onChange={(e) => setModulo({ ...modulo, multicategoria: e.target.value === 'scontrino' })} className="albatros-campo">
                    <option value="semplice">Una categoria</option>
                    <option value="scontrino">Scontrino con più categorie</option>
                  </select>
                </label>
              )}
              {!modulo.multicategoria && (
                <label className="albatros-etichetta">Categoria
                  <SceltaCategoria categorie={categorie} tipo="spesa" valore={modulo.categoria} onChange={(v) => setModulo({ ...modulo, categoria: v })} />
                </label>
              )}
              <label className="albatros-etichetta">Pagata da
                <select value={modulo.ente} disabled={!!modulo.spesaBfm || modulo.daBanca} onChange={(e) => setModulo({ ...modulo, ente: e.target.value })} className="albatros-campo">
                  <option value="">Da attribuire</option>
                  {/* BFM resta solo per mostrare una spesa che è già sua. */}
                  {ENTI.filter(e => e.id !== 'bfm' || modulo.ente === 'bfm').map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
                </select>
              </label>
              {modulo.ente === 'albatros' && !modulo.daBanca && (
                <label className="albatros-etichetta">Pagata con
                  <select value={modulo.metodo} onChange={(e) => setModulo({ ...modulo, metodo: e.target.value })} className="albatros-campo">
                    {/* Una spesa con carta scritta a mano prima resta carta finché non arriva il suo movimento. */}
                    {[...METODI_SPESA, ...(modulo.metodo === 'carta' ? [{ id: 'carta', label: 'Carta' }] : [])].map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </label>
              )}
            </div>
            {modulo.multicategoria && <p className="albatros-nota">Le categorie si danno alle voci dello scontrino: salvato, si apre il dettaglio per scriverle (anche più tardi, anche in parte).</p>}
            {modulo.spesaBfm && <p className="albatros-nota">Arriva dal modulo Spese di BFM: è un'uscita del conto corrente, oneri bancari compresi. Qui scegli la categoria di Albatros; data, importo e descrizione si cambiano nel modulo Spese.</p>}
            {modulo.daBanca && <p className="albatros-nota">È un'uscita del conto di Albatros, arrivata dall'estratto conto: data, importo e descrizione sono quelli della banca. Qui scegli la categoria, o se è uno scontrino con più categorie.</p>}
            {!modulo.id && <p className="albatros-nota">Qui si scrivono le spese in contanti (o da pagare). Quelle con carta o bonifico arrivano dall'estratto conto, nella vista Spese; quelle pagate da BFM dal modulo Spese di BFM.</p>}
            {!puoCorreggere && <p className="albatros-nota">Una spesa aggiunta non si può più cambiare né togliere: in caso di errore avvisa l'amministratore.</p>}
            <div style={{ display: 'flex', gap: '10px', marginTop: '16px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              {modulo.daBanca && puoCorreggere && <button type="button" className="btn-outline-annulla albatros-bottone" style={{ marginRight: 'auto' }} disabled={inCorso} onClick={() => nonEUnaSpesa(spese.find(x => x.id === modulo.id))}>Non è una spesa</button>}
              <button type="button" className="btn-outline-annulla albatros-bottone" onClick={() => setModulo(null)}>Annulla</button>
              <button type="button" className="btn-accent-inline albatros-bottone" disabled={inCorso} onClick={salva}><Icona nome="salva" />{modulo.id ? 'Salva' : 'Aggiungi spesa'}</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default Spese
