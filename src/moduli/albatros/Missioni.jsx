import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formattaDataGGMMAAAA } from '../../lib/utils'
import { moduloVisibile } from '../../lib/permessi'
import Icona from '../../components/Icona'
import { isoDi } from './calcolo'
import {
  STATI_MISSIONE, PRIORITA_MISSIONE, etichettaStato, etichettaPriorita,
  missioneAperta, missioneScaduta, confrontaMissioni, campiCambioStato,
  attivitaFatta, attivitaScaduta, avanzamento, statoDopoAttivita,
} from './regoleMissioni'

// ============================================================
// Le missioni: le cose da fare per il centro. L'elenco è corto apposta: una riga per missione
// (titolo, avanzamento, scadenza); aprendola si vedono le sue attività, ognuna col responsabile e
// la scadenza, e sotto ogni attività le azioni fatte, ognuna col suo giorno. Spuntate tutte le
// attività la missione si chiude. Il resto (descrizione, stato, storia) sta nei Dettagli.
// Tutti possono scrivere missioni, attività e azioni, spuntare e cambiare lo stato (il cambio resta
// nella storia); modificare i campi di una missione e cancellare resta all'amministratore.
// Il numero accanto a "Missioni" nel menu conta le non chiuse: dopo ogni salvataggio si avvisa
// App.jsx (onCambiate) perché lo ricalcoli.
// ============================================================

const MISSIONE_VUOTA = { titolo: '', descrizione: '', responsabile_id: '', priorita: 'normale', scadenza: '', stato: 'aperta' };
const ATTIVITA_VUOTA = { titolo: '', responsabile_id: '', scadenza: '' };
const giornoBreve = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');

function Missioni({ user, utenti, puoCorreggere, onCambiate }) {
  const [missioni, setMissioni] = useState([]);
  const [azioni, setAzioni] = useState([]);
  const [attivita, setAttivita] = useState([]);
  const [mancanti, setMancanti] = useState(null);
  // Due viste: le missioni da fare (aperte, in corso, in attesa) e le completate.
  const [vista, setVista] = useState('da_fare');
  const [filtroResponsabile, setFiltroResponsabile] = useState('');
  const [cerca, setCerca] = useState('');
  // L'overlay della missione nuova (o della modifica dell'amministratore): null = chiuso.
  const [inForm, setInForm] = useState(null);
  // Le missioni aperte nell'elenco, l'attività di cui si vedono le azioni, la missione nei Dettagli.
  const [espanse, setEspanse] = useState(() => new Set());
  const [attivitaEspansa, setAttivitaEspansa] = useState(null);
  const [dettaglioId, setDettaglioId] = useState(null);
  // La nuova attività in scrittura, per missione (se ne possono avere aperte più d'una).
  const [nuoveAttivita, setNuoveAttivita] = useState({});
  const [nuovaAzione, setNuovaAzione] = useState({ data: isoDi(new Date()), descrizione: '' });
  // L'azione che l'amministratore sta correggendo (giorno e testo): null = nessuna.
  const [azioneInModifica, setAzioneInModifica] = useState(null);
  const [inCorso, setInCorso] = useState(false);
  // Chi può essere responsabile: gli amministratori e chi ha un ruolo che vede Albatros.
  const [responsabili, setResponsabili] = useState(new Set());

  const carica = async () => {
    const [m, a, t] = await Promise.all([
      supabase.from('albatros_missioni').select('*'),
      supabase.from('albatros_missioni_azioni').select('*').order('data', { ascending: false }).order('id', { ascending: false }),
      supabase.from('albatros_missioni_attivita').select('*').order('id'),
    ]);
    setMancanti(m.error?.message || a.error?.message || t.error?.message || null);
    setMissioni(m.data || []);
    setAzioni(a.data || []);
    setAttivita(t.data || []);
  };
  useEffect(() => { carica(); }, []);

  useEffect(() => {
    Promise.all([supabase.from('utenti').select('*'), supabase.from('ruoli').select('*')]).then(([u, r]) => {
      const ruoli = new Map((r.data || []).map(x => [String(x.id), x]));
      const ruoloDi = (ut) => ruoli.get(String(ut.ruolo_id)) || (r.data || []).find(x => x.nome === ut.ruolo);
      setResponsabili(new Set((u.data || [])
        .filter(ut => ut.attivo !== false)
        .filter(ut => {
          const ruolo = ruoloDi(ut);
          return ruolo && moduloVisibile({ isAdmin: ruolo.is_admin ?? ruolo.nome === 'admin', permessi: ruolo.permessi || {} }, 'albatros');
        })
        .map(ut => String(ut.id))));
    });
  }, []);

  const ricarica = async () => { await carica(); onCambiate?.(); };

  const oggi = isoDi(new Date());
  const nomeUtente = (id) => (id ? utenti[id] || '—' : '—');
  // Nei menu del responsabile restano anche quelli già assegnati, se nel frattempo hanno perso
  // l'accesso ad Albatros: altrimenti il filtro non li troverebbe e la modifica li toglierebbe.
  const utentiOrdinati = useMemo(() => {
    const assegnati = new Set([...missioni, ...attivita].map(x => String(x.responsabile_id)));
    return Object.entries(utenti)
      .filter(([id]) => responsabili.has(id) || assegnati.has(id))
      .sort((a, b) => a[1].localeCompare(b[1]));
  }, [utenti, responsabili, missioni, attivita]);
  const attivitaDi = (id) => attivita.filter(a => a.missione_id === id);
  const azioniDiAttivita = (id) => azioni.filter(a => a.attivita_id === id);
  // La storia della missione: i cambi di stato (e le azioni scritte prima che stessero sotto le attività).
  const storiaDi = (id) => azioni.filter(a => a.missione_id === id && !a.attivita_id);

  const visibili = useMemo(() => {
    const testo = cerca.trim().toLowerCase();
    return missioni
      .filter(m => (vista === 'da_fare' ? missioneAperta(m) : !missioneAperta(m)))
      // Una missione è anche di chi ha una sua attività ancora da fare.
      .filter(m => !filtroResponsabile || (filtroResponsabile === 'nessuno'
        ? !m.responsabile_id
        : String(m.responsabile_id) === filtroResponsabile
          || attivita.some(a => a.missione_id === m.id && !attivitaFatta(a) && String(a.responsabile_id) === filtroResponsabile)))
      .filter(m => !testo || [m.titolo, m.descrizione, ...attivita.filter(a => a.missione_id === m.id).map(a => a.titolo)].join(' ').toLowerCase().includes(testo))
      .sort(confrontaMissioni);
  }, [missioni, attivita, vista, filtroResponsabile, cerca]);

  const quanteDaFare = missioni.filter(missioneAperta).length;

  const espandi = (id) => setEspanse(prima => {
    const dopo = new Set(prima);
    if (dopo.has(id)) dopo.delete(id); else dopo.add(id);
    return dopo;
  });

  const salvaMissione = async () => {
    const titolo = inForm.titolo.trim().replace(/\s+/g, ' ');
    if (!titolo) return alert('Scrivi il titolo della missione.');
    const record = {
      titolo,
      descrizione: inForm.descrizione.trim() || null,
      responsabile_id: inForm.responsabile_id ? Number(inForm.responsabile_id) : null,
      priorita: inForm.priorita,
      scadenza: inForm.scadenza || null,
    };
    setInCorso(true);
    const { data, error } = inForm.id
      ? await supabase.from('albatros_missioni').update(record).eq('id', inForm.id).select().single()
      : await supabase.from('albatros_missioni').insert([{ ...record, ...campiCambioStato(null, inForm.stato), creato_da: user.id }]).select().single();
    setInCorso(false);
    if (error) return alert(`Errore nel salvataggio: ${error.message}`);
    setInForm(null);
    // Una missione nuova si apre subito nell'elenco, pronta per scriverci le attività.
    if (!inForm.id) {
      setEspanse(prima => new Set(prima).add(data.id));
      setVista(missioneAperta(data) ? 'da_fare' : 'completate');
    }
    ricarica();
  };

  // Il cambio di stato resta nella storia della missione: quando è passata in attesa o è stata
  // chiusa, e da chi.
  const registraStato = async (m, stato, perche = '') => {
    const { error } = await supabase.from('albatros_missioni').update(campiCambioStato(m, stato)).eq('id', m.id);
    if (!error) {
      await supabase.from('albatros_missioni_azioni').insert([{
        missione_id: m.id, data: oggi, descrizione: `Stato: ${etichettaStato(m.stato)} → ${etichettaStato(stato)}${perche}`, creato_da: user.id,
      }]);
    }
    return error;
  };

  const cambiaStato = async (m, stato) => {
    if (stato === m.stato) return;
    const daFare = attivitaDi(m.id).filter(a => !attivitaFatta(a)).length;
    if (stato === 'chiusa' && daFare > 0 && !window.confirm(`Ci sono ancora ${daFare} attività da fare. Chiudere lo stesso la missione?`)) return;
    setInCorso(true);
    const error = await registraStato(m, stato);
    setInCorso(false);
    if (error) return alert(`Errore: ${error.message}`);
    ricarica();
  };

  // Dopo ogni cambio alle attività: spuntate tutte la missione si chiude, e se una torna da fare
  // si riapre (vedi statoDopoAttivita).
  const allineaStato = async (m, attivitaDopo) => {
    const stato = statoDopoAttivita(m, attivitaDopo);
    if (stato) await registraStato(m, stato, stato === 'chiusa' ? ' (fatte tutte le attività)' : ' (attività di nuovo da fare)');
  };

  const aggiungiAttivita = async (m) => {
    const nuova = nuoveAttivita[m.id] || ATTIVITA_VUOTA;
    const titolo = nuova.titolo.trim().replace(/\s+/g, ' ');
    if (!titolo) return alert("Scrivi l'attività.");
    setInCorso(true);
    const { data, error } = await supabase.from('albatros_missioni_attivita').insert([{
      missione_id: m.id, titolo, responsabile_id: nuova.responsabile_id ? Number(nuova.responsabile_id) : null,
      scadenza: nuova.scadenza || null, creato_da: user.id,
    }]).select().single();
    if (!error) await allineaStato(m, [...attivitaDi(m.id), data]);
    setInCorso(false);
    if (error) return alert(`Errore: ${error.message}`);
    setNuoveAttivita(prima => ({ ...prima, [m.id]: ATTIVITA_VUOTA }));
    ricarica();
  };

  const spunta = async (m, a) => {
    const campi = attivitaFatta(a) ? { fatta_il: null, fatta_da: null } : { fatta_il: new Date().toISOString(), fatta_da: user.id };
    setInCorso(true);
    const { error } = await supabase.from('albatros_missioni_attivita').update(campi).eq('id', a.id);
    if (!error) await allineaStato(m, attivitaDi(m.id).map(x => (x.id === a.id ? { ...x, ...campi } : x)));
    setInCorso(false);
    if (error) return alert(`Errore: ${error.message}`);
    ricarica();
  };

  const eliminaAttivita = async (m, a) => {
    if (!window.confirm(`Cancellare l'attività "${a.titolo}" con le sue azioni?`)) return;
    const { error } = await supabase.from('albatros_missioni_attivita').delete().eq('id', a.id);
    if (error) return alert(`Errore: ${error.message}`);
    await allineaStato(m, attivitaDi(m.id).filter(x => x.id !== a.id));
    ricarica();
  };

  const apriAzioni = (a) => {
    setAttivitaEspansa(attivitaEspansa === a.id ? null : a.id);
    setNuovaAzione({ data: oggi, descrizione: '' });
  };

  const aggiungiAzione = async (a) => {
    const descrizione = nuovaAzione.descrizione.trim();
    if (!descrizione) return alert('Scrivi cosa è stato fatto.');
    if (!nuovaAzione.data) return alert('Scegli il giorno.');
    setInCorso(true);
    const { error } = await supabase.from('albatros_missioni_azioni').insert([{
      missione_id: a.missione_id, attivita_id: a.id, data: nuovaAzione.data, descrizione, creato_da: user.id,
    }]);
    setInCorso(false);
    if (error) return alert(`Errore: ${error.message}`);
    setNuovaAzione({ data: oggi, descrizione: '' });
    ricarica();
  };

  const salvaAzione = async () => {
    const descrizione = azioneInModifica.descrizione.trim();
    if (!descrizione) return alert('Scrivi cosa è stato fatto.');
    if (!azioneInModifica.data) return alert('Scegli il giorno.');
    setInCorso(true);
    const { error } = await supabase.from('albatros_missioni_azioni').update({ data: azioneInModifica.data, descrizione }).eq('id', azioneInModifica.id);
    setInCorso(false);
    if (error) return alert(`Errore: ${error.message}`);
    setAzioneInModifica(null);
    ricarica();
  };

  const eliminaAzione = async (a) => {
    if (!window.confirm(`Cancellare l'azione del ${formattaDataGGMMAAAA(a.data)}?`)) return;
    const { error } = await supabase.from('albatros_missioni_azioni').delete().eq('id', a.id);
    if (error) return alert(`Errore: ${error.message}`);
    ricarica();
  };

  const eliminaMissione = async (m) => {
    if (!window.confirm(`Cancellare la missione "${m.titolo}" con tutte le sue attività e azioni?`)) return;
    const { error } = await supabase.from('albatros_missioni').delete().eq('id', m.id);
    if (error) return alert(`Errore: ${error.message}`);
    setDettaglioId(null);
    ricarica();
  };

  const dettaglio = missioni.find(m => m.id === dettaglioId);

  if (mancanti) {
    return (
      <p className="albatros-avviso">
        Le tabelle delle missioni non esistono ancora (o manca un pezzo): esegui <strong>sql/albatros_missioni.sql</strong> nell'SQL Editor di Supabase. ({mancanti})
      </p>
    );
  }

  const cestino = (titolo, onClick) => (
    <button type="button" className="btn-icon-action danger" title={titolo} onClick={onClick}>
      <Icona nome="elimina" size={13} style={{ marginRight: 0 }} />
    </button>
  );

  const rigaAttivita = (m, a) => {
    const sue = azioniDiAttivita(a.id);
    const aperta = attivitaEspansa === a.id;
    return (
      <li key={a.id} className={attivitaFatta(a) ? 'fatta' : ''}>
        <div className="albatros-attivita-riga">
          <input type="checkbox" checked={attivitaFatta(a)} disabled={inCorso} onChange={() => spunta(m, a)} aria-label={`Fatta: ${a.titolo}`} />
          <button type="button" className="albatros-attivita-testo" onClick={() => apriAzioni(a)} aria-expanded={aperta}>
            <span className="albatros-missione-intestazione">
              <span className="titolo">{a.titolo}</span>
              <span className="albatros-missione-inserita">inserita il {formattaDataGGMMAAAA(a.creato_il.slice(0, 10))}</span>
            </span>
            <span className="albatros-missione-meta">
              {a.responsabile_id && <span>{nomeUtente(a.responsabile_id)}</span>}
              {a.scadenza && !attivitaFatta(a) && <span className={attivitaScaduta(a, oggi) ? 'scaduta' : ''}>entro il {giornoBreve(a.scadenza)}</span>}
              {attivitaFatta(a) && <span>fatta il {giornoBreve(a.fatta_il.slice(0, 10))}</span>}
              <span className="albatros-attivita-azioni-conta">{sue.length === 0 ? '+ azione' : `${sue.length} ${sue.length === 1 ? 'azione' : 'azioni'}`}</span>
            </span>
          </button>
          {puoCorreggere && cestino("Cancella l'attività", () => eliminaAttivita(m, a))}
        </div>
        {aperta && (
          <div className="albatros-attivita-azioni">
            {sue.map(z => (azioneInModifica?.id === z.id ? (
              <div key={z.id} className="albatros-azione-nuova">
                <input type="date" value={azioneInModifica.data} onChange={(e) => setAzioneInModifica({ ...azioneInModifica, data: e.target.value })} className="albatros-campo" aria-label="Giorno" />
                <input type="text" value={azioneInModifica.descrizione} autoFocus
                  onChange={(e) => setAzioneInModifica({ ...azioneInModifica, descrizione: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') salvaAzione(); if (e.key === 'Escape') setAzioneInModifica(null); }} className="albatros-campo" />
                <span style={{ display: 'flex', gap: '6px' }}>
                  <button type="button" className="btn-outline-annulla albatros-bottone" onClick={() => setAzioneInModifica(null)}>Annulla</button>
                  <button type="button" className="btn-accent-inline albatros-bottone" disabled={inCorso} onClick={salvaAzione}>Salva</button>
                </span>
              </div>
            ) : (
              <div key={z.id} className="albatros-azione">
                <strong>{giornoBreve(z.data)}</strong>
                <span className="testo">{z.descrizione}<span className="albatros-tenue"> · {nomeUtente(z.creato_da)}</span></span>
                {puoCorreggere && (
                  <button type="button" className="btn-icon-action" title="Modifica giorno e testo" onClick={() => setAzioneInModifica({ id: z.id, data: z.data, descrizione: z.descrizione })}>
                    <Icona nome="modifica" size={13} style={{ marginRight: 0 }} />
                  </button>
                )}
                {puoCorreggere && cestino("Cancella l'azione", () => eliminaAzione(z))}
              </div>
            )))}
            <div className="albatros-azione-nuova">
              <input type="date" value={nuovaAzione.data} onChange={(e) => setNuovaAzione({ ...nuovaAzione, data: e.target.value })} className="albatros-campo" aria-label="Giorno" />
              <input type="text" value={nuovaAzione.descrizione} placeholder="Cosa è stato fatto" autoFocus
                onChange={(e) => setNuovaAzione({ ...nuovaAzione, descrizione: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && aggiungiAzione(a)} className="albatros-campo" />
              <button type="button" className="btn-accent-inline albatros-bottone" disabled={inCorso} onClick={() => aggiungiAzione(a)}>Aggiungi</button>
            </div>
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="albatros-pagina no-print">
      <div className="albatros-card">
        <div className="albatros-testata">
          <div className="albatros-chips">
            <button type="button" className={`albatros-chip ${vista === 'da_fare' ? 'attivo' : ''}`} onClick={() => setVista('da_fare')}>Da fare · {quanteDaFare}</button>
            <button type="button" className={`albatros-chip ${vista === 'completate' ? 'attivo' : ''}`} onClick={() => setVista('completate')}>Completate · {missioni.length - quanteDaFare}</button>
          </div>
          <button type="button" className="btn-accent-inline albatros-bottone" style={{ marginLeft: 'auto' }}
            onClick={() => setInForm({ ...MISSIONE_VUOTA })}>+ Nuova missione</button>
        </div>
        <div className="albatros-testata" style={{ marginTop: '10px' }}>
          <input type="text" value={cerca} onChange={(e) => setCerca(e.target.value)} className="albatros-campo" placeholder="Cerca" style={{ flex: '1 1 160px', width: 'auto' }} aria-label="Cerca" />
          <select value={filtroResponsabile} onChange={(e) => setFiltroResponsabile(e.target.value)} className="albatros-campo" style={{ flex: '1 1 160px', width: 'auto' }} aria-label="Responsabile">
            <option value="">Tutti i responsabili</option>
            <option value={String(user.id)}>Le mie</option>
            {utentiOrdinati.filter(([id]) => id !== String(user.id)).map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
            <option value="nessuno">Senza responsabile</option>
          </select>
        </div>

        {visibili.length === 0 && <p className="albatros-vuoto" style={{ marginTop: '14px' }}>{vista === 'da_fare' ? 'Nessuna missione da fare.' : 'Nessuna missione completata.'}</p>}
        <div className="albatros-missioni">
          {visibili.map(m => {
            const sue = attivitaDi(m.id);
            const { fatte, totale } = avanzamento(sue);
            const aperta = espanse.has(m.id);
            const nuova = nuoveAttivita[m.id] || ATTIVITA_VUOTA;
            const setNuova = (x) => setNuoveAttivita(prima => ({ ...prima, [m.id]: x }));
            return (
              <div key={m.id} className={`albatros-missione priorita-${m.priorita} ${missioneAperta(m) ? '' : 'chiusa'}`}>
                <button type="button" className="albatros-missione-riga" onClick={() => espandi(m.id)} aria-expanded={aperta}>
                  <span className={`riga-espandibile-chevron ${aperta ? 'aperta' : ''}`}>›</span>
                  <span className="albatros-missione-intestazione">
                    <span className="albatros-missione-titolo">
                      {m.titolo}
                      {m.stato === 'in_attesa' && <span className="albatros-badge mini stato-in_attesa">In attesa</span>}
                    </span>
                    <span className="albatros-missione-inserita">inserita il {formattaDataGGMMAAAA(m.creato_il.slice(0, 10))}</span>
                  </span>
                  <span className="albatros-missione-destra">
                    {totale > 0 && <span className="albatros-missione-avanzamento"><span className="barra"><span style={{ width: `${(fatte / totale) * 100}%` }} /></span>{fatte}/{totale}</span>}
                    {m.scadenza && missioneAperta(m) && <span className={missioneScaduta(m, oggi) ? 'scaduta' : ''}>{giornoBreve(m.scadenza)}</span>}
                  </span>
                </button>
                {aperta && (
                  <div className="albatros-missione-corpo">
                    {sue.length === 0 && <p className="albatros-vuoto">Nessuna attività: aggiungi i passi da fare, la missione si chiude quando sono spuntati tutti.</p>}
                    <ul className="albatros-attivita">{sue.map(a => rigaAttivita(m, a))}</ul>
                    <div className="albatros-missione-nuova-attivita">
                      <input type="text" value={nuova.titolo} placeholder="Nuova attività" onChange={(e) => setNuova({ ...nuova, titolo: e.target.value })}
                        onKeyDown={(e) => e.key === 'Enter' && aggiungiAttivita(m)} className="albatros-campo" />
                      <select value={nuova.responsabile_id} onChange={(e) => setNuova({ ...nuova, responsabile_id: e.target.value })} className="albatros-campo" aria-label="Responsabile">
                        <option value="">Responsabile…</option>
                        {utentiOrdinati.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
                      </select>
                      <input type="date" value={nuova.scadenza} onChange={(e) => setNuova({ ...nuova, scadenza: e.target.value })} className="albatros-campo" aria-label="Scadenza" title="Scadenza (facoltativa)" />
                      <button type="button" className="btn-accent-inline albatros-bottone" disabled={inCorso} onClick={() => aggiungiAttivita(m)}><Icona nome="nuovo" />Aggiungi</button>
                    </div>
                    <div className="albatros-missione-piede">
                      <button type="button" className="btn-outline-annulla albatros-bottone" onClick={() => setDettaglioId(m.id)}>Dettagli</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {inForm && (
        <div className="modal-form-backdrop" onClick={() => setInForm(null)}>
          <div className="modal-form-box albatros-overlay" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-form-close" aria-label="Chiudi" onClick={() => setInForm(null)}>✕</button>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '1.1rem', color: '#0f172a' }}>{inForm.id ? 'Modifica missione' : 'Nuova missione'}</h3>
            <div className="albatros-griglia-2">
              <label className="albatros-etichetta" style={{ gridColumn: '1 / -1' }}>Titolo
                <input type="text" value={inForm.titolo} autoFocus placeholder="Es. Sistemare la rete del campo 2" onChange={(e) => setInForm({ ...inForm, titolo: e.target.value })} className="albatros-campo" />
              </label>
              <label className="albatros-etichetta" style={{ gridColumn: '1 / -1' }}>Descrizione
                <textarea value={inForm.descrizione} rows={3} placeholder="Facoltativa" onChange={(e) => setInForm({ ...inForm, descrizione: e.target.value })} className="albatros-campo" />
              </label>
              <label className="albatros-etichetta">Responsabile
                <select value={inForm.responsabile_id} onChange={(e) => setInForm({ ...inForm, responsabile_id: e.target.value })} className="albatros-campo">
                  <option value="">Nessuno</option>
                  {utentiOrdinati.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
                </select>
              </label>
              <label className="albatros-etichetta">Scadenza
                <input type="date" value={inForm.scadenza} onChange={(e) => setInForm({ ...inForm, scadenza: e.target.value })} className="albatros-campo" />
              </label>
              <label className="albatros-etichetta">Priorità
                <select value={inForm.priorita} onChange={(e) => setInForm({ ...inForm, priorita: e.target.value })} className="albatros-campo">
                  {PRIORITA_MISSIONE.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </label>
              {!inForm.id && (
                <label className="albatros-etichetta">Stato
                  <select value={inForm.stato} onChange={(e) => setInForm({ ...inForm, stato: e.target.value })} className="albatros-campo">
                    {STATI_MISSIONE.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </label>
              )}
            </div>
            <div style={{ display: 'flex', gap: '10px', marginTop: '16px', justifyContent: 'flex-end' }}>
              <button type="button" className="btn-outline-annulla albatros-bottone" onClick={() => setInForm(null)}>Annulla</button>
              <button type="button" className="btn-accent-inline albatros-bottone" disabled={inCorso} onClick={salvaMissione}><Icona nome="salva" />{inForm.id ? 'Salva' : 'Aggiungi'}</button>
            </div>
          </div>
        </div>
      )}

      {dettaglio && !inForm && (
        <div className="modal-form-backdrop" onClick={() => setDettaglioId(null)}>
          <div className="modal-form-box albatros-overlay" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-form-close" aria-label="Chiudi" onClick={() => setDettaglioId(null)}>✕</button>
            <h3 style={{ margin: '0 32px 10px 0', fontSize: '1.1rem', color: '#0f172a' }}>{dettaglio.titolo}</h3>
            {dettaglio.descrizione && <p className="albatros-missione-descrizione">{dettaglio.descrizione}</p>}
            <dl className="albatros-missione-dati">
              <dt>Inserita</dt><dd>{formattaDataGGMMAAAA(dettaglio.creato_il.slice(0, 10))} da {nomeUtente(dettaglio.creato_da)}</dd>
              <dt>Responsabile</dt><dd>{nomeUtente(dettaglio.responsabile_id)}</dd>
              <dt>Scadenza</dt><dd className={missioneScaduta(dettaglio, oggi) ? 'scaduta' : ''}>{dettaglio.scadenza ? formattaDataGGMMAAAA(dettaglio.scadenza) : '—'}</dd>
              <dt>Priorità</dt><dd>{etichettaPriorita(dettaglio.priorita)}</dd>
              {dettaglio.chiusa_il && <><dt>Chiusa</dt><dd>{formattaDataGGMMAAAA(dettaglio.chiusa_il.slice(0, 10))}</dd></>}
            </dl>

            <label className="albatros-etichetta" style={{ marginTop: '12px' }}>Stato
              <select value={dettaglio.stato} disabled={inCorso} onChange={(e) => cambiaStato(dettaglio, e.target.value)} className="albatros-campo">
                {STATI_MISSIONE.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </label>

            {storiaDi(dettaglio.id).length > 0 && (
              <>
                <h4 className="albatros-missione-sezione">Storia</h4>
                {storiaDi(dettaglio.id).map(z => (
                  <div key={z.id} className="albatros-azione">
                    <strong>{giornoBreve(z.data)}</strong>
                    <span className="testo">{z.descrizione}<span className="albatros-tenue"> · {nomeUtente(z.creato_da)}</span></span>
                  </div>
                ))}
              </>
            )}

            {puoCorreggere && (
              <div style={{ display: 'flex', gap: '10px', marginTop: '16px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button type="button" className="btn-outline-annulla albatros-bottone" style={{ color: '#b91c1c', borderColor: '#fecaca' }} onClick={() => eliminaMissione(dettaglio)}>
                  <Icona nome="elimina" />Cancella
                </button>
                <button type="button" className="btn-outline-annulla albatros-bottone" onClick={() => setInForm({
                  id: dettaglio.id, titolo: dettaglio.titolo, descrizione: dettaglio.descrizione || '', responsabile_id: dettaglio.responsabile_id ? String(dettaglio.responsabile_id) : '',
                  priorita: dettaglio.priorita, scadenza: dettaglio.scadenza || '', stato: dettaglio.stato,
                })}><Icona nome="modifica" />Modifica</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default Missioni
