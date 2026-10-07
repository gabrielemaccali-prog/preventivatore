import { useState, useEffect, useRef, useMemo } from 'react'
import { supabase } from '../../lib/supabaseClient'
import Icona from '../../components/Icona'
import { formattaDataGGMMAAAA } from '../../lib/utils'
import {
  categorieDi, idCategoriaScelta, num, r2, euro, giornataDiLavoro,
  quadratura, chiusuraModificabile, cassaScrivibile, composizioneCorreggibile, aggiuntaConsentita, sommaRighe, totaleRiga, rigaDaIncrementare, vociFrequenti, voceDiNome,
} from './calcolo'
import SceltaCategoria from './SceltaCategoria'
import IconaCategoria from './IconaCategoria'

// ============================================================
// La giornata del centro (scheda Giornata; l'elenco delle chiusure sta in StoricoChiusure).
// Durante la serata si toccano le voci del listino e si forma il
// "battuto", il preventivo di quanto dovrebbe esserci in cassa. A fine serata "Chiudi la giornata"
// apre la chiusura: si scrivono POS e contanti, si confrontano col battuto e, se avanza un
// residuo, lo si può spiegare con altre voci prima di confermare.
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
  const [righe, setRighe] = useState([]);
  const [recenti, setRecenti] = useState([]);
  const [righeRecenti, setRigheRecenti] = useState([]);
  const [filtro, setFiltro] = useState(null);
  const [cerca, setCerca] = useState('');
  const [altraVoce, setAltraVoce] = useState(false);
  // La chiusura in corso: null = overlay chiuso; altrimenti i valori scritti, salvati solo alla conferma.
  const [inChiusura, setInChiusura] = useState(null);
  const [inCorso, setInCorso] = useState(false);

  const caricaGiorno = async (giorno) => {
    const { data: ch } = await supabase.from('albatros_chiusure').select('*').eq('data', giorno).maybeSingle();
    const rg = ch ? await supabase.from('albatros_righe').select('*').eq('chiusura_id', ch.id).order('id') : { data: [] };
    setChiusura(ch || null);
    setRighe(rg.data || []);
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
    alert(`La giornata è chiusa: si può specificare solo il residuo (${euro(Math.max(r2(num(chiusura.pos) + num(chiusura.contanti) - battuto), 0))}), senza superarlo.`);
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
  const apriChiusura = () => setInChiusura({ pos: mostraImporto(chiusura?.pos ?? null), contanti: mostraImporto(chiusura?.contanti ?? null) });

  const confermaChiusura = () => esegui(async () => {
    const pos = leggiImporto(inChiusura.pos);
    const contanti = leggiImporto(inChiusura.contanti);
    if (pos == null || contanti == null) { alert('Scrivi POS e contanti (anche 0).'); return; }
    if (Number.isNaN(pos) || Number.isNaN(contanti) || pos < 0 || contanti < 0) { alert('Importo non valido.'); return; }
    const ch = await assicuraChiusura();
    if (!ch) return;
    const { error } = await supabase.from('albatros_chiusure')
      .update({ pos, contanti, chiusa_il: new Date().toISOString(), chiusa_da: user.id }).eq('id', ch.id);
    if (error) { alert(`Errore: ${error.message}`); return; }
    setInChiusura(null);
    await ricarica();
  });

  // Il residuo nella chiusura: incassato scritto meno battuto.
  const qc = inChiusura ? quadratura({ pos: leggiImporto(inChiusura.pos) || 0, contanti: leggiImporto(inChiusura.contanti) || 0 }, righe) : null;
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
              <span className="albatros-tasto-nome"><IconaCategoria categoria={categoriaDi(v)} size={13} />{v.nome}</span>
              <span className="albatros-tasto-prezzo">{euro(v.prezzo)}</span>
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
            <div className="albatros-voce-q"><span>Contanti</span><span>{euro(q.contanti)}</span></div>
            <div className="albatros-voce-q totale"><span>Incassato</span><span>{euro(q.incassato)}</span></div>
            <div className="albatros-voce-q"><span>Battuto</span><span>{euro(q.specificato)}</span></div>
            <div className="albatros-voce-q" style={{ fontWeight: 700, color: q.nonSpecificato < 0 ? '#b91c1c' : q.nonSpecificato > 0 ? '#b45309' : '#15803d' }}>
              <span>{q.nonSpecificato < 0 ? 'Battuto oltre l\'incassato' : 'Residuo non specificato'}</span><span>{euro(Math.abs(q.nonSpecificato))}</span>
            </div>
          </div>
        )}
      </div>

      {inChiusura && (
        <div className="modal-form-backdrop" onClick={() => setInChiusura(null)}>
          <div className="modal-form-box albatros-overlay" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-form-close" aria-label="Chiudi" onClick={() => setInChiusura(null)}>✕</button>
            <h3 style={{ margin: '0 0 4px 0', fontSize: '1.1rem', color: '#0f172a' }}>Chiusura del {formattaDataGGMMAAAA(data)}</h3>
            <p className="albatros-nota" style={{ marginTop: 0 }}>Scrivi quanto c'è: il totale del POS e i contanti contati.</p>

            <div className="albatros-griglia-2" style={{ marginTop: '12px' }}>
              {campoCassa('pos', 'POS €')}
              {campoCassa('contanti', 'Contanti contati €')}
            </div>

            <div className="albatros-riepilogo-chiusura">
              <div className="albatros-voce-q totale"><span>Incassato</span><span>{euro(qc.incassato)}</span></div>
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
