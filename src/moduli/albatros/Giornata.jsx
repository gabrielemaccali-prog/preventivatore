import { useState, useEffect, useRef, useMemo } from 'react'
import { supabase } from '../../lib/supabaseClient'
import Icona from '../../components/Icona'
import { formattaDataGGMMAAAA } from '../../lib/utils'
import {
  categorieDi, idCategoriaScelta, num, r2, euro, giornataDiLavoro,
  quadratura, fondoProposto, fondoDaSpecificare, ENTI_RITIRO, etichettaEnte, chiusuraModificabile, cassaScrivibile, composizioneCorreggibile, aggiuntaConsentita, sommaRighe, totaleRiga, rigaDaIncrementare, vociFrequenti, voceDiNome,
} from './calcolo'
import SceltaCategoria from './SceltaCategoria'
import IconaCategoria from './IconaCategoria'

// ============================================================
// La giornata del centro (scheda Giornata; l'elenco delle chiusure sta in StoricoChiusure).
// Durante la serata si toccano le voci del listino e si forma il
// "battuto", il preventivo di quanto dovrebbe esserci in cassa. A fine serata "Chiudi la giornata"
// apre la chiusura: si scrivono POS e tutti i contanti contati, si conferma il fondo cassa con cui
// si era partiti e si dice quanto se ne lascia per domani; il resto lo ritira Lama o BFM. L'incasso
// si confronta col battuto e, se avanza un residuo, lo si può spiegare con altre voci.
//
// Finché la giornata è aperta la composizione si modifica liberamente. Chiusa, il totale è fissato
// da POS e contanti: si possono ancora aggiungere voci per spiegare il residuo, senza superarlo,
// ma togliere righe, correggere POS e contanti e riaprire (dalla scheda Chiusure) spetta
// all'amministratore.
// ============================================================

// I campi in euro sono testo con tastiera numerica: sul telefono la virgola è il separatore
// che viene naturale, e un input type="number" la rifiuta o la perde a seconda del browser.
const leggiImporto = (v) => {
  const s = String(v ?? '').trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? r2(n) : NaN;
};
const mostraImporto = (n) => (n == null ? '' : String(r2(n)).replace('.', ','));
const RIGA_VUOTA = { nome: '', quantita: '1', prezzo: '', categoria: null };
const oraDi = (ts) => (ts ? new Date(ts).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

// Una voce scritta a mano: dal listino col suo prezzo, oppure nuova (entra nel listino).
// `onAggiungi` riceve { nome, quantita, prezzo, categoria } e risponde true se è andata.
function FormVoce({ listino, categorie, inCorso, onAggiungi, prezzoProposto }) {
  const [riga, setRiga] = useState(RIGA_VUOTA);
  const inputVoce = useRef(null);
  const voceScelta = voceDiNome(listino, riga.nome);
  const proposto = voceScelta ? mostraImporto(voceScelta.prezzo) : (prezzoProposto ?? '');
  const aggiungi = async () => {
    if (!riga.nome.trim()) { inputVoce.current?.focus(); return; }
    if (await onAggiungi({ ...riga, prezzo: riga.prezzo || (voceScelta ? '' : proposto) })) {
      setRiga(RIGA_VUOTA);
      inputVoce.current?.focus();
    }
  };
  return (
    <>
      <div className="albatros-form-riga">
        <label className="albatros-etichetta albatros-col-voce">Voce
          <input ref={inputVoce} type="text" list="albatros-voci" value={riga.nome} placeholder="Es. Caffè, Campo 1h"
            onChange={(e) => setRiga({ ...riga, nome: e.target.value })} className="albatros-campo" />
        </label>
        <label className="albatros-etichetta albatros-col-qta">Quantità
          <input type="text" inputMode="decimal" value={riga.quantita} onChange={(e) => setRiga({ ...riga, quantita: e.target.value })} className="albatros-campo albatros-importo" />
        </label>
        <label className="albatros-etichetta albatros-col-qta">Prezzo €
          <input type="text" inputMode="decimal" value={riga.prezzo} placeholder={proposto}
            className={`albatros-campo albatros-importo ${proposto && !riga.prezzo ? 'valore-proposto' : ''}`}
            onChange={(e) => setRiga({ ...riga, prezzo: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && aggiungi()} />
        </label>
        {riga.nome.trim() && !voceScelta && (
          <label className="albatros-etichetta albatros-col-qta">Categoria
            <SceltaCategoria categorie={categorie} tipo="listino" valore={riga.categoria} onChange={(v) => setRiga({ ...riga, categoria: v })} />
          </label>
        )}
        <button type="button" className="btn-accent-inline albatros-bottone" disabled={inCorso} onClick={aggiungi}>+ Aggiungi</button>
      </div>
      {riga.nome.trim() && !voceScelta && <p className="albatros-nota">"{riga.nome.trim()}" è una voce nuova: entrerà nel listino col prezzo che scrivi.</p>}
    </>
  );
}

// La data la tiene il modulo: la scheda Chiusure apre qui la giornata che si tocca nell'elenco.
function Giornata({ user, listino, ricaricaListino, categorie, utenti, puoCorreggere, data, setData }) {
  const [chiusura, setChiusura] = useState(null);
  // L'ultima chiusura prima di questa giornata con un fondo lasciato: da lì parte il fondo.
  const [precedente, setPrecedente] = useState(null);
  const [righe, setRighe] = useState([]);
  const [recenti, setRecenti] = useState([]);
  const [righeRecenti, setRigheRecenti] = useState([]);
  const [filtro, setFiltro] = useState(null);
  const [cerca, setCerca] = useState('');
  const [altraVoce, setAltraVoce] = useState(false);
  // La chiusura in corso: null = overlay chiuso; altrimenti i valori scritti, salvati solo alla conferma.
  const [inChiusura, setInChiusura] = useState(null);
  // Il fondo cassa di una giornata già chiusa che non ce l'ha: null = finestra chiusa.
  const [inFondo, setInFondo] = useState(null);
  const [inCorso, setInCorso] = useState(false);

  const caricaGiorno = async (giorno) => {
    const { data: ch } = await supabase.from('albatros_chiusure').select('*').eq('data', giorno).maybeSingle();
    const [rg, pr] = await Promise.all([
      ch ? supabase.from('albatros_righe').select('*').eq('chiusura_id', ch.id).order('id') : Promise.resolve({ data: [] }),
      supabase.from('albatros_chiusure').select('*').lt('data', giorno).not('fondo_lasciato', 'is', null)
        .order('data', { ascending: false }).limit(1).maybeSingle(),
    ]);
    setChiusura(ch || null);
    setRighe(rg.data || []);
    setPrecedente(pr.data || null);
  };

  // Le ultime chiusure: servono per le voci più usate e per segnalare le giornate rimaste aperte.
  const caricaRecenti = async () => {
    const { data: ch } = await supabase.from('albatros_chiusure').select('*').order('data', { ascending: false }).limit(60);
    const elenco = ch || [];
    if (elenco.length === 0) { setRecenti([]); setRigheRecenti([]); return; }
    const { data: rg } = await supabase.from('albatros_righe').select('*').in('chiusura_id', elenco.map(c => c.id));
    const tutteRighe = rg || [];
    setRigheRecenti(tutteRighe);
    setRecenti(elenco.map(c => ({ chiusura: c, ...quadratura(c, tutteRighe.filter(r => r.chiusura_id === c.id)) })));
  };

  useEffect(() => { caricaGiorno(data); }, [data]);
  useEffect(() => { caricaRecenti(); }, []);

  const ricarica = async () => { await Promise.all([caricaGiorno(data), caricaRecenti()]); };

  const aperta = chiusuraModificabile(chiusura);
  const correggibile = composizioneCorreggibile(chiusura, puoCorreggere);
  const q = quadratura(chiusura, righe);
  const voci = useMemo(() => new Map(listino.map(v => [v.id, v])), [listino]);
  const frequenti = useMemo(() => vociFrequenti(righeRecenti, listino, 16), [righeRecenti, listino]);
  const giornateAperte = recenti.filter(g => !g.chiusura.chiusa_il && g.chiusura.data < giornataDiLavoro());

  // La griglia: le voci attive, filtrate per "più usate", per categoria o per nome.
  const catListino = categorieDi(categorie, 'listino');
  const categoriaDi = (voce) => categorie.find(c => c.id === voce?.categoria_id);
  const filtroAttivo = filtro ?? (frequenti.length > 0 ? 'frequenti' : 'tutte');
  const griglia = useMemo(() => {
    const posizione = new Map(catListino.map((c, i) => [c.id, i]));
    const testo = cerca.trim().toLowerCase();
    const base = testo ? listino.filter(v => v.attiva && v.nome.toLowerCase().includes(testo))
      : filtroAttivo === 'frequenti' ? frequenti
        : listino.filter(v => v.attiva && (filtroAttivo === 'tutte' || String(v.categoria_id) === filtroAttivo));
    return filtroAttivo === 'frequenti' && !testo ? base : [...base].sort((a, b) =>
      (posizione.get(a.categoria_id) ?? 999) - (posizione.get(b.categoria_id) ?? 999) || a.nome.localeCompare(b.nome));
  }, [listino, frequenti, catListino, filtroAttivo, cerca]);

  // La chiusura nasce alla prima cosa che si scrive per quel giorno. Se due telefoni la creano
  // insieme, il vincolo di unicità sulla data ne tiene una e l'altro la rilegge.
  const assicuraChiusura = async () => {
    if (chiusura) return chiusura;
    await supabase.from('albatros_chiusure').upsert([{ data, creato_da: user.id }], { onConflict: 'data', ignoreDuplicates: true });
    const { data: ch, error } = await supabase.from('albatros_chiusure').select('*').eq('data', data).single();
    if (error) { alert(`Non riesco ad aprire la giornata: ${error.message}`); return null; }
    setChiusura(ch);
    return ch;
  };

  // Le scritture vanno in fila: due tocchi rapidi sulla stessa voce devono diventare 2, non 1.
  const coda = useRef(Promise.resolve());
  const inAttesa = useRef(0);
  // Le righe come le vede la coda: un tocco in fila deve trovare la riga creata dal tocco prima.
  const righeAttuali = useRef(righe);
  useEffect(() => { righeAttuali.current = righe; }, [righe]);
  const esegui = (fn) => {
    inAttesa.current += 1;
    setInCorso(true);
    coda.current = coda.current
      .then(fn)
      .catch(err => alert(`Errore: ${err.message}`))
      .finally(() => { inAttesa.current -= 1; if (inAttesa.current === 0) setInCorso(false); });
    return coda.current;
  };

  // --- Battuto ---
  const oltreIlResiduo = (aggiunta) => {
    const battuto = sommaRighe(righeAttuali.current);
    if (aggiuntaConsentita(chiusura, battuto, aggiunta)) return false;
    alert(`La giornata è chiusa: si può specificare solo il residuo (${euro(Math.max(r2(quadratura(chiusura, []).incassato - battuto), 0))}), senza superarlo.`);
    return true;
  };

  // Un tocco su una voce aggiunge 1 alla riga uguale (stessa voce, stesso prezzo), o ne crea una.
  const toccaVoce = (voce) => esegui(async () => {
    if (oltreIlResiduo(voce.prezzo)) return;
    const esistente = rigaDaIncrementare(righeAttuali.current, voce);
    if (esistente) {
      const dopo = r2(num(esistente.quantita) + 1);
      const { error } = await supabase.from('albatros_righe').update({ quantita: dopo }).eq('id', esistente.id);
      if (error) { alert(`Errore: ${error.message}`); return; }
      righeAttuali.current = righeAttuali.current.map(r => (r.id === esistente.id ? { ...r, quantita: dopo } : r));
    } else {
      const ch = await assicuraChiusura();
      if (!ch) return;
      const { data: nuova, error } = await supabase.from('albatros_righe').insert([{ chiusura_id: ch.id, voce_id: voce.id, quantita: 1, prezzo: r2(voce.prezzo), creato_da: user.id }]).select().single();
      if (error) { alert(`Errore: ${error.message}`); return; }
      righeAttuali.current = [...righeAttuali.current, nuova];
    }
    setRighe(righeAttuali.current);
  });

  const aggiungiVoce = ({ nome: nomeScritto, quantita: q0, prezzo: p0, categoria }) => new Promise(risolvi => esegui(async () => {
    const nome = nomeScritto.trim().replace(/\s+/g, ' ');
    const quantita = leggiImporto(q0);
    if (!quantita || quantita <= 0) { alert('Quantità non valida.'); return risolvi(false); }
    let voce = voceDiNome(listino, nome);
    const prezzoScritto = leggiImporto(p0);
    if (Number.isNaN(prezzoScritto) || (prezzoScritto != null && prezzoScritto < 0)) { alert('Prezzo non valido.'); return risolvi(false); }
    const prezzo = prezzoScritto ?? (voce ? r2(voce.prezzo) : null);
    if (prezzo == null) { alert(`"${nome}" non è ancora nel listino: scrivi il prezzo.`); return risolvi(false); }
    if (oltreIlResiduo(quantita * prezzo)) return risolvi(false);
    // Una voce scritta per la prima volta entra nel listino col prezzo usato qui.
    if (!voce) {
      const { data: nuova, error } = await supabase.from('albatros_listino')
        .insert([{ nome, categoria_id: idCategoriaScelta(categoria, categorie, 'listino'), prezzo, creato_da: user.id }]).select().single();
      if (error && error.code !== '23505') { alert(`Errore nel creare la voce: ${error.message}`); return risolvi(false); }
      const aggiornato = await ricaricaListino();
      voce = nuova || voceDiNome(aggiornato, nome);
      if (!voce) { alert('Non trovo la voce appena creata, riprova.'); return risolvi(false); }
    }
    const ch = await assicuraChiusura();
    if (!ch) return risolvi(false);
    const { error } = await supabase.from('albatros_righe').insert([{ chiusura_id: ch.id, voce_id: voce.id, quantita, prezzo, creato_da: user.id }]);
    if (error) { alert(`Errore nel salvataggio della riga: ${error.message}`); return risolvi(false); }
    await caricaGiorno(data);
    risolvi(true);
  }));

  const cambiaQuantita = (riga, delta) => esegui(async () => {
    if (delta > 0 && oltreIlResiduo(delta * num(riga.prezzo))) return;
    const dopo = r2(num(riga.quantita) + delta);
    if (dopo <= 0) {
      if (!window.confirm(`Togliere la riga "${voci.get(riga.voce_id)?.nome || '?'}"?`)) return;
      const { error } = await supabase.from('albatros_righe').delete().eq('id', riga.id);
      if (error) { alert(`Errore: ${error.message}`); return; }
    } else {
      const { error } = await supabase.from('albatros_righe').update({ quantita: dopo }).eq('id', riga.id);
      if (error) { alert(`Errore: ${error.message}`); return; }
    }
    await caricaGiorno(data);
  });

  // --- Chiusura e riapertura ---
  // Il fondo di partenza si propone da quello lasciato all'ultima chiusura, e lo stesso valore si
  // propone come fondo da lasciare: di solito si conferma e basta.
  const apriChiusura = () => {
    const partenza = chiusura?.fondo_partenza ?? fondoProposto(precedente);
    setInChiusura({
      pos: mostraImporto(chiusura?.pos ?? null),
      contanti: mostraImporto(chiusura?.contanti ?? null),
      fondo_partenza: mostraImporto(partenza),
      fondo_lasciato: mostraImporto(chiusura?.fondo_lasciato ?? partenza),
      ritirato_da: chiusura?.ritirato_da || '',
    });
  };

  const apriFondo = () => {
    const partenza = fondoProposto(precedente);
    setInFondo({ fondo_partenza: mostraImporto(partenza), fondo_lasciato: mostraImporto(partenza), ritirato_da: '' });
  };

  // Scrive solo il fondo: POS e contanti restano quelli della chiusura.
  const salvaFondo = () => esegui(async () => {
    const [fondoPartenza, fondoLasciato] = ['fondo_partenza', 'fondo_lasciato'].map(k => leggiImporto(inFondo[k]));
    if (fondoPartenza == null || fondoLasciato == null) { alert('Scrivi il fondo di partenza e quello lasciato (anche 0).'); return; }
    if ([fondoPartenza, fondoLasciato].some(v => Number.isNaN(v) || v < 0)) { alert('Importo non valido.'); return; }
    const contanti = r2(num(chiusura.contanti));
    if (fondoLasciato > contanti) { alert(`Non si può lasciare in cassa più dei contanti contati (${euro(contanti)}).`); return; }
    const ritirato = r2(contanti - fondoLasciato);
    if (ritirato > 0 && !inFondo.ritirato_da) { alert(`Scegli chi ha ritirato i ${euro(ritirato)}.`); return; }
    const { error } = await supabase.from('albatros_chiusure')
      .update({ fondo_partenza: fondoPartenza, fondo_lasciato: fondoLasciato, ritirato_da: ritirato > 0 ? inFondo.ritirato_da : null })
      .eq('id', chiusura.id).is('fondo_lasciato', null);
    if (error) { alert(`Errore: ${error.message}`); return; }
    setInFondo(null);
    await ricarica();
  });

  const confermaChiusura = () => esegui(async () => {
    const [pos, contanti, fondoPartenza, fondoLasciato] = ['pos', 'contanti', 'fondo_partenza', 'fondo_lasciato'].map(k => leggiImporto(inChiusura[k]));
    if ([pos, contanti, fondoPartenza, fondoLasciato].some(v => v == null)) { alert('Scrivi POS, contanti, fondo di partenza e fondo lasciato (anche 0).'); return; }
    if ([pos, contanti, fondoPartenza, fondoLasciato].some(v => Number.isNaN(v) || v < 0)) { alert('Importo non valido.'); return; }
    if (fondoLasciato > contanti) { alert('Non si può lasciare in cassa più dei contanti contati.'); return; }
    const ritirato = r2(contanti - fondoLasciato);
    if (ritirato > 0 && !inChiusura.ritirato_da) { alert(`Scegli chi ritira i ${euro(ritirato)}.`); return; }
    if (contanti < fondoPartenza && !window.confirm(`In cassa ci sono meno contanti (${euro(contanti)}) del fondo di partenza (${euro(fondoPartenza)}). Confermi lo stesso?`)) return;
    const ch = await assicuraChiusura();
    if (!ch) return;
    const { error } = await supabase.from('albatros_chiusure')
      .update({
        pos, contanti, fondo_partenza: fondoPartenza, fondo_lasciato: fondoLasciato,
        ritirato_da: ritirato > 0 ? inChiusura.ritirato_da : null,
        chiusa_il: new Date().toISOString(), chiusa_da: user.id,
      }).eq('id', ch.id);
    if (error) { alert(`Errore: ${error.message}`); return; }
    setInChiusura(null);
    await ricarica();
  });

  // I conti del fondo in corso di scrittura, sulla chiusura già fatta.
  const qf = inFondo ? quadratura({ ...chiusura, fondo_partenza: leggiImporto(inFondo.fondo_partenza) || 0, fondo_lasciato: leggiImporto(inFondo.fondo_lasciato) || 0 }, righe) : null;

  // I conti della chiusura in corso, con i numeri scritti finora.
  const qc = inChiusura ? quadratura(Object.fromEntries(['pos', 'contanti', 'fondo_partenza', 'fondo_lasciato'].map(k => [k, leggiImporto(inChiusura[k]) || 0])), righe) : null;
  const fondoIeri = fondoProposto(precedente);
  const campoCassa = (campo, etichetta) => (
    <label className="albatros-etichetta">{etichetta}
      <input type="text" inputMode="decimal" value={inChiusura[campo]} placeholder="0,00" autoFocus={campo === 'pos'}
        disabled={!cassaScrivibile(chiusura, chiusura?.[campo] ?? null, puoCorreggere)}
        onChange={(e) => setInChiusura({ ...inChiusura, [campo]: e.target.value })} className="albatros-campo albatros-importo albatros-importo-grande" />
    </label>
  );

  return (
    <div className="albatros-pagina no-print">
      <datalist id="albatros-voci">{listino.filter(v => v.attiva).map(v => <option key={v.id} value={v.nome}>{euro(v.prezzo)}</option>)}</datalist>

      <div className="albatros-card">
        <div className="albatros-testata">
          <label className="albatros-etichetta" style={{ flex: '0 1 200px' }}>Giornata
            <input type="date" value={data} max={puoCorreggere ? undefined : giornataDiLavoro()} onChange={(e) => e.target.value && setData(e.target.value)} className="albatros-campo" />
          </label>
          <div className="albatros-stato">
            {chiusura?.chiusa_il
              ? <span className="albatros-badge chiusa">Chiusa {oraDi(chiusura.chiusa_il)}{utenti[chiusura.chiusa_da] ? ` da ${utenti[chiusura.chiusa_da]}` : ''}</span>
              : <span className="albatros-badge aperta">{chiusura ? 'Aperta' : 'Da iniziare'}</span>}
          </div>
          <div className="albatros-battuto-testata">
            <span>Battuto</span>
            <strong>{euro(q.specificato)}</strong>
          </div>
        </div>
        {chiusura?.chiusa_il && (
          <p className="descrizione-pagina" style={{ margin: '10px 0 0 0' }}>
            Questa giornata è chiusa: POS e contanti non si toccano più{puoCorreggere ? " finché non la riapri dalla scheda Chiusure" : ' (può riaprirla un amministratore)'}. Il residuo non specificato si può ancora spiegare con altre voci, senza superare l'incassato.
          </p>
        )}
        {giornateAperte.length > 0 && (
          <p className="albatros-avviso" style={{ marginTop: '12px', marginBottom: 0 }}>
            Giornate non ancora chiuse:{' '}
            {giornateAperte.map((g, i) => (
              <span key={g.chiusura.id}>{i > 0 && ', '}<button type="button" className="albatros-link" onClick={() => setData(g.chiusura.data)}>{formattaDataGGMMAAAA(g.chiusura.data)}</button></span>
            ))}
          </p>
        )}
      </div>

      <div className="albatros-card">
        <div className="albatros-filtri-listino">
          {frequenti.length > 0 && <button type="button" className={`albatros-chip ${filtroAttivo === 'frequenti' && !cerca ? 'attivo' : ''}`} onClick={() => { setFiltro('frequenti'); setCerca(''); }}>Più usate</button>}
          {catListino.map(c => (
            <button key={c.id} type="button" className={`albatros-chip ${filtroAttivo === String(c.id) && !cerca ? 'attivo' : ''}`} onClick={() => { setFiltro(String(c.id)); setCerca(''); }}><IconaCategoria categoria={c} size={13} titolo={false} />{c.nome}</button>
          ))}
          <button type="button" className={`albatros-chip ${filtroAttivo === 'tutte' && !cerca ? 'attivo' : ''}`} onClick={() => { setFiltro('tutte'); setCerca(''); }}>Tutte</button>
          <input type="search" value={cerca} placeholder="Cerca…" onChange={(e) => setCerca(e.target.value)} className="albatros-campo albatros-cerca" />
        </div>

        {listino.length === 0 && <p className="albatros-vuoto">Il listino è vuoto: aggiungi la prima voce qui sotto.</p>}
        {listino.length > 0 && griglia.length === 0 && <p className="albatros-vuoto">Nessuna voce.</p>}
        <div className="albatros-griglia-listino">
          {griglia.map(v => (
            <button key={v.id} type="button" className="albatros-tasto" onClick={() => toccaVoce(v)}>
              <span className="albatros-tasto-nome">{v.nome}</span>
              <span className="albatros-tasto-prezzo"><IconaCategoria categoria={categoriaDi(v)} size={12} />{euro(v.prezzo)}</span>
            </button>
          ))}
        </div>

        <button type="button" className="albatros-link" style={{ marginTop: '12px' }} onClick={() => setAltraVoce(!altraVoce)}>
          {altraVoce ? '− Chiudi' : '+ Voce non in griglia, quantità o prezzo diversi'}
        </button>
        {altraVoce && <div style={{ marginTop: '10px' }}><FormVoce listino={listino} categorie={categorie} inCorso={inCorso} onAggiungi={aggiungiVoce} /></div>}
      </div>

      <div className="albatros-card">
        <div className="albatros-testata" style={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
          <h3 className="albatros-titolo" style={{ margin: 0 }}>Battuto della giornata</h3>
          <strong style={{ fontSize: '1.1rem' }}>{euro(q.specificato)}</strong>
        </div>
        {righe.length === 0 && <p className="albatros-vuoto">Ancora niente: tocca le voci qui sopra.</p>}
        {righe.map(r => {
          const voce = voci.get(r.voce_id);
          const fuoriListino = voce && r2(voce.prezzo) !== r2(r.prezzo);
          return (
            <div key={r.id} className="albatros-riga">
              <div className="albatros-riga-testo">
                <strong className="albatros-con-icona"><IconaCategoria categoria={categoriaDi(voce)} size={12} />{voce?.nome || '?'}</strong>
                <div className="albatros-tenue" style={{ fontSize: '0.78rem' }}>
                  {mostraImporto(r.quantita)} × {euro(r.prezzo)}{fuoriListino && <span style={{ color: '#b45309' }}> (listino {euro(voce.prezzo)})</span>}
                </div>
              </div>
              <div className="albatros-qta">
                {correggibile && <button type="button" className="btn-icon-action" disabled={inCorso} onClick={() => cambiaQuantita(r, -1)} aria-label="Una in meno">−</button>}
                <button type="button" className="btn-icon-action" disabled={inCorso} onClick={() => cambiaQuantita(r, 1)} aria-label="Una in più">+</button>
              </div>
              <div className="albatros-riga-importo">{euro(totaleRiga(r))}</div>
              {correggibile && <button type="button" className="btn-icon-action danger" title="Togli la riga" disabled={inCorso} onClick={() => cambiaQuantita(r, -num(r.quantita))}><Icona nome="elimina" size={14} style={{ marginRight: 0 }} /></button>}
            </div>
          );
        })}

        {aperta ? (
          <button type="button" className="albatros-chiudi" disabled={inCorso} onClick={apriChiusura}><Icona nome="salva" />Chiudi la giornata</button>
        ) : (
          <div className="albatros-riepilogo-chiusura">
            <div className="albatros-voce-q"><span>POS</span><span>{euro(q.pos)}</span></div>
            <div className="albatros-voce-q"><span>Contanti contati</span><span>{euro(q.contantiContati)}</span></div>
            <div className="albatros-voce-q"><span>− Fondo di partenza</span><span>{euro(q.fondoPartenza)}</span></div>
            <div className="albatros-voce-q totale"><span>Incassato</span><span>{euro(q.incassato)}</span></div>
            <div className="albatros-voce-q"><span>Battuto</span><span>{euro(q.specificato)}</span></div>
            <div className="albatros-voce-q" style={{ fontWeight: 700, color: q.nonSpecificato < 0 ? '#b91c1c' : q.nonSpecificato > 0 ? '#b45309' : '#15803d' }}>
              <span>{q.nonSpecificato < 0 ? 'Battuto oltre l\'incassato' : 'Residuo non specificato'}</span><span>{euro(Math.abs(q.nonSpecificato))}</span>
            </div>
            <p className="albatros-nota">
              {fondoDaSpecificare(chiusura) ? 'Fondo cassa non specificato.' : <>
                Lasciati in cassa {euro(q.fondoLasciato)}
                {q.ritirato > 0 && <> · ritirati {euro(q.ritirato)}{chiusura.ritirato_da ? ` da ${etichettaEnte(chiusura.ritirato_da)}` : ''}</>}
              </>}
            </p>
            {fondoDaSpecificare(chiusura) && (
              <button type="button" className="btn-outline-annulla albatros-bottone" style={{ marginTop: '8px' }} disabled={inCorso} onClick={apriFondo}>Specifica il fondo cassa</button>
            )}
          </div>
        )}
      </div>

      {inFondo && (
        <div className="modal-form-backdrop" onClick={() => setInFondo(null)}>
          <div className="modal-form-box albatros-overlay" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-form-close" aria-label="Chiudi" onClick={() => setInFondo(null)}>✕</button>
            <h3 style={{ margin: '0 0 4px 0', fontSize: '1.1rem', color: '#0f172a' }}>Fondo cassa del {formattaDataGGMMAAAA(data)}</h3>
            <p className="albatros-nota" style={{ marginTop: 0 }}>
              La giornata è chiusa con {euro(q.contantiContati)} di contanti contati. Scrivi con quanti si era partiti e quanti ne sono rimasti in cassa.
            </p>
            <div className="albatros-griglia-2" style={{ marginTop: '12px' }}>
              <label className="albatros-etichetta">Fondo di partenza €
                <input type="text" inputMode="decimal" value={inFondo.fondo_partenza} placeholder="0,00" autoFocus
                  onChange={(e) => setInFondo({ ...inFondo, fondo_partenza: e.target.value })} className="albatros-campo albatros-importo albatros-importo-grande" />
              </label>
              <label className="albatros-etichetta">Lasciati in cassa per il giorno dopo €
                <input type="text" inputMode="decimal" value={inFondo.fondo_lasciato} placeholder="0,00"
                  onChange={(e) => setInFondo({ ...inFondo, fondo_lasciato: e.target.value })} className="albatros-campo albatros-importo albatros-importo-grande" />
              </label>
            </div>
            {precedente && <p className="albatros-nota">All'ultima chiusura prima ({formattaDataGGMMAAAA(precedente.data)}) erano stati lasciati {euro(precedente.fondo_lasciato)}.</p>}
            <div className="albatros-ritiro">
              <span>Ritirati: <strong>{euro(qf.ritirato)}</strong></span>
              {qf.ritirato > 0 && (
                <label className="albatros-etichetta" style={{ flexDirection: 'row', alignItems: 'center', gap: '8px' }}>Li ha ritirati
                  <select value={inFondo.ritirato_da} onChange={(e) => setInFondo({ ...inFondo, ritirato_da: e.target.value })} className="albatros-campo" style={{ width: 'auto' }}>
                    <option value="">Scegli…</option>
                    {ENTI_RITIRO.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
                  </select>
                </label>
              )}
            </div>
            <div className="albatros-riepilogo-chiusura">
              <div className="albatros-voce-q"><span>Incasso in contanti (contati − fondo di partenza)</span><span>{euro(qf.contanti)}</span></div>
              <div className="albatros-voce-q totale"><span>Incassato (POS + contanti)</span><span>{euro(qf.incassato)}</span></div>
              <div className="albatros-voce-q"><span>Battuto</span><span>{euro(qf.specificato)}</span></div>
            </div>
            {qf.nonSpecificato < 0 && <p className="albatros-nota" style={{ color: '#b91c1c' }}>Con questo fondo il battuto supera l'incassato di {euro(-qf.nonSpecificato)}: ricontrolla i numeri.</p>}
            <div style={{ display: 'flex', gap: '10px', marginTop: '16px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button type="button" className="btn-outline-annulla albatros-bottone" onClick={() => setInFondo(null)}>Annulla</button>
              <button type="button" className="btn-accent-inline albatros-bottone" disabled={inCorso} onClick={salvaFondo}><Icona nome="salva" />Salva il fondo</button>
            </div>
            <p className="albatros-nota" style={{ textAlign: 'right' }}>Una volta salvato, il fondo si cambia solo riaprendo la giornata.</p>
          </div>
        </div>
      )}

      {inChiusura && (
        <div className="modal-form-backdrop" onClick={() => setInChiusura(null)}>
          <div className="modal-form-box albatros-overlay" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-form-close" aria-label="Chiudi" onClick={() => setInChiusura(null)}>✕</button>
            <h3 style={{ margin: '0 0 4px 0', fontSize: '1.1rem', color: '#0f172a' }}>Chiusura del {formattaDataGGMMAAAA(data)}</h3>
            <p className="albatros-nota" style={{ marginTop: 0 }}>Scrivi il totale del POS e tutti i contanti che ci sono in cassa, fondo compreso.</p>

            <div className="albatros-griglia-2" style={{ marginTop: '12px' }}>
              {campoCassa('pos', 'POS €')}
              {campoCassa('contanti', 'Contanti contati €')}
            </div>

            <h4 className="albatros-titolo" style={{ margin: '16px 0 8px 0' }}>Fondo cassa</h4>
            <div className="albatros-griglia-2">
              <div>
                {campoCassa('fondo_partenza', 'Fondo di partenza €')}
                <p className="albatros-nota" style={{ marginTop: '4px' }}>
                  {fondoIeri == null
                    ? 'Prima chiusura con il fondo: scrivi con quanti contanti si era partiti.'
                    : leggiImporto(inChiusura.fondo_partenza) === fondoIeri
                      ? `Quello lasciato all'ultima chiusura (${formattaDataGGMMAAAA(precedente.data)}).`
                      : <span style={{ color: '#b45309' }}>All'ultima chiusura ({formattaDataGGMMAAAA(precedente.data)}) erano stati lasciati {euro(fondoIeri)}.</span>}
                </p>
              </div>
              {campoCassa('fondo_lasciato', 'Lasciati in cassa per domani €')}
            </div>
            <div className="albatros-ritiro">
              <span>Da ritirare: <strong>{euro(qc.ritirato)}</strong></span>
              {qc.ritirato > 0 && (
                <label className="albatros-etichetta" style={{ flexDirection: 'row', alignItems: 'center', gap: '8px' }}>Li ritira
                  <select value={inChiusura.ritirato_da} onChange={(e) => setInChiusura({ ...inChiusura, ritirato_da: e.target.value })} className="albatros-campo" style={{ width: 'auto' }}
                    disabled={!cassaScrivibile(chiusura, chiusura?.ritirato_da ?? null, puoCorreggere)}>
                    <option value="">Scegli…</option>
                    {ENTI_RITIRO.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
                  </select>
                </label>
              )}
            </div>

            <div className="albatros-riepilogo-chiusura">
              <div className="albatros-voce-q"><span>Incasso in contanti (contati − fondo di partenza)</span><span>{euro(qc.contanti)}</span></div>
              <div className="albatros-voce-q totale"><span>Incassato (POS + contanti)</span><span>{euro(qc.incassato)}</span></div>
              <div className="albatros-voce-q"><span>Battuto</span><span>{euro(qc.specificato)}</span></div>
              <div className="albatros-voce-q" style={{ fontWeight: 700, color: qc.nonSpecificato < 0 ? '#b91c1c' : qc.nonSpecificato > 0 ? '#b45309' : '#15803d' }}>
                <span>{qc.nonSpecificato < 0 ? 'Battuto oltre l\'incassato' : qc.nonSpecificato > 0 ? 'Residuo non specificato' : 'Tutto specificato'}</span>
                <span>{euro(Math.abs(qc.nonSpecificato))}</span>
              </div>
            </div>

            {qc.nonSpecificato < 0 && (
              <p className="albatros-nota" style={{ color: '#b91c1c' }}>In cassa c'è meno del battuto: ricontrolla POS e contanti prima di confermare.</p>
            )}
            {qc.nonSpecificato > 0 && (
              <>
                <p className="albatros-nota">Se sai cosa compone il residuo puoi aggiungerlo qui, altrimenti conferma pure: resterà non specificato.</p>
                <div style={{ marginTop: '8px' }}>
                  <FormVoce listino={listino} categorie={categorie} inCorso={inCorso} onAggiungi={aggiungiVoce} prezzoProposto={mostraImporto(qc.nonSpecificato)} />
                </div>
              </>
            )}

            <div style={{ display: 'flex', gap: '10px', marginTop: '16px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button type="button" className="btn-outline-annulla albatros-bottone" onClick={() => setInChiusura(null)}>Annulla</button>
              <button type="button" className="albatros-chiudi" style={{ width: 'auto', marginTop: 0, padding: '0 20px' }} disabled={inCorso} onClick={confermaChiusura}>
                <Icona nome="salva" />Conferma e chiudi
              </button>
            </div>
            <p className="albatros-nota" style={{ textAlign: 'right' }}>Dopo la conferma POS e contanti non si potranno più modificare; il residuo si potrà ancora specificare.</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default Giornata
